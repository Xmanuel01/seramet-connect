import { afterEach, describe, expect, it } from "vitest";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

describe("Pass 6 restaurant-scale read models", () => {
  let database: SqliteD1TestDatabase | undefined;
  afterEach(() => database?.close());

  it("measures 10k movements, 1k items, 500 recipes, 100 suppliers and 1k POs", async () => {
    database = createMigratedTestDatabase();
    const seedStarted = performance.now();
    seedScaleFixture(database);
    const seedMs = performance.now() - seedStarted;
    const service = new InventoryIntelligenceService(database, loadActor());

    const summaryStarted = performance.now();
    const branchOne = await service.summary("branch-load-a");
    const branchTwo = await service.summary("branch-load-b");
    const summaryMs = performance.now() - summaryStarted;

    const pageStarted = performance.now();
    const page = await service.listInventory({ branchId: "branch-load-a", limit: 100 });
    const pageMs = performance.now() - pageStarted;

    const procurementStarted = performance.now();
    const procurement = await service.procurementOverview("branch-load-a", 100);
    const procurementMs = performance.now() - procurementStarted;

    expect(branchOne.itemCount + branchTwo.itemCount).toBe(1_000);
    expect(page.items).toHaveLength(100);
    expect(page.nextCursor).not.toBeNull();
    expect(procurement.purchaseOrders).toHaveLength(100);
    expect(procurement.suppliers).toHaveLength(100);
    expect(seedMs).toBeLessThan(30_000);
    expect(summaryMs).toBeLessThan(2_000);
    expect(pageMs).toBeLessThan(2_000);
    expect(procurementMs).toBeLessThan(3_000);
    console.info(
      `PASS6_LOAD seed=${seedMs.toFixed(1)}ms summary=${summaryMs.toFixed(1)}ms inventoryPage=${pageMs.toFixed(1)}ms procurement=${procurementMs.toFixed(1)}ms`,
    );
  }, 40_000);
});

