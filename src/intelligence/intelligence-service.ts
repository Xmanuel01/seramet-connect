import { SerametHttpError, type SerametEnv, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";
import { resolveRuntimeConfiguration } from "@/server/environment";
import {
  IntelligenceEvidenceService,
  intelligenceToolDefinitions,
} from "@/intelligence/evidence-tools";
import { GroundingError, validateGroundedAnswer } from "@/intelligence/grounding";
import { minimizeEvidenceForProvider, sanitizeUntrustedText } from "@/intelligence/privacy";
import { createIntelligenceProviderRegistry } from "@/intelligence/provider-registry";
import { classifyIntent, planIntelligenceQuery } from "@/intelligence/query-planner";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import type {
  AskIntelligenceInput,
  EvidencePackage,
  IntelligenceProviderConfiguration,
  IntelligenceProviderAdapter,
  IntelligenceProviderResult,
  IntelligenceResponse,
  StructuredIntelligenceAnswer,
} from "@/intelligence/types";

type ProviderConfigRow = {
  id: string;
  provider_key: string;
  display_name: string;
  model_identifier: string;
  enabled: number;
  status: IntelligenceProviderConfiguration["status"];
  capabilities_json: string;
  secret_reference: string | null;
  timeout_ms: number;
  max_input_units: number;
  max_output_units: number;
  per_minute_limit: number;
  daily_request_limit: number;
  monthly_request_limit: number;
  per_user_daily_limit: number;
  retention_mode: IntelligenceProviderConfiguration["retentionMode"];
  allowed_features_json: string;
  allowed_role_ids_json: string;
  prompt_version: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  permission_fingerprint: string;
  status: string;
  retention_mode: IntelligenceProviderConfiguration["retentionMode"];
  expires_at: string | null;
};

type BriefRow = {
  id: string;
  branch_id: string | null;
  brief_type: string;
  period_start: string;
  period_end: string;
  status: string;
  correlation_id: string;
};

type BriefSummaryRow = BriefRow & {
  quality: string;
  answer_json: string | null;
  provider_key: string | null;
  model_identifier: string | null;
  prompt_version: string | null;
  created_at: string;
  completed_at: string | null;
};

type ActionProposalRow = {
  expires_at: string;
  confirmation_token_hash: string;
  action_type: string;
  payload_json: string;
};

export class IntelligenceService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
    private readonly env: SerametEnv,
  ) {}

  async ask(input: AskIntelligenceInput): Promise<IntelligenceResponse> {
    this.require(permissions.intelligenceAsk);
    await this.assertEntitled("intelligence.basic");
    const providerConfig = await this.providerConfiguration();
    this.assertProviderAllowed(providerConfig);
    const permissionFingerprint = await hashJson([...this.actor.permissions].sort());
    const session = await this.getOrCreateSession(
      input.sessionId,
      input.question,
      providerConfig.retentionMode,
      permissionFingerprint,
    );
    let plan = await planIntelligenceQuery(this.db, this.actor, input.question);
    if (plan.intent === "UNSUPPORTED") {
      const priorIntent = await this.previousIntent(session.id);
      if (priorIntent) {
        const fallbackPlan = await planIntelligenceQuery(this.db, this.actor, priorIntent.question);
        plan = { ...fallbackPlan, intent: priorIntent.intent };
      }
    }
    await this.assertIntentEntitlement(plan.intent);
    if (plan.intent === "UNSUPPORTED") {
      throw new SerametHttpError(
        422,
        "This question is outside the allowlisted Seramet intelligence intents",
      );
    }
    const allowedIntents = providerConfig.allowedFeatures.filter(isIntelligenceIntent);
    if (allowedIntents.length > 0 && !allowedIntents.includes(plan.intent)) {
      throw new SerametHttpError(403, `Intelligence feature ${plan.intent} is not enabled`);
    }
    const evidence = await new IntelligenceEvidenceService(this.db, this.actor).build(
      plan,
      input.branchIds,
    );
    const branchScopeHash = await hashJson(evidence.authorizedBranchIds);
    const cacheKey = await hashJson({
      question: normalizeQuestion(input.question),
      intent: plan.intent,
      period: plan.period,
      branchScopeHash,
      permissionFingerprint,
      evidenceWatermark: evidence.evidenceWatermark,
      promptVersion: providerConfig.promptVersion,
      model: providerConfig.modelIdentifier,
    });
    const cached = input.forceRefresh
      ? null
      : await this.cachedAnswer(cacheKey, permissionFingerprint, branchScopeHash, evidence);
    const requestId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    await this.persistMessage({
      id: userMessageId,
      session,
      role: "USER",
      intent: plan.intent,
      status: "COMPLETE",
      requestId,
      content:
        session.retention_mode === "EPHEMERAL"
          ? { ephemeral: true }
          : { question: sanitizeUntrustedText(input.question, 1200) },
    });
    if (cached) {
      return this.persistAnswer({
        requestId,
        correlationId,
        session,
        providerConfig,
        evidence,
        answer: cached,
        cached: true,
      });
    }
    await this.reserveUsage(
      requestId,
      correlationId,
      providerConfig,
      plan.intent,
      evidence.authorizedBranchIds[0],
    );
    let provider: IntelligenceProviderAdapter;
    try {
      provider = createIntelligenceProviderRegistry(this.env).resolve(providerConfig, this.env);
    } catch {
      await this.recordUsageOutcome(
        requestId,
        correlationId,
        providerConfig,
        plan.intent,
        "FAILED",
        0,
        0,
        0,
        "PROVIDER_UNAVAILABLE",
      );
      throw new SerametHttpError(503, "Intelligence temporarily unavailable");
    }
    const health = await this.observeProviderHealth(providerConfig, provider);
    if (health === "UNAVAILABLE") {
      await this.recordUsageOutcome(
        requestId,
        correlationId,
        providerConfig,
        plan.intent,
        "FAILED",
        0,
        0,
        0,
        "PROVIDER_UNAVAILABLE",
      );
      throw new SerametHttpError(503, "Intelligence temporarily unavailable");
    }
    const started = Date.now();
    let result: IntelligenceProviderResult;
    try {
      const { tenantId: _tenantId, ...tenantNeutralEvidence } = evidence;
      const providerEvidence = minimizeEvidenceForProvider(tenantNeutralEvidence) as Omit<
        EvidencePackage,
        "tenantId"
      >;
      result = await provider.generateStructuredResponse({
        requestId,
        correlationId,
        providerKey: providerConfig.providerKey,
        modelIdentifier: providerConfig.modelIdentifier,
        promptVersion: providerConfig.promptVersion,
        question: sanitizeUntrustedText(input.question, 1200),
        intent: plan.intent,
        evidence: providerEvidence,
        maxOutputUnits: providerConfig.maxOutputUnits,
      });
    } catch (error) {
      await this.recordUsageOutcome(
        requestId,
        correlationId,
        providerConfig,
        plan.intent,
        "FAILED",
        0,
        0,
        Date.now() - started,
        classifyProviderError(error),
      );
      throw new SerametHttpError(503, "Intelligence temporarily unavailable");
    }
    let answer: StructuredIntelligenceAnswer;
    try {
      answer = validateGroundedAnswer(result.answer, evidence);
    } catch (error) {
      await this.recordUsageOutcome(
        requestId,
        correlationId,
        providerConfig,
        plan.intent,
        "REJECTED",
        result.inputUnits,
        result.outputUnits,
        result.latencyMs,
        error instanceof Error ? error.name || "GROUNDING_REJECTED" : "GROUNDING_REJECTED",
      );
      throw new SerametHttpError(
        422,
        `The provider answer failed Seramet grounding checks${error instanceof GroundingError ? ` (${error.code}: ${error.message})` : ""}`,
      );
    }
    await this.recordUsageOutcome(
      requestId,
      correlationId,
      providerConfig,
      plan.intent,
      "SUCCEEDED",
      result.inputUnits,
      result.outputUnits,
      result.latencyMs,
      undefined,
      result.providerCostMinor,
      result.costCurrency,
    );
    await this.storeCache(cacheKey, permissionFingerprint, branchScopeHash, evidence, answer);
    return this.persistAnswer({
      requestId,
      correlationId,
      session,
      providerConfig,
      evidence,
      answer,
      cached: false,
      health,
    });
  }

  async listSessions(limit = 30) {
    this.require(permissions.intelligenceAsk);
    const rows = await this.db
      .prepare(
        `SELECT id,title,status,retention_mode,created_at,updated_at,expires_at
         FROM intelligence_sessions WHERE tenant_id=? AND user_id=?
         ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, this.actor.id, Math.min(100, Math.max(1, limit)))
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async listSessionMessages(sessionId: string, limit = 100) {
    this.require(permissions.intelligenceAsk);
    const owned = await this.db
      .prepare(
        `SELECT id FROM intelligence_sessions
         WHERE tenant_id=? AND id=? AND user_id=? AND status IN ('ACTIVE','CLOSED')`,
      )
      .bind(this.actor.tenantId, sessionId, this.actor.id)
      .first<{ id: string }>();
    if (!owned) throw new SerametHttpError(404, "Intelligence session not found");
    const rows = await this.db
      .prepare(
        `SELECT id,role,intent,content_json,status,provider_key,model_identifier,prompt_version,
          request_id,created_at FROM intelligence_messages
         WHERE tenant_id=? AND session_id=? ORDER BY created_at ASC LIMIT ?`,
      )
      .bind(this.actor.tenantId, sessionId, Math.min(200, Math.max(1, limit)))
      .all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      ...row,
      content: parseJson(row["content_json"], {}),
      content_json: undefined,
    }));
  }

  listAuthorizedTools() {
    this.require(permissions.intelligenceAsk);
    return Object.values(intelligenceToolDefinitions).filter((definition) =>
      [definition.intelligencePermission, ...definition.sourcePermissions].every((permission) =>
        this.actor.permissions.includes(permission),
      ),
    );
  }

  async listBriefs(limit = 30) {
    this.require(permissions.intelligenceBriefsView);
    const branchIds = this.authorizedBranches();
    const rows = await this.db
      .prepare(
        `SELECT id,branch_id,brief_type,period_start,period_end,status,quality,answer_json,
          provider_key,model_identifier,prompt_version,created_at,completed_at
         FROM intelligence_briefs WHERE tenant_id=?
          AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
         ORDER BY period_end DESC,created_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, ...branchIds, Math.min(100, Math.max(1, limit)))
      .all<BriefSummaryRow>();
    return (rows.results ?? []).map((row) => ({
      ...row,
      answer: parseJson(row["answer_json"], null),
      answer_json: undefined,
    }));
  }

  async prepareBrief(input: {
    briefType: "MORNING" | "EOD" | "OWNER" | "MANAGEMENT";
    branchId?: string;
    periodStart?: string;
    periodEnd?: string;
  }) {
    this.require(permissions.intelligenceBriefsManage);
    await this.assertEntitled("intelligence.scheduled_briefs");
    if (input.branchId && !this.authorizedBranches().includes(input.branchId)) {
      throw new SerametHttpError(403, "Brief branch is not authorized");
    }
    if (input.briefType === "OWNER") {
      this.require(permissions.intelligenceOwner);
    }
    const question = briefQuestion(input.briefType);
    const plan = await planIntelligenceQuery(this.db, this.actor, question);
    const periodStart = input.periodStart ?? plan.period.start;
    const periodEnd = input.periodEnd ?? plan.period.end;
    if (periodEnd < periodStart) throw new SerametHttpError(400, "Brief period is invalid");
    const provider = await this.providerConfiguration();
    const generationKey = await hashJson({
      type: input.briefType,
      branchId: input.branchId ?? "all-authorized",
      periodStart,
      periodEnd,
      promptVersion: provider.promptVersion,
    });
    const id = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT INTO intelligence_briefs
         (tenant_id,id,branch_id,brief_type,period_start,period_end,status,quality,evidence_json,
          generation_key,correlation_id,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'PENDING','INSUFFICIENT_DATA','{}',?,?,?,?,?)
         ON CONFLICT(tenant_id,generation_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.branchId ?? null,
        input.briefType,
        periodStart,
        periodEnd,
        generationKey,
        correlationId,
        this.actor.id,
        stamp,
        stamp,
      )
      .run();
    const brief = await this.db
      .prepare(
        `SELECT id,branch_id,brief_type,period_start,period_end,status,correlation_id
         FROM intelligence_briefs WHERE tenant_id=? AND generation_key=?`,
      )
      .bind(this.actor.tenantId, generationKey)
      .first<BriefRow>();
    if (!brief) throw new SerametHttpError(500, "Brief identity was not persisted");
    return { ...brief, duplicate: (result.meta?.changes ?? 0) === 0 };
  }

  async generateBrief(briefId: string) {
    this.require(permissions.intelligenceBriefsManage);
    await this.assertEntitled("intelligence.scheduled_briefs");
    const claimed = await this.db
      .prepare(
        `UPDATE intelligence_briefs SET status='GENERATING',updated_at=?
         WHERE tenant_id=? AND id=? AND status IN ('PENDING','FAILED')
         RETURNING id,branch_id,brief_type,period_start,period_end,correlation_id`,
      )
      .bind(new Date().toISOString(), this.actor.tenantId, briefId)
      .first<BriefRow>();
    if (!claimed) {
      const existing = await this.db
        .prepare("SELECT status FROM intelligence_briefs WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, briefId)
        .first<{ status: string }>();
      if (existing?.status === "READY" || existing?.status === "PARTIAL") return existing;
      throw new SerametHttpError(409, "Brief cannot be generated in its current state");
    }
    try {
      const response = await this.ask({
        question: briefQuestion(claimed.brief_type),
        ...(claimed.branch_id ? { branchIds: [claimed.branch_id] } : {}),
        forceRefresh: true,
      });
      const status = ["HIGH", "COMPLETE"].includes(response.answer.dataQuality)
        ? "READY"
        : "PARTIAL";
      const stamp = new Date().toISOString();
      await this.db.batch([
        this.db
          .prepare(
            `UPDATE intelligence_briefs SET status=?,quality=?,evidence_json=?,answer_json=?,
             provider_key=?,model_identifier=?,prompt_version=?,updated_at=?,completed_at=?
             WHERE tenant_id=? AND id=? AND status='GENERATING'`,
          )
          .bind(
            status,
            response.answer.dataQuality,
            JSON.stringify(response.evidence),
            JSON.stringify(response.answer),
            response.provider.key,
            response.provider.modelIdentifier,
            await this.currentPromptVersion(),
            stamp,
            stamp,
            this.actor.tenantId,
            briefId,
          ),
        this.auditStatement(
          "INTELLIGENCE_BRIEF_GENERATED",
          "INTELLIGENCE_BRIEF",
          briefId,
          `${claimed.brief_type} brief generated from authorized evidence`,
          claimed.correlation_id,
          stamp,
        ),
      ]);
      return { id: briefId, status, quality: response.answer.dataQuality };
    } catch (error) {
      await this.db
        .prepare(
          `UPDATE intelligence_briefs SET status='FAILED',updated_at=?
           WHERE tenant_id=? AND id=? AND status='GENERATING'`,
        )
        .bind(new Date().toISOString(), this.actor.tenantId, briefId)
        .run();
      throw error;
    }
  }

  async expireRetainedData(at = new Date()) {
    this.require(permissions.intelligenceAdmin);
    const stamp = at.toISOString();
    const [messages, sessions, cache] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE intelligence_messages SET content_json='{"expired":true}'
           WHERE tenant_id=? AND session_id IN
            (SELECT id FROM intelligence_sessions WHERE tenant_id=? AND expires_at IS NOT NULL AND expires_at<=?)`,
        )
        .bind(this.actor.tenantId, this.actor.tenantId, stamp),
      this.db
        .prepare(
          `UPDATE intelligence_sessions SET status='EXPIRED',updated_at=?
           WHERE tenant_id=? AND status='ACTIVE' AND expires_at IS NOT NULL AND expires_at<=?`,
        )
        .bind(stamp, this.actor.tenantId, stamp),
      this.db
        .prepare("DELETE FROM intelligence_answer_cache WHERE tenant_id=? AND expires_at<=?")
        .bind(this.actor.tenantId, stamp),
    ]);
    return {
      messagesRedacted: messages?.meta?.changes ?? 0,
      sessionsExpired: sessions?.meta?.changes ?? 0,
      cacheDeleted: cache?.meta?.changes ?? 0,
    };
  }

  async recordFeedback(input: {
    messageId: string;
    rating: "HELPFUL" | "NOT_HELPFUL" | "INCORRECT_OR_MISSING_EVIDENCE";
    note?: string;
  }) {
    this.require(permissions.intelligenceAsk);
    const owned = await this.db
      .prepare(
        `SELECT m.id FROM intelligence_messages m JOIN intelligence_sessions s
         ON s.tenant_id=m.tenant_id AND s.id=m.session_id
         WHERE m.tenant_id=? AND m.id=? AND s.user_id=?`,
      )
      .bind(this.actor.tenantId, input.messageId, this.actor.id)
      .first<{ id: string }>();
    if (!owned) throw new SerametHttpError(404, "Intelligence message not found");
    const id = crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO intelligence_feedback
         (tenant_id,id,message_id,user_id,rating,note,created_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,message_id,user_id) DO UPDATE SET rating=excluded.rating,note=excluded.note`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.messageId,
        this.actor.id,
        input.rating,
        input.note ? sanitizeUntrustedText(input.note, 1000) : null,
        new Date().toISOString(),
      )
      .run();
    return { id, ...input };
  }

  async providerAdminSummary() {
    this.require(permissions.intelligenceUsageView);
    const config = await this.providerConfiguration(false);
    const usage = await this.db
      .prepare(
        `SELECT COUNT(*) requests,
          SUM(CASE WHEN status='SUCCEEDED' THEN 1 ELSE 0 END) succeeded,
          SUM(CASE WHEN status IN ('FAILED','REJECTED') THEN 1 ELSE 0 END) failed,
          SUM(input_units) input_units,SUM(output_units) output_units,
          SUM(COALESCE(provider_cost_minor,0)) provider_cost_minor,
          AVG(latency_ms) average_latency_ms
         FROM intelligence_usage_events WHERE tenant_id=? AND status<>'RESERVED'
         AND created_at>=?`,
      )
      .bind(this.actor.tenantId, monthStart())
      .first<Record<string, unknown>>();
    const health = config
      ? await this.db
          .prepare(
            `SELECT status,observed_latency_ms,failure_code,observed_at
             FROM intelligence_provider_health WHERE tenant_id=? AND provider_config_id=?`,
          )
          .bind(this.actor.tenantId, config.id)
          .first<Record<string, unknown>>()
      : null;
    return {
      enabled: Boolean(config?.enabled),
      provider: config
        ? {
            id: config.id,
            key: config.providerKey,
            displayName: config.displayName,
            modelIdentifier: config.modelIdentifier,
            status: config.status,
            capabilities: config.capabilities,
            timeoutMs: config.timeoutMs,
            maxInputUnits: config.maxInputUnits,
            maxOutputUnits: config.maxOutputUnits,
            perMinuteLimit: config.perMinuteLimit,
            dailyRequestLimit: config.dailyRequestLimit,
            monthlyRequestLimit: config.monthlyRequestLimit,
            perUserDailyLimit: config.perUserDailyLimit,
            retentionMode: config.retentionMode,
            allowedFeatures: config.allowedFeatures,
            allowedRoleIds: config.allowedRoleIds,
            promptVersion: config.promptVersion,
            secretConfigured: Boolean(config.secretReference),
          }
        : null,
      health,
      usage: usage ?? {},
    };
  }

  async upsertProviderConfiguration(input: {
    id?: string;
    providerKey: string;
    displayName: string;
    modelIdentifier: string;
    enabled: boolean;
    secretReference?: string;
    timeoutMs: number;
    maxInputUnits: number;
    maxOutputUnits: number;
    perMinuteLimit: number;
    dailyRequestLimit: number;
    monthlyRequestLimit: number;
    perUserDailyLimit: number;
    retentionMode: IntelligenceProviderConfiguration["retentionMode"];
    allowedFeatures: string[];
    allowedRoleIds: string[];
    promptVersion: string;
  }) {
    this.require(permissions.intelligenceAdmin);
    const runtime = resolveRuntimeConfiguration(this.env);
    if (input.providerKey === "DETERMINISTIC_TEST" && runtime.productionLike) {
      throw new SerametHttpError(
        400,
        "The deterministic test provider cannot activate in production",
      );
    }
    if (
      input.secretReference &&
      !/^([A-Z][A-Z0-9_]+|env:\/\/[A-Z][A-Z0-9_]+|managed:\/\/[A-Za-z0-9/_.-]+)$/.test(
        input.secretReference,
      )
    ) {
      throw new SerametHttpError(400, "Provider secret reference is invalid");
    }
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO intelligence_provider_configs
           (tenant_id,id,provider_key,display_name,model_identifier,enabled,status,capabilities_json,
            secret_reference,timeout_ms,max_input_units,max_output_units,per_minute_limit,
            daily_request_limit,monthly_request_limit,per_user_daily_limit,retention_mode,
            allowed_features_json,allowed_role_ids_json,prompt_version,configuration_json,
            created_by,created_at,updated_by,updated_at)
           VALUES (?,?,?,?,?,?,?,'["STRUCTURED_OUTPUT"]',?,?,?,?,?,?,?,?,?,?,?,?, '{}',?,?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET provider_key=excluded.provider_key,
            display_name=excluded.display_name,model_identifier=excluded.model_identifier,
            enabled=excluded.enabled,status=excluded.status,
            secret_reference=COALESCE(excluded.secret_reference,intelligence_provider_configs.secret_reference),
            timeout_ms=excluded.timeout_ms,max_input_units=excluded.max_input_units,
            max_output_units=excluded.max_output_units,per_minute_limit=excluded.per_minute_limit,
            daily_request_limit=excluded.daily_request_limit,monthly_request_limit=excluded.monthly_request_limit,
            per_user_daily_limit=excluded.per_user_daily_limit,retention_mode=excluded.retention_mode,
            allowed_features_json=excluded.allowed_features_json,allowed_role_ids_json=excluded.allowed_role_ids_json,
            prompt_version=excluded.prompt_version,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.providerKey,
          input.displayName,
          input.modelIdentifier,
          input.enabled ? 1 : 0,
          input.enabled ? "CONFIGURED" : "DISABLED",
          input.secretReference ?? null,
          input.timeoutMs,
          input.maxInputUnits,
          input.maxOutputUnits,
          input.perMinuteLimit,
          input.dailyRequestLimit,
          input.monthlyRequestLimit,
          input.perUserDailyLimit,
          input.retentionMode,
          JSON.stringify(input.allowedFeatures),
          JSON.stringify(input.allowedRoleIds),
          input.promptVersion,
          this.actor.id,
          stamp,
          this.actor.id,
          stamp,
        ),
      this.auditStatement(
        "INTELLIGENCE_PROVIDER_CONFIGURATION_CHANGED",
        "INTELLIGENCE_PROVIDER_CONFIG",
        id,
        "Provider metadata changed; secret value excluded",
        crypto.randomUUID(),
        stamp,
      ),
    ]);
    return this.providerConfiguration(false);
  }

  async proposeManagementAction(actionId: string) {
    this.require(permissions.intelligenceActionsSuggest);
    this.require(permissions.managementActionsManage);
    const action = await this.db
      .prepare(
        `SELECT id,branch_id,status FROM management_actions WHERE tenant_id=? AND id=?
         AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
      )
      .bind(this.actor.tenantId, actionId)
      .first<{ id: string; branch_id: string | null; status: string }>();
    if (!action) throw new SerametHttpError(404, "Management action not found");
    if (action.branch_id && !this.authorizedBranches().includes(action.branch_id)) {
      throw new SerametHttpError(403, "Management action branch is not authorized");
    }
    const latestMessage = await this.latestAssistantMessage();
    if (!latestMessage) throw new SerametHttpError(409, "No intelligence answer is available");
    const token = randomToken();
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO intelligence_action_proposals
         (tenant_id,id,session_id,message_id,branch_id,action_type,risk,payload_json,status,
          confirmation_token_hash,expires_at,created_by,created_at)
         VALUES (?,?,?,?,?,'ACKNOWLEDGE_MANAGEMENT_ACTION','LOW',?,'PROPOSED',?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        latestMessage.session_id,
        latestMessage.id,
        action.branch_id,
        JSON.stringify({ actionId }),
        await hashText(token),
        new Date(Date.now() + 5 * 60_000).toISOString(),
        this.actor.id,
        stamp,
      )
      .run();
    return {
      id,
      actionType: "ACKNOWLEDGE_MANAGEMENT_ACTION",
      risk: "LOW",
      confirmationToken: token,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async confirmAction(proposalId: string, token: string, note: string) {
    this.require(permissions.intelligenceActionsSuggest);
    this.require(permissions.managementActionsManage);
    const proposal = await this.db
      .prepare(
        `SELECT * FROM intelligence_action_proposals WHERE tenant_id=? AND id=?
         AND created_by=? AND status='PROPOSED'`,
      )
      .bind(this.actor.tenantId, proposalId, this.actor.id)
      .first<ActionProposalRow>();
    if (!proposal) throw new SerametHttpError(404, "Action proposal not found");
    if (Date.parse(proposal.expires_at) <= Date.now()) {
      throw new SerametHttpError(409, "Action proposal expired");
    }
    if ((await hashText(token)) !== proposal.confirmation_token_hash) {
      throw new SerametHttpError(403, "Action confirmation token is invalid");
    }
    if (proposal.action_type !== "ACKNOWLEDGE_MANAGEMENT_ACTION") {
      throw new SerametHttpError(403, "High-risk or unsupported intelligence action is blocked");
    }
    const payload = parseJson<{ actionId?: string }>(proposal.payload_json, {});
    if (!payload.actionId) throw new SerametHttpError(409, "Action proposal payload is invalid");
    const transitioned = await new ManagementIntelligenceService(
      this.db,
      this.actor,
    ).transitionAction(payload.actionId, "ACKNOWLEDGED", note);
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE intelligence_action_proposals SET status='CONFIRMED',confirmed_by=?,confirmed_at=?
           WHERE tenant_id=? AND id=? AND status='PROPOSED'`,
        )
        .bind(this.actor.id, stamp, this.actor.tenantId, proposalId),
      this.auditStatement(
        "INTELLIGENCE_SUGGESTED_ACTION_ACCEPTED",
        "INTELLIGENCE_ACTION_PROPOSAL",
        proposalId,
        note,
        correlationId,
        stamp,
      ),
    ]);
    return { proposalId, transitioned };
  }

  private async providerConfiguration(required?: true): Promise<IntelligenceProviderConfiguration>;
  private async providerConfiguration(
    required: false,
  ): Promise<IntelligenceProviderConfiguration | null>;
  private async providerConfiguration(
    required = true,
  ): Promise<IntelligenceProviderConfiguration | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM intelligence_provider_configs WHERE tenant_id=?
         ${required ? "AND enabled=1 AND status IN ('CONFIGURED','DEGRADED')" : ""}
         ORDER BY enabled DESC,updated_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId)
      .first<ProviderConfigRow>();
    if (!row) {
      if (required) throw new SerametHttpError(503, "Intelligence temporarily unavailable");
      return null;
    }
    return mapProviderConfig(this.actor.tenantId, row);
  }

  private assertProviderAllowed(config: IntelligenceProviderConfiguration) {
    const runtime = resolveRuntimeConfiguration(this.env);
    if (config.providerKey === "DETERMINISTIC_TEST" && runtime.productionLike) {
      throw new SerametHttpError(503, "Test intelligence provider is forbidden in production");
    }
    if (
      config.allowedRoleIds.length > 0 &&
      !this.actor.roleIds.some((roleId) => config.allowedRoleIds.includes(roleId))
    ) {
      throw new SerametHttpError(403, "Intelligence is not enabled for this user's roles");
    }
  }

  private async assertEntitled(featureKey: string) {
    const flag = await this.db
      .prepare("SELECT enabled FROM feature_flags WHERE tenant_id=? AND key='intelligence.enabled'")
      .bind(this.actor.tenantId)
      .first<{ enabled: number }>();
    const entitlement = await this.db
      .prepare(
        `SELECT e.enabled FROM tenant_subscriptions s JOIN feature_entitlements e
         ON e.tenant_id=s.tenant_id AND e.subscription_id=s.id
         WHERE s.tenant_id=? AND s.status IN ('TRIAL','ACTIVE') AND e.feature_key=?
         ORDER BY s.starts_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, featureKey)
      .first<{ enabled: number }>();
    if (!flag?.enabled || !entitlement?.enabled) {
      throw new SerametHttpError(403, "Intelligence entitlement is not active");
    }
  }

  private async assertIntentEntitlement(intent: string) {
    if (
      ["FINANCE", "FOOD_COST", "PAYMENT_RECONCILIATION", "SETTLEMENT", "CLOSE_READINESS"].includes(
        intent,
      )
    ) {
      await this.assertEntitled("intelligence.finance");
    }
    if (["OWNER_OVERVIEW", "COMPARE_BRANCHES", "ENTERPRISE_OVERVIEW"].includes(intent)) {
      await this.assertEntitled("intelligence.owner");
    }
    if (["COMPARE_PERIODS", "CHANNEL_PROFITABILITY"].includes(intent)) {
      await this.assertEntitled("intelligence.advanced_analysis");
    }
  }

  private async currentPromptVersion() {
    return (await this.providerConfiguration()).promptVersion;
  }

  private async getOrCreateSession(
    sessionId: string | undefined,
    question: string,
    retention: IntelligenceProviderConfiguration["retentionMode"],
    permissionFingerprint: string,
  ): Promise<SessionRow> {
    if (sessionId) {
      const session = await this.db
        .prepare(
          `SELECT id,user_id,permission_fingerprint,status,retention_mode,expires_at
           FROM intelligence_sessions WHERE tenant_id=? AND id=? AND user_id=?`,
        )
        .bind(this.actor.tenantId, sessionId, this.actor.id)
        .first<SessionRow>();
      if (!session || session.status !== "ACTIVE")
        throw new SerametHttpError(404, "Intelligence session not found");
      if (session.expires_at && Date.parse(session.expires_at) <= Date.now())
        throw new SerametHttpError(410, "Intelligence session expired");
      if (session.permission_fingerprint !== permissionFingerprint)
        throw new SerametHttpError(
          409,
          "Session permissions changed; start a new intelligence session",
        );
      return session;
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const expiresAt =
      retention === "EPHEMERAL"
        ? stamp
        : new Date(Date.now() + (retention === "SHORT" ? 7 : 30) * 86_400_000).toISOString();
    const branchScope = JSON.stringify({
      type: this.actor.branchScope.type,
      branchIds: this.authorizedBranches(),
    });
    await this.db
      .prepare(
        `INSERT INTO intelligence_sessions
         (tenant_id,id,user_id,title,branch_scope_json,permission_fingerprint,status,
          retention_mode,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        this.actor.id,
        sanitizeUntrustedText(question, 80),
        branchScope,
        permissionFingerprint,
        retention,
        stamp,
        stamp,
        expiresAt,
      )
      .run();
    return {
      id,
      user_id: this.actor.id,
      permission_fingerprint: permissionFingerprint,
      status: "ACTIVE",
      retention_mode: retention,
      expires_at: expiresAt,
    };
  }

  private async previousIntent(sessionId: string) {
    const row = await this.db
      .prepare(
        `SELECT intent FROM intelligence_messages WHERE tenant_id=? AND session_id=?
         AND intent IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, sessionId)
      .first<{ intent: string }>();
    if (!row?.intent) return null;
    return {
      intent: row.intent as ReturnType<typeof classifyIntent>,
      question: intentQuestion(row.intent),
    };
  }

  private persistMessage(input: {
    id: string;
    session: SessionRow;
    role: "USER" | "ASSISTANT" | "SYSTEM_EVENT";
    intent: string;
    status: "PENDING" | "COMPLETE" | "REJECTED" | "FAILED";
    requestId: string;
    content: unknown;
    providerConfig?: IntelligenceProviderConfiguration;
  }) {
    const stamp = new Date().toISOString();
    return this.db.batch([
      this.db
        .prepare(
          `INSERT INTO intelligence_messages
           (tenant_id,id,session_id,role,intent,content_json,status,provider_key,model_identifier,
            prompt_version,request_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          input.id,
          input.session.id,
          input.role,
          input.intent,
          JSON.stringify(input.content),
          input.status,
          input.providerConfig?.providerKey ?? null,
          input.providerConfig?.modelIdentifier ?? null,
          input.providerConfig?.promptVersion ?? null,
          input.requestId,
          stamp,
        ),
      this.db
        .prepare("UPDATE intelligence_sessions SET updated_at=? WHERE tenant_id=? AND id=?")
        .bind(stamp, this.actor.tenantId, input.session.id),
    ]);
  }

  private async persistAnswer(input: {
    requestId: string;
    correlationId: string;
    session: SessionRow;
    providerConfig: IntelligenceProviderConfiguration;
    evidence: EvidencePackage;
    answer: StructuredIntelligenceAnswer;
    cached: boolean;
    health?: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
  }): Promise<IntelligenceResponse> {
    const messageId = crypto.randomUUID();
    await this.persistMessage({
      id: messageId,
      session: input.session,
      role: "ASSISTANT",
      intent: input.evidence.intent,
      status: "COMPLETE",
      requestId: input.requestId,
      content: input.session.retention_mode === "EPHEMERAL" ? { ephemeral: true } : input.answer,
      providerConfig: input.providerConfig,
    });
    const statements = input.evidence.sources.map((source) =>
      this.db
        .prepare(
          `INSERT INTO intelligence_evidence_refs
           (tenant_id,id,session_id,message_id,branch_id,tool_key,source_type,source_id,quality,
            evidence_watermark,payload_hash,calculated_at,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          input.session.id,
          messageId,
          source.branchId ?? null,
          source.toolKey,
          source.sourceType,
          source.sourceId,
          source.quality,
          input.evidence.evidenceWatermark,
          source.payloadHash,
          source.calculatedAt,
          new Date().toISOString(),
        ),
    );
    if (statements.length) await this.db.batch(statements);
    return {
      requestId: input.requestId,
      correlationId: input.correlationId,
      sessionId: input.session.id,
      messageId,
      intent: input.evidence.intent,
      answer: input.answer,
      evidence: input.evidence,
      provider: {
        key: input.providerConfig.providerKey,
        displayName: input.providerConfig.displayName,
        modelIdentifier: input.providerConfig.modelIdentifier,
        health: input.health ?? "UNKNOWN",
        demo: input.providerConfig.providerKey === "DETERMINISTIC_TEST",
      },
      cached: input.cached,
      generatedAt: new Date().toISOString(),
    };
  }

  private async reserveUsage(
    requestId: string,
    correlationId: string,
    config: IntelligenceProviderConfiguration,
    intent: string,
    branchId?: string,
  ) {
    const now = new Date();
    const stamp = now.toISOString();
    const minute = new Date(now.getTime() - 60_000).toISOString();
    const day = `${stamp.slice(0, 10)}T00:00:00.000Z`;
    const month = `${stamp.slice(0, 7)}-01T00:00:00.000Z`;
    const result = await this.db
      .prepare(
        `INSERT INTO intelligence_usage_events
         (tenant_id,id,user_id,branch_id,request_id,intent,feature_key,provider_key,model_identifier,
          input_units,output_units,latency_ms,status,correlation_id,created_at)
         SELECT ?,?,?,?,?,?,'intelligence.basic',?,?,0,0,0,'RESERVED',?,?
         WHERE (SELECT COUNT(*) FROM intelligence_usage_events WHERE tenant_id=? AND status='RESERVED' AND created_at>=?) < ?
           AND (SELECT COUNT(*) FROM intelligence_usage_events WHERE tenant_id=? AND status='RESERVED' AND created_at>=?) < ?
           AND (SELECT COUNT(*) FROM intelligence_usage_events WHERE tenant_id=? AND status='RESERVED' AND created_at>=?) < ?
           AND (SELECT COUNT(*) FROM intelligence_usage_events WHERE tenant_id=? AND user_id=? AND status='RESERVED' AND created_at>=?) < ?`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.id,
        branchId ?? null,
        requestId,
        intent,
        config.providerKey,
        config.modelIdentifier,
        correlationId,
        stamp,
        this.actor.tenantId,
        minute,
        config.perMinuteLimit,
        this.actor.tenantId,
        day,
        config.dailyRequestLimit,
        this.actor.tenantId,
        month,
        config.monthlyRequestLimit,
        this.actor.tenantId,
        this.actor.id,
        day,
        config.perUserDailyLimit,
      )
      .run();
    if ((result.meta?.changes ?? 0) !== 1) {
      await this.recordUsageOutcome(
        requestId,
        correlationId,
        config,
        intent,
        "LIMITED",
        0,
        0,
        0,
        "USAGE_LIMIT_REACHED",
        undefined,
        undefined,
        true,
      );
      throw new SerametHttpError(429, "Intelligence usage limit reached");
    }
  }

  private async recordUsageOutcome(
    requestId: string,
    correlationId: string,
    config: IntelligenceProviderConfiguration,
    intent: string,
    status: "SUCCEEDED" | "REJECTED" | "FAILED" | "LIMITED",
    inputUnits: number,
    outputUnits: number,
    latencyMs: number,
    errorCategory?: string,
    providerCostMinor?: number,
    costCurrency?: string,
    ignoreDuplicate = false,
  ) {
    const sql = `${ignoreDuplicate ? "INSERT OR IGNORE" : "INSERT"} INTO intelligence_usage_events
      (tenant_id,id,user_id,branch_id,request_id,intent,feature_key,provider_key,model_identifier,
       input_units,output_units,provider_cost_minor,cost_currency,latency_ms,status,error_category,
       correlation_id,created_at) VALUES (?,?,?,?,?,?,'intelligence.basic',?,?,?,?,?,?,?,?,?,?,?)`;
    await this.db
      .prepare(sql)
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.id,
        this.actor.branchId,
        requestId,
        intent,
        config.providerKey,
        config.modelIdentifier,
        inputUnits,
        outputUnits,
        providerCostMinor ?? null,
        costCurrency ?? null,
        latencyMs,
        status,
        errorCategory ?? null,
        correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  private async cachedAnswer(
    cacheKey: string,
    permissionFingerprint: string,
    branchScopeHash: string,
    evidence: EvidencePackage,
  ) {
    const row = await this.db
      .prepare(
        `SELECT response_json FROM intelligence_answer_cache WHERE tenant_id=? AND cache_key=?
         AND permission_fingerprint=? AND branch_scope_hash=? AND evidence_watermark=? AND expires_at>?`,
      )
      .bind(
        this.actor.tenantId,
        cacheKey,
        permissionFingerprint,
        branchScopeHash,
        evidence.evidenceWatermark,
        new Date().toISOString(),
      )
      .first<{ response_json: string }>();
    return row ? parseJson<StructuredIntelligenceAnswer | null>(row.response_json, null) : null;
  }

  private storeCache(
    cacheKey: string,
    permissionFingerprint: string,
    branchScopeHash: string,
    evidence: EvidencePackage,
    answer: StructuredIntelligenceAnswer,
  ) {
    const stamp = new Date().toISOString();
    return this.db
      .prepare(
        `INSERT INTO intelligence_answer_cache
         (tenant_id,cache_key,intent,branch_scope_hash,permission_fingerprint,evidence_watermark,
          response_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,cache_key) DO UPDATE SET response_json=excluded.response_json,
          created_at=excluded.created_at,expires_at=excluded.expires_at`,
      )
      .bind(
        this.actor.tenantId,
        cacheKey,
        evidence.intent,
        branchScopeHash,
        permissionFingerprint,
        evidence.evidenceWatermark,
        JSON.stringify(answer),
        stamp,
        new Date(Date.now() + 5 * 60_000).toISOString(),
      )
      .run();
  }

  private async observeProviderHealth(
    config: IntelligenceProviderConfiguration,
    provider: IntelligenceProviderAdapter,
  ) {
    const health = provider.health ? await provider.health() : { status: "UNKNOWN" as const };
    await this.db
      .prepare(
        `INSERT INTO intelligence_provider_health
         (tenant_id,provider_config_id,status,observed_latency_ms,failure_code,observed_at)
         VALUES (?,?,?,?,?,?) ON CONFLICT(tenant_id,provider_config_id) DO UPDATE SET
          status=excluded.status,observed_latency_ms=excluded.observed_latency_ms,
          failure_code=excluded.failure_code,observed_at=excluded.observed_at`,
      )
      .bind(
        this.actor.tenantId,
        config.id,
        health.status,
        health.latencyMs ?? null,
        health.code ?? null,
        new Date().toISOString(),
      )
      .run();
    return health.status;
  }

  private async latestAssistantMessage() {
    return this.db
      .prepare(
        `SELECT m.id,m.session_id FROM intelligence_messages m JOIN intelligence_sessions s
         ON s.tenant_id=m.tenant_id AND s.id=m.session_id WHERE m.tenant_id=? AND s.user_id=?
         AND m.role='ASSISTANT' AND m.status='COMPLETE' ORDER BY m.created_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, this.actor.id)
      .first<{ id: string; session_id: string }>();
  }

  private authorizedBranches() {
    return this.actor.branchScope.type === "ALL" &&
      this.actor.permissions.includes(permissions.tenantScopeAllBranches)
      ? this.actor.assignedBranchIds
      : [this.actor.branchId];
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission))
      throw new SerametHttpError(403, `Permission ${permission} is required`);
  }

  private auditStatement(
    action: string,
    entityType: string,
    entityId: string,
    reason: string,
    correlationId: string,
    stamp: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
         (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
          correlation_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.branchId,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        reason,
        correlationId,
        "{}",
        stamp,
      );
  }
}

