import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CookbookService } from "@/cookbook/cookbook-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "cookbook-tenant";
const branchId = "cookbook-branch";
const userId = "cookbook-user";
const recipeId = "cookbook-recipe";
const firstVersionId = "cookbook-recipe-v1";
const secondVersionId = "cookbook-recipe-v2";

describe("authoritative cookbook", () => {
  let db: SqliteD1TestDatabase;
  let service: CookbookService;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seed(db);
    service = new CookbookService(db, actor());
  });

  afterEach(() => db.close());
  it("does not expose unpublished methods or draft history to cookbook readers", async () => {
    const input = {
      recipeId,
      recipeVersionId: firstVersionId,
      prepMinutes: 15,
      cookMinutes: 20,
      method: [{ step: 1, instruction: "Approved cooking method" }],
      changeSummary: "Disposable initial method",
    };
    const draft = await service.saveDraft(input);
    const reader = new CookbookService(db, { ...actor(), permissions: ["cookbook.view"] });
    let library = await reader.library(branchId);
    expect(library.recipes).toEqual([]);
    expect(await reader.history(firstVersionId)).toEqual([]);
    await service.publish({ contentVersionId: draft.id });
    await service.saveDraft({ ...input, chefNotes: "Private unapproved test method" });
    library = await reader.library(branchId);
    expect(JSON.stringify(library)).not.toContain("Private unapproved test method");
    expect((await reader.history(firstVersionId)).every((row) => row.status === "PUBLISHED")).toBe(
      true,
    );
  });

  it("creates immutable drafts and publishes a copied revision", async () => {
    const draft = await service.saveDraft({
      recipeId,
      recipeVersionId: firstVersionId,
      prepMinutes: 15,
      cookMinutes: 35,
      portionLabel: "4 portions",
      chefNotes: "Taste before service.",
      method: [
        { step: 1, instruction: "Prepare ingredients." },
        { step: 2, instruction: "Cook until tender.", durationMinutes: 35 },
      ],
      changeSummary: "Initial kitchen standard",
    });
    expect(draft.revision).toBe(1);

    const published = await service.publish({
      contentVersionId: draft.id,
      changeSummary: "Approved by kitchen lead",
    });
    expect(published.revision).toBe(2);

    const history = await service.history(firstVersionId);
    expect(history.map((row) => row.status)).toEqual(["PUBLISHED", "DRAFT"]);
    expect(history[0]).toMatchObject({
      revision: 2,
      prepMinutes: 15,
      cookMinutes: 35,
      changeSummary: "Approved by kitchen lead",
    });

    const rows = await db
      .prepare(
        "SELECT action FROM audit_events WHERE tenant_id=? AND entity_type='COOKBOOK_CONTENT' ORDER BY created_at",
      )
      .bind(tenantId)
      .all<{ action: string }>();
    const actions = (rows.results ?? []).map((row) => row.action);
    expect(actions).toHaveLength(2);
    expect(actions).toEqual(
      expect.arrayContaining(["COOKBOOK_DRAFT_CREATED", "COOKBOOK_REVISION_PUBLISHED"]),
    );
  });

  it("does not silently carry a method to a new recipe version but can copy it as a draft", async () => {
    const draft = await service.saveDraft({
      recipeId,
      recipeVersionId: firstVersionId,
      prepMinutes: 10,
      cookMinutes: 20,
      method: [{ step: 1, instruction: "Cook the original standard." }],
      changeSummary: "Initial method",
    });
    await service.publish({ contentVersionId: draft.id });

    db.sqlite
      .prepare("UPDATE recipes SET current_version_id=? WHERE tenant_id=? AND id=?")
      .run(secondVersionId, tenantId, recipeId);

    const libraryBefore = await service.library(branchId);
    const currentBefore = libraryBefore.recipes[0]!;
    expect(currentBefore["latestContent"]).toBeNull();
    expect(currentBefore["publishedContent"]).toBeNull();
    expect(currentBefore["previousPublishedContent"]).not.toBeNull();

    const copied = await service.copyPreviousPublished({
      recipeId,
      targetRecipeVersionId: secondVersionId,
      changeSummary: "Review previous method against recipe v2",
    });
    expect(copied.revision).toBe(1);

    const libraryAfter = await service.library(branchId);
    const currentAfter = libraryAfter.recipes[0]!;
    expect(currentAfter["publishedContent"]).toBeNull();
    expect(currentAfter["latestContent"]).toMatchObject({
      status: "DRAFT",
      prepMinutes: 10,
      cookMinutes: 20,
      changeSummary: "Review previous method against recipe v2",
    });
  });
});