function seedScaleFixture(database: SqliteD1TestDatabase) {
  const db = database.sqlite;
  const stamp = "2026-08-31T00:00:00.000Z";
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES ('tenant-load','tenant-load','Load Tenant','Load Tenant','KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
    ).run(stamp, stamp);
    const branchInsert = db.prepare(
      `INSERT INTO branches
        (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES ('tenant-load',?,?,?,'Africa/Nairobi',240,1,'{}')`,
    );
    const warehouseInsert = db.prepare(
      `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
       VALUES ('tenant-load',?,?,?,?,1,'{}')`,
    );
    for (const suffix of ["a", "b"]) {
      branchInsert.run(
        `branch-load-${suffix}`,
        `B-${suffix.toUpperCase()}`,
        `Branch ${suffix.toUpperCase()}`,
      );
      warehouseInsert.run(
        `warehouse-load-${suffix}`,
        `branch-load-${suffix}`,
        `W-${suffix.toUpperCase()}`,
        `Warehouse ${suffix.toUpperCase()}`,
      );
    }
    db.prepare(
      `INSERT INTO unit_definitions
        (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at)
       VALUES ('tenant-load','unit-load','UNIT','Unit','u','COUNT',1,1,1,?,?)`,
    ).run(stamp, stamp);
    const supplierInsert = db.prepare(
      `INSERT INTO suppliers
        (tenant_id,id,code,name,payment_terms_days,currency,lead_time_days,minimum_order_minor,active,payload_json,created_at,updated_at)
       VALUES ('tenant-load',?,?,?,?, 'KES',2,0,1,'{}',?,?)`,
    );
    for (let index = 0; index < 100; index++) {
      supplierInsert.run(
        `supplier-${index}`,
        `SUP-${index}`,
        `Supplier ${index}`,
        30,
        stamp,
        stamp,
      );
    }
    const itemInsert = db.prepare(
      `INSERT INTO inventory_items
        (tenant_id,id,sku,name,unit,active,payload_json,code,category_id,base_unit_id,
         purchase_unit_id,storage_unit_id,issue_unit_id,track_inventory,track_expiry,
         default_warehouse_id,updated_at)
       VALUES ('tenant-load',?,?,?,?,1,'{}',?,'scale','unit-load','unit-load','unit-load','unit-load',1,0,?,?)`,
    );
    for (let index = 0; index < 1_000; index++) {
      const suffix = index % 2 === 0 ? "a" : "b";
      itemInsert.run(
        `item-${index}`,
        `SKU-${index}`,
        `Inventory Item ${index}`,
        "u",
        `ITEM-${index}`,
        `warehouse-load-${suffix}`,
        stamp,
      );
    }
    const movementInsert = db.prepare(
      `INSERT INTO inventory_movements
        (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,
         source_type,source_id,idempotency_key,correlation_id,payload_json,created_at,
         unit_cost_minor,total_cost_minor,business_date,occurred_at,actor_id,negative_override)
       VALUES ('tenant-load',?,?,?,?,?,?,?,?,?,?, '{}',?,?,?,?,?,?,0)`,
    );
    for (let index = 0; index < 10_000; index++) {
      const itemIndex = index % 1_000;
      const suffix = itemIndex % 2 === 0 ? "a" : "b";
      movementInsert.run(
        `movement-${index}`,
        `branch-load-${suffix}`,
        `warehouse-load-${suffix}`,
        `item-${itemIndex}`,
        "OPENING",
        100_000,
        "LOAD_FIXTURE",
        `source-${index}`,
        `movement-${index}`,
        `correlation-${index}`,
        stamp,
        1_000,
        100,
        "2026-08-31",
        stamp,
        "load-user",
      );
    }
    const recipeInsert = db.prepare(
      `INSERT INTO recipes
        (tenant_id,id,menu_item_id,yield_minor,active,payload_json,name,updated_at)
       VALUES ('tenant-load',?,?,1000000,1,'{}',?,?)`,
    );
    for (let index = 0; index < 500; index++) {
      recipeInsert.run(`recipe-${index}`, `menu-${index}`, `Recipe ${index}`, stamp);
    }
    const poInsert = db.prepare(
      `INSERT INTO purchase_orders
        (tenant_id,id,branch_id,purchase_order_number,status,currency,total_minor,version,payload_json,
         created_at,updated_at,supplier_id,warehouse_id,expected_at)
       VALUES ('tenant-load',?,? ,?,'APPROVED','KES',10000,1,'{}',?,?,?,?,?)`,
    );
    const lineInsert = db.prepare(
      `INSERT INTO purchase_order_lines
        (tenant_id,id,purchase_order_id,item_id,ordered_quantity_minor,received_quantity_minor,
         unit_cost_minor,payload_json,purchase_unit_id,ordered_purchase_quantity_minor,
         received_purchase_quantity_minor,tax_minor,discount_minor)
       VALUES ('tenant-load',?,?,?,1000000,0,10000,'{}','unit-load',1000000,0,0,0)`,
    );
    for (let index = 0; index < 1_000; index++) {
      const suffix = index % 2 === 0 ? "a" : "b";
      poInsert.run(
        `po-${index}`,
        `branch-load-${suffix}`,
        `PO-${index}`,
        stamp,
        stamp,
        `supplier-${index % 100}`,
        `warehouse-load-${suffix}`,
        "2026-09-01T00:00:00.000Z",
      );
      lineInsert.run(`po-line-${index}`, `po-${index}`, `item-${index}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function loadActor(): ServerActor {
  return {
    id: "load-user",
    name: "Load user",
    tenantId: "tenant-load",
    roleIds: ["manager"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: ["branch-load-a", "branch-load-b"],
    assignedBranches: [
      { id: "branch-load-a", name: "Branch A" },
      { id: "branch-load-b", name: "Branch B" },
    ],
    branchScope: { type: "ALL" },
    branchId: "branch-load-a",
    branch: "Branch A",
    role: "Manager",
  };
}
