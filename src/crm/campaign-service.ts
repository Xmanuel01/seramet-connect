import { sha256Hex } from "@/crm/contact-normalization";
import {
  capabilityForChannel,
  getCampaignProviderRegistry,
  type CampaignProviderRegistry,
} from "@/crm/campaign-provider-registry";
import { evaluateSegment, type CustomerFacts } from "@/crm/crm-analytics";
import { CrmDomainError, CrmServiceBase, safeJson } from "@/crm/service-base";
import type { CommunicationChannel, DataQuality, SegmentDefinition } from "@/crm/types";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";

const allowedTemplateVariables = new Set([
  "customer.firstName",
  "restaurant.name",
  "branch.name",
  "voucher.code",
  "reward.balance",
  "expiry.date",
]);

type CampaignRow = {
  id: string;
  name: string;
  status: "DRAFT" | "SCHEDULED" | "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
  segment_id: string;
  channels_json: string;
  schedule_at: string | null;
  template_subject: string | null;
  template_body: string;
  voucher_definition_id: string | null;
  branch_scope_json: string;
  brand_scope_json: string;
  provider_config_id: string | null;
  approval_required: number;
  approved_by: string | null;
};

export class CampaignService extends CrmServiceBase {
  constructor(
    db: D1Database,
    actor: ServerActor,
    private readonly providers: CampaignProviderRegistry = getCampaignProviderRegistry(),
  ) {
    super(db, actor);
  }

