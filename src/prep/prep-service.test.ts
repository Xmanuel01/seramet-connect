import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrepService } from "@/prep/prep-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "prep-tenant";
const branchId = "prep-branch";
const warehouseId = "prep-warehouse";
const stationId = "prep-station";
const userId = "prep-user";
const recipeId = "prep-recipe";
const recipeVersionId = "prep-recipe-v1";
const outputItemId = "prep-output";
const ingredientItemId = "prep-ingredient";
const recommendationId = "prep:" + branchId + ":2026-09-24:" + recipeId;

describe("authoritative prep execution", () => {
  let db: SqliteD1TestDatabase;
  let service: PrepService;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seed(db);
    service = new PrepService(db, actor());
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  it("scales ingredients, controls revision changes and executes through production", async () => {
    // Audit timestamps must be distinct when asserting chronological SQL ordering.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T12:00:00.000Z"));
    const initial = await service.library(branchId, "2026-09-24");
    expect(initial.tasks).toHaveLength(1);
    expect(initial.tasks[0]).toMatchObject({
      id: recommendationId,
      status: "RECOMMENDED",
      effectiveTargetMicro: 2_000_000,
      cookbookPublished: true,
      recipeVersionCurrent: true,
    });
    expect(initial.tasks[0]!.ingredients[0]).toMatchObject({
      name: "Rice",
      scaledQuantityMicro: 1_000_000,
      requiredWithWasteMicro: 1_100_000,
    });

    const adjusted = await service.adjust(recommendationId, {
      expectedRevision: 1,
      targetQuantityMicro: 3_000_000,
      stationId,
      dueAt: "2026-09-24T17:00:00.000Z",
      reason: "Dinner forecast increased",
    });
    expect(adjusted).toMatchObject({
      status: "ADJUSTED",
      revision: 2,
      effectiveTargetMicro: 3_000_000,
      stationId,
    });
    expect(adjusted.ingredients[0]).toMatchObject({
      scaledQuantityMicro: 1_500_000,
      requiredWithWasteMicro: 1_650_000,
    });

    await expect(
      service.adjust(recommendationId, {
        expectedRevision: 1,
        targetQuantityMicro: 2_500_000,
        reason: "Stale manager change",
      }),
    ).rejects.toThrow("Prep task changed while you were editing it");

    vi.setSystemTime(new Date("2026-09-24T12:00:01.000Z"));
    const approved = await service.approve(recommendationId, {
      expectedRevision: 2,
      warehouseId,
    });
    expect(approved).toMatchObject({
      status: "APPROVED",
      revision: 3,
      warehouseId,
      productionStatus: "PLANNED",
    });

    const batch = await db
      .prepare(
        "SELECT planned_quantity_minor,status FROM production_batches WHERE tenant_id=? AND id=?",
      )
      .bind(tenantId, approved.productionBatchId)
      .first<{ planned_quantity_minor: number; status: string }>();
    expect(batch).toEqual({ planned_quantity_minor: 3_000_000, status: "PLANNED" });

    vi.setSystemTime(new Date("2026-09-24T12:00:02.000Z"));
    const started = await service.start(recommendationId, approved.revision);
    expect(started).toMatchObject({
      status: "STARTED",
      revision: 4,
      productionStatus: "IN_PROGRESS",
    });

    vi.setSystemTime(new Date("2026-09-24T12:00:03.000Z"));
    const completed = await service.complete(recommendationId, {
      expectedRevision: started.revision,
      actualOutputQuantityMicro: 2_800_000,
    });
    expect(completed).toMatchObject({
      status: "COMPLETED",
      revision: 5,
      productionStatus: "COMPLETED",
      actualOutputQuantityMicro: 2_800_000,
    });

    const movementCount = await db
      .prepare(
        "SELECT COUNT(*) count FROM inventory_movements WHERE tenant_id=? AND source_type='PRODUCTION_BATCH' AND source_id=?",
      )
      .bind(tenantId, completed.productionBatchId)
      .first<{ count: number }>();
    expect(movementCount?.count).toBe(2);

    const audit = await db
      .prepare(
        "SELECT action FROM audit_events WHERE tenant_id=? AND entity_type='PRODUCTION_PREP_RECOMMENDATION' ORDER BY created_at",
      )
      .bind(tenantId)
      .all<{ action: string }>();
    expect((audit.results ?? []).map((row) => row.action)).toEqual([
      "PREP_RECOMMENDATION_ADJUSTED",
      "PREP_RECOMMENDATION_APPROVED",
      "PREP_PRODUCTION_STARTED",
      "PREP_PRODUCTION_COMPLETED",
    ]);
  });

  it("blocks approval when the exact recipe version has no published Cookbook method", async () => {
    db.sqlite
      .prepare(
        "DELETE FROM cookbook_recipe_content_versions WHERE tenant_id=? AND recipe_version_id=?",
      )
      .run(tenantId, recipeVersionId);

    await expect(
      service.approve(recommendationId, {
        expectedRevision: 1,
        warehouseId,
      }),
    ).rejects.toThrow("Publish the Cookbook method");
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM production_batches WHERE tenant_id=? AND branch_id=?")
        .get(tenantId, branchId)?.["count"],
    ).toBe(0);
  });

  it("dismisses an approved prep task and cancels its linked production batch", async () => {
    const approved = await service.approve(recommendationId, {
      expectedRevision: 1,
      warehouseId,
    });
    const dismissed = await service.dismiss(recommendationId, {
      expectedRevision: approved.revision,
      reason: "Demand removed after event cancellation",
    });
    expect(dismissed).toMatchObject({ status: "DISMISSED" });
    const batch = await db
      .prepare("SELECT status FROM production_batches WHERE tenant_id=? AND id=?")
      .bind(tenantId, approved.productionBatchId)
      .first<{ status: string }>();
    expect(batch?.status).toBe("CANCELLED");
  });
});

