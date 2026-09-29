import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { IntelligenceEvidenceService } from "@/intelligence/evidence-tools";
import { validateGroundedAnswer } from "@/intelligence/grounding";
import { IntelligenceService } from "@/intelligence/intelligence-service";
import { planIntelligenceQuery } from "@/intelligence/query-planner";
import { createIntelligenceProviderRegistry } from "@/intelligence/provider-registry";
import type {
  EvidencePackage,
  IntelligenceProviderConfiguration,
  IntelligenceProviderRequest,
} from "@/intelligence/types";

const tenantCount = 10;
const branchesPerTenant = 5;
const historyDays = 365;
const concurrentRequests = 250;

describe.sequential("Pass 9 representative intelligence load fixture", () => {
  let db: SqliteD1TestDatabase;
  let env: SerametEnv;
  let actors: ServerActor[];

  beforeAll(() => {
    db = createDemoFixtureDatabase();
    env = { SERAMET_ENVIRONMENT: "test", SERAMET_DB: db };
    actors = seedRepresentativeFixture(db);
  }, 120_000);

  afterAll(() => db.close());

  it("measures planner, evidence, grounding, cache, provider, request and brief paths without tenant bleed", async () => {
    const timings: Record<string, number> = {};
    const questions = [
      "How are we doing today?",
      "Compare all branches this week",
      "Show channel profitability today",
      "What needs attention today?",
    ];

    const plans = await measured(timings, "plannerMs", () =>
      Promise.all(
        Array.from({ length: concurrentRequests }, (_, index) =>
          planIntelligenceQuery(
            db,
            actors[index % actors.length]!,
            questions[index % questions.length]!,
          ),
        ),
      ),
    );

    const evidence = await measured(timings, "evidenceRetrievalMs", () =>
      Promise.all(
        plans.map((plan, index) =>
          new IntelligenceEvidenceService(db, actors[index % actors.length]!).build(plan),
        ),
      ),
    );

    const provider = createIntelligenceProviderRegistry(env).resolve(providerConfig(), env);
    const providerResults = await measured(timings, "mockProviderRoundtripMs", () =>
      Promise.all(
        evidence.map((item, index) =>
          provider.generateStructuredResponse(providerRequest(item, index)),
        ),
      ),
    );

    await measured(timings, "groundingMs", async () => {
      providerResults.forEach((result, index) =>
        validateGroundedAnswer(result.answer, evidence[index]!),
      );
    });

    const services = actors.map((actor) => new IntelligenceService(db, actor, env));
    const responses = await measured(timings, "fullRequestMs", () =>
      Promise.all(
        Array.from({ length: concurrentRequests }, (_, index) => {
          const service = services[index % services.length]!;
          return service.ask({
            question: questions[index % questions.length]!,
            forceRefresh: true,
          });
        }),
      ),
    );
    responses.forEach((response, index) => {
      expect(response.evidence.tenantId).toBe(actors[index % actors.length]!.tenantId);
      expect(
        response.evidence.authorizedBranchIds.every((branchId) =>
          actors[index % actors.length]!.assignedBranchIds.includes(branchId),
        ),
      ).toBe(true);
    });

    await Promise.all(
      services.map((service) => service.ask({ question: "How are we doing today?" })),
    );
    const cached = await measured(timings, "cacheRetrievalMs", () =>
      Promise.all(services.map((service) => service.ask({ question: "How are we doing today?" }))),
    );
    expect(cached.every((response) => response.cached)).toBe(true);

    await measured(timings, "briefGenerationMs", () =>
      Promise.all(
        services
          .filter((_, index) => index % 2 === 0)
          .map(async (service) => {
            const brief = await service.prepareBrief({ briefType: "MORNING" });
            return service.generateBrief(brief.id);
          }),
      ),
    );

    const facts = {
      tenants: Number(
        await db
          .prepare("SELECT COUNT(*) count FROM tenants WHERE id LIKE 'load-tenant-%'")
          .first("count"),
      ),
      branches: Number(
        await db
          .prepare("SELECT COUNT(*) count FROM branches WHERE tenant_id LIKE 'load-tenant-%'")
          .first("count"),
      ),
      users: Number(
        await db
          .prepare("SELECT COUNT(*) count FROM users WHERE tenant_id LIKE 'load-tenant-%'")
          .first("count"),
      ),
      branchDayMetrics: Number(
        await db
          .prepare(
            "SELECT COUNT(*) count FROM daily_branch_metrics WHERE tenant_id LIKE 'load-tenant-%'",
          )
          .first("count"),
      ),
      channelFacts: Number(
        await db
          .prepare(
            "SELECT COUNT(*) count FROM daily_channel_metrics WHERE tenant_id LIKE 'load-tenant-%'",
          )
          .first("count"),
      ),
      supplierFacts: Number(
        await db
          .prepare(
            "SELECT COUNT(*) count FROM daily_supplier_metrics WHERE tenant_id LIKE 'load-tenant-%'",
          )
          .first("count"),
      ),
      menuFacts: Number(
        await db
          .prepare(
            "SELECT COUNT(*) count FROM daily_menu_item_metrics WHERE tenant_id LIKE 'load-tenant-%'",
          )
          .first("count"),
      ),
      inventoryFacts: Number(
        await db
          .prepare(
            "SELECT COUNT(*) count FROM inventory_data_quality_issues WHERE tenant_id LIKE 'load-tenant-%'",
          )
          .first("count"),
      ),
      concurrentRequests,
    };
    expect(facts).toMatchObject({
      tenants: 10,
      branches: 50,
      users: 20,
      branchDayMetrics: 18_250,
      channelFacts: 150,
      supplierFacts: 150,
      menuFacts: 2_000,
      inventoryFacts: 1_000,
      concurrentRequests: 250,
    });
    console.info("PASS9_PERFORMANCE", JSON.stringify({ facts, timings }));
  }, 120_000);
});