function actor(): ServerActor {
  return {
    id: userId,
    name: "Kitchen manager",
    tenantId,
    roleIds: ["manager"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Main Branch", isPrimary: true }],
    primaryBranchId: branchId,
    branchScope: { type: "ALL" },
    branchId,
    branch: "Main Branch",
    role: "Manager",
  };
}

function seed(db: SqliteD1TestDatabase) {
  const stamp = "2026-09-24T12:00:00.000Z";
  db.sqlite
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .run(tenantId, "cookbook-tenant", "Cookbook Tenant", "Cookbook Tenant", "KES", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    )
    .run(tenantId, branchId, "MAIN", "Main Branch");
  db.sqlite
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,active,payload_json,created_at,updated_at) VALUES (?,?,NULL,?,1,'{}',?,?)",
    )
    .run(tenantId, userId, "Kitchen manager", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at) VALUES (?,?,?,?,?,'COUNT',1,1,1,?,?)",
    )
    .run(tenantId, "unit-piece", "PC", "Piece", "pc", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (tenant_id,id,sku,code,name,unit,base_unit_id,purchase_unit_id,active,payload_json,updated_at) VALUES (?,?,?,?,?,'pc',?,?,1,'{}',?)",
    )
    .run(
      tenantId,
      "output-item",
      "OUTPUT",
      "OUTPUT",
      "Cookbook output",
      "unit-piece",
      "unit-piece",
      stamp,
    );
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (tenant_id,id,sku,code,name,unit,base_unit_id,purchase_unit_id,active,payload_json,updated_at) VALUES (?,?,?,?,?,'pc',?,?,1,'{}',?)",
    )
    .run(
      tenantId,
      "ingredient-item",
      "ING",
      "ING",
      "Ingredient",
      "unit-piece",
      "unit-piece",
      stamp,
    );
  db.sqlite
    .prepare(
      "INSERT INTO recipes (tenant_id,id,menu_item_id,yield_minor,active,payload_json,name,production_item_id,current_version_id,updated_at) VALUES (?,?,?,1,1,'{}',?,?,?,?)",
    )
    .run(
      tenantId,
      recipeId,
      "production:" + recipeId,
      "Cookbook recipe",
      "output-item",
      firstVersionId,
      stamp,
    );
  for (const [id, version] of [
    [firstVersionId, 1],
    [secondVersionId, 2],
  ] as const) {
    db.sqlite
      .prepare(
        "INSERT INTO recipe_versions (tenant_id,id,recipe_id,version,yield_quantity_minor,yield_unit_id,effective_from,active,packaging_cost_minor,production_overhead_minor,created_by,created_at) VALUES (?,?,?,?,?,?,?, ?,0,0,?,?)",
      )
      .run(
        tenantId,
        id,
        recipeId,
        version,
        4_000_000,
        "unit-piece",
        stamp,
        version === 1 ? 1 : 0,
        userId,
        stamp,
      );
    db.sqlite
      .prepare(
        "INSERT INTO recipe_version_components (tenant_id,id,recipe_version_id,inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps,optional,station_id) VALUES (?,?,?,?,NULL,?,?,0,0,NULL)",
      )
      .run(tenantId, "component-" + version, id, "ingredient-item", 2_000_000, "unit-piece");
  }
}
