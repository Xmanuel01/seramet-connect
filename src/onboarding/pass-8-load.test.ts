import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SerametEnv, ServerActor } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import type { DurableQueueMessage } from "@/server/environment";
import { handleWorkerQueue, type SerametWorkerMessage } from "@/server/workers";

const tenantId = "tenant-pass8-load";
const stamp = "2026-09-01T08:00:00.000Z";

describe.sequential("Pass 8 realistic onboarding load foundation", () => {
  let db: SqliteD1TestDatabase;
  let service: OnboardingService;
  let env: SerametEnv;

  beforeAll(() => {
    db = createMigratedTestDatabase();
    seedScaleFixture(db);
    env = { SERAMET_ENVIRONMENT: "test", SERAMET_DB: db };
    service = new OnboardingService(db, loadActor(), env);
  }, 120_000);

  afterAll(() => db.close());

  it("measures bounded setup, readiness, import and health operations at realistic fixture size", async () => {
    const metrics: Record<string, number> = {};
    const setup = await measure(metrics, "setupSummaryMs", () =>
      service.getSetupCentre("branch-0"),
    );
    const readiness = await measure(metrics, "readinessCheckMs", () =>
      service.recalculateReadiness("branch-0", true),
    );
    const branches = await measure(metrics, "branchListingMs", () =>
      service.listBrandsAndBranches(),
    );
    const health = await measure(metrics, "integrationHealthMs", () => service.integrationHealth());
    const menuCatalog = await measure(metrics, "menuCatalogMs", () =>
      service.listMenuCatalog("branch-0"),
    );

    const menuCsv = csv(
      "code,name,category,price,currency",
      600,
      (index) => `IMPORT-MENU-${index},Imported menu ${index},LOAD,100,KES`,
    );
    const menuPreview = await measure(metrics, "menuImportPreviewMs", () =>
      service.previewImport({
        branchId: "branch-0",
        kind: "MENU",
        originalName: "load-menu.csv",
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(menuCsv),
        duplicateStrategy: "CREATE",
        idempotencyKey: "pass8-load-menu-preview",
      }),
    );
    const commit = await measure(metrics, "menuImportQueueMs", () =>
      service.commitImport(menuPreview.id, menuPreview.commitKey),
    );
    expect(commit).toMatchObject({ status: "QUEUED", queued: true });
    expect(
      await db
        .prepare("SELECT status FROM setup_imports WHERE tenant_id=? AND id=?")
        .bind(tenantId, menuPreview.id)
        .first("status"),
    ).toBe("COMMITTING");
    await measure(metrics, "menuImportCommitWorkerMs", () =>
      processJob(db, env, String(commit.jobId)),
    );
    expect(
      await db
        .prepare("SELECT status FROM setup_imports WHERE tenant_id=? AND id=?")
        .bind(tenantId, menuPreview.id)
        .first("status"),
    ).toBe("COMMITTED");

    const inventoryCsv = csv(
      "code,name,baseUnit,purchaseUnit,dimension,factorNumerator,factorDenominator",
      1_000,
      (index) => `IMPORT-INV-${index},Imported inventory ${index},KG,KG,MASS,1,1`,
    );
    const inventoryPreview = await measure(metrics, "inventoryImportPreviewMs", () =>
      service.previewImport({
        branchId: "branch-0",
        kind: "INVENTORY",
        originalName: "load-inventory.csv",
        mimeType: "text/csv",
        bytes: new TextEncoder().encode(inventoryCsv),
        duplicateStrategy: "CREATE",
        idempotencyKey: "pass8-load-inventory-preview",
      }),
    );

    expect(setup.counts).toMatchObject({
      branches: 1,
      users: 1_001,
      menuItems: 5_000,
      inventoryItems: 10_000,
      suppliers: 1_000,
    });
    expect(readiness.stages).toHaveLength(18);
    expect(branches.branches).toHaveLength(50);
    expect(menuCatalog).toHaveLength(5_000);
    expect(health).toHaveLength(10);
    expect(menuPreview).toMatchObject({ rowCount: 600, errorCount: 0, canCommit: true });
    expect(commit).toMatchObject({ queued: true, rows: 600 });
    expect(inventoryPreview).toMatchObject({ rowCount: 1_000, errorCount: 0, canCommit: true });
    expect(await count(db, "menu_catalog_items")).toBe(5_600);

    for (const duration of Object.values(metrics)) expect(duration).toBeLessThan(30_000);
    console.info(`PASS8_LOAD_METRICS ${JSON.stringify(metrics)}`);
  }, 120_000);
});