function mapProviderConfig(
  tenantId: string,
  row: ProviderConfigRow,
): IntelligenceProviderConfiguration {
  return {
    id: row.id,
    tenantId,
    providerKey: row.provider_key,
    displayName: row.display_name,
    modelIdentifier: row.model_identifier,
    enabled: row.enabled === 1,
    status: row.status,
    capabilities: parseJson(row.capabilities_json, []),
    ...(row.secret_reference ? { secretReference: row.secret_reference } : {}),
    timeoutMs: row.timeout_ms,
    maxInputUnits: row.max_input_units,
    maxOutputUnits: row.max_output_units,
    perMinuteLimit: row.per_minute_limit,
    dailyRequestLimit: row.daily_request_limit,
    monthlyRequestLimit: row.monthly_request_limit,
    perUserDailyLimit: row.per_user_daily_limit,
    retentionMode: row.retention_mode,
    allowedFeatures: parseJson(row.allowed_features_json, []),
    allowedRoleIds: parseJson(row.allowed_role_ids_json, []),
    promptVersion: row.prompt_version,
  };
}

function normalizeQuestion(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
function placeholders(count: number) {
  return Array.from({ length: Math.max(1, count) }, () => "?").join(",");
}
function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
function monthStart() {
  return `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;
}
function classifyProviderError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/timeout/i.test(text)) return "TIMEOUT";
  if (/rate/i.test(text)) return "PROVIDER_RATE_LIMIT";
  if (/credential|unauthor/i.test(text)) return "INVALID_CREDENTIALS";
  if (/parse|schema|malformed/i.test(text)) return "MALFORMED_OUTPUT";
  return "PROVIDER_FAILURE";
}
function intentQuestion(intent: string) {
  return (
    (
      {
        FOOD_COST: "Why did food cost change?",
        FINANCE: "Show finance summary",
        INVENTORY: "Show inventory risks",
        PROCUREMENT: "Show purchase recommendations",
        SUPPLIER: "Show supplier performance",
        KITCHEN: "Show kitchen performance",
        STAFF_OPERATIONS: "Show staff operational metrics",
        PAYMENT_RECONCILIATION: "Show reconciliation issues",
        SETTLEMENT: "Show settlement issues",
        MANAGEMENT_ACTIONS: "What needs attention?",
        CLOSE_READINESS: "What is blocking close?",
        OWNER_OVERVIEW: "Compare authorized branches",
        ENTERPRISE_OVERVIEW: "Show authorized enterprise performance and readiness",
        BRANCH_OVERVIEW: "How are we doing?",
      } as Record<string, string>
    )[intent] ?? "Show branch overview"
  );
}
function briefQuestion(type: string) {
  return (
    (
      {
        MORNING: "Morning branch overview today",
        EOD: "What is blocking close?",
        OWNER: "Compare authorized branches",
        MANAGEMENT: "How are we doing?",
      } as Record<string, string>
    )[type] ?? "How are we doing?"
  );
}
function isIntelligenceIntent(
  value: string,
): value is import("@/intelligence/types").IntelligenceIntent {
  return [
    "BRANCH_OVERVIEW",
    "OWNER_OVERVIEW",
    "ENTERPRISE_OVERVIEW",
    "FINANCE",
    "FOOD_COST",
    "COMPARE_PERIODS",
    "COMPARE_BRANCHES",
    "CHANNEL_PROFITABILITY",
    "INVENTORY",
    "PROCUREMENT",
    "SUPPLIER",
    "KITCHEN",
    "STAFF_OPERATIONS",
    "PAYMENT_RECONCILIATION",
    "SETTLEMENT",
    "MANAGEMENT_ACTIONS",
    "CLOSE_READINESS",
    "INTEGRATION_HEALTH",
    "SETUP_READINESS",
    "CRM_OVERVIEW",
    "CRM_RETENTION",
    "CRM_LOYALTY",
    "CRM_CAMPAIGNS",
    "CRM_FEEDBACK",
    "GUEST_EXPERIENCE",
    "GENERAL_PRODUCT_HELP",
  ].includes(value);
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function hashText(value: string) {
  return hashJson(value);
}
async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