function actor(): ServerActor {
  return {
    id: userId,
    name: "Prep manager",
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
    .run(tenantId, "prep-tenant", "Prep Tenant", "Prep Tenant", "KES", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    )
    .run(tenantId, branchId, "MAIN", "Main Branch");
  db.sqlite
    .prepare(
      "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
    )
    .run(tenantId, warehouseId, branchId, "MAIN", "Main Store");
  db.sqlite
    .prepare(
      "INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES (?,?,?,?,?,?,1,'{}')",
    )
    .run(tenantId, stationId, branchId, "PREP", "Prep Station", "KITCHEN");
  db.sqlite
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,active,payload_json,created_at,updated_at) VALUES (?,?,NULL,?,1,'{}',?,?)",
    )
    .run(tenantId, userId, "Prep manager", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at) VALUES (?,?,?,?,?,'MASS',1,1,1,?,?)",
    )
    .run(tenantId, "unit-kg", "KG", "Kilogram", "kg", stamp, stamp);

  for (const item of [
    { id: outputItemId, sku: "PILAU-PREP", name: "Prepared Pilau" },
    { id: ingredientItemId, sku: "RICE", name: "Rice" },
  ]) {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,purchase_unit_id,default_warehouse_id,updated_at) VALUES (?,?,?,?, 'kg',1,'{}',?,?,?,?,?)",
      )
      .run(
        tenantId,
        item.id,
        item.sku,
        item.name,
        item.sku,
        "unit-kg",
        "unit-kg",
        warehouseId,
        stamp,
      );
  }

  for (const [itemId, quantity, cost, value] of [
    [ingredientItemId, 10_000_000, 10_000, 100_000],
    [outputItemId, 0, 0, 0],
  ] as const) {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_balances (tenant_id,branch_id,warehouse_id,item_id,quantity_minor,version,updated_at,payload_json,quantity_reserved_minor,average_unit_cost_minor,total_value_minor) VALUES (?,?,?,?,?,1,?,'{}',0,?,?)",
      )
      .run(tenantId, branchId, warehouseId, itemId, quantity, stamp, cost, value);
  }

  db.sqlite
    .prepare(
      "INSERT INTO recipes (tenant_id,id,menu_item_id,yield_minor,active,payload_json,name,production_item_id,current_version_id,updated_at) VALUES (?,?,?,4000000,1,'{}',?,?,?,?)",
    )
    .run(
      tenantId,
      recipeId,
      "production:" + recipeId,
      "Prepared Pilau",
      outputItemId,
      recipeVersionId,
      stamp,
    );
  db.sqlite
    .prepare(
      "INSERT INTO recipe_versions (tenant_id,id,recipe_id,version,yield_quantity_minor,yield_unit_id,effective_from,active,packaging_cost_minor,production_overhead_minor,created_by,created_at) VALUES (?,?,?,1,4000000,'unit-kg',?,1,0,0,?,?)",
    )
    .run(tenantId, recipeVersionId, recipeId, stamp, userId, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO recipe_version_components (tenant_id,id,recipe_version_id,inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps,optional,station_id) VALUES (?,?,?,?,NULL,2000000,'unit-kg',1000,0,?)",
    )
    .run(tenantId, "component-rice", recipeVersionId, ingredientItemId, stationId);

  db.sqlite
    .prepare(
      "INSERT INTO cookbook_recipe_content_versions (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes,portion_label,image_url,chef_notes,method_json,media_json,source_document,source_reference,change_summary,created_by,created_at) VALUES (?,?,?,?,1,'PUBLISHED',10,30,'4 kg',NULL,'Taste before service.',?,'[]','Kitchen Standard','Pilau section','Approved method',?,?)",
    )
    .run(
      tenantId,
      "cookbook-published",
      recipeId,
      recipeVersionId,
      JSON.stringify([{ step: 1, instruction: "Cook the pilau to the published standard." }]),
      userId,
      stamp,
    );

  db.sqlite
    .prepare(
      "INSERT INTO production_prep_recommendations (tenant_id,id,branch_id,business_date,recipe_id,recipe_version_id,output_item_id,forecast_required_minor,prepared_available_minor,safety_buffer_minor,recommended_batch_minor,due_at,station_id,status,quality,explanation_json,generated_at,updated_at) VALUES (?,?,?,?,?,?,?,3000000,1000000,0,2000000,NULL,?,'RECOMMENDED','HIGH','{}',?,?)",
    )
    .run(
      tenantId,
      recommendationId,
      branchId,
      "2026-09-24",
      recipeId,
      recipeVersionId,
      outputItemId,
      stationId,
      stamp,
      stamp,
    );
}
