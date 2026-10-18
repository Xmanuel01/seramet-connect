import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CookbookService } from "../src/cookbook/cookbook-service";
import { InventoryIntelligenceService } from "../src/inventory/inventory-intelligence-service";
import { QUANTITY_SCALE } from "../src/inventory/quantity";
import type { ServerActor } from "../src/lib/seramet-auth";
import { permissions } from "../src/platform/permissions";
import { createLocalDevelopmentDatabase } from "../src/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "../src/server/database/sqlite-test-adapter";

type PilotFixture = {
  tenantId: string;
  userId: string;
  firstBranchId: string;
  menuItemId: string;
};

// Run once after seed-pilot-e2e.ts, with the same CI=true / SERAMET_E2E=true environment:
// node node_modules/vite-node/dist/cli.mjs --script scripts/seed-category-acceptance.ts
// Only disposable local data is supported. Recreate the pilot tenant after a failed/previous run.
export async function seedCategoryAcceptance(db: SqliteD1TestDatabase, fixture: PilotFixture) {
  assertDisposable(fixture);
  const foundation = await db
    .prepare(
      `SELECT b.name,u.name AS user_name FROM branches b
     JOIN users u ON u.tenant_id=b.tenant_id AND u.id=? AND u.active=1
     JOIN user_branches ub ON ub.tenant_id=b.tenant_id AND ub.user_id=u.id AND ub.branch_id=b.id
     JOIN tenants t ON t.id=b.tenant_id AND t.active=1
     WHERE b.tenant_id=? AND b.id=? AND b.active=1`,
    )
    .bind(fixture.userId, fixture.tenantId, fixture.firstBranchId)
    .first<{ name: string; user_name: string }>();
  const menuItem = await db
    .prepare(
      `SELECT m.id FROM menu_catalog_items m
     JOIN menu_item_branch_settings bs ON bs.tenant_id=m.tenant_id AND bs.menu_item_id=m.id
     WHERE m.tenant_id=? AND m.id=? AND m.active=1 AND m.sellable=1
       AND bs.branch_id=? AND bs.available=1`,
    )
    .bind(fixture.tenantId, fixture.menuItemId, fixture.firstBranchId)
    .first();
  if (!foundation || !menuItem)
    throw new Error("Seed the pilot foundation, manager and branch menu first.");
  const granted = await db
    .prepare(
      `SELECT DISTINCT rp.permission_code FROM user_roles ur
     JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1
     JOIN role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
     WHERE ur.tenant_id=? AND ur.user_id=?`,
    )
    .bind(fixture.tenantId, fixture.userId)
    .all<{ permission_code: ServerActor["permissions"][number] }>();
  const actor: ServerActor = {
    id: fixture.userId,
    name: foundation.user_name,
    tenantId: fixture.tenantId,
    roleIds: [],
    permissions: (granted.results ?? []).map((row) => row.permission_code),
    assignedBranchIds: [fixture.firstBranchId],
    assignedBranches: [{ id: fixture.firstBranchId, name: foundation.name }],
    branchScope: { type: "BRANCH", branchId: fixture.firstBranchId },
    branchId: fixture.firstBranchId,
    branch: foundation.name,
    role: "Manager",
  };
  for (const permission of [
    permissions.inventoryAdjust,
    permissions.inventoryCostControlManage,
    permissions.cookbookView,
    permissions.cookbookManage,
    permissions.cookbookPublish,
  ]) {
    if (!actor.permissions.includes(permission))
      throw new Error(`Pilot manager requires ${permission}`);
  }
  const existing = await db
    .prepare(
      `SELECT id FROM unit_definitions WHERE tenant_id=? AND code='CA-KG'
     UNION ALL SELECT id FROM public_branch_profiles WHERE tenant_id=? AND branch_id=?`,
    )
    .bind(fixture.tenantId, fixture.tenantId, fixture.firstBranchId)
    .first();
  if (existing)
    throw new Error("Category fixtures already exist; recreate the disposable pilot tenant.");

  const inventory = new InventoryIntelligenceService(db, actor);
  const cookbook = new CookbookService(db, actor);
  const stamp = new Date().toISOString();
  const units = { kg: randomUUID(), ml: randomUUID(), portion: randomUUID(), slice: randomUUID() };
  for (const [id, code, name, symbol, dimension] of [
    [units.kg, "CA-KG", "Acceptance kilogram", "kg", "MASS"],
    [units.ml, "CA-ML", "Acceptance millilitre", "ml", "VOLUME"],
    [units.portion, "CA-PORTION", "Acceptance portion", "portion", "COUNT"],
    [units.slice, "CA-SLICE", "Acceptance slice", "slice", "COUNT"],
  ] as const) {
    await inventory.createUnit({ id, code, name, symbol, dimension });
  }
  const items = { rice: randomUUID(), oil: randomUUID(), bread: randomUUID() };
  for (const [id, code, name, baseUnitId] of [
    [items.rice, "CA-RICE", "Rice", units.kg],
    [items.oil, "CA-OIL", "Oil", units.ml],
    [items.bread, "CA-BREAD", "Bread", units.slice],
  ]) {
    await inventory.createInventoryItem({ id, code, name, baseUnitId, trackInventory: false });
  }
  const recipes = [];
  for (const definition of [
    {
      name: "Acceptance Rice",
      yieldPortions: 25,
      ingredients: [
        { inventoryItemId: items.rice, quantityMicro: 2 * QUANTITY_SCALE, unitId: units.kg },
        { inventoryItemId: items.oil, quantityMicro: 300 * QUANTITY_SCALE, unitId: units.ml },
      ],
    },
    {
      name: "Acceptance Breakfast",
      yieldPortions: 1,
      ingredients: [
        { inventoryItemId: items.bread, quantityMicro: 2 * QUANTITY_SCALE, unitId: units.slice },
      ],
    },
  ]) {
    const output = await inventory.createInventoryItem({
      code: definition.yieldPortions === 25 ? "CA-RICE-OUTPUT" : "CA-BREAKFAST-OUTPUT",
      name: `${definition.name} output`,
      baseUnitId: units.portion,
      trackInventory: false,
    });
    const recipe = await inventory.createRecipe({
      name: definition.name,
      productionItemId: output.id,
    });
    const version = await inventory.createRecipeVersion({
      recipeId: recipe.id,
      version: 1,
      yieldQuantityMicro: definition.yieldPortions * QUANTITY_SCALE,
      yieldUnitId: units.portion,
      effectiveFrom: stamp,
      components: definition.ingredients,
    });
    const draft = await cookbook.saveDraft({
      recipeId: recipe.id,
      recipeVersionId: version.id,
      prepMinutes: 0,
      cookMinutes: 0,
      portionLabel: `${definition.yieldPortions} portion${definition.yieldPortions === 1 ? "" : "s"}`,
      method: [
        {
          step: 1,
          instruction: "Disposable acceptance method; not a production kitchen standard.",
        },
      ],
      sourceDocument: "Synthetic disposable browser acceptance fixture",
      chefNotes:
        "Acceptance quantities only. No source cookbook data or unit conversions inferred.",
      changeSummary: "Seed disposable cookbook acceptance",
    });
    const published = await cookbook.publish({ contentVersionId: draft.id });
    recipes.push({
      id: recipe.id,
      name: definition.name,
      versionId: version.id,
      publishedContentId: published.id,
      yieldPortions: definition.yieldPortions,
    });
  }

  const channelId = randomUUID();
  await db
    .prepare(
      "INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json) VALUES (?,?,?,'QR',1,?)",
    )
    .bind(
      fixture.tenantId,
      channelId,
      "CA-QR",
      JSON.stringify({
        id: channelId,
        tenantId: fixture.tenantId,
        code: "CA-QR",
        displayName: "Disposable table QR",
        channelType: "QR",
        enabled: true,
        requiresCustomer: false,
        requiresTable: true,
        requiresAddress: false,
        isExternallyPaid: false,
        sortOrder: 10,
        metadata: {},
      }),
    )
    .run();
  const profileId = randomUUID();
  const operatingHours = Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [
      day,
      ["00:00", "23:59"],
    ]),
  );
  // Same structure as pass11-demo.sql. Publication is publicly_enabled, not a "published" column.
  await db
    .prepare(
      `INSERT INTO public_branch_profiles
     (tenant_id,id,brand_id,branch_id,restaurant_slug,branch_slug,public_name,description,
      logo_url,cover_url,address,public_phone,public_email,currency,public_status,service_modes_json,
      operating_hours_json,social_links_json,branding_json,legal_links_json,minimum_order_minor,
      ordering_enabled,reservations_enabled,publicly_enabled,updated_by,created_at,updated_at)
     VALUES (?,?,NULL,?,?,'branch-a','Disposable acceptance restaurant','Disposable guest menu',
       NULL,NULL,'Disposable branch address',NULL,NULL,'KES','OPEN',?,?,
       '{}','{}','{}',0,1,0,1,?,?,?)`,
    )
    .bind(
      fixture.tenantId,
      profileId,
      fixture.firstBranchId,
      fixture.tenantId,
      JSON.stringify(["QR_TABLE"]),
      JSON.stringify(operatingHours),
      fixture.userId,
      stamp,
      stamp,
    )
    .run();

  return {
    tenantId: fixture.tenantId,
    branchId: fixture.firstBranchId,
    recipes,
    items,
    units,
    publicProfile: {
      id: profileId,
      restaurantSlug: fixture.tenantId,
      branchSlug: "branch-a",
      menuItemId: fixture.menuItemId,
    },
    expected: {
      riceYield50: { riceKg: 4, oilMl: 600 },
      riceIngredient3Kg: { yieldPortions: 37.5, oilMl: 450 },
      breakfastYield2: { breadSlices: 4 },
    },
  };
}

function assertDisposable(fixture: PilotFixture) {
  if (process.env.SERAMET_E2E !== "true" || process.env.CI !== "true") {
    throw new Error("Disposable local acceptance requires SERAMET_E2E=true and CI=true.");
  }
  if (
    !/^e2e-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(fixture.tenantId) ||
    !fixture.userId ||
    !fixture.firstBranchId ||
    !fixture.menuItemId
  ) {
    throw new Error("An existing disposable pilot fixture is required.");
  }
}

async function main() {
  const fixture = JSON.parse(
    readFileSync(resolve(".seramet/e2e-fixture.json"), "utf8"),
  ) as PilotFixture;
  assertDisposable(fixture);
  if (!existsSync(resolve(".seramet/development.sqlite")))
    throw new Error("Seed the pilot database first.");
  const db = createLocalDevelopmentDatabase();
  try {
    console.log(JSON.stringify(await seedCategoryAcceptance(db, fixture), null, 2));
  } finally {
    db.close();
  }
}

await main();
