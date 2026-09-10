import { afterEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-load";
const branchCount = 10;
const dayCount = 365;
const representedOrders = 250_000;
const lastBusinessDate = "2026-08-30";

describe.sequential("Pass 7 management read-model performance fixture", () => {
  let db: SqliteD1TestDatabase | undefined;

  afterEach(() => db?.close());

  it("serves bounded multi-branch management queries at the documented fixture size", async () => {
    db = createMigratedTestDatabase();
    const seedStarted = performance.now();
    seedPerformanceFixture(db);
    const seedMs = performance.now() - seedStarted;
    const service = new ManagementIntelligenceService(db, loadActor());

    const ownerStarted = performance.now();
    const owner = await service.ownerControlCentre("2025-08-31", lastBusinessDate);
    const ownerMs = performance.now() - ownerStarted;

    const branchStarted = performance.now();
    const branch = await service.controlCentre({
      branchId: "branch-load-0",
      periodStart: "2026-08-24",
      periodEnd: lastBusinessDate,
      limit: 200,
    });
    const branchMs = performance.now() - branchStarted;

    const periodStarted = performance.now();
    const period = await db
      .prepare(
        `SELECT COUNT(*) AS day_rows, SUM(order_count) AS order_count,
                SUM(net_sales_minor) AS net_sales_minor
         FROM daily_branch_metrics
         WHERE tenant_id=? AND business_date BETWEEN ? AND ?`,
      )
      .bind(tenantId, "2025-08-31", lastBusinessDate)
      .first<{ day_rows: number; order_count: number; net_sales_minor: number }>();
    const periodMs = performance.now() - periodStarted;

    const inventoryStarted = performance.now();
    const inventory = await db
      .prepare(
        `SELECT COUNT(*) AS movement_count, SUM(total_cost_minor) AS total_value_minor
         FROM inventory_movements WHERE tenant_id=?`,
      )
      .bind(tenantId)
      .first<{ movement_count: number; total_value_minor: number }>();
    const inventoryMs = performance.now() - inventoryStarted;

    expect(owner.branches).toHaveLength(branchCount);
    expect(branch.trend).toHaveLength(7);
    expect(branch.menu).toHaveLength(100);
    expect(branch.staff).toHaveLength(100);
    expect(branch.channels).toHaveLength(3);
    expect(branch.suppliers).toHaveLength(5);
    expect(period).toMatchObject({
      day_rows: branchCount * dayCount,
      order_count: representedOrders,
    });
    expect(inventory).toMatchObject({ movement_count: 10_000, total_value_minor: 10_000 });

    // These are regression ceilings for a local SQLite test runtime, not production latency claims.
    expect(ownerMs).toBeLessThan(2_500);
    expect(branchMs).toBeLessThan(2_500);
    expect(periodMs).toBeLessThan(1_000);
    expect(inventoryMs).toBeLessThan(1_000);

    console.info(
      "PASS_7_PERFORMANCE",
      JSON.stringify({
        fixture: {
          branches: branchCount,
          days: dayCount,
          representedOrders,
          menuRows: 1_000,
          inventoryMovements: 10_000,
          staffRows: 1_000,
          channels: 3,
          suppliers: 5,
        },
        timingsMs: {
          seed: rounded(seedMs),
          ownerControlCentre: rounded(ownerMs),
          branchControlCentre: rounded(branchMs),
          periodAggregate: rounded(periodMs),
          inventoryAggregate: rounded(inventoryMs),
        },
      }),
    );
  }, 30_000);
});

function seedPerformanceFixture(db: SqliteD1TestDatabase) {
  const stamp = "2026-08-30T20:00:00.000Z";
  const branches = Array.from({ length: branchCount }, (_, index) => `branch-load-${index}`);
  db.sqlite.exec("BEGIN");
  try {
    db.sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(tenantId, tenantId, "Load tenant", "Load tenant", "KES", stamp, stamp);
    db.sqlite
      .prepare(
        `INSERT INTO brands (tenant_id,id,code,name,active,payload_json)
         VALUES (?,?,'LOAD','Load brand',1,'{}')`,
      )
      .run(tenantId, "brand-load");

    const branchStatement = db.sqlite.prepare(
      `INSERT INTO branches
        (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES (?,?,? ,?,?,'Africa/Nairobi',240,1,'{"defaultCurrency":"KES"}')`,
    );
    const warehouseStatement = db.sqlite.prepare(
      `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
       VALUES (?,?,?,?,?,1,'{}')`,
    );
    for (const [index, branchId] of branches.entries()) {
      branchStatement.run(tenantId, branchId, "brand-load", `B${index}`, `Branch ${index}`);
      warehouseStatement.run(
        tenantId,
        `warehouse-load-${index}`,
        branchId,
        `W${index}`,
        `Warehouse ${index}`,
      );
    }

    const itemStatement = db.sqlite.prepare(
      `INSERT INTO inventory_items
        (tenant_id,id,sku,name,unit,active,payload_json,code,track_inventory,track_expiry,updated_at)
       VALUES (?,?,?,?, 'piece',1,'{}',?,1,0,?)`,
    );
    for (let index = 0; index < 10; index += 1) {
      itemStatement.run(
        tenantId,
        `item-load-${index}`,
        `ITEM-${index}`,
        `Inventory item ${index}`,
        `ITEM-${index}`,
        stamp,
      );
    }

    const supplierStatement = db.sqlite.prepare(
      `INSERT INTO suppliers
        (tenant_id,id,code,name,currency,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,'KES',1,'{}',?,?)`,
    );
    for (let index = 0; index < 5; index += 1) {
      supplierStatement.run(
        tenantId,
        `supplier-load-${index}`,
        `SUP-${index}`,
        `Supplier ${index}`,
        stamp,
        stamp,
      );
    }

    seedDailyBranchMetrics(db, branches, stamp);
    seedMenuMetrics(db, branches, stamp);
    seedStaffMetrics(db, branches, stamp);
    seedChannelAndSupplierMetrics(db, branches, stamp);
    seedInventoryMovements(db, branches, stamp);
    seedHealth(db, branches, stamp);
    db.sqlite.exec("COMMIT");
  } catch (error) {
    db.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function seedDailyBranchMetrics(db: SqliteD1TestDatabase, branches: string[], stamp: string) {
  const rows = branchCount * dayCount;
  const ordersPerRow = Math.floor(representedOrders / rows);
  const remainder = representedOrders - ordersPerRow * rows;
  const statement = db.sqlite.prepare(
    `INSERT INTO daily_branch_metrics
      (tenant_id,branch_id,business_date,currency,gross_sales_minor,net_sales_minor,
       net_revenue_minor,cogs_minor,gross_profit_minor,gross_margin_bps,food_cost_bps,
       labour_cost_minor,labour_cost_bps,contribution_minor,order_count,
       average_order_value_minor,quality,calculated_at)
     VALUES (?,?,?,'KES',?,?,?,?,?,?,?,?,?,?,?,?, 'HIGH',?)`,
  );
  let rowIndex = 0;
  for (const branchId of branches) {
    for (let day = 0; day < dayCount; day += 1) {
      const orderCount = ordersPerRow + (rowIndex < remainder ? 1 : 0);
      const netSales = orderCount * 2_500;
      const cogs = Math.trunc((netSales * 3_200) / 10_000);
      const labour = Math.trunc((netSales * 1_800) / 10_000);
      statement.run(
        tenantId,
        branchId,
        fixtureDate(day),
        netSales,
        netSales,
        netSales,
        cogs,
        netSales - cogs,
        6_800,
        3_200,
        labour,
        1_800,
        netSales - cogs - labour,
        orderCount,
        2_500,
        stamp,
      );
      rowIndex += 1;
    }
  }
}

function seedMenuMetrics(db: SqliteD1TestDatabase, branches: string[], stamp: string) {
  const statement = db.sqlite.prepare(
    `INSERT INTO daily_menu_item_metrics
      (tenant_id,branch_id,business_date,menu_item_id,quantity_sold,net_revenue_minor,
       theoretical_cost_minor,contribution_minor,food_cost_bps,sales_mix_bps,
       classification,quality,calculated_at)
     VALUES (?,?,?,?,10,25000,8000,17000,3200,100,'STAR','HIGH',?)`,
  );
  for (const [branchIndex, branchId] of branches.entries()) {
    for (let itemIndex = 0; itemIndex < 100; itemIndex += 1) {
      statement.run(
        tenantId,
        branchId,
        lastBusinessDate,
        `menu-load-${branchIndex}-${itemIndex}`,
        stamp,
      );
    }
  }
}

function seedStaffMetrics(db: SqliteD1TestDatabase, branches: string[], stamp: string) {
  const employee = db.sqlite.prepare(
    `INSERT INTO employees
      (tenant_id,id,branch_id,employee_number,status,payload_json,created_at,updated_at)
     VALUES (?,?,?,?, 'ACTIVE',?, ?,?)`,
  );
  const metric = db.sqlite.prepare(
    `INSERT INTO daily_staff_metrics
      (tenant_id,branch_id,business_date,employee_id,shift_count,worked_minutes,
       labour_cost_minor,orders_handled,net_sales_minor,average_order_value_minor,
       quality,calculated_at)
     VALUES (?,?,?,?,1,480,9600,10,25000,2500,'HIGH',?)`,
  );
  for (const [branchIndex, branchId] of branches.entries()) {
    for (let staffIndex = 0; staffIndex < 100; staffIndex += 1) {
      const id = `employee-load-${branchIndex}-${staffIndex}`;
      employee.run(
        tenantId,
        id,
        branchId,
        `EMP-${branchIndex}-${staffIndex}`,
        JSON.stringify({ name: `Employee ${branchIndex}-${staffIndex}` }),
        stamp,
        stamp,
      );
      metric.run(tenantId, branchId, lastBusinessDate, id, stamp);
    }
  }
}

function seedChannelAndSupplierMetrics(
  db: SqliteD1TestDatabase,
  branches: string[],
  stamp: string,
) {
  const channel = db.sqlite.prepare(
    `INSERT INTO daily_channel_metrics
      (tenant_id,branch_id,business_date,channel_key,channel_label,currency,order_count,
       net_sales_minor,commission_minor,provider_fees_minor,cogs_minor,contribution_minor,
       contribution_bps,quality,calculated_at)
     VALUES (?,?,?,?,?,'KES',20,50000,5000,500,16000,28500,5700,'HIGH',?)`,
  );
  const supplier = db.sqlite.prepare(
    `INSERT INTO daily_supplier_metrics
      (tenant_id,branch_id,business_date,supplier_id,currency,purchase_value_minor,
       order_count,average_lead_time_minutes,on_time_bps,fill_rate_bps,quality,calculated_at)
     VALUES (?,?,?,?,'KES',50000,2,2880,9500,9800,'HIGH',?)`,
  );
  for (const branchId of branches) {
    for (let index = 0; index < 3; index += 1) {
      channel.run(
        tenantId,
        branchId,
        lastBusinessDate,
        `channel-${index}`,
        `Channel ${index}`,
        stamp,
      );
    }
    for (let index = 0; index < 5; index += 1) {
      supplier.run(tenantId, branchId, lastBusinessDate, `supplier-load-${index}`, stamp);
    }
  }
}

function seedInventoryMovements(db: SqliteD1TestDatabase, branches: string[], stamp: string) {
  const statement = db.sqlite.prepare(
    `INSERT INTO inventory_movements
      (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,
       source_type,source_id,idempotency_key,correlation_id,payload_json,created_at,
       unit_cost_minor,total_cost_minor,business_date,occurred_at,negative_override)
     VALUES (?,?,?,?,?,'OPENING',1,'LOAD_FIXTURE',?,?,?,?,?,1,1,?,?,0)`,
  );
  for (let index = 0; index < 10_000; index += 1) {
    const branchIndex = index % branches.length;
    const id = `movement-load-${index}`;
    statement.run(
      tenantId,
      id,
      branches[branchIndex]!,
      `warehouse-load-${branchIndex}`,
      `item-load-${index % 10}`,
      id,
      id,
      id,
      "{}",
      stamp,
      lastBusinessDate,
      stamp,
    );
  }
}

function seedHealth(db: SqliteD1TestDatabase, branches: string[], stamp: string) {
  const statement = db.sqlite.prepare(
    `INSERT INTO branch_health_snapshots
      (tenant_id,branch_id,business_date,status,evidence_json,quality,calculated_at)
     VALUES (?,?,?,'HEALTHY','{"openActions":0}','HIGH',?)`,
  );
  for (const branchId of branches) {
    statement.run(tenantId, branchId, lastBusinessDate, stamp);
  }
}

function loadActor(): ServerActor {
  const branchIds = Array.from({ length: branchCount }, (_, index) => `branch-load-${index}`);
  return {
    id: "management-load-user",
    name: "Management load user",
    tenantId,
    roleIds: ["management"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: branchIds,
    assignedBranches: branchIds.map((id) => ({ id, name: id })),
    branchScope: { type: "BRANCH", branchId: branchIds[0]! },
    branchId: branchIds[0]!,
    branch: branchIds[0]!,
    role: "Configured role",
  };
}

function fixtureDate(day: number) {
  const start = Date.UTC(2025, 7, 31);
  return new Date(start + day * 86_400_000).toISOString().slice(0, 10);
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}