  async listSegments() {
    this.require(permissions.crmView);
    const rows = await this.db
      .prepare(
        `SELECT s.*,
                (SELECT customer_count FROM crm_segment_snapshots ss
                 WHERE ss.tenant_id=s.tenant_id AND ss.segment_id=s.id
                 ORDER BY ss.as_of DESC LIMIT 1) AS latest_count,
                (SELECT quality FROM crm_segment_snapshots ss
                 WHERE ss.tenant_id=s.tenant_id AND ss.segment_id=s.id
                 ORDER BY ss.as_of DESC LIMIT 1) AS latest_quality
         FROM crm_segments s WHERE s.tenant_id=? ORDER BY s.created_at DESC`,
      )
      .bind(this.actor.tenantId)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async createSegment(input: {
    code: string;
    name: string;
    description?: string;
    definition: SegmentDefinition;
    lapsedDays?: number;
  }) {
    this.require(permissions.campaignManage);
    assertSafeSegmentDefinition(input.definition);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO crm_segments
            (tenant_id,id,code,name,description,status,definition_json,lapsed_days,
             quality_threshold,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,'ACTIVE',?,?,'LOW',?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.code.toUpperCase(),
          input.name,
          input.description ?? null,
          JSON.stringify(input.definition),
          input.lapsedDays ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CRM_SEGMENT_CREATED",
        entityType: "CRM_SEGMENT",
        entityId: id,
        at: stamp,
      }),
    ]);
    return { id };
  }

  async buildSegmentSnapshot(segmentId: string, branchId?: string, asOf = new Date()) {
    this.require(permissions.crmView);
    const scopedBranch =
      branchId ?? (this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : undefined);
    if (scopedBranch) this.branch(scopedBranch);
    const segment = await this.db
      .prepare("SELECT definition_json,status FROM crm_segments WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, segmentId)
      .first<{ definition_json: string; status: string }>();
    if (!segment || segment.status !== "ACTIVE") {
      throw new CrmDomainError("NOT_FOUND", "Active CRM segment was not found");
    }
    const definition = safeJson<SegmentDefinition>(segment.definition_json, {});
    assertSafeSegmentDefinition(definition);
    const rows = await this.db
      .prepare(
        `SELECT m.customer_id,m.order_count,m.net_spend_minor,m.average_order_minor,m.refund_minor,
                m.discount_minor,m.favorite_channel,m.last_visit_at,m.quality,
                COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l
                  WHERE l.tenant_id=m.tenant_id AND l.customer_id=m.customer_id),0) AS loyalty_points,
                (SELECT tier_id FROM customer_loyalty_memberships lm
                  WHERE lm.tenant_id=m.tenant_id AND lm.customer_id=m.customer_id
                  AND lm.status='ACTIVE' ORDER BY lm.joined_at LIMIT 1) AS tier_id,
                COALESCE(a.canonical_customer_id,m.customer_id) AS canonical_customer_id
         FROM customer_metric_snapshots m
         LEFT JOIN customer_aliases a ON a.tenant_id=m.tenant_id AND a.alias_customer_id=m.customer_id
         WHERE m.tenant_id=? AND m.period_key='LIFETIME' AND (? IS NULL OR m.branch_id=?)`,
      )
      .bind(this.actor.tenantId, scopedBranch ?? null, scopedBranch ?? null)
      .all<{
        customer_id: string;
        canonical_customer_id: string;
        order_count: number;
        net_spend_minor: number;
        average_order_minor: number;
        refund_minor: number;
        discount_minor: number;
        favorite_channel: string | null;
        last_visit_at: string | null;
        quality: DataQuality;
        loyalty_points: number;
        tier_id: string | null;
      }>();
    const candidates = new Map<string, { facts: CustomerFacts; quality: DataQuality }>();
    for (const row of rows.results ?? []) {
      const existing = candidates.get(row.canonical_customer_id);
      const facts = existing?.facts ?? {
        orderCount: 0,
        netSpendMinor: 0,
        averageOrderMinor: 0,
        daysSinceLastVisit: Number.MAX_SAFE_INTEGER,
        refundMinor: 0,
        discountMinor: 0,
        loyaltyPoints: 0,
      };
      facts.orderCount += row.order_count;
      facts.netSpendMinor += row.net_spend_minor;
      facts.averageOrderMinor = facts.orderCount
        ? Math.round(facts.netSpendMinor / facts.orderCount)
        : 0;
      facts.refundMinor += row.refund_minor;
      facts.discountMinor += row.discount_minor;
      facts.loyaltyPoints += row.loyalty_points;
      if (row.favorite_channel) facts.favoriteChannel = row.favorite_channel;
      if (row.tier_id) facts.tierId = row.tier_id;
      if (row.last_visit_at) {
        facts.daysSinceLastVisit = Math.min(
          facts.daysSinceLastVisit,
          Math.max(0, Math.floor((asOf.getTime() - Date.parse(row.last_visit_at)) / 86_400_000)),
        );
      }
      candidates.set(row.canonical_customer_id, {
        facts,
        quality: lowerQuality(existing?.quality, row.quality),
      });
    }
    const members = [...candidates.entries()].filter(([, value]) =>
      evaluateSegment(definition, value.facts),
    );
    const id = crypto.randomUUID();
    const stamp = asOf.toISOString();
    const definitionHash = await sha256Hex(segment.definition_json);
    const quality = aggregateQuality(members.map(([, value]) => value.quality));
    const statements = [
      this.db
        .prepare(
          `INSERT INTO crm_segment_snapshots
            (tenant_id,id,segment_id,branch_id,as_of,customer_count,quality,definition_hash,
             evidence_watermark,metrics_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'{}',?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          segmentId,
          scopedBranch ?? null,
          stamp,
          members.length,
          quality,
          definitionHash,
          `${stamp}:${rows.results?.length ?? 0}`,
          stamp,
        ),
      ...members.map(([customerId, value]) =>
        this.db
          .prepare(
            `INSERT INTO crm_segment_members
              (tenant_id,snapshot_id,customer_id,evidence_json) VALUES (?,?,?,?)`,
          )
          .bind(this.actor.tenantId, id, customerId, JSON.stringify(value.facts)),
      ),
    ];
    for (let index = 0; index < statements.length; index += 200) {
      await this.db.batch(statements.slice(index, index + 200));
    }
    return { id, segmentId, branchId: scopedBranch, customerCount: members.length, quality };
  }

  async listCampaigns() {
    this.require(permissions.campaignView);
    const scopedBranch = this.actor.branchScope.type === "BRANCH" ? this.actor.branchId : null;
    const rows = await this.db
      .prepare(
        `SELECT c.id,c.name,c.status,c.objective,c.schedule_at,c.starts_at,c.ends_at,
                c.channels_json,s.name AS segment_name,p.display_name AS provider_name,
                p.status AS provider_status,
                (SELECT COUNT(*) FROM campaign_audiences a WHERE a.tenant_id=c.tenant_id
                  AND a.campaign_id=c.id AND a.eligibility_status='ELIGIBLE') AS eligible,
                (SELECT COUNT(*) FROM campaign_deliveries d WHERE d.tenant_id=c.tenant_id
                  AND d.campaign_id=c.id AND d.status IN ('SENT','DELIVERED')) AS sent,
                (SELECT COUNT(*) FROM campaign_deliveries d WHERE d.tenant_id=c.tenant_id
                  AND d.campaign_id=c.id AND d.status='DELIVERED') AS delivered
         FROM campaigns c JOIN crm_segments s ON s.tenant_id=c.tenant_id AND s.id=c.segment_id
         LEFT JOIN communication_provider_configs p ON p.tenant_id=c.tenant_id AND p.id=c.provider_config_id
         WHERE c.tenant_id=?
           AND (? IS NULL OR c.branch_scope_json='[]' OR EXISTS (
             SELECT 1 FROM json_each(c.branch_scope_json) WHERE value=?))
         ORDER BY c.created_at DESC`,
      )
      .bind(this.actor.tenantId, scopedBranch, scopedBranch)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  async upsertProviderConfig(input: {
    id?: string;
    providerKey: string;
    displayName: string;
    capabilities: string[];
    secretReference?: string;
    perMinuteLimit?: number;
    batchSize?: number;
    maxAttempts?: number;
    configuration?: Record<string, unknown>;
  }) {
    this.require(permissions.campaignManage);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO communication_provider_configs
            (tenant_id,id,provider_key,display_name,status,capabilities_json,secret_reference,
             per_minute_limit,batch_size,max_attempts,configuration_json,created_by,created_at,updated_at)
           VALUES (?,?,?,?, 'CONFIGURED',?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET provider_key=excluded.provider_key,
             display_name=excluded.display_name,capabilities_json=excluded.capabilities_json,
             secret_reference=excluded.secret_reference,per_minute_limit=excluded.per_minute_limit,
             batch_size=excluded.batch_size,max_attempts=excluded.max_attempts,
             configuration_json=excluded.configuration_json,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.providerKey,
          input.displayName,
          JSON.stringify(input.capabilities),
          input.secretReference ?? null,
          input.perMinuteLimit ?? 60,
          input.batchSize ?? 100,
          input.maxAttempts ?? 5,
          JSON.stringify(input.configuration ?? {}),
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CAMPAIGN_PROVIDER_CONFIGURED",
        entityType: "COMMUNICATION_PROVIDER_CONFIG",
        entityId: id,
        at: stamp,
        metadata: {
          providerKey: input.providerKey,
          secretConfigured: Boolean(input.secretReference),
        },
      }),
    ]);
    return { id, providerKey: input.providerKey, status: "CONFIGURED" as const };
  }

  async providerHealth() {
    this.require(permissions.campaignView);
    const configs = await this.db
      .prepare(
        `SELECT id,provider_key,display_name,status,capabilities_json,
                CASE WHEN secret_reference IS NULL THEN 0 ELSE 1 END AS secret_configured
         FROM communication_provider_configs WHERE tenant_id=? ORDER BY display_name`,
      )
      .bind(this.actor.tenantId)
      .all<{
        id: string;
        provider_key: string;
        display_name: string;
        status: string;
        capabilities_json: string;
        secret_configured: number;
      }>();
    return Promise.all(
      (configs.results ?? []).map(async (config) => {
        let liveStatus: "CONFIGURED" | "DEGRADED" | "UNKNOWN" = "UNKNOWN";
        try {
          liveStatus = await this.providers.get(config.provider_key).health();
        } catch {
          liveStatus = "UNKNOWN";
        }
        return {
          id: config.id,
          providerKey: config.provider_key,
          displayName: config.display_name,
          capabilities: safeJson<string[]>(config.capabilities_json, []),
          configuredStatus: config.status,
          liveStatus,
          secretConfigured: config.secret_configured === 1,
        };
      }),
    );
  }

  async createCampaign(input: {
    name: string;
    objective: string;
    segmentId: string;
    channels: CommunicationChannel[];
    scheduleAt?: string;
    startsAt?: string;
    endsAt?: string;
    templateSubject?: string;
    templateBody: string;
    voucherDefinitionId?: string;
    branchIds: string[];
    brandIds: string[];
    budgetMinor?: number;
    currency?: string;
    providerConfigId?: string;
    approvalRequired: boolean;
  }) {
    this.require(permissions.campaignManage);
    for (const branchId of input.branchIds) this.branch(branchId);
    const variables = validateTemplate(`${input.templateSubject ?? ""}\n${input.templateBody}`);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const statements = [
      this.db
        .prepare(
          `INSERT INTO campaigns
            (tenant_id,id,name,status,objective,segment_id,channels_json,schedule_at,starts_at,
             ends_at,template_subject,template_body,template_variables_json,voucher_definition_id,
             branch_scope_json,brand_scope_json,budget_minor,currency,provider_config_id,
             approval_required,created_by,created_at,updated_at)
           VALUES (?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.name,
          input.objective,
          input.segmentId,
          JSON.stringify(input.channels),
          input.scheduleAt ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
          input.templateSubject ?? null,
          input.templateBody,
          JSON.stringify(variables),
          input.voucherDefinitionId ?? null,
          JSON.stringify(input.branchIds),
          JSON.stringify(input.brandIds),
          input.budgetMinor ?? null,
          input.currency ?? null,
          input.providerConfigId ?? null,
          Number(input.approvalRequired),
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement({
        action: "CAMPAIGN_CREATED",
        entityType: "CAMPAIGN",
        entityId: id,
        at: stamp,
      }),
    ];
    if (input.voucherDefinitionId) {
      const voucher = await this.db
        .prepare("SELECT campaign_id FROM voucher_definitions WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, input.voucherDefinitionId)
        .first<{ campaign_id: string | null }>();
      if (!voucher) throw new CrmDomainError("NOT_FOUND", "Campaign voucher was not found");
      if (voucher.campaign_id) {
        throw new CrmDomainError("CONFLICT", "Voucher is already assigned to another campaign");
      }
      statements.push(
        this.db
          .prepare(
            "UPDATE voucher_definitions SET campaign_id=?,updated_at=? WHERE tenant_id=? AND id=? AND campaign_id IS NULL",
          )
          .bind(id, stamp, this.actor.tenantId, input.voucherDefinitionId),
      );
    }
    await this.db.batch(statements);
    return { id, status: "DRAFT" as const };
  }

  async previewCampaign(campaignId: string) {
    this.require(permissions.campaignView);
    const campaign = await this.campaign(campaignId);
    const snapshot = await this.buildSegmentSnapshot(
      campaign.segment_id,
      this.scopedCampaignBranch(campaign),
    );
    const build = await this.buildAudience(campaign, snapshot.id, true);
    let providerReadiness: "CONFIGURED" | "DEGRADED" | "UNKNOWN" = "UNKNOWN";
    if (campaign.provider_config_id) {
      const config = await this.providerConfig(campaign.provider_config_id);
      try {
        providerReadiness = await this.providers.get(config.provider_key).health();
      } catch {
        providerReadiness = "UNKNOWN";
      }
    }
    return { ...build, segment: snapshot, providerReadiness };
  }

  async approveCampaign(campaignId: string, reason: string) {
    this.require(permissions.campaignApprove);
    const campaign = await this.campaign(campaignId);
    if (campaign.status !== "DRAFT") {
      throw new CrmDomainError("INVALID_STATE", "Only draft campaigns can be approved");
    }
    const nextStatus = campaign.schedule_at ? "SCHEDULED" : "ACTIVE";
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE campaigns SET status=?,approved_by=?,approval_reason=?,approved_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status='DRAFT'`,
        )
        .bind(nextStatus, this.actor.id, reason, stamp, stamp, this.actor.tenantId, campaignId),
      this.auditStatement({
        action: "CAMPAIGN_APPROVED",
        entityType: "CAMPAIGN",
        entityId: campaignId,
        reason,
        at: stamp,
        metadata: { status: nextStatus },
      }),
    ]);
    return { id: campaignId, status: nextStatus };
  }

  async queueCampaign(campaignId: string) {
    this.require(permissions.campaignSend);
    const campaign = await this.campaign(campaignId);
    if (campaign.status === "COMPLETED") {
      return { id: campaignId, queued: 0, scheduled: false, complete: true };
    }
    if (!campaign.provider_config_id) {
      throw new CrmDomainError("INVALID_STATE", "Campaign has no provider configuration");
    }
    if (campaign.status === "DRAFT") {
      throw new CrmDomainError("INVALID_STATE", "Draft campaign cannot send");
    }
    if (!["SCHEDULED", "ACTIVE"].includes(campaign.status)) {
      throw new CrmDomainError("INVALID_STATE", "Campaign is not sendable");
    }
    if (campaign.approval_required === 1 && !campaign.approved_by) {
      throw new CrmDomainError("INVALID_STATE", "Campaign approval is required");
    }
    if (campaign.schedule_at && campaign.schedule_at > new Date().toISOString()) {
      return { id: campaignId, queued: 0, scheduled: true };
    }
    let audience = await this.db
      .prepare("SELECT id FROM campaign_audiences WHERE tenant_id=? AND campaign_id=? LIMIT 1")
      .bind(this.actor.tenantId, campaignId)
      .first<{ id: string }>();
    if (!audience) {
      const snapshot = await this.buildSegmentSnapshot(
        campaign.segment_id,
        this.scopedCampaignBranch(campaign),
      );
      await this.buildAudience(campaign, snapshot.id, false);
      audience = await this.db
        .prepare("SELECT id FROM campaign_audiences WHERE tenant_id=? AND campaign_id=? LIMIT 1")
        .bind(this.actor.tenantId, campaignId)
        .first<{ id: string }>();
    }
    const config = await this.providerConfig(campaign.provider_config_id);
    const rows = await this.db
      .prepare(
        `SELECT id,channel FROM campaign_audiences WHERE tenant_id=? AND campaign_id=?
         AND eligibility_status='ELIGIBLE' ORDER BY id`,
      )
      .bind(this.actor.tenantId, campaignId)
      .all<{ id: string; channel: CommunicationChannel }>();
    const stamp = new Date().toISOString();
    const statements = (rows.results ?? []).map((row) => {
      const id = crypto.randomUUID();
      const key = `campaign:${campaignId}:${row.id}`;
      return this.db
        .prepare(
          `INSERT INTO campaign_deliveries
            (tenant_id,id,campaign_id,audience_id,provider_config_id,channel,status,
             attempt_count,max_attempts,idempotency_key,correlation_id,next_attempt_at,
             queued_at,updated_at)
           VALUES (?,?,?,?,?,?,'QUEUED',0,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          this.actor.tenantId,
          id,
          campaignId,
          row.id,
          campaign.provider_config_id,
          row.channel,
          config.max_attempts,
          key,
          crypto.randomUUID(),
          stamp,
          stamp,
          stamp,
        );
    });
    let queued = 0;
    for (let index = 0; index < statements.length; index += 200) {
      const results = await this.db.batch(statements.slice(index, index + 200));
      queued += results.reduce((sum, result) => sum + (result.meta?.changes ?? 0), 0);
    }
    await this.db
      .prepare(
        "UPDATE campaigns SET status='ACTIVE',updated_at=? WHERE tenant_id=? AND id=? AND status='SCHEDULED'",
      )
      .bind(stamp, this.actor.tenantId, campaignId)
      .run();
    return { id: campaignId, queued, scheduled: false };
  }

  async processCampaign(campaignId: string) {
    this.require(permissions.campaignSend);
    const current = await this.campaign(campaignId);
    if (current.status === "COMPLETED") {
      return { sent: 0, failed: 0, providerStatus: "CONFIGURED" as const };
    }
    await this.queueCampaign(campaignId);
    const campaign = await this.campaign(campaignId);
    if (!campaign.provider_config_id) throw new CrmDomainError("INVALID_STATE", "Provider missing");
    const config = await this.providerConfig(campaign.provider_config_id);
    let adapter;
    try {
      adapter = this.providers.get(config.provider_key);
    } catch {
      await this.db
        .prepare(
          `UPDATE campaign_deliveries SET status='FAILED',last_error_code='PROVIDER_NOT_REGISTERED',
             next_attempt_at=datetime('now','+5 minutes'),updated_at=?
           WHERE tenant_id=? AND campaign_id=? AND status IN ('QUEUED','FAILED')`,
        )
        .bind(new Date().toISOString(), this.actor.tenantId, campaignId)
        .run();
      return { sent: 0, failed: 0, providerStatus: "UNKNOWN" as const };
    }
    const capabilitySet = new Set(safeJson<string[]>(config.capabilities_json, []));
    const sentLastMinute = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM campaign_deliveries WHERE tenant_id=?
         AND provider_config_id=? AND sent_at>=datetime('now','-1 minute')`,
      )
      .bind(this.actor.tenantId, config.id)
      .first<{ count: number }>();
    const allowance = Math.max(
      0,
      Math.min(config.batch_size, config.per_minute_limit - (sentLastMinute?.count ?? 0)),
    );
    const deliveries = await this.db
      .prepare(
        `SELECT d.id,d.audience_id,d.channel,d.idempotency_key,d.attempt_count,d.max_attempts,
                a.customer_id,c.first_name,c.display_name
         FROM campaign_deliveries d JOIN campaign_audiences a
           ON a.tenant_id=d.tenant_id AND a.id=d.audience_id
         JOIN customers c ON c.tenant_id=a.tenant_id AND c.id=a.customer_id
         WHERE d.tenant_id=? AND d.campaign_id=?
           AND d.status IN ('QUEUED','FAILED') AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?)
         ORDER BY d.queued_at LIMIT ?`,
      )
      .bind(this.actor.tenantId, campaignId, new Date().toISOString(), allowance)
      .all<{
        id: string;
        audience_id: string;
        channel: CommunicationChannel;
        idempotency_key: string;
        attempt_count: number;
        max_attempts: number;
        customer_id: string;
        first_name: string | null;
        display_name: string;
      }>();
    let sent = 0;
    let failed = 0;
    for (const delivery of deliveries.results ?? []) {
      if (
        !capabilitySet.has(capabilityForChannel(delivery.channel)) ||
        !adapter.capabilities.has(capabilityForChannel(delivery.channel))
      ) {
        await this.failDelivery(
          delivery.id,
          "CAPABILITY_NOT_CONFIGURED",
          delivery.attempt_count + 1,
          delivery.max_attempts,
        );
        failed += 1;
        continue;
      }
      const eligibility = await this.currentEligibility(delivery.customer_id, delivery.channel);
      if (!eligibility.eligible || !eligibility.contact) {
        await this.db
          .prepare(
            `UPDATE campaign_deliveries SET status='UNSUBSCRIBED',last_error_code=?,updated_at=?
             WHERE tenant_id=? AND id=? AND status IN ('QUEUED','FAILED')`,
          )
          .bind(eligibility.reason, new Date().toISOString(), this.actor.tenantId, delivery.id)
          .run();
        continue;
      }
      const claimed = await this.db
        .prepare(
          `UPDATE campaign_deliveries SET status='SENDING',attempt_count=attempt_count+1,updated_at=?
           WHERE tenant_id=? AND id=? AND status IN ('QUEUED','FAILED')`,
        )
        .bind(new Date().toISOString(), this.actor.tenantId, delivery.id)
        .run();
      if ((claimed.meta?.changes ?? 0) === 0) continue;
      const variables = await this.templateVariables(campaign, delivery, eligibility.contact);
      const result = await adapter.send({
        tenantId: this.actor.tenantId,
        deliveryId: delivery.id,
        channel: delivery.channel,
        destination: eligibility.contact,
        ...(campaign.template_subject
          ? { subject: renderTemplate(campaign.template_subject, variables) }
          : {}),
        body: renderTemplate(campaign.template_body, variables),
        idempotencyKey: delivery.idempotency_key,
      });
      if (result.status === "SENT") {
        const stamp = new Date().toISOString();
        await this.db.batch([
          this.db
            .prepare(
              `UPDATE campaign_deliveries SET status='SENT',provider_message_id=?,sent_at=?,
                 last_error_code=NULL,next_attempt_at=NULL,updated_at=?
               WHERE tenant_id=? AND id=? AND status='SENDING'`,
            )
            .bind(result.providerMessageId ?? null, stamp, stamp, this.actor.tenantId, delivery.id),
          this.db
            .prepare(
              `INSERT INTO campaign_events
                (tenant_id,id,campaign_id,delivery_id,customer_id,event_type,provider_event_id,
                 attribution_type,payload_json,occurred_at,created_at)
               VALUES (?,?,?,?,?,'SENT',?,'UNKNOWN','{}',?,?)`,
            )
            .bind(
              this.actor.tenantId,
              crypto.randomUUID(),
              campaignId,
              delivery.id,
              delivery.customer_id,
              result.providerMessageId ?? `send:${delivery.id}`,
              stamp,
              stamp,
            ),
        ]);
        sent += 1;
      } else {
        await this.failDelivery(
          delivery.id,
          result.errorCode ?? "PROVIDER_FAILED",
          delivery.attempt_count + 1,
          delivery.max_attempts,
        );
        failed += 1;
      }
    }
    const pending = await this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM campaign_deliveries WHERE tenant_id=? AND campaign_id=?
         AND status IN ('QUEUED','SENDING','FAILED')`,
      )
      .bind(this.actor.tenantId, campaignId)
      .first<{ count: number }>();
    if ((pending?.count ?? 0) === 0) {
      await this.db
        .prepare(
          "UPDATE campaigns SET status='COMPLETED',updated_at=? WHERE tenant_id=? AND id=? AND status='ACTIVE'",
        )
        .bind(new Date().toISOString(), this.actor.tenantId, campaignId)
        .run();
    }
    return { sent, failed, providerStatus: "CONFIGURED" as const };
  }

  private async buildAudience(campaign: CampaignRow, snapshotId: string, previewOnly: boolean) {
    const members = await this.db
      .prepare(
        `SELECT m.customer_id,c.status,c.first_name,c.display_name
         FROM crm_segment_members m JOIN customers c ON c.tenant_id=m.tenant_id AND c.id=m.customer_id
         WHERE m.tenant_id=? AND m.snapshot_id=? ORDER BY m.customer_id`,
      )
      .bind(this.actor.tenantId, snapshotId)
      .all<{
        customer_id: string;
        status: string;
        first_name: string | null;
        display_name: string;
      }>();
    const channels = safeJson<CommunicationChannel[]>(campaign.channels_json, []);
    const counts = {
      estimatedAudience: (members.results ?? []).length,
      eligible: 0,
      noConsent: 0,
      missingContact: 0,
      suppressed: 0,
      inactiveCustomer: 0,
      outOfScope: 0,
    };
    const statements = [];
    for (const member of members.results ?? []) {
      for (const channel of channels) {
        const eligibility = await this.currentEligibility(
          member.customer_id,
          channel,
          member.status,
        );
        const key = eligibility.reason;
        if (eligibility.eligible) counts.eligible += 1;
        else if (key === "NO_CONSENT") counts.noConsent += 1;
        else if (key === "MISSING_CONTACT") counts.missingContact += 1;
        else if (key === "SUPPRESSED") counts.suppressed += 1;
        else if (key === "INACTIVE_CUSTOMER") counts.inactiveCustomer += 1;
        else counts.outOfScope += 1;
        if (previewOnly) continue;
        const contactHash = await sha256Hex(
          eligibility.contact ?? `${member.customer_id}:${channel}`,
        );
        statements.push(
          this.db
            .prepare(
              `INSERT INTO campaign_audiences
                (tenant_id,id,campaign_id,snapshot_id,customer_id,channel,contact_hash,
                 eligibility_status,eligibility_evidence_json,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,campaign_id,customer_id,channel) DO UPDATE SET
                 snapshot_id=excluded.snapshot_id,contact_hash=excluded.contact_hash,
                 eligibility_status=excluded.eligibility_status,
                 eligibility_evidence_json=excluded.eligibility_evidence_json,
                 created_at=excluded.created_at`,
            )
            .bind(
              this.actor.tenantId,
              crypto.randomUUID(),
              campaign.id,
              snapshotId,
              member.customer_id,
              channel,
              contactHash,
              eligibility.eligible ? "ELIGIBLE" : eligibility.reason,
              JSON.stringify({ checkedAt: new Date().toISOString(), reason: eligibility.reason }),
              new Date().toISOString(),
            ),
        );
      }
    }
    for (let index = 0; index < statements.length; index += 200) {
      await this.db.batch(statements.slice(index, index + 200));
    }
    return counts;
  }

  private async currentEligibility(
    customerId: string,
    channel: CommunicationChannel,
    knownStatus?: string,
  ) {
    const customer = knownStatus
      ? { status: knownStatus }
      : await this.db
          .prepare("SELECT status FROM customers WHERE tenant_id=? AND id=?")
          .bind(this.actor.tenantId, customerId)
          .first<{ status: string }>();
    if (!customer || customer.status !== "ACTIVE") {
      return { eligible: false, reason: "INACTIVE_CUSTOMER" as const };
    }
    const consent = await this.db
      .prepare(
        `SELECT status FROM customer_consents WHERE tenant_id=? AND customer_id=? AND channel=?
         ORDER BY effective_at DESC,rowid DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, customerId, `${channel}_MARKETING`)
      .first<{ status: string }>();
    if (consent?.status !== "GRANTED") return { eligible: false, reason: "NO_CONSENT" as const };
    const suppression = await this.db
      .prepare(
        `SELECT id FROM customer_suppressions WHERE tenant_id=? AND customer_id=? AND active=1
         AND channel IN (?, 'ALL') LIMIT 1`,
      )
      .bind(this.actor.tenantId, customerId, channel)
      .first<{ id: string }>();
    if (suppression) return { eligible: false, reason: "SUPPRESSED" as const };
    const identifierType =
      channel === "EMAIL" ? "EMAIL" : channel === "PUSH" ? "ONLINE_ACCOUNT" : "PHONE";
    const identifier = await this.db
      .prepare(
        `SELECT display_value,normalized_value FROM customer_identifiers
         WHERE tenant_id=? AND customer_id=? AND identifier_type=? AND status='ACTIVE'
         ORDER BY verified DESC,created_at LIMIT 1`,
      )
      .bind(this.actor.tenantId, customerId, identifierType)
      .first<{ display_value: string | null; normalized_value: string }>();
    const contact = identifier?.display_value ?? identifier?.normalized_value;
    if (!contact) return { eligible: false, reason: "MISSING_CONTACT" as const };
    return { eligible: true, reason: "ELIGIBLE" as const, contact };
  }

  private async templateVariables(
    campaign: CampaignRow,
    delivery: { customer_id: string; first_name: string | null; display_name: string },
    _contact: string,
  ) {
    const tenant = await this.db
      .prepare("SELECT trading_name FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ trading_name: string }>();
    const branchId = this.scopedCampaignBranch(campaign);
    const branch = branchId
      ? await this.db
          .prepare("SELECT name FROM branches WHERE tenant_id=? AND id=?")
          .bind(this.actor.tenantId, branchId)
          .first<{ name: string }>()
      : null;
    const voucher = campaign.voucher_definition_id
      ? await this.db
          .prepare("SELECT code,valid_to FROM voucher_definitions WHERE tenant_id=? AND id=?")
          .bind(this.actor.tenantId, campaign.voucher_definition_id)
          .first<{ code: string; valid_to: string | null }>()
      : null;
    const rewardBalance = await this.db
      .prepare(
        "SELECT COALESCE(SUM(points),0) AS points FROM loyalty_ledger WHERE tenant_id=? AND customer_id=?",
      )
      .bind(this.actor.tenantId, delivery.customer_id)
      .first<{ points: number }>();
    return {
      "customer.firstName":
        delivery.first_name ?? delivery.display_name.split(/\s+/)[0] ?? "Customer",
      "restaurant.name": tenant?.trading_name ?? "Restaurant",
      "branch.name": branch?.name ?? "",
      "voucher.code": voucher?.code ?? "",
      "reward.balance": String(rewardBalance?.points ?? 0),
      "expiry.date": voucher?.valid_to?.slice(0, 10) ?? "",
    };
  }

  private async failDelivery(id: string, code: string, attempts: number, maxAttempts: number) {
    const dead = attempts >= maxAttempts;
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE campaign_deliveries SET status=?,last_error_code=?,
           next_attempt_at=CASE WHEN ?=1 THEN NULL ELSE datetime('now','+5 minutes') END,updated_at=?
         WHERE tenant_id=? AND id=? AND status IN ('SENDING','QUEUED','FAILED')`,
      )
      .bind(dead ? "DEAD_LETTER" : "FAILED", code, Number(dead), stamp, this.actor.tenantId, id)
      .run();
  }

  private async campaign(id: string) {
    const campaign = await this.db
      .prepare("SELECT * FROM campaigns WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<CampaignRow>();
    if (!campaign) throw new CrmDomainError("NOT_FOUND", "Campaign was not found");
    for (const branchId of safeJson<string[]>(campaign.branch_scope_json, []))
      this.branch(branchId);
    return campaign;
  }

  private scopedCampaignBranch(campaign: CampaignRow) {
    const branches = safeJson<string[]>(campaign.branch_scope_json, []);
    if (this.actor.branchScope.type === "BRANCH") {
      if (branches.length && !branches.includes(this.actor.branchId)) {
        throw new CrmDomainError("PERMISSION_DENIED", "Campaign is outside assigned branch scope");
      }
      return this.actor.branchId;
    }
    return branches.length === 1 ? branches[0] : undefined;
  }

  private async providerConfig(id: string) {
    const config = await this.db
      .prepare(
        `SELECT id,provider_key,capabilities_json,per_minute_limit,batch_size,max_attempts,status
         FROM communication_provider_configs WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{
        id: string;
        provider_key: string;
        capabilities_json: string;
        per_minute_limit: number;
        batch_size: number;
        max_attempts: number;
        status: string;
      }>();
    if (!config || config.status !== "CONFIGURED") {
      throw new CrmDomainError("INVALID_STATE", "Campaign provider is not configured");
    }
    return config;
  }
}

export function validateTemplate(template: string) {
  const variables = [...template.matchAll(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g)].map((match) => match[1]!);
  const unknown = variables.filter((variable) => !allowedTemplateVariables.has(variable));
  if (unknown.length) {
    throw new CrmDomainError(
      "VALIDATION_FAILED",
      `Unknown template variables: ${[...new Set(unknown)].join(", ")}`,
    );
  }
  return [...new Set(variables)];
}

export function renderTemplate(template: string, variables: Record<string, string>) {
  validateTemplate(template);
  return template.replace(
    /{{\s*([a-zA-Z0-9_.]+)\s*}}/g,
    (_match, variable: string) => variables[variable] ?? "",
  );
}

function assertSafeSegmentDefinition(definition: SegmentDefinition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new CrmDomainError("VALIDATION_FAILED", "Segment definition is invalid");
  }
  const allowedFields = new Set([
    "orderCount",
    "netSpendMinor",
    "averageOrderMinor",
    "daysSinceLastVisit",
    "refundMinor",
    "discountMinor",
    "favoriteChannel",
    "loyaltyPoints",
    "tierId",
  ]);
  const rules = [...(definition.all ?? []), ...(definition.any ?? [])];
  if (!rules.length)
    throw new CrmDomainError("VALIDATION_FAILED", "Segment requires at least one rule");
  for (const rule of rules) {
    if (!allowedFields.has(rule.field)) {
      throw new CrmDomainError(
        "VALIDATION_FAILED",
        "Sensitive or unsupported segment field is blocked",
      );
    }
  }
}

function lowerQuality(left: DataQuality | undefined, right: DataQuality) {
  if (!left) return right;
  const rank: DataQuality[] = ["INSUFFICIENT_DATA", "LOW", "MEDIUM", "HIGH"];
  return rank.indexOf(left) <= rank.indexOf(right) ? left : right;
}

function aggregateQuality(values: DataQuality[]): DataQuality {
  if (!values.length) return "INSUFFICIENT_DATA";
  return values.reduce((left, right) => lowerQuality(left, right), "HIGH");
}
