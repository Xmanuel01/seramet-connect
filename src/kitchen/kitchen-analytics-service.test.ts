import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KitchenAnalyticsService,
  parseKitchenAnalyticsPeriod,
} from "@/kitchen/kitchen-analytics-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "kitchen-analytics-tenant";
const branchId = "kitchen-analytics-branch";
const otherBranchId = "kitchen-analytics-other";
const stationId = "kitchen-analytics-station";
const warehouseId = "kitchen-analytics-warehouse";
const userId = "kitchen-analytics-user";
const recipeId = "kitchen-analytics-recipe";
const recipeVersion1 = "kitchen-analytics-recipe-v1";
const recipeVersion2 = "kitchen-analytics-recipe-v2";
const outputItemId = "kitchen-analytics-output";
const today = new Date().toISOString().slice(0, 10);
const yesterday = shiftDate(today, -1);

describe("Kitchen Analytics control centre", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seed(db);
  });

  afterEach(() => db.close());

  it("aggregates station timing, prep, production yield and Cookbook coverage", async () => {
    const service = new KitchenAnalyticsService(db, actor());
    const overview = await service.overview(branchId, 7);

    expect(overview.summary).toMatchObject({
      ticketCount: 30,
      completedCount: 26,
      lateCount: 6,
      completionBps: 8667,
      lateBps: 2000,
    });
    expect(overview.summary.averagePrepMs).toBe(807_692);

    expect(overview.stations).toHaveLength(1);
    expect(overview.stations[0]).toMatchObject({
      stationId,
      ticketCount: 30,
      completedCount: 26,
      lateCount: 6,
      completionBps: 8667,
      lateBps: 2000,
      averagePrepMs: 807_692,
    });

    expect(overview.daily).toHaveLength(2);
    expect(overview.production).toMatchObject({
      batchCount: 2,
      completedCount: 1,
      inProgressCount: 1,
      cancelledCount: 0,
      belowTargetCount: 1,
      averageYieldVarianceBps: -700,
      averageAbsoluteYieldVarianceBps: 700,
    });
    expect(overview.prep).toMatchObject({
      taskCount: 1,
      completedCount: 0,
      awaitingApprovalCount: 1,
      completionBps: 0,
    });
    expect(overview.cookbook).toEqual({
      recipeCount: 1,
      publishedCount: 0,
      missingCount: 1,
      coverageBps: 0,
    });
    expect(overview.currentPrep).toMatchObject({
      blockerCount: 1,
      blockers: [
        {
          recipeName: "Prepared Pilau",
          status: "RECOMMENDED",
          reasons: ["RECIPE_VERSION_CHANGED"],
        },
      ],
    });
  });

  it("requires Kitchen view permission and branch scope", async () => {
    const noKitchen = actor(
      allPermissionCodes.filter((code) => code !== permissions.kitchenView),
    );
    await expect(
      new KitchenAnalyticsService(db, noKitchen).overview(branchId, 7),
    ).rejects.toThrow("kitchen.view permission is required");

    await expect(
      new KitchenAnalyticsService(db, actor()).overview(otherBranchId, 7),
    ).rejects.toThrow("Actor cannot read records outside the active branch");
  });

  it("accepts only supported analytics periods", () => {
    expect(parseKitchenAnalyticsPeriod("1")).toBe(1);
    expect(parseKitchenAnalyticsPeriod("7")).toBe(7);
    expect(parseKitchenAnalyticsPeriod("30")).toBe(30);
    expect(() => parseKitchenAnalyticsPeriod("14")).toThrow(
      "periodDays must be one of 1, 7 or 30",
    );
  });
});

