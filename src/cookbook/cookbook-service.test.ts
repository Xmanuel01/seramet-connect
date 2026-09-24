import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookbookService } from "@/cookbook/cookbook-service";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import { QUANTITY_SCALE } from "@/inventory/quantity";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-cookbook";
const branchId = "branch-cookbook";
const actorId = "user-cookbook";

describe("Cookbook shared recipe layer", () => {
  let db: SqliteD1TestDatabase;
  let inventory: InventoryIntelligenceService;
  let cookbook: CookbookService;
  let recipeId: string;
  let recipeVersionId: string;

  beforeEach(async () => {
    db = createMigratedTestDatabase();
    seedFoundation(db);
    inventory = new InventoryIntelligenceService(db, actor());
    cookbook = new CookbookService(db, actor());

    await inventory.createUnit({
      id: "unit-kg",
      code: "KG",
      name: "Kilogram",
      symbol: "kg",
      dimension: "MASS",
    });
    await inventory.createInventoryItem({
      id: "item-rice",
      code: "RICE",
      name: "Rice",
      baseUnitId: "unit-kg",
      purchaseUnitId: "unit-kg",
    });
    await inventory.createInventoryItem({
      id: "item-pilau",
      code: "BEEF-PILAU",
      name: "Beef Pilau",
      baseUnitId: "unit-kg",
      purchaseUnitId: "unit-kg",
    });

    const recipe = await inventory.saveRecipeDefinition({
      productionItemId: "item-pilau",
      name: "Beef Pilau",
      yieldQuantityMicro: 4 * QUANTITY_SCALE,
      yieldUnitId: "unit-kg",
      components: [
        {
          inventoryItemId: "item-rice",
          quantityMicro: 4 * QUANTITY_SCALE,
          unitId: "unit-kg",
        },
      ],
    });
    recipeId = recipe.recipeId;
    recipeVersionId = recipe.recipeVersionId;
  });

  afterEach(() => db.close());

  it("stores append-only draft and published cookbook revisions idempotently", async () => {
    const draft = await cookbook.saveDraft({
      branchId,
      recipeId,
      recipeVersionId,
      idempotencyKey: "cookbook-draft-0001",
      prepMinutes: 20,
      cookMinutes: 45,
      portionLabel: "4 kg batch",
      chefNotes: "Keep the rice grains separate.",
      method: [
        {
          id: "step-1",
          title: "Prepare",
          instruction: "Wash the rice and prepare the pilau base.",
          timerMinutes: 10,
        },
        {
          id: "step-2",
          title: "Cook",
          instruction: "Cook until the rice is tender and the stock is absorbed.",
          timerMinutes: 35,
        },
      ],
      media: [],
      changeSummary: "Initial kitchen standard",
    });

    expect(draft).toMatchObject({
      duplicate: false,
      revision: 1,
      status: "DRAFT",
      recipeId,
      recipeVersionId,
    });

    const replay = await cookbook.saveDraft({
      branchId,
      recipeId,
      recipeVersionId,
      idempotencyKey: "cookbook-draft-0001",
      prepMinutes: 999,
      cookMinutes: 999,
      method: [{ instruction: "This replay must not create another revision." }],
      media: [],
    });
    expect(replay).toMatchObject({ duplicate: true, id: draft.id, revision: 1 });

    const published = await cookbook.publish({
      branchId,
      contentVersionId: draft.id,
      idempotencyKey: "cookbook-publish-0001",
      changeSummary: "Approved by kitchen management",
    });
    expect(published).toMatchObject({
      duplicate: false,
      revision: 2,
      status: "PUBLISHED",
      recipeId,
      recipeVersionId,
    });

    const publishReplay = await cookbook.publish({
      branchId,
      contentVersionId: draft.id,
      idempotencyKey: "cookbook-publish-0001",
    });
    expect(publishReplay).toMatchObject({
      duplicate: true,
      id: published.id,
      revision: 2,
    });

    const overview = await cookbook.overview(branchId);
    expect(overview.recipes).toHaveLength(1);
    expect(overview.recipes[0]).toMatchObject({
      publication_status: "PUBLISHED",
      target_name: "Beef Pilau",
      target_code: "BEEF-PILAU",
    });

    const detail = await cookbook.detail(branchId, recipeId);
    expect(detail.published).toMatchObject({
      id: published.id,
      revision: 2,
      prepMinutes: 20,
      cookMinutes: 45,
    });
    expect(detail.components[0]).toMatchObject({
      inventory_item_name: "Rice",
      quantity_minor: 4 * QUANTITY_SCALE,
      unit_symbol: "kg",
    });

    const contentRows = await db
      .prepare(
        "SELECT revision,status FROM cookbook_recipe_content_versions WHERE tenant_id=? AND recipe_id=? ORDER BY revision",
      )
      .bind(tenantId, recipeId)
      .all<{ revision: number; status: string }>();
    expect(contentRows.results).toEqual([
      { revision: 1, status: "DRAFT" },
      { revision: 2, status: "PUBLISHED" },
    ]);
  });

  it("requires cookbook review when the authoritative costing recipe changes version", async () => {
    const draft = await cookbook.saveDraft({
      branchId,
      recipeId,
      recipeVersionId,
      idempotencyKey: "cookbook-version-draft-0001",
      prepMinutes: 15,
      cookMinutes: 40,
      method: [{ instruction: "Cook the original four-kilogram standard." }],
      media: [],
    });
    await cookbook.publish({
      branchId,
      contentVersionId: draft.id,
      idempotencyKey: "cookbook-version-publish-0001",
    });

    const updated = await inventory.saveRecipeDefinition({
      recipeId,
      productionItemId: "item-pilau",
      name: "Beef Pilau",
      yieldQuantityMicro: 5 * QUANTITY_SCALE,
      yieldUnitId: "unit-kg",
      components: [
        {
          inventoryItemId: "item-rice",
          quantityMicro: 5 * QUANTITY_SCALE,
          unitId: "unit-kg",
        },
      ],
    });
    expect(updated.version).toBe(2);

    const overview = await cookbook.overview(branchId);
    expect(overview.recipes[0]).toMatchObject({
      version: 2,
      publication_status: "MISSING",
      published: null,
    });

    const detail = await cookbook.detail(branchId, recipeId);
    expect(detail.published).toBeNull();
    expect(detail.draft).toBeNull();
    expect(detail.previousPublished).toMatchObject({
      recipeVersionId,
      status: "PUBLISHED",
    });
    expect(detail.recipe.current_version_id).toBe(updated.recipeVersionId);
  });

  it("separates view, edit and publish permissions", async () => {
    const viewer = new CookbookService(db, actor([permissions.cookbookView]));
    const overview = await viewer.overview(branchId);
    expect(overview.recipes).toHaveLength(1);

    await expect(
      viewer.saveDraft({
        branchId,
        recipeId,
        recipeVersionId,
        idempotencyKey: "cookbook-viewer-draft-0001",
        prepMinutes: 1,
        cookMinutes: 1,
        method: [{ instruction: "Viewer cannot save this." }],
        media: [],
      }),
    ).rejects.toThrow(/cookbook\.manage/i);

    const manager = new CookbookService(
      db,
      actor([permissions.cookbookView, permissions.cookbookManage]),
    );
    const draft = await manager.saveDraft({
      branchId,
      recipeId,
      recipeVersionId,
      idempotencyKey: "cookbook-manager-draft-0001",
      prepMinutes: 1,
      cookMinutes: 1,
      method: [{ instruction: "Manager can draft this." }],
      media: [],
    });
    await expect(
      manager.publish({
        branchId,
        contentVersionId: draft.id,
        idempotencyKey: "cookbook-manager-publish-0001",
      }),
    ).rejects.toThrow(/cookbook\.publish/i);
  });
});

function seedFoundation(db: SqliteD1TestDatabase) {
  const stamp = new Date().toISOString();
  db.sqlite
    .prepare(
      `INSERT INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
    )
    .run(tenantId, "cookbook-test", "Cookbook Test", "Cookbook Test", stamp, stamp);
  db.sqlite
    .prepare(
      `INSERT INTO branches
        (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')`,
    )
    .run(tenantId, branchId, "COOKBOOK", "Cookbook Branch");
  db.sqlite
    .prepare(
      `INSERT INTO users
        (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,1,1,'{}',?,?)`,
    )
    .run(tenantId, actorId, "cookbook@example.test", "Cookbook Manager", stamp, stamp);
}

function actor(permissionCodes = allPermissionCodes): ServerActor {
  return {
    id: actorId,
    name: "Cookbook Manager",
    tenantId,
    roleIds: ["manager"],
    permissions: [...permissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Cookbook Branch", isPrimary: true }],
    primaryBranchId: branchId,
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: "Cookbook Branch",
    role: "Manager",
  };
}