async function measure<T>(
  metrics: Record<string, number>,
  name: string,
  operation: () => Promise<T>,
) {
  const started = performance.now();
  const result = await operation();
  metrics[name] = Math.round((performance.now() - started) * 100) / 100;
  return result;
}

function csv(header: string, rows: number, value: (index: number) => string) {
  return [header, ...Array.from({ length: rows }, (_, index) => value(index))].join("\n");
}

async function processJob(db: SqliteD1TestDatabase, env: SerametEnv, jobId: string) {
  const job = await db
    .prepare("SELECT correlation_id FROM worker_jobs WHERE tenant_id=? AND id=?")
    .bind(tenantId, jobId)
    .first<{ correlation_id: string }>();
  if (!job) throw new Error("Queued import job was not persisted");
  const message: DurableQueueMessage<SerametWorkerMessage> = {
    id: `load-message-${jobId}`,
    timestamp: new Date(stamp),
    attempts: 1,
    body: { kind: "worker-job", tenantId, jobId, correlationId: job.correlation_id },
    ack() {},
    retry() {},
  };
  await handleWorkerQueue({ queue: "seramet-load", messages: [message] }, env);
}

function seedScaleFixture(db: SqliteD1TestDatabase) {
  const sqlite = db.sqlite;
  sqlite.exec("BEGIN");
  try {
    sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,'pass8-load','Load Legal','Load Trading','KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(tenantId, stamp, stamp);
    sqlite
      .prepare(
        `INSERT INTO tenant_onboarding_profiles
          (tenant_id,country_code,accounting_mode,go_live_state,demo_mode,demo_reset_allowed,created_by,created_at,updated_by,updated_at)
         VALUES (?,'KE','PERPETUAL','SETUP',0,0,'load-user',?,'load-user',?)`,
      )
      .run(tenantId, stamp, stamp);
    sqlite
      .prepare(
        "INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,'brand-load','LOAD','Load Brand',1,'{}')",
      )
      .run(tenantId);

    const insertBranch = sqlite.prepare(
      `INSERT INTO branches
        (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES (?,?,'brand-load',?,?, 'Africa/Nairobi',240,1,'{}')`,
    );
    const insertProfile = sqlite.prepare(
      `INSERT INTO branch_operating_profiles
        (tenant_id,branch_id,negative_stock_policy,operating_hours_json,service_modes_json,
         required_device_roles_json,payments_required,inventory_enabled,recipes_required,
         printing_required,kds_required,created_by,created_at,updated_by,updated_at)
       VALUES (?,?,'ALLOW_WITH_ALERT','{}','[]','[]',0,1,0,0,0,'load-user',?,'load-user',?)`,
    );
    const insertWarehouse = sqlite.prepare(
      "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
    );
    for (let index = 0; index < 50; index += 1) {
      insertBranch.run(tenantId, `branch-${index}`, `B${index}`, `Branch ${index}`);
      insertProfile.run(tenantId, `branch-${index}`, stamp, stamp);
      insertWarehouse.run(
        tenantId,
        `warehouse-${index}`,
        `branch-${index}`,
        `W${index}`,
        `Warehouse ${index}`,
      );
    }

    for (const code of allPermissionCodes) {
      sqlite
        .prepare(
          "INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT(code) DO NOTHING",
        )
        .run(code, code);
    }
    sqlite
      .prepare(
        "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,'role-load','LOAD_ADMIN','Load admin',1,'{}')",
      )
      .run(tenantId);
    for (const code of allPermissionCodes) {
      sqlite
        .prepare(
          "INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,'role-load',?)",
        )
        .run(tenantId, code);
    }
    const insertUser = sqlite.prepare(
      `INSERT INTO users
        (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
       VALUES (?,?,NULL,?,1,1,'{}',?,?)`,
    );
    for (let index = 0; index <= 1_000; index += 1) {
      insertUser.run(tenantId, `load-user-${index}`, `Load user ${index}`, stamp, stamp);
    }
    sqlite
      .prepare(
        "INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,'load-user-0','role-load')",
      )
      .run(tenantId);
    sqlite
      .prepare(
        "INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,'load-user-0','branch-0')",
      )
      .run(tenantId);

    sqlite
      .prepare(
        `INSERT INTO unit_definitions
          (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at)
         VALUES (?,'unit-load','KG','Kilogram','kg','MASS',1,1,1,?,?)`,
      )
      .run(tenantId, stamp, stamp);
    const insertInventory = sqlite.prepare(
      `INSERT INTO inventory_items
        (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,purchase_unit_id,
         storage_unit_id,issue_unit_id,track_inventory,track_expiry,updated_at)
       VALUES (?,?,?,?, 'kg',1,'{}',?,'unit-load','unit-load','unit-load','unit-load',1,0,?)`,
    );
    for (let index = 0; index < 10_000; index += 1) {
      insertInventory.run(
        tenantId,
        `inventory-${index}`,
        `INV-${index}`,
        `Inventory ${index}`,
        `INV-${index}`,
        stamp,
      );
    }
    const insertMenu = sqlite.prepare(
      `INSERT INTO menu_catalog_items
        (tenant_id,id,code,name,category_code,selling_price_minor,currency,sellable,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?, 'LOAD',10000,'KES',1,1,'{}',?,?)`,
    );
    const activateMenu = sqlite.prepare(
      `INSERT INTO menu_item_branch_settings
        (tenant_id,branch_id,menu_item_id,selling_price_minor,available,
         channel_availability_json,updated_at)
       VALUES (?,'branch-0',?,NULL,1,'{}',?)`,
    );
    for (let index = 0; index < 5_000; index += 1) {
      insertMenu.run(tenantId, `menu-${index}`, `MENU-${index}`, `Menu ${index}`, stamp, stamp);
      activateMenu.run(tenantId, `menu-${index}`, stamp);
    }
    const insertSupplier = sqlite.prepare(
      `INSERT INTO suppliers
        (tenant_id,id,code,name,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,1,'{}',?,?)`,
    );
    for (let index = 0; index < 1_000; index += 1) {
      insertSupplier.run(
        tenantId,
        `supplier-${index}`,
        `SUP-${index}`,
        `Supplier ${index}`,
        stamp,
        stamp,
      );
    }
    const insertRecipe = sqlite.prepare(
      `INSERT INTO recipes
        (tenant_id,id,menu_item_id,yield_minor,active,payload_json,production_item_id,name,updated_at)
       VALUES (?,?,?,1000000,1,'{}',NULL,?,?)`,
    );
    const insertComponent = sqlite.prepare(
      `INSERT INTO recipe_components
        (tenant_id,id,recipe_id,inventory_item_id,quantity_minor,payload_json)
       VALUES (?,?,?,?,1000,'{}')`,
    );
    for (let recipe = 0; recipe < 100; recipe += 1) {
      insertRecipe.run(tenantId, `recipe-${recipe}`, `menu-${recipe}`, `Recipe ${recipe}`, stamp);
      for (let component = 0; component < 100; component += 1) {
        const index = recipe * 100 + component;
        insertComponent.run(
          tenantId,
          `component-${index}`,
          `recipe-${recipe}`,
          `inventory-${index}`,
        );
      }
    }
    for (let index = 0; index < 10; index += 1) {
      sqlite
        .prepare(
          `INSERT INTO provider_connections
            (tenant_id,id,branch_id,provider_id,environment,status,secret_reference,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,'SANDBOX','CONFIGURED','managed://load','{}',?,?)`,
        )
        .run(
          tenantId,
          `connection-${index}`,
          `branch-${index}`,
          index % 2 ? "provider-daraja" : "provider-delivery-glovo",
          stamp,
          stamp,
        );
      sqlite
        .prepare(
          `INSERT INTO hardware_devices
            (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json)
           VALUES (?,?,?,'PRINTER',?,'ACTIVE','load-user',?,'{}')`,
        )
        .run(tenantId, `device-${index}`, `branch-${index}`, `Printer ${index}`, stamp);
    }
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}

function loadActor(): ServerActor {
  const branches = Array.from({ length: 50 }, (_, index) => `branch-${index}`);
  return {
    id: "load-user-0",
    name: "Load administrator",
    tenantId,
    roleIds: ["role-load"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: branches,
    assignedBranches: branches.map((id) => ({ id, name: id })),
    branchScope: { type: "ALL" },
    branchId: "branch-0",
    branch: "Branch 0",
    role: "Configured role",
  };
}

async function count(db: SqliteD1TestDatabase, table: string) {
  return Number(
    await db
      .prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?`)
      .bind(tenantId)
      .first("count"),
  );
}
