import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EnterpriseService } from "@/enterprise/enterprise-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-enterprise-load";
const branchCount = 500;

describe("Pass 12 enterprise representative load foundation", () => {
  let db: SqliteD1TestDatabase;
  let service: EnterpriseService;

  beforeAll(() => {
    db = createMigratedTestDatabase();
    seedFixture(db);
    service = new EnterpriseService(db, loadActor());
  });

  afterAll(() => db.close());

  it("measures hierarchy, dashboard, policy and overview reads across 500 branches", async () => {
    const timings: Record<string, number> = {};
    const hierarchy = await measured(timings, "hierarchyMs", () =>
      service.listHierarchy(undefined, 1000),
    );
    const dashboard = await measured(timings, "dashboardMs", () =>
      service.dashboard("load-root", "2026-09-01", "2026-09-30"),
    );
    const policy = await measured(timings, "policyResolveMs", () =>
      service.resolvePolicy("LOAD.MENU.GUARD", "load-branch-node-499"),
    );
    const overview = await measured(timings, "overviewMs", () => service.overview());

    expect(hierarchy).toHaveLength(branchCount + 11);
    expect(dashboard.branches).toHaveLength(branchCount);
    expect(dashboard.totals).toMatchObject({ branchCount, orderCount: branchCount * 25 });
    expect(policy).toMatchObject({ locked: true, effectiveValue: { active: true } });
    expect(overview.readiness).toHaveLength(200);
    expect(Object.values(timings).every((value) => value < 10_000)).toBe(true);
    console.info(
      "PASS12_LOAD_MEASUREMENTS",
      JSON.stringify({
        fixture: {
          branches: branchCount,
          nodes: hierarchy.length,
          metrics: branchCount,
          readiness: branchCount,
        },
        ...timings,
      }),
    );
  }, 30_000);
});

async function measured<T>(timings: Record<string, number>, key: string, action: () => Promise<T>) {
  const started = performance.now();
  const result = await action();
  timings[key] = Number((performance.now() - started).toFixed(2));
  return result;
}