async function measured<T>(timings: Record<string, number>, key: string, run: () => Promise<T>) {
  const started = performance.now();
  const result = await run();
  timings[key] = Math.round((performance.now() - started) * 100) / 100;
  return result;
}

function seedRepresentativeFixture(db: SqliteD1TestDatabase) {
  const actors: ServerActor[] = [];
  const stamp = new Date().toISOString();
  const statements = {
    tenant: db.sqlite.prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',?,?)",
    ),
    branch: db.sqlite.prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
    ),
    user: db.sqlite.prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,NULL,?,1,1,'{}',?,?)",
    ),
    role: db.sqlite.prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
    ),
    userRole: db.sqlite.prepare(
      "INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)",
    ),
    featureFlag: db.sqlite.prepare(
      "INSERT INTO feature_flags (tenant_id,key,enabled,configuration_json,updated_by,updated_at) VALUES (?,'intelligence.enabled',1,'{}',?,?)",
    ),
    subscription: db.sqlite.prepare(
      "INSERT INTO tenant_subscriptions (tenant_id,id,plan_id,status,starts_at,created_at,updated_at) VALUES (?,?,'plan-demo-intelligence','ACTIVE',?,?,?)",
    ),
    entitlement: db.sqlite.prepare(
      "INSERT INTO feature_entitlements (tenant_id,subscription_id,feature_key,enabled,limits_json) VALUES (?,?,?,1,'{}')",
    ),
    provider: db.sqlite.prepare(
      "INSERT INTO intelligence_provider_configs (tenant_id,id,provider_key,display_name,model_identifier,enabled,status,capabilities_json,secret_reference,timeout_ms,max_input_units,max_output_units,per_minute_limit,daily_request_limit,monthly_request_limit,per_user_daily_limit,retention_mode,allowed_features_json,allowed_role_ids_json,prompt_version,configuration_json,created_by,created_at,updated_by,updated_at) VALUES (?,?,'DETERMINISTIC_TEST','Load test evidence renderer','deterministic-load-v1',1,'CONFIGURED','[\"STRUCTURED_OUTPUT\"]',NULL,5000,1000000,100000,10000,100000,1000000,10000,'EPHEMERAL','[]','[]','load-v1','{\"demo\":true}',?,?,?,?)",
    ),
    supplier: db.sqlite.prepare(
      "INSERT INTO suppliers (tenant_id,id,code,name,currency,lead_time_days,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES',2,1,'{}',?,?)",
    ),
    branchMetric: db.sqlite.prepare(
      "INSERT INTO daily_branch_metrics (tenant_id,branch_id,business_date,currency,gross_sales_minor,net_sales_minor,net_revenue_minor,cogs_minor,gross_profit_minor,gross_margin_bps,food_cost_bps,order_count,quality,quality_reasons_json,source_watermark,calculated_at) VALUES (?,?,?,'KES',?,?,?,?,?,?,?,?,'HIGH','[]',?,?)",
    ),
    channelMetric: db.sqlite.prepare(
      "INSERT INTO daily_channel_metrics (tenant_id,branch_id,business_date,channel_key,channel_id,channel_label,currency,order_count,gross_sales_minor,net_sales_minor,cogs_minor,contribution_minor,quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,NULL,?,'KES',?,?,?,?,?,'HIGH','[]',?)",
    ),
    supplierMetric: db.sqlite.prepare(
      "INSERT INTO daily_supplier_metrics (tenant_id,branch_id,business_date,supplier_id,currency,purchase_value_minor,order_count,on_time_bps,fill_rate_bps,price_variance_minor,quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,'KES',?,2,9500,9800,0,'HIGH','[]',?)",
    ),
    menuMetric: db.sqlite.prepare(
      "INSERT INTO daily_menu_item_metrics (tenant_id,branch_id,business_date,menu_item_id,quantity_sold,net_revenue_minor,theoretical_cost_minor,contribution_minor,food_cost_bps,sales_mix_bps,classification,quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,5,50000,16000,34000,3200,250,'STAR','HIGH','[]',?)",
    ),
    inventoryFact: db.sqlite.prepare(
      "INSERT INTO inventory_data_quality_issues (tenant_id,id,branch_id,entity_type,entity_id,issue_code,severity,message,status,detected_at) VALUES (?,?,?,'INVENTORY_ITEM',?,?,'INFO','Representative load fact','OPEN',?)",
    ),
  };
  db.sqlite.exec("BEGIN");
  try {
    for (let tenantIndex = 0; tenantIndex < tenantCount; tenantIndex += 1) {
      const tenantId = `load-tenant-${tenantIndex}`;
      const subscriptionId = `load-subscription-${tenantIndex}`;
      statements.tenant.run(
        tenantId,
        tenantId,
        `Load tenant ${tenantIndex}`,
        `Load tenant ${tenantIndex}`,
        "KES",
        stamp,
        stamp,
      );
      const userIds = [`load-user-${tenantIndex}-manager`, `load-user-${tenantIndex}-owner`];
      const roleIds = [`load-role-${tenantIndex}-manager`, `load-role-${tenantIndex}-owner`];
      userIds.forEach((userId, index) => {
        statements.user.run(tenantId, userId, `Load user ${tenantIndex}-${index}`, stamp, stamp);
        statements.role.run(
          tenantId,
          roleIds[index]!,
          index === 0 ? "MANAGER" : "OWNER",
          index === 0 ? "Manager" : "Owner",
        );
        statements.userRole.run(tenantId, userId, roleIds[index]!);
      });
      statements.featureFlag.run(tenantId, userIds[0]!, stamp);
      statements.subscription.run(tenantId, subscriptionId, stamp, stamp, stamp);
      for (const feature of [
        "intelligence.basic",
        "intelligence.finance",
        "intelligence.owner",
        "intelligence.scheduled_briefs",
        "intelligence.advanced_analysis",
      ]) {
        statements.entitlement.run(tenantId, subscriptionId, feature);
      }
      statements.provider.run(
        tenantId,
        `load-provider-${tenantIndex}`,
        userIds[0]!,
        stamp,
        userIds[0]!,
        stamp,
      );
      const suppliers = Array.from(
        { length: 3 },
        (_, index) => `load-supplier-${tenantIndex}-${index}`,
      );
      suppliers.forEach((supplierId, index) =>
        statements.supplier.run(
          tenantId,
          supplierId,
          `SUP-${index}`,
          `Supplier ${index}`,
          stamp,
          stamp,
        ),
      );
      const branchIds = Array.from(
        { length: branchesPerTenant },
        (_, index) => `load-branch-${tenantIndex}-${index}`,
      );
      branchIds.forEach((branchId, branchIndex) => {
        statements.branch.run(
          tenantId,
          branchId,
          `B${branchIndex}`,
          `Branch ${tenantIndex}-${branchIndex}`,
        );
        for (let dayOffset = 0; dayOffset < historyDays; dayOffset += 1) {
          const businessDate = isoDateDaysAgo(dayOffset);
          const netSales = 1_000_000 + tenantIndex * 10_000 + branchIndex * 1_000 + dayOffset;
          statements.branchMetric.run(
            tenantId,
            branchId,
            businessDate,
            netSales + 50_000,
            netSales,
            netSales - 100_000,
            300_000,
            netSales - 400_000,
            6500,
            3500,
            40,
            `load-${dayOffset}`,
            stamp,
          );
        }
        const today = isoDateDaysAgo(0);
        ["DINE_IN", "TAKEAWAY", "MARKETPLACE"].forEach((channel, index) =>
          statements.channelMetric.run(
            tenantId,
            branchId,
            today,
            channel,
            channel.replace("_", " "),
            10 + index,
            300_000,
            290_000,
            90_000,
            200_000,
            stamp,
          ),
        );
        suppliers.forEach((supplierId, index) =>
          statements.supplierMetric.run(
            tenantId,
            branchId,
            today,
            supplierId,
            100_000 + index * 10_000,
            stamp,
          ),
        );
        for (let index = 0; index < 40; index += 1)
          statements.menuMetric.run(
            tenantId,
            branchId,
            today,
            `menu-${tenantIndex}-${branchIndex}-${index}`,
            stamp,
          );
        for (let index = 0; index < 20; index += 1)
          statements.inventoryFact.run(
            tenantId,
            `inventory-fact-${tenantIndex}-${branchIndex}-${index}`,
            branchId,
            `item-${index}`,
            `LOAD_QUALITY_${branchIndex}_${index}`,
            stamp,
          );
      });
      userIds.forEach((userId, index) =>
        actors.push({
          id: userId,
          name: `Load user ${tenantIndex}-${index}`,
          tenantId,
          roleIds: [roleIds[index]!],
          permissions: [...allPermissionCodes],
          assignedBranchIds: branchIds,
          assignedBranches: branchIds.map((id) => ({ id, name: id })),
          branchScope: { type: "ALL" },
          branchId: branchIds[0]!,
          branch: branchIds[0]!,
          role: index === 0 ? "Manager" : "Owner",
        }),
      );
    }
    db.sqlite.exec("COMMIT");
  } catch (error) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }
  return actors;
}

