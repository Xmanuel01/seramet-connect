import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import {
  basisPoints,
  healthFromSeverities,
  menuClassification,
  percentile,
} from "@/management/calculations";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { enqueueManagementRecalculation } from "@/server/workers";
import { validateRuntimeConfiguration } from "@/server/environment";

const tenantId = "tenant-a";
const branchId = "branch-a";
const businessDate = "2026-08-30";

describe.sequential("Pass 7 management intelligence and restaurant finance", () => {
  let db: SqliteD1TestDatabase;
  let service: ManagementIntelligenceService;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seedFoundation(db);
    service = new ManagementIntelligenceService(db, actor());
  });

  afterEach(() => db.close());

  it("applies schema version 8 with durable management read models", async () => {
    const version = await db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .first<{ version: number }>();
    expect(version?.version).toBe(17);
    for (const table of [
      "management_actions",
      "management_action_events",
      "daily_branch_metrics",
      "daily_channel_metrics",
      "daily_station_metrics",
      "daily_staff_metrics",
      "daily_supplier_metrics",
      "daily_menu_item_metrics",
      "financial_summary_periods",
      "branch_health_snapshots",
      "inventory_gl_reconciliations",
      "close_readiness_snapshots",
    ]) {
      expect(
        await db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .bind(table)
          .first(),
        table,
      ).not.toBeNull();
    }
  });

  it("rejects the opt-in local database in production readiness", () => {
    const issues = validateRuntimeConfiguration({
      SERAMET_ENVIRONMENT: "production",
      SERAMET_ENABLE_LOCAL_DATABASE: "true",
    });
    expect(issues).toContainEqual({
      code: "LOCAL_DATABASE_FORBIDDEN",
      message: "The local development database is forbidden",
    });
  });

  it("uses deterministic integer ratios, percentiles, classifications and health", () => {
    expect(basisPoints(3_000, 10_000)).toBe(3_000);
    expect(percentile([100, 200, 300, 400, 500], 90)).toBe(500);
    expect(
      menuClassification({
        quality: "HIGH",
        contributionMinor: 8_000,
        contributionMedianMinor: 5_000,
        salesMixBps: 2_500,
        popularityMedianBps: 2_000,
      }),
    ).toBe("STAR");
    expect(healthFromSeverities(["HIGH", "HIGH"])).toBe("CRITICAL");
    expect(healthFromSeverities(["MEDIUM"])).toBe("WATCH");
  });

  it("reconciles branch sales, flash P&L, COGS and inventory GL from authoritative facts", async () => {
    seedDailyFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.latest).toMatchObject({
      grossSalesMinor: 10_000,
      discountsMinor: 100,
      netSalesMinor: 9_900,
      taxMinor: 1_000,
      cogsMinor: 3_000,
      grossProfitMinor: 6_900,
      orderCount: 1,
    });
    expect(control.flashPnl).toMatchObject({
      netRevenueMinor: 9_900,
      cogsMinor: 3_000,
      grossProfitMinor: 6_900,
      quality: "COMPLETE",
    });
    expect(control.inventoryGl).toMatchObject({
      subledgerValueMinor: 97_000,
      glValueMinor: 97_000,
      differenceMinor: 0,
      status: "MATCHED",
    });
  });

  it("labels a flash P&L partial when labour or station evidence is missing", async () => {
    seedInvoiceAndCogs(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.latest?.quality).toBe("MEDIUM");
    expect(control.flashPnl?.quality).toBe("PARTIAL");
    expect(control.flashPnl?.qualityReasons).toEqual(
      expect.arrayContaining(["MISSING_LABOUR_DATA", "MISSING_STATION_TIMESTAMPS"]),
    );
  });

  it("persists configurable actions idempotently and keeps resolved history without duplication", async () => {
    seedDailyFacts(db);
    await service.upsertThreshold({
      metricCode: "FOOD_COST_BPS",
      comparison: "GREATER_THAN",
      severity: "HIGH",
      thresholdValue: 2_000,
      valueUnit: "BPS",
      effectiveFrom: "2026-01-01",
    });
    await service.recalculateTenant(branchId, businessDate);
    await service.recalculateTenant(branchId, businessDate);
    const action = await db
      .prepare("SELECT id,status,evidence_json FROM management_actions WHERE tenant_id=?")
      .bind(tenantId)
      .first<{ id: string; status: string; evidence_json: string }>();
    expect(action?.status).toBe("OPEN");
    expect(JSON.parse(action!.evidence_json)).toMatchObject({ deepLink: "/finance" });
    expect(await count(db, "management_actions")).toBe(1);
    await service.transitionAction(
      action!.id,
      "RESOLVED",
      "Reviewed against the daily food-cost evidence",
    );
    await service.recalculateTenant(branchId, businessDate);
    expect(await count(db, "management_actions")).toBe(1);
    expect(
      await db
        .prepare("SELECT status FROM management_actions WHERE tenant_id=? AND id=?")
        .bind(tenantId, action!.id)
        .first("status"),
    ).toBe("RESOLVED");
    expect(await count(db, "management_action_events")).toBe(2);
  });

  it("resolves tenant targets with effective branch overrides and audits configuration", async () => {
    seedDailyFacts(db);
    await service.upsertTarget({
      metricCode: "FOOD_COST_BPS",
      targetValue: 3_100,
      valueUnit: "BPS",
      effectiveFrom: "2026-01-01",
    });
    await service.upsertTarget({
      branchId,
      metricCode: "FOOD_COST_BPS",
      targetValue: 2_900,
      valueUnit: "BPS",
      effectiveFrom: "2026-08-01",
      effectiveTo: "2026-08-31",
    });
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.targets).toContainEqual(
      expect.objectContaining({
        metricCode: "FOOD_COST_BPS",
        targetValue: 2_900,
        source: "BRANCH_OVERRIDE",
      }),
    );
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id=? AND action LIKE 'MANAGEMENT_%_CHANGED'",
        )
        .bind(tenantId)
        .first("count"),
    ).toBe(2);
  });

  it("calculates provider-neutral channel contribution from persisted charges and settlement facts", async () => {
    seedDailyFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.channels).toHaveLength(1);
    expect(control.channels[0]).toMatchObject({
      channelLabel: "Configured marketplace",
      commissionMinor: 1_000,
      providerFeesMinor: 200,
      cogsMinor: 3_000,
      contributionMinor: 5_700,
      settlementDifferenceMinor: -200,
    });
  });

  it("marks a configured marketplace channel incomplete when settlement facts are absent", async () => {
    seedDailyFacts(db);
    db.sqlite.prepare("DELETE FROM settlement_batches WHERE tenant_id=?").run(tenantId);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.channels[0]).toMatchObject({
      settlementDifferenceMinor: null,
      qualityReasons: expect.arrayContaining(["MISSING_SETTLEMENT_FACTS"]),
    });
  });

  it("calculates kitchen average, median and P90 only from persisted station timestamps", async () => {
    seedDailyFacts(db);
    seedSecondStationTicket(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.stations[0]).toMatchObject({
      ticketCount: 2,
      completedCount: 2,
      averagePrepMs: 900_000,
      medianPrepMs: 900_000,
      p90PrepMs: 1_200_000,
      quality: "HIGH",
    });
  });

  it("degrades kitchen quality when persisted station timestamps are incomplete", async () => {
    seedDailyFacts(db);
    db.sqlite
      .prepare(
        "UPDATE order_station_status SET payload_json='{}' WHERE tenant_id=? AND order_id='order-1'",
      )
      .run(tenantId);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.stations[0]).toMatchObject({
      averagePrepMs: null,
      quality: "MEDIUM",
      qualityReasons: ["MISSING_STATION_TIMESTAMPS"],
    });
  });

  it("reports factual staff attendance and service values without generating an employee score", async () => {
    seedDailyFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.staff[0]).toMatchObject({
      employeeName: "Configured employee",
      workedMinutes: 480,
      lateMinutes: 5,
      labourCostMinor: 9_600,
      ordersHandled: 1,
    });
    expect(control.staff[0]).not.toHaveProperty("score");
  });

  it("calculates supplier lead time, fill rate, rejection and price variance from procurement facts", async () => {
    seedDailyFacts(db);
    seedSupplierFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.suppliers[0]).toMatchObject({
      averageLeadTimeMinutes: 2_880,
      onTimeBps: 10_000,
      fillRateBps: 9_000,
      rejectedQuantityMicro: 1_000_000,
      priceVarianceMinor: 700,
      invoiceMatchExceptions: 1,
      outstandingPayableMinor: 62_000,
    });
  });

  it("reclassifies menu profitability deterministically and keeps missing recipes insufficient", async () => {
    seedDailyFacts(db);
    seedMenuFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.menu.find((row) => row.menuItemId === "menu-a")?.classification).toBe("STAR");
    expect(control.menu.find((row) => row.menuItemId === "menu-missing")).toMatchObject({
      classification: "INSUFFICIENT_DATA",
      quality: "INSUFFICIENT_DATA",
    });
  });

  it("builds a mathematically reconciled food-cost bridge and leaves the remainder unexplained", async () => {
    seedFoodCostBridgeFacts(db);
    const bridge = await service.foodCostBridge({
      branchId,
      previousStart: "2026-08-01",
      previousEnd: "2026-08-07",
      currentStart: "2026-08-08",
      currentEnd: "2026-08-14",
    });
    expect(bridge.changeMinor).toBe(5_000);
    expect(
      bridge.drivers.reduce((sum, row) => sum + row.amountMinor, 0) + bridge.unexplainedMinor,
    ).toBe(bridge.changeMinor);
    expect(bridge.unexplainedMinor).toBe(2_500);
  });

  it("surfaces close blockers and never posts a balancing journal from reconciliation", async () => {
    seedDailyFacts(db);
    db.sqlite
      .prepare(
        `INSERT INTO reconciliation_exceptions
          (tenant_id,id,branch_id,source_type,source_id,amount_minor,currency,status,severity,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,500,'KES','OPEN','HIGH','{}',?,?)`,
      )
      .run(tenantId, "recon-open", branchId, "BANK", "bank-1", iso(), iso());
    const journalsBefore = await count(db, "journal_entries");
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.closeReadiness).toMatchObject({ status: "NOT_READY", blockerCount: 1 });
    expect(await count(db, "journal_entries")).toBe(journalsBefore);
  });

  it("aggregates approvals without duplicating source approval records", async () => {
    seedSupplierApproval(db);
    await service.recalculateTenant(branchId, businessDate);
    await service.recalculateTenant(branchId, businessDate);
    const control = await service.controlCentre({ branchId, periodEnd: businessDate });
    expect(control.approvals).toHaveLength(1);
    expect(control.approvals[0]).toMatchObject({
      sourceType: "PURCHASE_ORDER",
      sourceId: "po-approval",
    });
  });

  it("enforces tenant and branch authorization and financial-view permissions", async () => {
    await expect(
      new ManagementIntelligenceService(db, actor("tenant-b", ["branch-c"])).controlCentre({
        branchId,
        periodEnd: businessDate,
      }),
    ).rejects.toThrow(/cannot read/i);
    await expect(
      new ManagementIntelligenceService(db, actor(tenantId, ["branch-b"])).controlCentre({
        branchId,
        periodEnd: businessDate,
      }),
    ).rejects.toThrow(/cannot read/i);
    const noFinance = actor(tenantId, [branchId], [permissions.managementView]);
    await expect(
      new ManagementIntelligenceService(db, noFinance).controlCentre({
        branchId,
        periodEnd: businessDate,
      }),
    ).rejects.toThrow(permissions.managementFinanceView);
  });

  it("keeps authorized branches visible in comparison when calculated data is missing", async () => {
    seedDailyFacts(db);
    await service.recalculateTenant(branchId, businessDate);
    const owner = await service.ownerControlCentre(businessDate, businessDate);
    expect(owner.branches).toHaveLength(2);
    expect(owner.branches.find((row) => row.metric.branchId === "branch-b")?.metric).toMatchObject({
      branchName: "Configured branch-b",
      quality: "INSUFFICIENT_DATA",
      qualityReasons: ["MISSING_CALCULATED_BRANCH_METRICS"],
    });
  });

  it("deduplicates durable management jobs before queue delivery", async () => {
    const delivered: unknown[] = [];
    const env = {
      SERAMET_DB: db,
      SERAMET_WORK_QUEUE: {
        async send(message: unknown) {
          delivered.push(message);
        },
      },
    };
    const first = await enqueueManagementRecalculation(env, {
      tenantId,
      branchId,
      idempotencyKey: "same-management-job",
    });
    const second = await enqueueManagementRecalculation(env, {
      tenantId,
      branchId,
      idempotencyKey: "same-management-job",
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(await count(db, "worker_jobs")).toBe(1);
    expect(await count(db, "management_recalculation_events")).toBe(1);
  });
});