function actor(permissionCodes = allPermissionCodes): ServerActor {
  return {
    id: userId,
    name: "Kitchen manager",
    tenantId,
    roleIds: ["manager"],
    permissions: [...permissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Main Branch", isPrimary: true }],
    primaryBranchId: branchId,
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: "Main Branch",
    role: "Manager",
  };
}

function seed(db: SqliteD1TestDatabase) {
  const stamp = today + "T12:00:00.000Z";
  db.sqlite
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'UTC','en-KE',1,'{}',?,?)",
    )
    .run(
      tenantId,
      "kitchen-analytics",
      "Kitchen Analytics",
      "Kitchen Analytics",
      "KES",
      stamp,
      stamp,
    );

  for (const [id, code, name] of [
    [branchId, "MAIN", "Main Branch"],
    [otherBranchId, "OTHER", "Other Branch"],
  ] as const) {
    db.sqlite
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'UTC',0,1,'{}')",
      )
      .run(tenantId, id, code, name);
  }

  db.sqlite
    .prepare(
      "INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
    )
    .run(tenantId, warehouseId, branchId, "MAIN", "Main Store");
  db.sqlite
    .prepare(
      "INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES (?,?,?,?,?,'KITCHEN',1,'{}')",
    )
    .run(tenantId, stationId, branchId, "MAIN", "Main Kitchen");
  db.sqlite
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,active,payload_json,created_at,updated_at) VALUES (?,?,NULL,?,1,'{}',?,?)",
    )
    .run(tenantId, userId, "Kitchen manager", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at) VALUES (?,?,?,?,?,'MASS',1,1,1,?,?)",
    )
    .run(tenantId, "unit-kg", "KG", "Kilogram", "kg", stamp, stamp);
  db.sqlite
    .prepare(
      "INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,purchase_unit_id,default_warehouse_id,updated_at) VALUES (?,?,?,?, 'kg',1,'{}',?,?,?,?,?)",
    )
    .run(
      tenantId,
      outputItemId,
      "PILAU-PREP",
      "Prepared Pilau",
      "PILAU-PREP",
      "unit-kg",
      "unit-kg",
      warehouseId,
      stamp,
    );

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
      recipeVersion2,
      stamp,
    );

  for (const [versionId, version, active] of [
    [recipeVersion1, 1, 0],
    [recipeVersion2, 2, 1],
  ] as const) {
    db.sqlite
      .prepare(
        "INSERT INTO recipe_versions (tenant_id,id,recipe_id,version,yield_quantity_minor,yield_unit_id,effective_from,active,packaging_cost_minor,production_overhead_minor,created_by,created_at) VALUES (?,?,?,?,4000000,'unit-kg',?,?,0,0,?,?)",
      )
      .run(tenantId, versionId, recipeId, version, stamp, active, userId, stamp);
  }

  db.sqlite
    .prepare(
      "INSERT INTO cookbook_recipe_content_versions (tenant_id,id,recipe_id,recipe_version_id,revision,status,prep_minutes,cook_minutes,portion_label,image_url,chef_notes,method_json,media_json,source_document,source_reference,change_summary,created_by,created_at) VALUES (?,?,?,?,1,'PUBLISHED',10,30,'4 kg',NULL,NULL,?,'[]',NULL,NULL,'Old standard',?,?)",
    )
    .run(
      tenantId,
      "cookbook-v1",
      recipeId,
      recipeVersion1,
      JSON.stringify([{ step: 1, instruction: "Cook old version." }]),
      userId,
      stamp,
    );

  for (const row of [
    { date: yesterday, tickets: 10, completed: 8, late: 2, avg: 600_000, pickup: 120_000, throughput: 6_000 },
    { date: today, tickets: 20, completed: 18, late: 4, avg: 900_000, pickup: 180_000, throughput: 8_000 },
  ]) {
    db.sqlite
      .prepare(
        "INSERT INTO daily_station_metrics (tenant_id,branch_id,business_date,station_id,ticket_count,completed_count,late_count,average_prep_ms,median_prep_ms,p90_prep_ms,average_ready_pickup_ms,throughput_per_hour_milli,quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'HIGH','[]',?)",
      )
      .run(
        tenantId,
        branchId,
        row.date,
        stationId,
        row.tickets,
        row.completed,
        row.late,
        row.avg,
        row.avg,
        row.avg + 120_000,
        row.pickup,
        row.throughput,
        stamp,
      );
  }

  db.sqlite
    .prepare(
      "INSERT INTO production_prep_recommendations (tenant_id,id,branch_id,business_date,recipe_id,recipe_version_id,output_item_id,forecast_required_minor,prepared_available_minor,safety_buffer_minor,recommended_batch_minor,due_at,station_id,status,quality,explanation_json,generated_at,updated_at) VALUES (?,?,?,?,?,?,?,3000000,1000000,0,2000000,NULL,?,'RECOMMENDED','HIGH','{}',?,?)",
    )
    .run(
      tenantId,
      "prep-risk",
      branchId,
      today,
      recipeId,
      recipeVersion1,
      outputItemId,
      stationId,
      stamp,
      stamp,
    );

  db.sqlite
    .prepare(
      "INSERT INTO production_batches (tenant_id,id,branch_id,warehouse_id,recipe_version_id,planned_quantity_minor,actual_output_quantity_minor,output_item_id,station_id,employee_id,status,idempotency_key,started_at,completed_at,business_date,expected_yield_minor,yield_variance_bps,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,4000000,3720000,?,?,NULL,'COMPLETED','analytics-completed',?,?,?,4000000,-700,'{}',?,?)",
    )
    .run(
      tenantId,
      "batch-completed",
      branchId,
      warehouseId,
      recipeVersion1,
      outputItemId,
      stationId,
      stamp,
      stamp,
      today,
      stamp,
      stamp,
    );
  db.sqlite
    .prepare(
      "INSERT INTO production_batches (tenant_id,id,branch_id,warehouse_id,recipe_version_id,planned_quantity_minor,actual_output_quantity_minor,output_item_id,station_id,employee_id,status,idempotency_key,started_at,completed_at,business_date,expected_yield_minor,yield_variance_bps,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,2000000,NULL,?,?,NULL,'IN_PROGRESS','analytics-progress',?,NULL,?,2000000,NULL,'{}',?,?)",
    )
    .run(
      tenantId,
      "batch-progress",
      branchId,
      warehouseId,
      recipeVersion1,
      outputItemId,
      stationId,
      stamp,
      today,
      stamp,
      stamp,
    );
}

function shiftDate(value: string, days: number) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