function isoDateDaysAgo(days: number) {
  const date = new Date(Date.UTC(2026, 8, 1));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function providerConfig(): IntelligenceProviderConfiguration {
  return {
    id: "load-provider",
    tenantId: "load-tenant-0",
    providerKey: "DETERMINISTIC_TEST",
    displayName: "Load test evidence renderer",
    modelIdentifier: "deterministic-load-v1",
    enabled: true,
    status: "CONFIGURED",
    capabilities: ["STRUCTURED_OUTPUT"],
    timeoutMs: 5000,
    maxInputUnits: 1_000_000,
    maxOutputUnits: 100_000,
    perMinuteLimit: 10_000,
    dailyRequestLimit: 100_000,
    monthlyRequestLimit: 1_000_000,
    perUserDailyLimit: 10_000,
    retentionMode: "EPHEMERAL",
    allowedFeatures: [],
    allowedRoleIds: [],
    promptVersion: "load-v1",
  };
}

function providerRequest(evidence: EvidencePackage, index: number): IntelligenceProviderRequest {
  const { tenantId: _tenantId, ...tenantNeutralEvidence } = evidence;
  return {
    requestId: `load-request-${index}`,
    correlationId: `load-correlation-${index}`,
    providerKey: "DETERMINISTIC_TEST",
    modelIdentifier: "deterministic-load-v1",
    promptVersion: "load-v1",
    question: "How are we doing today?",
    intent: evidence.intent,
    evidence: tenantNeutralEvidence,
    maxOutputUnits: 100_000,
  };
}
