// CI-only probe for the exact authoritative menu catalogue SQL used by the UI.
// Runs against disposable PostgreSQL 16 and NEVER a deployed restaurant database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { OnboardingService } from "@/onboarding/onboarding-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { PostgresD1Database } from "@/server/database/postgres-database";

const connectionString = process.env.SERAMET_POSTGRES_URL;
const target = connectionString ? new URL(connectionString) : null;
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  target.username !== "seramet_test" ||
  target.pathname !== "/seramet_test"
) {
  throw new Error("Menu smoke testing is restricted to ephemeral CI PostgreSQL");
}

const db = PostgresD1Database.fromHyperdrive({ connectionString: connectionString! });
try {
  const tenantId = "menu-ci-" + randomUUID();
  const branchId = "branch-ci-" + randomUUID();
  const secondBranchId = "other-ci-" + randomUUID();
  const itemId = randomUUID();
  const stationId = randomUUID();
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,
         locale,active,payload_json,created_at,updated_at)
       VALUES (?,?,'Menu CI Restaurant','Menu CI Restaurant','KES','Africa/Nairobi',
         'en-KE',1,'{}',?,?)`,
    )
    .bind(tenantId, tenantId, stamp, stamp)
    .run();
  for (const [id, code] of [
    [branchId, "CI-MAIN"],
    [secondBranchId, "CI-OTHER"],
  ]) {
    await db
      .prepare(
        `INSERT INTO branches
          (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
         VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')`,
      )
      .bind(tenantId, id, code, code)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
       VALUES (?,?,?,'MAIN','Kitchen','KITCHEN',1,'{}')`,
    )
    .bind(tenantId, stationId, branchId)
    .run();
  await db
    .prepare(
      `INSERT INTO menu_catalog_items
        (tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,
         station_id,recipe_reference,sellable,active,payload_json,created_at,updated_at)
       VALUES (?,?,'PILAU-CI','PILAU-CI','Test Pilau','MAIN',NULL,45000,'KES',
          ?,NULL,1,1,'{}',?,?)`,
    )
    .bind(tenantId, itemId, stationId, stamp, stamp)
    .run();
  await db
    .prepare(
      `INSERT INTO menu_item_branch_settings
        (tenant_id,branch_id,menu_item_id,station_id,available,channel_availability_json,updated_at)
       VALUES (?,?,?,?,1,'{}',?)`,
    )
    .bind(tenantId, branchId, itemId, stationId, stamp)
    .run();
  const actor: ServerActor = {
    id: "menu-ci-actor",
    name: "CI Branch Manager",
    tenantId,
    roleIds: ["manager"],
    permissions: [permissions.setupView],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "CI Main" }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: "CI Main",
    role: "Manager",
  };
  const service = new OnboardingService(db, actor);
  const actual = await service.listMenuCatalog(branchId);
  assert.equal(actual.length, 1, "Branch must list exactly one activated item");
  assert.equal(actual[0]!.code, "PILAU-CI");
  assert.equal(actual[0]!.selling_price_minor, 45_000);
  assert.equal(actual[0]!.station_id, stationId);
  assert.equal(actual[0]!.branch_activated, 1);
  const omitted = await service.listMenuCatalog();
  assert.deepEqual(omitted, actual, "Omitting branchId must not leak tenant-wide catalogue");
  await assert.rejects(service.listMenuCatalog(secondBranchId), /branch/i);
  console.log("Authoritative branch catalogue, menu pricing and scope on PostgreSQL: PASS");
} finally {
  await db.close();
}