function actor(
  selectedTenant = tenantId,
  branches = [branchId, "branch-b"],
  permissionCodes = allPermissionCodes,
): ServerActor {
  return {
    id: `user-${selectedTenant}`,
    name: "Management user",
    tenantId: selectedTenant,
    roleIds: ["management"],
    permissions: [...permissionCodes],
    assignedBranchIds: branches,
    assignedBranches: branches.map((id) => ({ id, name: id })),
    branchScope: { type: "BRANCH", branchId: branches[0]! },
    branchId: branches[0]!,
    branch: branches[0]!,
    role: "Configured role",
  };
}

function seedFoundation(db: SqliteD1TestDatabase) {
  const stamp = iso();
  for (const [id, slug] of [
    [tenantId, "tenant-a"],
    ["tenant-b", "tenant-b"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(id, slug, id, id, stamp, stamp);
  }
  for (const [tenant, branch, warehouse] of [
    [tenantId, branchId, "warehouse-a"],
    [tenantId, "branch-b", "warehouse-b"],
    ["tenant-b", "branch-c", "warehouse-c"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO branches
          (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
         VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{"currency":"KES"}')`,
      )
      .run(tenant, branch, branch.toUpperCase(), `Configured ${branch}`);
    db.sqlite
      .prepare(
        `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
         VALUES (?,?,?,?,?,1,'{}')`,
      )
      .run(tenant, warehouse, branch, warehouse.toUpperCase(), warehouse);
  }
  for (const [id, code, name, type, payload] of [
    ["account-inventory", "INV", "Inventory", "ASSET", "{}"],
    ["account-cogs", "COGS", "Cost", "COGS", '{"managementCategory":"COGS"}'],
    ["account-payable", "AP", "Payable", "LIABILITY", "{}"],
    ["account-waste", "WASTE", "Waste", "EXPENSE", "{}"],
    ["account-variance", "VAR", "Variance", "EXPENSE", "{}"],
    ["account-equity", "EQUITY", "Equity", "EQUITY", "{}"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO accounts
          (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
         VALUES (?,?,NULL,?,?,?,?,1,?)`,
      )
      .run(tenantId, id, code, name, type, "KES", payload);
  }
  db.sqlite
    .prepare(
      `INSERT INTO inventory_account_mappings
        (tenant_id,id,inventory_account_id,accounts_payable_account_id,cogs_account_id,wastage_account_id,
         variance_account_id,accounting_mode,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'PERPETUAL',1,?,?)`,
    )
    .run(
      tenantId,
      "mapping-default",
      "account-inventory",
      "account-payable",
      "account-cogs",
      "account-waste",
      "account-variance",
      stamp,
      stamp,
    );
  db.sqlite
    .prepare(
      `INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
       VALUES (?,?,?,'PREP','Configured station','OTHER',1,'{"targetPrepTimeMs":900000}')`,
    )
    .run(tenantId, "station-a", branchId);
  db.sqlite
    .prepare(
      `INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json)
       VALUES (?,?,'MARKET','MARKETPLACE',1,'{"displayName":"Configured marketplace","providerConnectionId":"connection-a"}')`,
    )
    .run(tenantId, "channel-market");
  db.sqlite
    .prepare(
      `INSERT INTO employees
        (tenant_id,id,branch_id,employee_number,status,payload_json,created_at,updated_at)
       VALUES (?,?,?,'EMP-1','ACTIVE','{"name":"Configured employee","hourlyRateMinor":1200}',?,?)`,
    )
    .run(tenantId, "employee-a", branchId, stamp, stamp);
  db.sqlite
    .prepare(
      `INSERT INTO inventory_items
        (tenant_id,id,sku,name,unit,active,payload_json,code,track_inventory,track_expiry,updated_at)
       VALUES (?,?,'ITEM-1','Configured item','kg',1,'{}','ITEM-1',1,0,?)`,
    )
    .run(tenantId, "item-a", stamp);
  db.sqlite
    .prepare(
      `INSERT INTO inventory_balances
        (tenant_id,branch_id,warehouse_id,item_id,quantity_minor,version,updated_at,payload_json,
         quantity_reserved_minor,average_unit_cost_minor,total_value_minor,last_movement_at)
       VALUES (?,?,?,'item-a',2000000,1,?,'{}',0,50000,100000,?)`,
    )
    .run(tenantId, branchId, "warehouse-a", stamp, stamp);
  insertJournal(db, "opening", "2026-01-01", 100_000, "account-inventory", "account-equity");
}

function seedDailyFacts(db: SqliteD1TestDatabase) {
  seedInvoiceAndCogs(db);
  db.sqlite
    .prepare(
      `INSERT INTO orders
        (tenant_id,id,branch_id,display_number,status,channel_id,business_date,currency,total_minor,
         correlation_id,version,payload_json,created_at,updated_at)
       VALUES (?,?,?,'ORD-1','COMPLETED','channel-market',?,'KES',9900,'corr-1',1,?,?,?)`,
    )
    .run(
      tenantId,
      "order-1",
      branchId,
      businessDate,
      JSON.stringify({
        grossSalesMinor: 10_000,
        discountMinor: 100,
        employeeId: "employee-a",
        acceptedAt: `${businessDate}T10:00:00.000Z`,
        completedAt: `${businessDate}T10:15:00.000Z`,
      }),
      `${businessDate}T10:00:00.000Z`,
      `${businessDate}T10:15:00.000Z`,
    );
  db.sqlite
    .prepare(
      `INSERT INTO inventory_movements
        (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,source_type,source_id,
         idempotency_key,correlation_id,payload_json,created_at,total_cost_minor,business_date,occurred_at,negative_override)
       VALUES (?,?,?,?,'item-a','SALE_CONSUMPTION',-1000000,'ORDER','order-1','movement-sale','corr-1','{}',?,-3000,?,?,0)`,
    )
    .run(tenantId, "movement-sale", branchId, "warehouse-a", iso(), businessDate, iso());
  db.sqlite
    .prepare(
      `INSERT INTO order_station_status
        (tenant_id,order_id,station_id,status,version,updated_at,payload_json)
       VALUES (?,?,'station-a','READY',1,?,?)`,
    )
    .run(
      tenantId,
      "order-1",
      `${businessDate}T10:15:00.000Z`,
      JSON.stringify({
        startedAt: `${businessDate}T10:00:00.000Z`,
        readyAt: `${businessDate}T10:10:00.000Z`,
        pickedUpAt: `${businessDate}T10:12:00.000Z`,
      }),
    );
  db.sqlite
    .prepare(
      `INSERT INTO attendance
        (tenant_id,id,branch_id,employee_id,business_date,clock_in_at,clock_out_at,idempotency_key,payload_json)
       VALUES (?,?,?,'employee-a',?,?,?,'attendance-1','{"lateMinutes":5}')`,
    )
    .run(
      tenantId,
      "attendance-1",
      branchId,
      businessDate,
      `${businessDate}T06:00:00.000Z`,
      `${businessDate}T14:00:00.000Z`,
    );
  for (const [id, type, amount] of [
    ["charge-commission", "COMMISSION", -1_000],
    ["charge-fee", "SERVICE_FEE", -200],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO marketplace_charges
          (tenant_id,id,branch_id,order_id,charge_type,amount_minor,currency,payload_json,created_at)
         VALUES (?,?,?,?,?,?,'KES','{}',?)`,
      )
      .run(tenantId, id, branchId, "order-1", type, amount, iso());
  }
  db.sqlite
    .prepare(
      `INSERT INTO settlement_batches
        (tenant_id,id,branch_id,connection_id,external_settlement_id,period_start,period_end,gross_minor,
         net_expected_minor,net_settled_minor,currency,status,version,payload_json,created_at,updated_at)
       VALUES (?,?,?,'connection-a','external-settlement',?,?,9900,8000,7800,'KES','MATCHED',1,'{}',?,?)`,
    )
    .run(tenantId, "settlement-a", branchId, businessDate, businessDate, iso(), iso());
}

function seedInvoiceAndCogs(db: SqliteD1TestDatabase) {
  db.sqlite
    .prepare(
      `INSERT INTO invoices
        (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,paid_minor,
         version,payload_json,created_at,updated_at)
       VALUES (?,?,?,'INV-1','PAID',?,'KES',10900,10900,1,?,?,?)`,
    )
    .run(
      tenantId,
      "invoice-1",
      branchId,
      businessDate,
      JSON.stringify({ grossSalesMinor: 10_000, discountMinor: 100, taxMinor: 1_000 }),
      iso(),
      iso(),
    );
  insertJournal(db, "sale-cogs", businessDate, 3_000, "account-cogs", "account-inventory");
}

function seedSecondStationTicket(db: SqliteD1TestDatabase) {
  db.sqlite
    .prepare(
      `INSERT INTO orders
        (tenant_id,id,branch_id,display_number,status,channel_id,business_date,currency,total_minor,
         correlation_id,version,payload_json,created_at,updated_at)
       VALUES (?,?,?,'ORD-2','COMPLETED','channel-market',?,'KES',1000,'corr-2',1,'{}',?,?)`,
    )
    .run(tenantId, "order-2", branchId, businessDate, iso(), iso());
  db.sqlite
    .prepare(
      `INSERT INTO order_station_status
        (tenant_id,order_id,station_id,status,version,updated_at,payload_json)
       VALUES (?,?,'station-a','READY',1,?,?)`,
    )
    .run(
      tenantId,
      "order-2",
      iso(),
      JSON.stringify({
        startedAt: `${businessDate}T11:00:00.000Z`,
        readyAt: `${businessDate}T11:20:00.000Z`,
      }),
    );
}

function seedSupplierFacts(db: SqliteD1TestDatabase) {
  db.sqlite
    .prepare(
      `INSERT INTO unit_definitions
        (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at)
       VALUES (?,'unit-kg','KG','Kilogram','kg','MASS',1,1,1,?,?)`,
    )
    .run(tenantId, iso(), iso());
  db.sqlite
    .prepare(
      `UPDATE inventory_items SET base_unit_id='unit-kg',purchase_unit_id='unit-kg' WHERE tenant_id=? AND id='item-a'`,
    )
    .run(tenantId);
  db.sqlite
    .prepare(
      `INSERT INTO suppliers
        (tenant_id,id,code,name,payment_terms_days,currency,lead_time_days,active,payload_json,created_at,updated_at)
       VALUES (?,'supplier-a','SUP-A','Configured supplier',30,'KES',2,1,'{}',?,?)`,
    )
    .run(tenantId, iso(), iso());
  db.sqlite
    .prepare(
      `INSERT INTO purchase_orders
        (tenant_id,id,branch_id,purchase_order_number,status,currency,total_minor,version,payload_json,
         created_at,updated_at,supplier_id,warehouse_id,expected_at,received_at)
       VALUES (?,?,?,'PO-1','RECEIVED','KES',62000,1,'{}',?,?,?,?,?,?)`,
    )
    .run(
      tenantId,
      "po-1",
      branchId,
      "2026-08-28T10:00:00.000Z",
      iso(),
      "supplier-a",
      "warehouse-a",
      `${businessDate}T12:00:00.000Z`,
      `${businessDate}T10:00:00.000Z`,
    );
  db.sqlite
    .prepare(
      `INSERT INTO purchase_order_lines
        (tenant_id,id,purchase_order_id,item_id,ordered_quantity_minor,received_quantity_minor,
         unit_cost_minor,payload_json,purchase_unit_id,ordered_purchase_quantity_minor,received_purchase_quantity_minor,
         tax_minor,discount_minor)
       VALUES (?,'pol-1','po-1','item-a',10000000,9000000,5500,'{}','unit-kg',10000000,10000000,0,0)`,
    )
    .run(tenantId);
  db.sqlite
    .prepare(
      `INSERT INTO goods_receipts
        (tenant_id,id,branch_id,purchase_order_id,receipt_number,idempotency_key,status,payload_json,
         received_at,supplier_id,warehouse_id,received_by,business_date)
       VALUES (?,?,?,'po-1','GR-1','gr-1','ACCEPTED','{}',?,'supplier-a','warehouse-a','receiver',?)`,
    )
    .run(tenantId, "gr-1", branchId, `${businessDate}T10:00:00.000Z`, businessDate);
  db.sqlite
    .prepare(
      `INSERT INTO goods_receipt_lines
        (tenant_id,id,goods_receipt_id,purchase_order_line_id,inventory_item_id,purchase_unit_id,
         received_purchase_quantity_minor,accepted_purchase_quantity_minor,rejected_purchase_quantity_minor,
         converted_base_quantity_minor,unit_price_minor,total_cost_minor,quality_status,price_variance_minor,
         price_variance_bps,created_at)
       VALUES (?,'grl-1','gr-1','pol-1','item-a','unit-kg',10000000,9000000,1000000,
         9000000,6200,62000,'PARTIAL',700,1273,?)`,
    )
    .run(tenantId, iso());
  db.sqlite
    .prepare(
      `INSERT INTO supplier_invoices
        (tenant_id,id,branch_id,supplier_id,purchase_order_id,goods_receipt_id,invoice_number,
         invoice_date,currency,subtotal_minor,tax_minor,total_minor,status,payload_json,created_at,updated_at)
       VALUES (?,?,?,'supplier-a','po-1','gr-1','SI-1',?,'KES',62000,0,62000,'POSTED','{}',?,?)`,
    )
    .run(tenantId, "supplier-invoice-1", branchId, businessDate, iso(), iso());
  db.sqlite
    .prepare(
      `INSERT INTO procurement_matches
        (tenant_id,id,purchase_order_id,goods_receipt_id,supplier_invoice_id,status,ordered_total_minor,
         received_total_minor,invoiced_total_minor,variance_minor,payload_json,created_at,updated_at)
       VALUES (?,'match-1','po-1','gr-1','supplier-invoice-1','QUANTITY_VARIANCE',55000,62000,62000,7000,'{}',?,?)`,
    )
    .run(tenantId, iso(), iso());
}

function seedMenuFacts(db: SqliteD1TestDatabase) {
  for (const row of [
    ["menu-a", 20, 20_000, 5_000, 15_000, 2_500, "HIGH"],
    ["menu-b", 5, 7_000, 2_000, 5_000, 2_857, "HIGH"],
    ["menu-missing", 1, 1_000, 0, 1_000, 0, "INSUFFICIENT_DATA"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO menu_profitability_snapshots
          (tenant_id,id,branch_id,menu_item_id,period_start,period_end,quantity_sold,net_revenue_minor,
           theoretical_cost_minor,contribution_minor,food_cost_bps,classification,quality,generated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'INSUFFICIENT_DATA',?,?)`,
      )
      .run(
        tenantId,
        `profit-${row[0]}`,
        branchId,
        row[0],
        businessDate,
        businessDate,
        row[1],
        row[2],
        row[3],
        row[4],
        row[5],
        row[6],
        iso(),
      );
  }
}

function seedFoodCostBridgeFacts(db: SqliteD1TestDatabase) {
  insertJournal(db, "previous-cogs", "2026-08-03", 10_000, "account-cogs", "account-inventory");
  insertJournal(db, "current-cogs", "2026-08-10", 15_000, "account-cogs", "account-inventory");
  for (const [id, type, value] of [
    ["bridge-waste", "WASTAGE", 1_000],
    ["bridge-count", "STOCK_COUNT_ADJUSTMENT", 500],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO inventory_movements
          (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,source_type,source_id,
           idempotency_key,correlation_id,payload_json,created_at,total_cost_minor,business_date,occurred_at,negative_override)
         VALUES (?,?,?,?,?,?,1,'TEST',?,?,?,'{}',?,?,?,?,0)`,
      )
      .run(
        tenantId,
        id,
        branchId,
        "warehouse-a",
        "item-a",
        type,
        id,
        id,
        id,
        iso(),
        value,
        "2026-08-10",
        iso(),
      );
  }
  seedSupplierFacts(db);
  db.sqlite
    .prepare(
      "UPDATE goods_receipt_lines SET price_variance_minor=1000 WHERE tenant_id=? AND id='grl-1'",
    )
    .run(tenantId);
  db.sqlite
    .prepare("UPDATE goods_receipts SET business_date='2026-08-10' WHERE tenant_id=? AND id='gr-1'")
    .run(tenantId);
}

function seedSupplierApproval(db: SqliteD1TestDatabase) {
  db.sqlite
    .prepare(
      `INSERT INTO purchase_orders
        (tenant_id,id,branch_id,purchase_order_number,status,currency,total_minor,version,payload_json,created_at,updated_at)
       VALUES (?,?,?,'PO-APPROVAL','SUBMITTED','KES',5000,1,'{}',?,?)`,
    )
    .run(tenantId, "po-approval", branchId, iso(), iso());
}

function insertJournal(
  db: SqliteD1TestDatabase,
  id: string,
  date: string,
  amount: number,
  debitAccount: string,
  creditAccount: string,
) {
  db.sqlite
    .prepare(
      `INSERT INTO journal_entries
        (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,correlation_id,payload_json,created_at,posted_at)
       VALUES (?,?,?,'TEST',?,?, 'DRAFT','Test journal',?,'{}',?,NULL)`,
    )
    .run(tenantId, id, branchId, id, date, id, iso());
  db.sqlite
    .prepare(
      `INSERT INTO journal_lines
        (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
       VALUES (?,?,1,?,?,0,'KES','{}'),(?,?,2,?,0,?,'KES','{}')`,
    )
    .run(tenantId, id, debitAccount, amount, tenantId, id, creditAccount, amount);
  db.sqlite
    .prepare(
      `UPDATE journal_entries
       SET status = 'POSTED', posted_at = ?
       WHERE tenant_id = ? AND id = ?`,
    )
    .run(iso(), tenantId, id);
}

async function count(db: SqliteD1TestDatabase, table: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function iso() {
  return "2026-08-30T12:00:00.000Z";
}