function seedFixture(db: SqliteD1TestDatabase) {
  const stamp = "2026-09-09T10:00:00.000Z";
  db.sqlite.exec("BEGIN");
  try {
    db.sqlite
      .prepare(
        "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',?,?)",
      )
      .run(
        tenantId,
        "enterprise-load",
        "Enterprise Load Legal",
        "Enterprise Load",
        "KES",
        stamp,
        stamp,
      );
    db.sqlite
      .prepare(
        "INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,'Configured Brand',1,'{}')",
      )
      .run(tenantId, "load-brand", "LOAD");
    db.sqlite
      .prepare(
        "INSERT INTO legal_entities (tenant_id,id,code,legal_name,country_code,base_currency,status,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,'Configured Legal Entity','KE','KES','ACTIVE','load',?,'load',?)",
      )
      .run(tenantId, "load-legal", "LEGAL", stamp, stamp);
    const insertNode = db.sqlite.prepare(`INSERT INTO enterprise_nodes
      (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,status,effective_from,currency,
       metadata_json,created_by,created_at,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',?,'KES','{}','load',?,'load',?)`);
    const insertClosure = db.sqlite.prepare(
      "INSERT INTO enterprise_node_closure (tenant_id,ancestor_id,descendant_id,depth) VALUES (?,?,?,?)",
    );
    insertNode.run(
      tenantId,
      "load-root",
      "GROUP",
      "ROOT",
      "Configured Enterprise",
      null,
      null,
      null,
      null,
      stamp,
      stamp,
      stamp,
    );
    insertClosure.run(tenantId, "load-root", "load-root", 0);
    for (let region = 0; region < 10; region += 1) {
      const regionId = `load-region-${region}`;
      insertNode.run(
        tenantId,
        regionId,
        "REGION",
        `REG-${region}`,
        `Region ${region}`,
        "load-root",
        "load-legal",
        "load-brand",
        null,
        stamp,
        stamp,
        stamp,
      );
      insertClosure.run(tenantId, regionId, regionId, 0);
      insertClosure.run(tenantId, "load-root", regionId, 1);
    }
    const insertBranch = db.sqlite.prepare(
      "INSERT INTO branches (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    );
    const insertMetric = db.sqlite.prepare(`INSERT INTO daily_branch_metrics
      (tenant_id,branch_id,business_date,currency,gross_sales_minor,discounts_minor,refunds_minor,
       net_sales_minor,tax_minor,service_charge_minor,net_revenue_minor,marketplace_commission_minor,
       payment_processing_fees_minor,delivery_fees_minor,cogs_minor,gross_profit_minor,gross_margin_bps,
       food_cost_bps,labour_cost_minor,labour_cost_bps,operating_expenses_minor,contribution_minor,
       order_count,average_order_value_minor,payment_variance_minor,wastage_minor,inventory_variance_minor,
       quality,quality_reasons_json,source_watermark,calculated_at)
      VALUES (?,?,?,'KES',100000,0,0,100000,0,0,100000,0,0,0,30000,70000,7000,3000,10000,1000,5000,55000,25,4000,0,0,0,'HIGH','[]','load',?)`);
    const insertReadiness = db.sqlite.prepare(`INSERT INTO enterprise_readiness_results
      (tenant_id,id,scope_node_id,branch_id,check_code,status,severity,message,evidence_json,source,calculated_at)
      VALUES (?,?,?,?,?,'READY','INFO','Configured readiness evidence','{}','LOAD',?)`);
    for (let index = 0; index < branchCount; index += 1) {
      const branchId = `load-branch-${index}`;
      const nodeId = `load-branch-node-${index}`;
      const regionId = `load-region-${index % 10}`;
      insertBranch.run(
        tenantId,
        branchId,
        "load-brand",
        `BR-${index}`,
        `Branch ${String(index).padStart(3, "0")}`,
      );
      insertNode.run(
        tenantId,
        nodeId,
        "BRANCH",
        `NODE-${index}`,
        `Branch ${String(index).padStart(3, "0")}`,
        regionId,
        "load-legal",
        "load-brand",
        branchId,
        stamp,
        stamp,
        stamp,
      );
      insertClosure.run(tenantId, nodeId, nodeId, 0);
      insertClosure.run(tenantId, regionId, nodeId, 1);
      insertClosure.run(tenantId, "load-root", nodeId, 2);
      insertMetric.run(tenantId, branchId, "2026-09-09", stamp);
      insertReadiness.run(
        tenantId,
        `readiness-${index}`,
        nodeId,
        branchId,
        `CHECK-${index}`,
        stamp,
      );
    }
    db.sqlite
      .prepare(
        "INSERT INTO enterprise_policy_definitions (tenant_id,id,code,name,category,value_schema_json,sensitive,active,created_by,created_at,updated_at) VALUES (?,?,?,'Load guard','MENU','{}',0,1,'load',?,?)",
      )
      .run(tenantId, "load-policy", "LOAD.MENU.GUARD", stamp, stamp);
    db.sqlite
      .prepare(
        "INSERT INTO enterprise_policy_assignments (tenant_id,id,policy_id,scope_node_id,value_json,state,approval_policy_json,effective_from,version,created_by,created_at) VALUES (?,?,?,?,?,'LOCKED','{}',?,1,'load',?)",
      )
      .run(
        tenantId,
        "load-policy-assignment",
        "load-policy",
        "load-root",
        '{"active":true}',
        "2020-01-01T00:00:00.000Z",
        stamp,
      );
    db.sqlite.exec("COMMIT");
  } catch (error) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function loadActor(): ServerActor {
  const branches = Array.from({ length: branchCount }, (_, index) => `load-branch-${index}`);
  return {
    id: "load-enterprise-actor",
    name: "Configured load actor",
    tenantId,
    roleIds: ["load-role"],
    permissions: [...allPermissionCodes, permissions.tenantScopeAllBranches],
    assignedBranchIds: branches,
    assignedBranches: branches.map((id) => ({ id, name: id })),
    branchScope: { type: "ALL" },
    branchId: branches[0]!,
    role: "Configured role",
    branch: "Configured branch",
  };
}
