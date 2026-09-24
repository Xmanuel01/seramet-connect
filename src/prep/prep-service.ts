import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import { BASIS_POINTS_SCALE, multiplyDivide } from "@/inventory/quantity";
import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

type PrepStatus = "RECOMMENDED" | "APPROVED" | "ADJUSTED" | "STARTED" | "COMPLETED" | "DISMISSED";

type PrepRow = {
  id: string;
  branch_id: string;
  business_date: string;
  recipe_id: string;
  recipe_name: string;
  recipe_version_id: string;
  recipe_version: number;
  current_version_id: string | null;
  output_item_id: string;
  output_item_name: string;
  default_warehouse_id: string | null;
  yield_quantity_minor: number;
  yield_unit_id: string;
  yield_unit_symbol: string | null;
  forecast_required_minor: number;
  prepared_available_minor: number;
  safety_buffer_minor: number;
  recommended_batch_minor: number;
  target_quantity_minor: number | null;
  due_at: string | null;
  station_id: string | null;
  station_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  production_batch_id: string | null;
  production_status: string | null;
  actual_output_quantity_minor: number | null;
  status: PrepStatus;
  quality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
  explanation_json: string;
  adjustment_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  dismissal_reason: string | null;
  revision: number;
  generated_at: string;
  updated_at: string;
};

type CookbookRow = {
  id: string;
  revision: number;
  prep_minutes: number;
  cook_minutes: number;
  portion_label: string | null;
  image_url: string | null;
  chef_notes: string | null;
  method_json: string;
  media_json: string;
  source_document: string | null;
  source_reference: string | null;
  change_summary: string | null;
  created_at: string;
};

export class PrepService {
  private readonly production: InventoryIntelligenceService;

  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {
    this.production = new InventoryIntelligenceService(db, actor);
  }

  async library(branchId: string, businessDate: string) {
    this.require(permissions.productionView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);

    const [rows, warehouses, stations] = await Promise.all([
      this.db
        .prepare(
          "SELECT p.id,p.branch_id,p.business_date,p.recipe_id,r.name AS recipe_name," +
            " p.recipe_version_id,rv.version AS recipe_version,r.current_version_id," +
            " p.output_item_id,i.name AS output_item_name,i.default_warehouse_id," +
            " rv.yield_quantity_minor,rv.yield_unit_id,u.symbol AS yield_unit_symbol," +
            " p.forecast_required_minor,p.prepared_available_minor,p.safety_buffer_minor," +
            " p.recommended_batch_minor,p.target_quantity_minor,p.due_at,p.station_id," +
            " s.name AS station_name,p.warehouse_id,w.name AS warehouse_name," +
            " p.production_batch_id,b.status AS production_status,b.actual_output_quantity_minor," +
            " p.status,p.quality,p.explanation_json,p.adjustment_reason,p.approved_by,p.approved_at," +
            " p.started_at,p.completed_at,p.dismissed_by,p.dismissed_at,p.dismissal_reason," +
            " p.revision,p.generated_at,p.updated_at" +
            " FROM production_prep_recommendations p" +
            " JOIN recipes r ON r.tenant_id=p.tenant_id AND r.id=p.recipe_id" +
            " JOIN recipe_versions rv ON rv.tenant_id=p.tenant_id AND rv.id=p.recipe_version_id" +
            " JOIN inventory_items i ON i.tenant_id=p.tenant_id AND i.id=p.output_item_id" +
            " LEFT JOIN unit_definitions u ON u.tenant_id=rv.tenant_id AND u.id=rv.yield_unit_id" +
            " LEFT JOIN stations s ON s.tenant_id=p.tenant_id AND s.id=p.station_id" +
            " LEFT JOIN warehouses w ON w.tenant_id=p.tenant_id AND w.id=p.warehouse_id" +
            " LEFT JOIN production_batches b ON b.tenant_id=p.tenant_id AND b.id=p.production_batch_id" +
            " WHERE p.tenant_id=? AND p.branch_id=? AND p.business_date=?" +
            " ORDER BY CASE p.status WHEN 'STARTED' THEN 0 WHEN 'APPROVED' THEN 1" +
            " WHEN 'ADJUSTED' THEN 2 WHEN 'RECOMMENDED' THEN 3 WHEN 'COMPLETED' THEN 4 ELSE 5 END," +
            " COALESCE(p.due_at,'9999-12-31T23:59:59Z'),p.recommended_batch_minor DESC",
        )
        .bind(this.actor.tenantId, branchId, businessDate)
        .all<PrepRow>(),
      this.db
        .prepare(
          "SELECT id,code,name FROM warehouses WHERE tenant_id=? AND branch_id=? AND active=1 ORDER BY name",
        )
        .bind(this.actor.tenantId, branchId)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          "SELECT id,code,name,station_type FROM stations WHERE tenant_id=? AND branch_id=? AND active=1 ORDER BY name",
        )
        .bind(this.actor.tenantId, branchId)
        .all<Record<string, unknown>>(),
    ]);

    const tasks = [];
    for (const row of rows.results ?? []) tasks.push(await this.serializeTask(row));
    return {
      branchId,
      businessDate,
      tasks,
      warehouses: warehouses.results ?? [],
      stations: stations.results ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  async adjust(
    recommendationId: string,
    input: {
      expectedRevision: number;
      targetQuantityMicro: number;
      stationId?: string | null;
      dueAt?: string | null;
      reason: string;
    },
  ) {
    this.require(permissions.productionPlan);
    const row = await this.recommendation(recommendationId);
    this.authorizeRow(row);
    if (!["RECOMMENDED", "ADJUSTED"].includes(row.status)) {
      throw transition("Cannot adjust a prep task in " + row.status + " status");
    }
    assertPositiveInteger(input.targetQuantityMicro, "Prep target quantity");
    await this.assertStation(row.branch_id, input.stationId ?? null);
    const stamp = new Date().toISOString();
    const result = await this.db
      .prepare(
        "UPDATE production_prep_recommendations" +
          " SET target_quantity_minor=?,station_id=?,due_at=?,adjustment_reason=?," +
          " status='ADJUSTED',revision=revision+1,updated_at=?" +
          " WHERE tenant_id=? AND id=? AND revision=? AND status IN ('RECOMMENDED','ADJUSTED')",
      )
      .bind(
        input.targetQuantityMicro,
        input.stationId ?? null,
        input.dueAt ?? null,
        input.reason.trim(),
        stamp,
        this.actor.tenantId,
        recommendationId,
        input.expectedRevision,
      )
      .run();
    this.assertChanged(result.meta?.changes, "Prep task changed while you were editing it");
    await this.audit("PREP_RECOMMENDATION_ADJUSTED", recommendationId, row.branch_id, stamp, {
      previousStatus: row.status,
      targetQuantityMicro: input.targetQuantityMicro,
      stationId: input.stationId ?? null,
      dueAt: input.dueAt ?? null,
      reason: input.reason.trim(),
    });
    return this.serializeTask(await this.recommendation(recommendationId));
  }

  async approve(
    recommendationId: string,
    input: { expectedRevision: number; warehouseId: string },
  ) {
    this.require(permissions.productionPlan);
    const row = await this.recommendation(recommendationId);
    this.authorizeRow(row);
    if (row.status === "APPROVED" && row.production_batch_id) return this.serializeTask(row);
    if (!["RECOMMENDED", "ADJUSTED"].includes(row.status)) {
      throw transition("Cannot approve a prep task in " + row.status + " status");
    }
    await this.assertCurrentRecipeVersion(row);
    await this.assertPublishedCookbook(row.recipe_version_id);
    await this.assertWarehouse(row.branch_id, input.warehouseId);
    const quantity = row.target_quantity_minor ?? row.recommended_batch_minor;
    assertPositiveInteger(quantity, "Prep production quantity");

    const stamp = new Date().toISOString();
    const batchId = "prep-batch:" + recommendationId;
    const updated = await this.db
      .prepare(
        "UPDATE production_prep_recommendations" +
          " SET target_quantity_minor=?,warehouse_id=?,production_batch_id=?," +
          " status='APPROVED',approved_by=?,approved_at=?,revision=revision+1,updated_at=?" +
          " WHERE tenant_id=? AND id=? AND revision=? AND status IN ('RECOMMENDED','ADJUSTED')",
      )
      .bind(
        quantity,
        input.warehouseId,
        batchId,
        this.actor.id,
        stamp,
        stamp,
        this.actor.tenantId,
        recommendationId,
        input.expectedRevision,
      )
      .run();
    this.assertChanged(updated.meta?.changes, "Prep task changed before approval");

    try {
      await this.production.planProduction({
        id: batchId,
        branchId: row.branch_id,
        warehouseId: input.warehouseId,
        recipeVersionId: row.recipe_version_id,
        outputItemId: row.output_item_id,
        plannedQuantityMicro: quantity,
        idempotencyKey: "prep-plan:" + recommendationId,
        businessDate: row.business_date,
        ...(row.station_id ? { stationId: row.station_id } : {}),
      });
    } catch (error) {
      await this.db
        .prepare(
          "UPDATE production_prep_recommendations" +
            " SET status=?,production_batch_id=NULL,warehouse_id=NULL,approved_by=NULL,approved_at=NULL," +
            " revision=revision+1,updated_at=? WHERE tenant_id=? AND id=?" +
            " AND status='APPROVED' AND production_batch_id=?",
        )
        .bind(row.status, new Date().toISOString(), this.actor.tenantId, recommendationId, batchId)
        .run();
      throw error;
    }

    await this.audit("PREP_RECOMMENDATION_APPROVED", recommendationId, row.branch_id, stamp, {
      productionBatchId: batchId,
      targetQuantityMicro: quantity,
      warehouseId: input.warehouseId,
      recipeVersionId: row.recipe_version_id,
    });
    return this.serializeTask(await this.recommendation(recommendationId));
  }

  async start(recommendationId: string, expectedRevision: number) {
    this.require(permissions.productionStart);
    const row = await this.recommendation(recommendationId);
    this.authorizeRow(row);
    if (row.status === "STARTED") return this.serializeTask(row);
    if (row.status !== "APPROVED" || !row.production_batch_id) {
      throw transition("Only an approved prep task with a production batch can be started");
    }
    await this.assertCurrentRecipeVersion(row);
    await this.assertPublishedCookbook(row.recipe_version_id);

    const stamp = new Date().toISOString();
    const updated = await this.db
      .prepare(
        "UPDATE production_prep_recommendations SET status='STARTED',started_at=?," +
          " revision=revision+1,updated_at=? WHERE tenant_id=? AND id=? AND revision=? AND status='APPROVED'",
      )
      .bind(stamp, stamp, this.actor.tenantId, recommendationId, expectedRevision)
      .run();
    this.assertChanged(updated.meta?.changes, "Prep task changed before it could be started");

    try {
      await this.production.startProduction(row.production_batch_id);
    } catch (error) {
      await this.db
        .prepare(
          "UPDATE production_prep_recommendations SET status='APPROVED',started_at=NULL," +
            " revision=revision+1,updated_at=? WHERE tenant_id=? AND id=?" +
            " AND status='STARTED' AND production_batch_id=?",
        )
        .bind(
          new Date().toISOString(),
          this.actor.tenantId,
          recommendationId,
          row.production_batch_id,
        )
        .run();
      throw error;
    }

    await this.audit("PREP_PRODUCTION_STARTED", recommendationId, row.branch_id, stamp, {
      productionBatchId: row.production_batch_id,
    });
    return this.serializeTask(await this.recommendation(recommendationId));
  }

  async complete(
    recommendationId: string,
    input: { expectedRevision: number; actualOutputQuantityMicro: number },
  ) {
    this.require(permissions.productionComplete);
    assertPositiveInteger(input.actualOutputQuantityMicro, "Actual prep output");
    const row = await this.recommendation(recommendationId);
    this.authorizeRow(row);
    if (row.status === "COMPLETED") return this.serializeTask(row);
    if (row.status !== "STARTED" || !row.production_batch_id) {
      throw transition("Only a started prep task can be completed");
    }

    await this.production.completePlannedProduction(
      row.production_batch_id,
      input.actualOutputQuantityMicro,
    );

    const stamp = new Date().toISOString();
    const updated = await this.db
      .prepare(
        "UPDATE production_prep_recommendations SET status='COMPLETED',completed_at=?," +
          " revision=revision+1,updated_at=? WHERE tenant_id=? AND id=? AND revision=? AND status='STARTED'",
      )
      .bind(stamp, stamp, this.actor.tenantId, recommendationId, input.expectedRevision)
      .run();
    this.assertChanged(
      updated.meta?.changes,
      "Production completed but the prep task changed; refresh to reconcile its status",
    );
    await this.audit("PREP_PRODUCTION_COMPLETED", recommendationId, row.branch_id, stamp, {
      productionBatchId: row.production_batch_id,
      actualOutputQuantityMicro: input.actualOutputQuantityMicro,
    });
    return this.serializeTask(await this.recommendation(recommendationId));
  }

  async dismiss(recommendationId: string, input: { expectedRevision: number; reason: string }) {
    this.require(permissions.productionAdjust);
    const row = await this.recommendation(recommendationId);
    this.authorizeRow(row);
    if (row.status === "DISMISSED") return this.serializeTask(row);
    if (row.status === "COMPLETED") throw transition("Completed prep cannot be dismissed");

    if (row.production_batch_id && ["APPROVED", "STARTED"].includes(row.status)) {
      await this.production.cancelProduction(row.production_batch_id, input.reason);
    }

    const stamp = new Date().toISOString();
    const updated = await this.db
      .prepare(
        "UPDATE production_prep_recommendations SET status='DISMISSED',dismissed_by=?," +
          " dismissed_at=?,dismissal_reason=?,revision=revision+1,updated_at=?" +
          " WHERE tenant_id=? AND id=? AND revision=? AND status<>'COMPLETED'",
      )
      .bind(
        this.actor.id,
        stamp,
        input.reason.trim(),
        stamp,
        this.actor.tenantId,
        recommendationId,
        input.expectedRevision,
      )
      .run();
    this.assertChanged(updated.meta?.changes, "Prep task changed before it could be dismissed");
    await this.audit("PREP_RECOMMENDATION_DISMISSED", recommendationId, row.branch_id, stamp, {
      previousStatus: row.status,
      productionBatchId: row.production_batch_id,
      reason: input.reason.trim(),
    });
    return this.serializeTask(await this.recommendation(recommendationId));
  }

  private async serializeTask(row: PrepRow) {
    const [cookbook, ingredients] = await Promise.all([
      this.publishedCookbook(row.recipe_version_id),
      this.scaledIngredients(row),
    ]);
    return {
      id: row.id,
      branchId: row.branch_id,
      businessDate: row.business_date,
      recipeId: row.recipe_id,
      recipeName: row.recipe_name,
      recipeVersionId: row.recipe_version_id,
      recipeVersion: row.recipe_version,
      currentRecipeVersionId: row.current_version_id,
      outputItemId: row.output_item_id,
      outputItemName: row.output_item_name,
      defaultWarehouseId: row.default_warehouse_id,
      yieldQuantityMicro: row.yield_quantity_minor,
      yieldUnitId: row.yield_unit_id,
      yieldUnitSymbol: row.yield_unit_symbol,
      forecastRequiredMicro: row.forecast_required_minor,
      preparedAvailableMicro: row.prepared_available_minor,
      safetyBufferMicro: row.safety_buffer_minor,
      recommendedBatchMicro: row.recommended_batch_minor,
      targetQuantityMicro: row.target_quantity_minor,
      effectiveTargetMicro: row.target_quantity_minor ?? row.recommended_batch_minor,
      dueAt: row.due_at,
      stationId: row.station_id,
      stationName: row.station_name,
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      productionBatchId: row.production_batch_id,
      productionStatus: row.production_status,
      actualOutputQuantityMicro: row.actual_output_quantity_minor,
      status: row.status,
      quality: row.quality,
      explanation: parseObject(row.explanation_json),
      adjustmentReason: row.adjustment_reason,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      dismissedBy: row.dismissed_by,
      dismissedAt: row.dismissed_at,
      dismissalReason: row.dismissal_reason,
      revision: row.revision,
      generatedAt: row.generated_at,
      updatedAt: row.updated_at,
      recipeVersionCurrent: row.current_version_id === row.recipe_version_id,
      cookbook,
      cookbookPublished: Boolean(cookbook?.method.length),
      ingredients,
    };
  }

  private async scaledIngredients(row: PrepRow) {
    const components = await this.db
      .prepare(
        "SELECT c.id,c.inventory_item_id,c.sub_recipe_id,c.quantity_minor,c.unit_id," +
          " c.waste_factor_bps,c.optional,u.symbol AS unit_symbol,i.name AS inventory_item_name," +
          " s.name AS sub_recipe_name FROM recipe_version_components c" +
          " LEFT JOIN unit_definitions u ON u.tenant_id=c.tenant_id AND u.id=c.unit_id" +
          " LEFT JOIN inventory_items i ON i.tenant_id=c.tenant_id AND i.id=c.inventory_item_id" +
          " LEFT JOIN recipes s ON s.tenant_id=c.tenant_id AND s.id=c.sub_recipe_id" +
          " WHERE c.tenant_id=? AND c.recipe_version_id=?" +
          " ORDER BY COALESCE(i.name,s.name),c.id",
      )
      .bind(this.actor.tenantId, row.recipe_version_id)
      .all<{
        id: string;
        inventory_item_id: string | null;
        sub_recipe_id: string | null;
        quantity_minor: number;
        unit_id: string;
        waste_factor_bps: number;
        optional: number;
        unit_symbol: string | null;
        inventory_item_name: string | null;
        sub_recipe_name: string | null;
      }>();
    const target = row.target_quantity_minor ?? row.recommended_batch_minor;
    return (components.results ?? []).map((component) => {
      const scaled =
        target > 0 && row.yield_quantity_minor > 0
          ? multiplyDivide(
              component.quantity_minor,
              target,
              row.yield_quantity_minor,
              "scaled prep ingredient",
            )
          : 0;
      const withWaste =
        scaled > 0 && component.waste_factor_bps > 0
          ? multiplyDivide(
              scaled,
              BASIS_POINTS_SCALE + component.waste_factor_bps,
              BASIS_POINTS_SCALE,
              "scaled prep ingredient with process loss",
            )
          : scaled;
      return {
        id: component.id,
        inventoryItemId: component.inventory_item_id,
        subRecipeId: component.sub_recipe_id,
        name:
          component.inventory_item_name ??
          component.sub_recipe_name ??
          component.inventory_item_id ??
          component.sub_recipe_id ??
          "Unknown component",
        recipeQuantityMicro: component.quantity_minor,
        scaledQuantityMicro: scaled,
        requiredWithWasteMicro: withWaste,
        unitId: component.unit_id,
        unitSymbol: component.unit_symbol,
        wasteFactorBps: component.waste_factor_bps,
        optional: component.optional === 1,
      };
    });
  }

  private async publishedCookbook(recipeVersionId: string) {
    const row = await this.db
      .prepare(
        "SELECT id,revision,prep_minutes,cook_minutes,portion_label,image_url,chef_notes," +
          " method_json,media_json,source_document,source_reference,change_summary,created_at" +
          " FROM cookbook_recipe_content_versions WHERE tenant_id=? AND recipe_version_id=?" +
          " AND status='PUBLISHED' ORDER BY revision DESC LIMIT 1",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .first<CookbookRow>();
    if (!row) return null;
    return {
      id: row.id,
      revision: row.revision,
      prepMinutes: row.prep_minutes,
      cookMinutes: row.cook_minutes,
      portionLabel: row.portion_label,
      imageUrl: row.image_url,
      chefNotes: row.chef_notes,
      method: parseArray(row.method_json),
      media: parseArray(row.media_json),
      sourceDocument: row.source_document,
      sourceReference: row.source_reference,
      changeSummary: row.change_summary,
      publishedAt: row.created_at,
    };
  }

  private async recommendation(id: string) {
    const row = await this.db
      .prepare(
        "SELECT p.id,p.branch_id,p.business_date,p.recipe_id,r.name AS recipe_name," +
          " p.recipe_version_id,rv.version AS recipe_version,r.current_version_id," +
          " p.output_item_id,i.name AS output_item_name,i.default_warehouse_id," +
          " rv.yield_quantity_minor,rv.yield_unit_id,u.symbol AS yield_unit_symbol," +
          " p.forecast_required_minor,p.prepared_available_minor,p.safety_buffer_minor," +
          " p.recommended_batch_minor,p.target_quantity_minor,p.due_at,p.station_id," +
          " s.name AS station_name,p.warehouse_id,w.name AS warehouse_name,p.production_batch_id," +
          " b.status AS production_status,b.actual_output_quantity_minor,p.status,p.quality," +
          " p.explanation_json,p.adjustment_reason,p.approved_by,p.approved_at,p.started_at," +
          " p.completed_at,p.dismissed_by,p.dismissed_at,p.dismissal_reason,p.revision," +
          " p.generated_at,p.updated_at FROM production_prep_recommendations p" +
          " JOIN recipes r ON r.tenant_id=p.tenant_id AND r.id=p.recipe_id" +
          " JOIN recipe_versions rv ON rv.tenant_id=p.tenant_id AND rv.id=p.recipe_version_id" +
          " JOIN inventory_items i ON i.tenant_id=p.tenant_id AND i.id=p.output_item_id" +
          " LEFT JOIN unit_definitions u ON u.tenant_id=rv.tenant_id AND u.id=rv.yield_unit_id" +
          " LEFT JOIN stations s ON s.tenant_id=p.tenant_id AND s.id=p.station_id" +
          " LEFT JOIN warehouses w ON w.tenant_id=p.tenant_id AND w.id=p.warehouse_id" +
          " LEFT JOIN production_batches b ON b.tenant_id=p.tenant_id AND b.id=p.production_batch_id" +
          " WHERE p.tenant_id=? AND p.id=?",
      )
      .bind(this.actor.tenantId, id)
      .first<PrepRow>();
    if (!row) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Prep recommendation not found");
    }
    return row;
  }

  private authorizeRow(row: PrepRow) {
    authorizeBranchRead(this.actor, this.actor.tenantId, row.branch_id);
  }

  private async assertPublishedCookbook(recipeVersionId: string) {
    const cookbook = await this.publishedCookbook(recipeVersionId);
    if (!cookbook?.method.length) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Publish the Cookbook method for this exact recipe version before approving or starting prep",
      );
    }
  }

  private async assertCurrentRecipeVersion(row: PrepRow) {
    if (row.current_version_id !== row.recipe_version_id) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "This prep recommendation references an older recipe version; regenerate the prep plan",
      );
    }
  }

  private async assertWarehouse(branchId: string, warehouseId: string) {
    const warehouse = await this.db
      .prepare("SELECT id FROM warehouses WHERE tenant_id=? AND branch_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, branchId, warehouseId)
      .first<{ id: string }>();
    if (!warehouse) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        404,
        "Selected prep warehouse is unavailable for this branch",
      );
    }
  }

  private async assertStation(branchId: string, stationId: string | null) {
    if (!stationId) return;
    const station = await this.db
      .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, branchId, stationId)
      .first<{ id: string }>();
    if (!station) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        404,
        "Selected prep station is unavailable for this branch",
      );
    }
  }

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission as never)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        permission + " permission is required",
      );
    }
  }

  private assertChanged(changes: number | undefined, message: string) {
    if (Number(changes ?? 0) !== 1) {
      throw new ServerOperationError("CONFLICT", 409, message);
    }
  }

  private async audit(
    action: string,
    entityId: string,
    branchId: string,
    stamp: string,
    metadata: Record<string, unknown>,
  ) {
    await this.auditStatement(action, entityId, branchId, stamp, metadata).run();
  }

  private auditStatement(
    action: string,
    entityId: string,
    branchId: string,
    stamp: string,
    metadata: Record<string, unknown>,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        "INSERT INTO audit_events" +
          " (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason," +
          " correlation_id,session_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        "PRODUCTION_PREP_RECOMMENDATION",
        entityId,
        null,
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        JSON.stringify(metadata),
        stamp,
      );
  }
}

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ServerOperationError("VALIDATION_FAILED", 400, label + " must be a positive integer");
  }
}

function transition(message: string) {
  return new ServerOperationError("INVALID_STATE_TRANSITION", 409, message);
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
