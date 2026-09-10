import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import {
  average,
  basisPoints,
  evaluateThreshold,
  financialQuality,
  healthFromSeverities,
  median,
  menuClassification,
  multiplyRatio,
  percentile,
  qualityFromReasons,
} from "@/management/calculations";
import type {
  AnalyticsQuality,
  ApprovalInboxItem,
  BranchHealth,
  BranchTargetInput,
  ChannelMetric,
  CloseReadiness,
  DailyBranchMetric,
  FinancialSummary,
  FoodCostBridge,
  InventoryGlReconciliation,
  ManagementAction,
  ManagementActionStatus,
  ManagementControlCentre,
  ManagementSeverity,
  MenuMetric,
  OwnerControlCentre,
  StaffMetric,
  StationMetric,
  SupplierMetric,
  ThresholdPolicyInput,
} from "@/management/types";
import { permissions } from "@/platform/permissions";
import { authoritativeBusinessDate } from "@/server/business-date";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

type BranchRow = { id: string; name: string; currency: string };
type ManagementRowKey =
  | "accepted_purchase_quantity_minor"
  | "account_id"
  | "account_type"
  | "accounting_mode"
  | "action_type"
  | "amount_minor"
  | "approved_discounts"
  | "assigned_role_id"
  | "assigned_user_id"
  | "average_fulfilment_ms"
  | "average_lead_time_minutes"
  | "average_order_value_minor"
  | "average_prep_ms"
  | "average_prep_time_ms"
  | "average_ready_pickup_ms"
  | "average_service_ms"
  | "balance_minor"
  | "blocker_count"
  | "blockers_json"
  | "branch_id"
  | "branch_name"
  | "business_date"
  | "business_day_cutoff_minutes"
  | "calculated_at"
  | "cancellation_bps"
  | "cancelled_count"
  | "category"
  | "channel_code"
  | "channel_id"
  | "channel_key"
  | "channel_label"
  | "channel_payload"
  | "channel_type"
  | "charge_type"
  | "classification"
  | "clock_in_at"
  | "clock_out_at"
  | "code"
  | "cogs_account_id"
  | "cogs_minor"
  | "commission_minor"
  | "comparison"
  | "completed_count"
  | "connection_id"
  | "contribution_bps"
  | "contribution_minor"
  | "correlation_id"
  | "created_at"
  | "currency"
  | "default_currency"
  | "delivery_fees_minor"
  | "difference_minor"
  | "discounts_minor"
  | "displayName"
  | "effective_from"
  | "effective_to"
  | "employee_id"
  | "employee_number"
  | "employee_payload"
  | "evidence_json"
  | "expected_at"
  | "fill_rate_bps"
  | "first_detected_at"
  | "flash_operating_result_minor"
  | "food_cost_bps"
  | "fullName"
  | "gl_value_minor"
  | "gross_margin_bps"
  | "gross_profit_minor"
  | "gross_sales_minor"
  | "id"
  | "inventory_account_id"
  | "inventory_variance_minor"
  | "invoice_match_exceptions"
  | "labour_cost_bps"
  | "labour_cost_minor"
  | "last_detected_at"
  | "late_count"
  | "late_minutes"
  | "managementCategory"
  | "marketplace_commission_minor"
  | "median_prep_ms"
  | "menu_item_id"
  | "metric_code"
  | "metric_value"
  | "movement_type"
  | "name"
  | "net_revenue_minor"
  | "net_sales_minor"
  | "on_time_bps"
  | "operating_expenses_minor"
  | "order_count"
  | "order_id"
  | "orders_handled"
  | "outstanding_payable_minor"
  | "p90_prep_ms"
  | "payload_json"
  | "payment_processing_fees_minor"
  | "payment_variance_minor"
  | "period_end"
  | "period_start"
  | "period_type"
  | "price_variance_minor"
  | "provider_fees_minor"
  | "purchase_order_id"
  | "purchase_value_minor"
  | "quality"
  | "quality_reasons_json"
  | "quantity_sold"
  | "received_at"
  | "received_purchase_quantity_minor"
  | "refund_bps"
  | "refund_count"
  | "refund_involvement"
  | "refunds_minor"
  | "rejected_quantity_micro"
  | "reopen_after_minutes"
  | "reportingCategory"
  | "requested_at"
  | "resolution_note"
  | "resolved_at"
  | "return_value_minor"
  | "sales_mix_bps"
  | "service_charge_minor"
  | "settlement_difference_minor"
  | "severity"
  | "shift_count"
  | "source_id"
  | "source_type"
  | "source_updated_at"
  | "station_id"
  | "station_name"
  | "station_payload"
  | "status"
  | "subledger_value_minor"
  | "supplier_id"
  | "supplier_name"
  | "target_value"
  | "tax_minor"
  | "theoretical_cost_minor"
  | "threshold_value"
  | "throughput_per_hour_milli"
  | "ticket_count"
  | "timezone"
  | "tolerance_minor"
  | "total_cost_minor"
  | "total_minor"
  | "updated_at"
  | "value_unit"
  | "variance_minor"
  | "void_requests"
  | "warehouse_id"
  | "warning_count"
  | "wastage_minor"
  | "worked_minutes";
type JsonRow = Partial<Record<ManagementRowKey, unknown>> & Record<string, unknown>;
type MetricValue = { value: number; unit: string; sourceType: string; sourceId: string };

const RESOLVED_ACTION_STATUSES = ["RESOLVED", "DISMISSED"];
const CLOSED_INVOICE_STATUSES = ["PAID", "PARTIALLY_PAID", "ON_ACCOUNT", "CLOSED"];

export class ManagementIntelligenceService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async upsertThreshold(input: ThresholdPolicyInput) {
    this.requirePermission(permissions.managementTargetsManage);
    if (input.branchId) authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO metric_threshold_policies
            (tenant_id,id,branch_id,metric_code,comparison,severity,threshold_value,value_unit,
             effective_from,effective_to,reopen_after_minutes,active,payload_json,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'{}',?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET
             branch_id=excluded.branch_id,metric_code=excluded.metric_code,
             comparison=excluded.comparison,severity=excluded.severity,
             threshold_value=excluded.threshold_value,value_unit=excluded.value_unit,
             effective_from=excluded.effective_from,effective_to=excluded.effective_to,
             reopen_after_minutes=excluded.reopen_after_minutes,active=1,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.metricCode,
          input.comparison,
          input.severity,
          input.thresholdValue,
          input.valueUnit,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          input.reopenAfterMinutes ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement(
        "MANAGEMENT_THRESHOLD_CHANGED",
        "METRIC_THRESHOLD_POLICY",
        id,
        input.branchId,
        correlationId,
        stamp,
        { metricCode: input.metricCode },
      ),
    ]);
    return { id, ...input, updatedAt: stamp };
  }

  async upsertTarget(input: BranchTargetInput) {
    this.requirePermission(permissions.managementTargetsManage);
    if (input.branchId) authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO branch_targets
            (tenant_id,id,branch_id,metric_code,target_value,value_unit,effective_from,effective_to,
             active,payload_json,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,1,'{}',?,?,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET
             branch_id=excluded.branch_id,metric_code=excluded.metric_code,
             target_value=excluded.target_value,value_unit=excluded.value_unit,
             effective_from=excluded.effective_from,effective_to=excluded.effective_to,
             active=1,updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.metricCode,
          input.targetValue,
          input.valueUnit,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.auditStatement(
        "MANAGEMENT_TARGET_CHANGED",
        "BRANCH_TARGET",
        id,
        input.branchId,
        correlationId,
        stamp,
        { metricCode: input.metricCode },
      ),
    ]);
    return { id, ...input, updatedAt: stamp };
  }

  async transitionAction(id: string, status: ManagementActionStatus, note: string) {
    this.requirePermission(permissions.managementActionsManage);
    const action = await this.db
      .prepare(`SELECT id,branch_id,status FROM management_actions WHERE tenant_id=? AND id=?`)
      .bind(this.actor.tenantId, id)
      .first<{ id: string; branch_id: string | null; status: ManagementActionStatus }>();
    if (!action)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Management action not found");
    if (action.branch_id) authorizeBranchRead(this.actor, this.actor.tenantId, action.branch_id);
    if (!validActionTransition(action.status, status)) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        `Management action cannot move from ${action.status} to ${status}`,
      );
    }
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE management_actions SET status=?,resolution_note=?,
             resolved_at=?,resolution_actor_id=?,version=version+1,updated_at=?
           WHERE tenant_id=? AND id=? AND status=?`,
        )
        .bind(
          status,
          note,
          RESOLVED_ACTION_STATUSES.includes(status) ? stamp : null,
          RESOLVED_ACTION_STATUSES.includes(status) ? this.actor.id : null,
          stamp,
          this.actor.tenantId,
          id,
          action.status,
        ),
      this.db
        .prepare(
          `INSERT INTO management_action_events
            (tenant_id,id,management_action_id,event_type,actor_id,note,evidence_json,correlation_id,created_at)
           VALUES (?,?,?,?,?,?,'{}',?,?)`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          id,
          status,
          this.actor.id,
          note,
          correlationId,
          stamp,
        ),
      this.auditStatement(
        "MANAGEMENT_ACTION_TRANSITIONED",
        "MANAGEMENT_ACTION",
        id,
        action.branch_id ?? undefined,
        correlationId,
        stamp,
        { from: action.status, to: status },
      ),
    ]);
    return { id, status, note, updatedAt: stamp };
  }

  async recalculateTenant(branchId?: string, businessDate?: string) {
    if (!this.isSystemActor()) this.requirePermission(permissions.managementTargetsManage);
    const branches = await this.authorizedBranches(branchId);
    const results = [];
    for (const branch of branches) {
      const date = businessDate ?? (await this.serverBusinessDate(branch.id));
      results.push(await this.recalculateBranch(branch, date));
    }
    return {
      tenantId: this.actor.tenantId,
      branches: results,
      calculatedAt: new Date().toISOString(),
    };
  }

  async controlCentre(input: {
    branchId: string;
    periodStart?: string;
    periodEnd?: string;
    limit?: number;
  }): Promise<ManagementControlCentre> {
    this.requirePermission(permissions.managementView);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const periodEnd = input.periodEnd ?? (await this.serverBusinessDate(input.branchId));
    const periodStart = input.periodStart ?? addDays(periodEnd, -6);
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const [
      trendRows,
      flashRow,
      actions,
      channels,
      stations,
      staff,
      suppliers,
      menu,
      gl,
      close,
      health,
      approvals,
    ] = await Promise.all([
      this.db
        .prepare(
          `SELECT m.*,b.name AS branch_name FROM daily_branch_metrics m
             JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
             WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date BETWEEN ? AND ?
             ORDER BY m.business_date`,
        )
        .bind(this.actor.tenantId, input.branchId, periodStart, periodEnd)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM financial_summary_periods WHERE tenant_id=? AND branch_id=?
             AND period_type='DAY' AND period_end=?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd)
        .first<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM management_actions WHERE tenant_id=? AND branch_id=?
             AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')
             ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
               WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,last_detected_at DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM daily_channel_metrics WHERE tenant_id=? AND branch_id=? AND business_date=?
             ORDER BY contribution_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT m.*,s.name AS station_name FROM daily_station_metrics m
             JOIN stations s ON s.tenant_id=m.tenant_id AND s.id=m.station_id
             WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date=?
             ORDER BY m.average_prep_ms DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT m.*,e.payload_json AS employee_payload FROM daily_staff_metrics m
             JOIN employees e ON e.tenant_id=m.tenant_id AND e.id=m.employee_id
             WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date=?
             ORDER BY m.net_sales_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT m.*,s.name AS supplier_name FROM daily_supplier_metrics m
             JOIN suppliers s ON s.tenant_id=m.tenant_id AND s.id=m.supplier_id
             WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date=?
             ORDER BY m.purchase_value_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM daily_menu_item_metrics WHERE tenant_id=? AND branch_id=? AND business_date=?
             ORDER BY contribution_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd, limit)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM inventory_gl_reconciliations WHERE tenant_id=? AND branch_id=?
             AND business_date=? ORDER BY calculated_at DESC LIMIT 1`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd)
        .first<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM close_readiness_snapshots WHERE tenant_id=? AND branch_id=? AND business_date=?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd)
        .first<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM branch_health_snapshots WHERE tenant_id=? AND branch_id=? AND business_date=?`,
        )
        .bind(this.actor.tenantId, input.branchId, periodEnd)
        .first<JsonRow>(),
      this.db
        .prepare(
          `SELECT * FROM approval_inbox_items WHERE tenant_id=? AND branch_id=?
             ORDER BY requested_at LIMIT ?`,
        )
        .bind(this.actor.tenantId, input.branchId, limit)
        .all<JsonRow>(),
    ]);
    this.requirePermission(permissions.managementFinanceView);
    const trend = (trendRows.results ?? []).map(mapDailyBranchMetric);
    const targets = await this.effectiveTargets(input.branchId, periodEnd);
    return {
      branchId: input.branchId,
      periodStart,
      periodEnd,
      latest: trend.at(-1) ?? null,
      trend,
      flashPnl: flashRow ? mapFinancialSummary(flashRow) : null,
      actions: (actions.results ?? []).map(mapManagementAction),
      channels: (channels.results ?? []).map(mapChannelMetric),
      stations: (stations.results ?? []).map(mapStationMetric),
      staff: (staff.results ?? []).map(mapStaffMetric),
      suppliers: (suppliers.results ?? []).map(mapSupplierMetric),
      menu: (menu.results ?? []).map(mapMenuMetric),
      inventoryGl: gl ? mapInventoryGl(gl) : null,
      closeReadiness: close ? mapCloseReadiness(close) : null,
      health: health ? mapBranchHealth(health) : null,
      approvals: (approvals.results ?? []).map(mapApproval),
      targets,
      generatedAt: new Date().toISOString(),
    };
  }

  async ownerControlCentre(periodStart?: string, periodEnd?: string): Promise<OwnerControlCentre> {
    this.requirePermission(permissions.managementView);
    this.requirePermission(permissions.managementFinanceView);
    const branches = await this.authorizedBranches();
    const end =
      periodEnd ?? (branches[0] ? await this.serverBusinessDate(branches[0].id) : isoDate());
    const start = periodStart ?? addDays(end, -6);
    const output: OwnerControlCentre["branches"] = [];
    for (const branch of branches) {
      const metricRow = await this.db
        .prepare(
          `SELECT m.*,b.name AS branch_name FROM daily_branch_metrics m
           JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
           WHERE m.tenant_id=? AND m.branch_id=? AND m.business_date BETWEEN ? AND ?
           ORDER BY m.business_date DESC LIMIT 1`,
        )
        .bind(this.actor.tenantId, branch.id, start, end)
        .first<JsonRow>();
      const healthRow = await this.db
        .prepare(
          `SELECT * FROM branch_health_snapshots WHERE tenant_id=? AND branch_id=?
           AND business_date<=? ORDER BY business_date DESC LIMIT 1`,
        )
        .bind(this.actor.tenantId, branch.id, end)
        .first<JsonRow>();
      const actionCount = await this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM management_actions WHERE tenant_id=? AND branch_id=?
           AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
        )
        .bind(this.actor.tenantId, branch.id)
        .first<{ count: number }>();
      output.push({
        metric: metricRow ? mapDailyBranchMetric(metricRow) : emptyDailyBranchMetric(branch, end),
        health: healthRow ? mapBranchHealth(healthRow) : null,
        openActionCount: Number(actionCount?.count ?? 0),
      });
    }
    return {
      periodStart: start,
      periodEnd: end,
      branches: output,
      generatedAt: new Date().toISOString(),
    };
  }

  async foodCostBridge(input: {
    branchId: string;
    currentStart: string;
    currentEnd: string;
    previousStart: string;
    previousEnd: string;
  }): Promise<FoodCostBridge> {
    this.requirePermission(permissions.managementFinanceView);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const [currentCost, previousCost, wastage, purchaseVariance, countVariance, yieldVariance] =
      await Promise.all([
        this.sumCogs(input.branchId, input.currentStart, input.currentEnd),
        this.sumCogs(input.branchId, input.previousStart, input.previousEnd),
        this.sumMovementCost(input.branchId, input.currentStart, input.currentEnd, [
          "WASTAGE",
          "EXPIRY",
        ]),
        this.sumReceiptPriceVariance(input.branchId, input.currentStart, input.currentEnd),
        this.sumMovementCost(input.branchId, input.currentStart, input.currentEnd, [
          "STOCK_COUNT_ADJUSTMENT",
        ]),
        this.sumProductionYieldVariance(input.branchId, input.currentStart, input.currentEnd),
      ]);
    const reasons: string[] = [];
    if (!currentCost.configured || !previousCost.configured)
      reasons.push("MISSING_COGS_ACCOUNT_MAPPING");
    const drivers = [
      {
        code: "SUPPLIER_PRICE_VARIANCE",
        label: "Supplier price variance",
        amountMinor: purchaseVariance,
        evidence: { source: "goods_receipt_lines.price_variance_minor" },
      },
      {
        code: "RECORDED_WASTAGE",
        label: "Recorded wastage",
        amountMinor: wastage,
        evidence: { source: "inventory_movements", movementTypes: ["WASTAGE", "EXPIRY"] },
      },
      {
        code: "INVENTORY_COUNT_VARIANCE",
        label: "Inventory count variance",
        amountMinor: countVariance,
        evidence: { source: "inventory_movements", movementType: "STOCK_COUNT_ADJUSTMENT" },
      },
      {
        code: "PRODUCTION_YIELD_VARIANCE",
        label: "Production yield variance",
        amountMinor: yieldVariance,
        evidence: { source: "production_batches" },
      },
    ].filter((driver) => driver.amountMinor !== 0);
    const changeMinor = currentCost.value - previousCost.value;
    const supported = drivers.reduce((total, driver) => total + driver.amountMinor, 0);
    return {
      branchId: input.branchId,
      previousPeriodStart: input.previousStart,
      previousPeriodEnd: input.previousEnd,
      currentPeriodStart: input.currentStart,
      currentPeriodEnd: input.currentEnd,
      previousCostMinor: previousCost.value,
      currentCostMinor: currentCost.value,
      changeMinor,
      drivers,
      unexplainedMinor: changeMinor - supported,
      quality: qualityFromReasons(reasons, { hasPrimaryFacts: currentCost.configured }),
      qualityReasons: reasons,
    };
  }

  private async recalculateBranch(branch: BranchRow, businessDate: string) {
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const facts = await this.calculateBranchFacts(branch, businessDate);
    const [channels, stations, staff, suppliers, menu, inventoryGl] = await Promise.all([
      this.calculateChannels(branch, businessDate, facts),
      this.calculateStations(branch, businessDate),
      this.calculateStaff(branch, businessDate),
      this.calculateSuppliers(branch, businessDate),
      this.calculateMenu(branch, businessDate),
      this.calculateInventoryGl(branch, businessDate),
    ]);
    const close = await this.calculateCloseReadiness(branch, businessDate, inventoryGl);
    const statements: D1PreparedStatement[] = [
      ...[
        "daily_channel_metrics",
        "daily_station_metrics",
        "daily_staff_metrics",
        "daily_supplier_metrics",
        "daily_menu_item_metrics",
      ].map((table) =>
        this.db
          .prepare(`DELETE FROM ${table} WHERE tenant_id=? AND branch_id=? AND business_date=?`)
          .bind(this.actor.tenantId, branch.id, businessDate),
      ),
      this.dailyBranchStatement(facts, stamp),
      ...channels.map((metric) => this.channelStatement(metric, stamp)),
      ...stations.map((metric) => this.stationStatement(metric, stamp)),
      ...staff.map((metric) => this.staffStatement(metric, stamp)),
      ...suppliers.map((metric) => this.supplierStatement(metric, stamp)),
      ...menu.map((metric) => this.menuStatement(branch.id, businessDate, metric, stamp)),
      this.inventoryGlStatement(inventoryGl, stamp),
      this.closeReadinessStatement(close, stamp),
    ];
    const summaries = await this.calculateFinancialSummaries(branch, businessDate, facts);
    statements.push(...summaries.map((summary) => this.financialSummaryStatement(summary, stamp)));
    await this.db.batch(statements);
    await this.refreshApprovalInbox(branch.id, stamp);
    await this.generateThresholdActions(
      branch.id,
      businessDate,
      facts,
      inventoryGl,
      stamp,
      correlationId,
    );
    const health = await this.calculateAndPersistHealth(
      branch.id,
      businessDate,
      facts.quality,
      stamp,
    );
    await this.db
      .prepare(
        `UPDATE management_recalculation_events SET status='PROCESSED',processed_at=?
         WHERE tenant_id=? AND status IN ('PENDING','CLAIMED') AND (branch_id=? OR branch_id IS NULL)`,
      )
      .bind(stamp, this.actor.tenantId, branch.id)
      .run();
    return { branchId: branch.id, businessDate, quality: facts.quality, health: health.status };
  }

  private async calculateBranchFacts(branch: BranchRow, businessDate: string) {
    const [invoiceResult, refundResult, mapping, movements, drawers, reconciliation] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT id,total_minor,status,payload_json FROM invoices
           WHERE tenant_id=? AND branch_id=? AND business_date=?`,
          )
          .bind(this.actor.tenantId, branch.id, businessDate)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT amount_minor,status,payload_json FROM payment_refunds
           WHERE tenant_id=? AND branch_id=? AND substr(updated_at,1,10)=?`,
          )
          .bind(this.actor.tenantId, branch.id, businessDate)
          .all<JsonRow>(),
        this.accountMapping(branch.id),
        this.db
          .prepare(
            `SELECT movement_type,quantity_minor,total_cost_minor,payload_json FROM inventory_movements
           WHERE tenant_id=? AND branch_id=? AND business_date=?`,
          )
          .bind(this.actor.tenantId, branch.id, businessDate)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT variance_minor FROM cash_drawer_sessions WHERE tenant_id=? AND branch_id=?
           AND substr(COALESCE(closed_at,opened_at),1,10)=? AND variance_minor IS NOT NULL`,
          )
          .bind(this.actor.tenantId, branch.id, businessDate)
          .all<{ variance_minor: number }>(),
        this.db
          .prepare(
            `SELECT amount_minor FROM reconciliation_exceptions WHERE tenant_id=? AND branch_id=?
           AND status NOT IN ('RESOLVED','DISMISSED')`,
          )
          .bind(this.actor.tenantId, branch.id)
          .all<{ amount_minor: number }>(),
      ]);
    const invoices = invoiceResult.results ?? [];
    let grossSalesMinor = 0;
    let discountsMinor = 0;
    let taxMinor = 0;
    let serviceChargeMinor = 0;
    for (const invoice of invoices) {
      const payload = parseJson(invoice.payload_json);
      const total = integer(invoice.total_minor);
      const tax = pickInteger(payload, ["taxMinor", "taxTotalMinor"]);
      const service = pickInteger(payload, ["serviceChargeMinor", "serviceChargeTotalMinor"]);
      const discount = pickInteger(payload, ["discountMinor", "discountTotalMinor"]);
      const gross = pickInteger(
        payload,
        ["grossSalesMinor", "subtotalMinor"],
        total - tax - service + discount,
      );
      grossSalesMinor += gross;
      discountsMinor += discount;
      taxMinor += tax;
      serviceChargeMinor += service;
    }
    const refundsMinor = (refundResult.results ?? [])
      .filter((refund) => ["CONFIRMED", "REFUNDED", "COMPLETED"].includes(String(refund.status)))
      .reduce((total, refund) => total + integer(refund.amount_minor), 0);
    const netSalesMinor = grossSalesMinor - discountsMinor - refundsMinor;
    const netRevenueMinor = netSalesMinor;
    const accounting = await this.accountMetrics(branch.id, businessDate, mapping);
    const cogsMinor = accounting.cogsMinor;
    const grossProfitMinor = netRevenueMinor - cogsMinor;
    const orderCount =
      invoices.filter((invoice) => CLOSED_INVOICE_STATUSES.includes(String(invoice.status)))
        .length || invoices.length;
    const movementRows = movements.results ?? [];
    const wastageMinor = movementRows
      .filter((movement) =>
        ["WASTAGE", "EXPIRY", "BREAKAGE"].includes(String(movement.movement_type)),
      )
      .reduce((total, movement) => total + Math.abs(integer(movement.total_cost_minor)), 0);
    const inventoryVarianceMinor = movementRows
      .filter((movement) => String(movement.movement_type) === "STOCK_COUNT_ADJUSTMENT")
      .reduce((total, movement) => total + integer(movement.total_cost_minor), 0);
    const paymentVarianceMinor =
      (drawers.results ?? []).reduce((total, row) => total + integer(row.variance_minor), 0) +
      (reconciliation.results ?? []).reduce((total, row) => total + integer(row.amount_minor), 0);
    const labor = await this.labourCost(branch.id, businessDate);
    const stationPrep = await this.branchPrepTime(branch.id, businessDate);
    const qualityReasons: string[] = [];
    if (!mapping) qualityReasons.push("MISSING_ACCOUNT_MAPPING");
    if (!labor.hasData) qualityReasons.push("MISSING_LABOUR_DATA");
    if (stationPrep.value === null) qualityReasons.push("MISSING_STATION_TIMESTAMPS");
    if (invoices.length === 0) qualityReasons.push("MISSING_SALES_FACTS");
    const quality = qualityFromReasons(qualityReasons, { hasPrimaryFacts: invoices.length > 0 });
    return {
      branchId: branch.id,
      branchName: branch.name,
      businessDate,
      currency: branch.currency,
      grossSalesMinor,
      discountsMinor,
      refundsMinor,
      netSalesMinor,
      taxMinor,
      serviceChargeMinor,
      netRevenueMinor,
      marketplaceCommissionMinor: accounting.marketplaceCommissionMinor,
      paymentProcessingFeesMinor: accounting.paymentProcessingFeesMinor,
      deliveryFeesMinor: accounting.deliveryFeesMinor,
      cogsMinor,
      grossProfitMinor,
      grossMarginBps: basisPoints(grossProfitMinor, netRevenueMinor),
      foodCostBps: basisPoints(cogsMinor, netRevenueMinor),
      labourCostMinor: labor.value,
      labourCostBps: basisPoints(labor.value, netRevenueMinor),
      operatingExpensesMinor: accounting.operatingExpensesMinor,
      contributionMinor:
        grossProfitMinor -
        labor.value -
        accounting.marketplaceCommissionMinor -
        accounting.paymentProcessingFeesMinor -
        accounting.deliveryFeesMinor,
      orderCount,
      averageOrderValueMinor: orderCount > 0 ? Math.trunc(netSalesMinor / orderCount) : 0,
      averagePrepTimeMs: stationPrep.value,
      paymentVarianceMinor,
      wastageMinor,
      inventoryVarianceMinor,
      quality,
      qualityReasons,
    } satisfies DailyBranchMetric & {
      marketplaceCommissionMinor: number;
      paymentProcessingFeesMinor: number;
      deliveryFeesMinor: number;
    };
  }

  private async accountMapping(branchId: string) {
    return this.db
      .prepare(
        `SELECT inventory_account_id,cogs_account_id,wastage_account_id,variance_account_id,
                accounting_mode FROM inventory_account_mappings
         WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL)
         ORDER BY CASE WHEN branch_id=? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(this.actor.tenantId, branchId, branchId)
      .first<{
        inventory_account_id: string;
        cogs_account_id: string;
        wastage_account_id: string;
        variance_account_id: string;
        accounting_mode: string;
      }>();
  }

  private async accountMetrics(
    branchId: string,
    businessDate: string,
    mapping: Awaited<ReturnType<ManagementIntelligenceService["accountMapping"]>>,
  ) {
    const result = await this.db
      .prepare(
        `SELECT jl.account_id,a.account_type,a.payload_json,
                COALESCE(SUM(jl.debit_minor-jl.credit_minor),0) AS balance_minor
         FROM journal_lines jl
         JOIN journal_entries je ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
         JOIN accounts a ON a.tenant_id=jl.tenant_id AND a.id=jl.account_id
         WHERE jl.tenant_id=? AND je.branch_id=? AND je.business_date=? AND je.status='POSTED'
         GROUP BY jl.account_id,a.account_type,a.payload_json`,
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .all<JsonRow>();
    let cogsMinor = 0;
    let marketplaceCommissionMinor = 0;
    let paymentProcessingFeesMinor = 0;
    let deliveryFeesMinor = 0;
    let operatingExpensesMinor = 0;
    for (const row of result.results ?? []) {
      const amount = integer(row.balance_minor);
      const payload = parseJson(row.payload_json);
      const category = String(payload["managementCategory"] ?? payload["reportingCategory"] ?? "");
      if (mapping && String(row.account_id) === mapping.cogs_account_id) cogsMinor += amount;
      else if (category === "COGS") cogsMinor += amount;
      else if (category === "MARKETPLACE_COMMISSION") marketplaceCommissionMinor += amount;
      else if (category === "PAYMENT_PROCESSING_FEE") paymentProcessingFeesMinor += amount;
      else if (category === "DELIVERY_FEE") deliveryFeesMinor += amount;
      else if (row.account_type === "EXPENSE") operatingExpensesMinor += amount;
    }
    const chargeResult = await this.db
      .prepare(
        `SELECT mc.charge_type,COALESCE(SUM(ABS(mc.amount_minor)),0) AS amount_minor
         FROM marketplace_charges mc JOIN orders o ON o.tenant_id=mc.tenant_id AND o.id=mc.order_id
         WHERE mc.tenant_id=? AND mc.branch_id=? AND o.business_date=? GROUP BY mc.charge_type`,
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .all<{ charge_type: string; amount_minor: number }>();
    for (const row of chargeResult.results ?? []) {
      const amount = integer(row.amount_minor);
      if (row.charge_type === "COMMISSION" && marketplaceCommissionMinor === 0) {
        marketplaceCommissionMinor += amount;
      } else if (
        ["PROVIDER_FEE", "SERVICE_FEE", "PAYMENT_FEE"].includes(row.charge_type) &&
        paymentProcessingFeesMinor === 0
      ) {
        paymentProcessingFeesMinor += amount;
      } else if (row.charge_type === "DELIVERY_FEE" && deliveryFeesMinor === 0) {
        deliveryFeesMinor += amount;
      }
    }
    return {
      cogsMinor,
      marketplaceCommissionMinor,
      paymentProcessingFeesMinor,
      deliveryFeesMinor,
      operatingExpensesMinor,
    };
  }

  private async labourCost(branchId: string, businessDate: string) {
    const result = await this.db
      .prepare(
        `SELECT a.clock_in_at,a.clock_out_at,a.payload_json,e.payload_json AS employee_payload
         FROM attendance a JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id
         WHERE a.tenant_id=? AND a.branch_id=? AND a.business_date=?`,
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .all<JsonRow>();
    let value = 0;
    let priced = 0;
    for (const row of result.results ?? []) {
      if (!row.clock_out_at) continue;
      const minutes = durationMinutes(String(row.clock_in_at), String(row.clock_out_at));
      const employee = parseJson(String(row.employee_payload ?? "{}"));
      const hourlyRate = pickInteger(employee, ["hourlyRateMinor", "labourHourlyRateMinor"], -1);
      if (hourlyRate < 0) continue;
      value += multiplyRatio(hourlyRate, minutes, 60);
      priced += 1;
    }
    return { value, hasData: (result.results ?? []).length > 0 && priced > 0 };
  }

  private async branchPrepTime(branchId: string, businessDate: string) {
    const result = await this.db
      .prepare(
        `SELECT oss.payload_json FROM order_station_status oss
         JOIN orders o ON o.tenant_id=oss.tenant_id AND o.id=oss.order_id
         WHERE oss.tenant_id=? AND o.branch_id=? AND o.business_date=?`,
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .all<{ payload_json: string }>();
    const durations = (result.results ?? [])
      .map((row) => stationTiming(parseJson(row.payload_json)).prepMs)
      .filter((value): value is number => value !== null);
    return { value: average(durations), sampleSize: durations.length };
  }

  private async calculateChannels(
    branch: BranchRow,
    businessDate: string,
    branchFacts: DailyBranchMetric & {
      marketplaceCommissionMinor: number;
      paymentProcessingFeesMinor: number;
      deliveryFeesMinor: number;
    },
  ): Promise<ChannelMetric[]> {
    const [ordersResult, chargesResult, cogsResult, settlementsResult] = await Promise.all([
      this.db
        .prepare(
          `SELECT o.id,o.channel_id,o.status,o.total_minor,o.payload_json,c.code AS channel_code,
                  c.channel_type,c.payload_json AS channel_payload
           FROM orders o LEFT JOIN order_channels c ON c.tenant_id=o.tenant_id AND c.id=o.channel_id
           WHERE o.tenant_id=? AND o.branch_id=? AND o.business_date=?`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT mc.order_id,mc.charge_type,mc.amount_minor FROM marketplace_charges mc
           JOIN orders o ON o.tenant_id=mc.tenant_id AND o.id=mc.order_id
           WHERE mc.tenant_id=? AND mc.branch_id=? AND o.business_date=?`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT source_id,COALESCE(SUM(ABS(total_cost_minor)),0) AS cogs_minor
           FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND business_date=?
             AND movement_type='SALE_CONSUMPTION' GROUP BY source_id`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate)
        .all<{ source_id: string; cogs_minor: number }>(),
      this.db
        .prepare(
          `SELECT connection_id,COALESCE(SUM(net_settled_minor-net_expected_minor),0) AS difference_minor
           FROM settlement_batches WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL)
             AND period_start<=? AND period_end>=? GROUP BY connection_id`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate, businessDate)
        .all<{ connection_id: string; difference_minor: number }>(),
    ]);
    const charges = groupRows(chargesResult.results ?? [], (row) => String(row.order_id));
    const cogs = new Map(
      (cogsResult.results ?? []).map((row) => [row.source_id, integer(row.cogs_minor)]),
    );
    const settlements = new Map(
      (settlementsResult.results ?? []).map((row) => [
        row.connection_id,
        integer(row.difference_minor),
      ]),
    );
    const groups = groupRows(ordersResult.results ?? [], (row) =>
      String(row.channel_id ?? "UNASSIGNED"),
    );
    const metrics: ChannelMetric[] = [];
    for (const [channelKey, orders] of groups) {
      const channelPayload = parseJson(String(orders[0]?.channel_payload ?? "{}"));
      const channelId = channelKey === "UNASSIGNED" ? null : channelKey;
      const label = String(
        channelPayload["displayName"] ?? orders[0]?.channel_code ?? "Unassigned channel",
      );
      let grossSalesMinor = 0;
      let discountsMinor = 0;
      let refundsMinor = 0;
      let commissionMinor = 0;
      let providerFeesMinor = 0;
      let deliveryFeesMinor = 0;
      let cogsMinor = 0;
      let cancelledCount = 0;
      let refundCount = 0;
      const fulfilment: number[] = [];
      for (const order of orders) {
        const payload = parseJson(order.payload_json);
        const total = integer(order.total_minor);
        grossSalesMinor += pickInteger(payload, ["grossSalesMinor", "subtotalMinor"], total);
        discountsMinor += pickInteger(payload, ["discountMinor", "discountTotalMinor"]);
        refundsMinor += pickInteger(payload, ["refundMinor", "refundTotalMinor"]);
        if (pickInteger(payload, ["refundMinor", "refundTotalMinor"]) > 0) refundCount += 1;
        if (["CANCELLED", "VOIDED", "REJECTED"].includes(String(order.status))) cancelledCount += 1;
        const acceptedAt = pickString(payload, ["acceptedAt", "createdAt"]);
        const completedAt = pickString(payload, ["completedAt", "readyAt"]);
        if (acceptedAt && completedAt) fulfilment.push(durationMs(acceptedAt, completedAt));
        cogsMinor += cogs.get(String(order.id)) ?? 0;
        for (const charge of charges.get(String(order.id)) ?? []) {
          const amount = Math.abs(integer(charge.amount_minor));
          if (charge.charge_type === "COMMISSION") commissionMinor += amount;
          else if (
            ["PROVIDER_FEE", "SERVICE_FEE", "PAYMENT_FEE"].includes(String(charge.charge_type))
          ) {
            providerFeesMinor += amount;
          } else if (charge.charge_type === "DELIVERY_FEE") deliveryFeesMinor += amount;
        }
      }
      const netSalesMinor = grossSalesMinor - discountsMinor - refundsMinor;
      const reasons: string[] = [];
      if (cogsMinor === 0 && netSalesMinor > 0) reasons.push("MISSING_ORDER_COGS");
      const connectionId = pickString(channelPayload, ["providerConnectionId", "connectionId"]);
      const marketplace = String(orders[0]?.channel_type) === "MARKETPLACE";
      if (marketplace && !connectionId) reasons.push("MISSING_SETTLEMENT_MAPPING");
      if (marketplace && connectionId && !settlements.has(connectionId)) {
        reasons.push("MISSING_SETTLEMENT_FACTS");
      }
      const contributionMinor =
        netSalesMinor - cogsMinor - commissionMinor - providerFeesMinor - deliveryFeesMinor;
      metrics.push({
        branchId: branch.id,
        businessDate,
        channelKey,
        channelId,
        channelLabel: label,
        currency: branch.currency,
        orderCount: orders.length,
        cancelledCount,
        refundCount,
        grossSalesMinor,
        discountsMinor,
        refundsMinor,
        netSalesMinor,
        commissionMinor,
        providerFeesMinor,
        deliveryFeesMinor,
        cogsMinor,
        contributionMinor,
        contributionBps: basisPoints(contributionMinor, netSalesMinor),
        averageOrderValueMinor: orders.length ? Math.trunc(netSalesMinor / orders.length) : 0,
        cancellationBps: basisPoints(cancelledCount, orders.length),
        refundBps: basisPoints(refundCount, orders.length),
        averageFulfilmentMs: average(fulfilment),
        settlementDifferenceMinor:
          connectionId && settlements.has(connectionId) ? settlements.get(connectionId)! : null,
        quality: qualityFromReasons(reasons, { hasPrimaryFacts: orders.length > 0 }),
        qualityReasons: reasons,
      });
    }
    if (metrics.length === 0 && branchFacts.orderCount > 0) {
      metrics.push({
        branchId: branch.id,
        businessDate,
        channelKey: "UNASSIGNED",
        channelId: null,
        channelLabel: "Unassigned channel",
        currency: branch.currency,
        orderCount: branchFacts.orderCount,
        cancelledCount: 0,
        refundCount: 0,
        grossSalesMinor: branchFacts.grossSalesMinor,
        discountsMinor: branchFacts.discountsMinor,
        refundsMinor: branchFacts.refundsMinor,
        netSalesMinor: branchFacts.netSalesMinor,
        commissionMinor: branchFacts.marketplaceCommissionMinor,
        providerFeesMinor: branchFacts.paymentProcessingFeesMinor,
        deliveryFeesMinor: branchFacts.deliveryFeesMinor,
        cogsMinor: branchFacts.cogsMinor,
        contributionMinor: branchFacts.contributionMinor,
        contributionBps: basisPoints(branchFacts.contributionMinor, branchFacts.netSalesMinor),
        averageOrderValueMinor: branchFacts.averageOrderValueMinor,
        cancellationBps: 0,
        refundBps: 0,
        averageFulfilmentMs: null,
        settlementDifferenceMinor: null,
        quality: "LOW",
        qualityReasons: ["MISSING_ORDER_CHANNEL_FACTS"],
      });
    }
    return metrics;
  }

  private async calculateStations(
    branch: BranchRow,
    businessDate: string,
  ): Promise<StationMetric[]> {
    const result = await this.db
      .prepare(
        `SELECT s.id AS station_id,s.name AS station_name,s.payload_json AS station_payload,
                oss.status,oss.payload_json
         FROM stations s LEFT JOIN order_station_status oss
           ON oss.tenant_id=s.tenant_id AND oss.station_id=s.id
         LEFT JOIN orders o ON o.tenant_id=oss.tenant_id AND o.id=oss.order_id
           AND o.branch_id=s.branch_id AND o.business_date=?
         WHERE s.tenant_id=? AND s.branch_id=? AND s.active=1
           AND (o.id IS NOT NULL OR oss.order_id IS NULL)`,
      )
      .bind(businessDate, this.actor.tenantId, branch.id)
      .all<JsonRow>();
    const groups = groupRows(result.results ?? [], (row) => String(row.station_id));
    return [...groups.values()].map((rows) => {
      const prep: number[] = [];
      const pickup: number[] = [];
      let completed = 0;
      let late = 0;
      for (const row of rows) {
        if (!row.status) continue;
        if (["READY", "COMPLETED", "SERVED", "PICKED_UP"].includes(String(row.status)))
          completed += 1;
        const timing = stationTiming(parseJson(row.payload_json));
        if (timing.prepMs !== null) prep.push(timing.prepMs);
        if (timing.readyPickupMs !== null) pickup.push(timing.readyPickupMs);
        const stationPayload = parseJson(String(row.station_payload ?? "{}"));
        const targetMs = pickInteger(stationPayload, ["targetPrepTimeMs", "prepTargetMs"], 0);
        if (targetMs > 0 && timing.prepMs !== null && timing.prepMs > targetMs) late += 1;
      }
      const ticketCount = rows.filter((row) => row.status).length;
      const reasons =
        prep.length === ticketCount && ticketCount > 0 ? [] : ["MISSING_STATION_TIMESTAMPS"];
      const minStarted = rows
        .map((row) => pickString(parseJson(row.payload_json), ["startedAt", "acceptedAt"]))
        .filter((value): value is string => Boolean(value))
        .sort()[0];
      const maxReady = rows
        .map((row) => pickString(parseJson(row.payload_json), ["readyAt", "completedAt"]))
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1);
      const hours =
        minStarted && maxReady ? Math.max(1, durationMs(minStarted, maxReady) / 3_600_000) : 0;
      return {
        branchId: branch.id,
        businessDate,
        stationId: String(rows[0]?.station_id),
        stationName: String(rows[0]?.station_name ?? "Station"),
        ticketCount,
        completedCount: completed,
        lateCount: late,
        averagePrepMs: average(prep),
        medianPrepMs: median(prep),
        p90PrepMs: percentile(prep, 90),
        averageReadyPickupMs: average(pickup),
        throughputPerHourMilli: hours > 0 ? Math.trunc((completed * 1_000) / hours) : null,
        quality: qualityFromReasons(reasons, { hasPrimaryFacts: ticketCount > 0 }),
        qualityReasons: reasons,
      };
    });
  }

  private async calculateStaff(branch: BranchRow, businessDate: string): Promise<StaffMetric[]> {
    const [attendance, orders] = await Promise.all([
      this.db
        .prepare(
          `SELECT a.employee_id,a.clock_in_at,a.clock_out_at,a.payload_json,
                  e.payload_json AS employee_payload,e.employee_number
           FROM attendance a JOIN employees e ON e.tenant_id=a.tenant_id AND e.id=a.employee_id
           WHERE a.tenant_id=? AND a.branch_id=? AND a.business_date=?`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate)
        .all<JsonRow>(),
      this.db
        .prepare(
          `SELECT total_minor,payload_json FROM orders WHERE tenant_id=? AND branch_id=? AND business_date=?`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate)
        .all<JsonRow>(),
    ]);
    const ordersByEmployee = groupRows(orders.results ?? [], (row) => {
      const payload = parseJson(row.payload_json);
      return pickString(payload, ["employeeId", "servedByEmployeeId", "cashierId"]) ?? "UNASSIGNED";
    });
    const attendanceGroups = groupRows(attendance.results ?? [], (row) => String(row.employee_id));
    const output: StaffMetric[] = [];
    for (const [employeeId, rows] of attendanceGroups) {
      let workedMinutes = 0;
      let lateMinutes = 0;
      let labourCostMinor = 0;
      let priced = 0;
      for (const row of rows) {
        const minutes = row.clock_out_at
          ? durationMinutes(String(row.clock_in_at), String(row.clock_out_at))
          : 0;
        workedMinutes += minutes;
        const attendancePayload = parseJson(row.payload_json);
        lateMinutes += pickInteger(attendancePayload, ["lateMinutes"]);
        const employeePayload = parseJson(String(row.employee_payload ?? "{}"));
        const hourlyRate = pickInteger(
          employeePayload,
          ["hourlyRateMinor", "labourHourlyRateMinor"],
          -1,
        );
        if (hourlyRate >= 0 && minutes > 0) {
          labourCostMinor += multiplyRatio(hourlyRate, minutes, 60);
          priced += 1;
        }
      }
      const employeeOrders = ordersByEmployee.get(employeeId) ?? [];
      const netSalesMinor = employeeOrders.reduce(
        (total, order) => total + integer(order.total_minor),
        0,
      );
      const serviceDurations = employeeOrders
        .map((order) => {
          const payload = parseJson(order.payload_json);
          const opened = pickString(payload, ["openedAt", "createdAt"]);
          const served = pickString(payload, ["servedAt", "completedAt"]);
          return opened && served ? durationMs(opened, served) : null;
        })
        .filter((value): value is number => value !== null);
      const employeePayload = parseJson(String(rows[0]?.employee_payload ?? "{}"));
      const reasons: string[] = [];
      if (priced < rows.length) reasons.push("MISSING_LABOUR_RATE");
      if (employeeOrders.length === 0) reasons.push("MISSING_ORDER_STAFF_ASSIGNMENT");
      output.push({
        branchId: branch.id,
        businessDate,
        employeeId,
        employeeName: String(
          employeePayload["name"] ??
            employeePayload["fullName"] ??
            rows[0]?.employee_number ??
            employeeId,
        ),
        shiftCount: rows.length,
        workedMinutes,
        lateMinutes,
        labourCostMinor,
        ordersHandled: employeeOrders.length,
        netSalesMinor,
        averageOrderValueMinor:
          employeeOrders.length > 0 ? Math.trunc(netSalesMinor / employeeOrders.length) : 0,
        averageServiceMs: average(serviceDurations),
        voidRequests: countOrderFlag(employeeOrders, "voidRequested"),
        approvedDiscounts: countOrderFlag(employeeOrders, "discountApproved"),
        refundInvolvement: countOrderFlag(employeeOrders, "refundInvolved"),
        quality: qualityFromReasons(reasons, { hasPrimaryFacts: rows.length > 0 }),
        qualityReasons: reasons,
      });
    }
    return output;
  }

  private async calculateSuppliers(
    branch: BranchRow,
    businessDate: string,
  ): Promise<SupplierMetric[]> {
    const suppliers = await this.db
      .prepare(
        `SELECT id,name,currency FROM suppliers WHERE tenant_id=? AND active=1 ORDER BY name`,
      )
      .bind(this.actor.tenantId)
      .all<{ id: string; name: string; currency: string | null }>();
    const output: SupplierMetric[] = [];
    for (const supplier of suppliers.results ?? []) {
      const [orders, receipts, lines, returns, matches, invoices] = await Promise.all([
        this.db
          .prepare(
            `SELECT id,total_minor,expected_at,created_at,received_at FROM purchase_orders
             WHERE tenant_id=? AND branch_id=? AND supplier_id=? AND substr(created_at,1,10)<=?`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT id,purchase_order_id,received_at FROM goods_receipts
             WHERE tenant_id=? AND branch_id=? AND supplier_id=? AND business_date=?`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT grl.accepted_purchase_quantity_minor,grl.rejected_purchase_quantity_minor,
                    grl.received_purchase_quantity_minor,grl.total_cost_minor,grl.price_variance_minor
             FROM goods_receipt_lines grl JOIN goods_receipts gr
               ON gr.tenant_id=grl.tenant_id AND gr.id=grl.goods_receipt_id
             WHERE grl.tenant_id=? AND gr.branch_id=? AND gr.supplier_id=? AND gr.business_date=?`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT total_cost_minor FROM supplier_returns WHERE tenant_id=? AND branch_id=?
             AND supplier_id=? AND business_date=? AND status<>'CANCELLED'`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<{ total_cost_minor: number }>(),
        this.db
          .prepare(
            `SELECT pm.status FROM procurement_matches pm JOIN purchase_orders po
               ON po.tenant_id=pm.tenant_id AND po.id=pm.purchase_order_id
             WHERE pm.tenant_id=? AND po.branch_id=? AND po.supplier_id=?
               AND substr(pm.updated_at,1,10)<=?`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<{ status: string }>(),
        this.db
          .prepare(
            `SELECT total_minor,status,payload_json FROM supplier_invoices WHERE tenant_id=?
             AND branch_id=? AND supplier_id=? AND invoice_date<=?`,
          )
          .bind(this.actor.tenantId, branch.id, supplier.id, businessDate)
          .all<JsonRow>(),
      ]);
      const receiptRows = receipts.results ?? [];
      const orderById = new Map((orders.results ?? []).map((order) => [String(order.id), order]));
      const leadTimes = receiptRows
        .map((receipt) => {
          const order = orderById.get(String(receipt.purchase_order_id));
          return order
            ? durationMinutes(String(order.created_at), String(receipt.received_at))
            : null;
        })
        .filter((value): value is number => value !== null);
      const onTime = receiptRows.filter((receipt) => {
        const order = orderById.get(String(receipt.purchase_order_id));
        return Boolean(
          order?.expected_at && String(receipt.received_at) <= String(order.expected_at),
        );
      }).length;
      const received = (lines.results ?? []).reduce(
        (total, line) => total + integer(line.received_purchase_quantity_minor),
        0,
      );
      const accepted = (lines.results ?? []).reduce(
        (total, line) => total + integer(line.accepted_purchase_quantity_minor),
        0,
      );
      const purchaseValueMinor = (lines.results ?? []).reduce(
        (total, line) => total + integer(line.total_cost_minor),
        0,
      );
      const reasons: string[] = [];
      if (receiptRows.length === 0) reasons.push("MISSING_RECEIPT_HISTORY");
      output.push({
        branchId: branch.id,
        businessDate,
        supplierId: supplier.id,
        supplierName: supplier.name,
        currency: supplier.currency ?? branch.currency,
        purchaseValueMinor,
        orderCount: (orders.results ?? []).filter(
          (row) => String(row.created_at).slice(0, 10) === businessDate,
        ).length,
        averageLeadTimeMinutes: average(leadTimes),
        onTimeBps: receiptRows.length > 0 ? basisPoints(onTime, receiptRows.length) : null,
        fillRateBps: received > 0 ? basisPoints(accepted, received) : null,
        rejectedQuantityMicro: received - accepted,
        priceVarianceMinor: (lines.results ?? []).reduce(
          (total, line) => total + integer(line.price_variance_minor),
          0,
        ),
        returnValueMinor: (returns.results ?? []).reduce(
          (total, row) => total + integer(row.total_cost_minor),
          0,
        ),
        invoiceMatchExceptions: (matches.results ?? []).filter((row) => row.status !== "MATCHED")
          .length,
        outstandingPayableMinor: (invoices.results ?? [])
          .filter((row) => !["PAID", "DRAFT"].includes(String(row.status)))
          .reduce((total, row) => {
            const payload = parseJson(row.payload_json);
            return total + integer(row.total_minor) - pickInteger(payload, ["paidMinor"]);
          }, 0),
        quality: qualityFromReasons(reasons, {
          hasPrimaryFacts: (orders.results ?? []).length > 0,
        }),
        qualityReasons: reasons,
      });
    }
    return output.filter(
      (metric) =>
        metric.orderCount > 0 ||
        metric.purchaseValueMinor > 0 ||
        metric.outstandingPayableMinor > 0 ||
        metric.returnValueMinor > 0,
    );
  }

  private async calculateMenu(branch: BranchRow, businessDate: string): Promise<MenuMetric[]> {
    const result = await this.db
      .prepare(
        `SELECT menu_item_id,quantity_sold,net_revenue_minor,theoretical_cost_minor,
                contribution_minor,food_cost_bps,quality
         FROM menu_profitability_snapshots WHERE tenant_id=? AND branch_id=? AND period_end<=?
           AND period_end=(SELECT MAX(p2.period_end) FROM menu_profitability_snapshots p2
             WHERE p2.tenant_id=menu_profitability_snapshots.tenant_id
               AND p2.branch_id=menu_profitability_snapshots.branch_id
               AND p2.menu_item_id=menu_profitability_snapshots.menu_item_id AND p2.period_end<=?)`,
      )
      .bind(this.actor.tenantId, branch.id, businessDate, businessDate)
      .all<JsonRow>();
    const rows = result.results ?? [];
    const totalQuantity = rows.reduce((total, row) => total + integer(row.quantity_sold), 0);
    const contributions = rows.map((row) => integer(row.contribution_minor));
    const contributionMedianMinor = median(contributions) ?? 0;
    const popularityValues = rows.map((row) =>
      basisPoints(integer(row.quantity_sold), totalQuantity),
    );
    const popularityMedianBps = median(popularityValues) ?? 0;
    return rows.map((row) => {
      const sourceQuality = String(row.quality) as AnalyticsQuality;
      const quality =
        sourceQuality === "HIGH" || sourceQuality === "MEDIUM" || sourceQuality === "LOW"
          ? sourceQuality
          : "INSUFFICIENT_DATA";
      const salesMixBps = basisPoints(integer(row.quantity_sold), totalQuantity);
      return {
        menuItemId: String(row.menu_item_id),
        quantitySold: integer(row.quantity_sold),
        netRevenueMinor: integer(row.net_revenue_minor),
        theoreticalCostMinor: integer(row.theoretical_cost_minor),
        contributionMinor: integer(row.contribution_minor),
        foodCostBps: integer(row.food_cost_bps),
        salesMixBps,
        classification: menuClassification({
          quality,
          contributionMinor: integer(row.contribution_minor),
          contributionMedianMinor,
          salesMixBps,
          popularityMedianBps,
        }),
        quality,
      };
    });
  }

  private async calculateInventoryGl(branch: BranchRow, businessDate: string) {
    const mapping = await this.accountMapping(branch.id);
    if (!mapping || mapping.accounting_mode !== "PERPETUAL") {
      return {
        id: `${branch.id}:${businessDate}`,
        branchId: branch.id,
        warehouseId: null,
        businessDate,
        currency: branch.currency,
        subledgerValueMinor: 0,
        glValueMinor: 0,
        differenceMinor: 0,
        toleranceMinor: 0,
        status: "MISSING_CONFIGURATION" as const,
        quality: "INSUFFICIENT_DATA" as const,
        evidence: { reason: mapping ? "PERIODIC_ACCOUNTING" : "MISSING_ACCOUNT_MAPPING" },
      };
    }
    const [subledger, gl, tolerance] = await Promise.all([
      this.db
        .prepare(
          `SELECT COALESCE(SUM(total_value_minor),0) AS value_minor FROM inventory_balances
           WHERE tenant_id=? AND branch_id=?`,
        )
        .bind(this.actor.tenantId, branch.id)
        .first<{ value_minor: number }>(),
      this.db
        .prepare(
          `SELECT COALESCE(SUM(jl.debit_minor-jl.credit_minor),0) AS value_minor
           FROM journal_lines jl JOIN journal_entries je
             ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
           WHERE jl.tenant_id=? AND je.branch_id=? AND je.status='POSTED'
             AND je.business_date<=? AND jl.account_id=?`,
        )
        .bind(this.actor.tenantId, branch.id, businessDate, mapping.inventory_account_id)
        .first<{ value_minor: number }>(),
      this.effectiveThreshold(branch.id, "INVENTORY_GL_DIFFERENCE_MINOR", businessDate),
    ]);
    const subledgerValueMinor = integer(subledger?.value_minor);
    const glValueMinor = integer(gl?.value_minor);
    const differenceMinor = subledgerValueMinor - glValueMinor;
    const toleranceMinor = tolerance?.threshold_value ?? 0;
    return {
      id: `${branch.id}:${businessDate}`,
      branchId: branch.id,
      warehouseId: null,
      businessDate,
      currency: branch.currency,
      subledgerValueMinor,
      glValueMinor,
      differenceMinor,
      toleranceMinor,
      status:
        Math.abs(differenceMinor) <= Math.abs(toleranceMinor)
          ? ("MATCHED" as const)
          : ("VARIANCE" as const),
      quality: "HIGH" as const,
      evidence: { inventoryAccountId: mapping.inventory_account_id, noAdjustmentPosted: true },
    };
  }

  private async calculateCloseReadiness(
    branch: BranchRow,
    businessDate: string,
    inventoryGl: Awaited<ReturnType<ManagementIntelligenceService["calculateInventoryGl"]>>,
  ): Promise<CloseReadiness> {
    const [dayClose, reconciliation, settlements, counts, supplierInvoices, refunds, workerJobs] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT status FROM day_closes WHERE tenant_id=? AND branch_id=? AND business_date=?`,
          )
          .bind(this.actor.tenantId, branch.id, businessDate)
          .first<{ status: string }>(),
        this.count(
          `SELECT COUNT(*) AS count FROM reconciliation_exceptions WHERE tenant_id=? AND branch_id=?
           AND status NOT IN ('RESOLVED','DISMISSED')`,
          [this.actor.tenantId, branch.id],
        ),
        this.count(
          `SELECT COUNT(*) AS count FROM settlement_batches WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL)
           AND period_start<=? AND period_end>=? AND status NOT IN ('POSTED','MATCHED')`,
          [this.actor.tenantId, branch.id, businessDate, businessDate],
        ),
        this.count(
          `SELECT COUNT(*) AS count FROM stock_count_sessions WHERE tenant_id=? AND branch_id=?
           AND business_date=? AND status NOT IN ('POSTED','CANCELLED')`,
          [this.actor.tenantId, branch.id, businessDate],
        ),
        this.count(
          `SELECT COUNT(*) AS count FROM supplier_invoices WHERE tenant_id=? AND branch_id=?
           AND invoice_date<=? AND status IN ('DRAFT','REVIEW','APPROVED','DISPUTED')`,
          [this.actor.tenantId, branch.id, businessDate],
        ),
        this.count(
          `SELECT COUNT(*) AS count FROM payment_refunds WHERE tenant_id=? AND branch_id=?
           AND status IN ('REQUESTED','PROCESSING','PENDING')`,
          [this.actor.tenantId, branch.id],
        ),
        this.count(
          `SELECT COUNT(*) AS count FROM worker_jobs WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL)
           AND status IN ('FAILED','DEAD_LETTER')`,
          [this.actor.tenantId, branch.id],
        ),
      ]);
    const blockerCandidates: CloseReadiness["blockers"] = [
      { code: "UNRESOLVED_RECONCILIATION", count: reconciliation, severity: "HIGH" },
      { code: "UNMATCHED_SETTLEMENT", count: settlements, severity: "HIGH" },
      { code: "OPEN_STOCK_COUNT", count: counts, severity: "HIGH" },
      { code: "UNPOSTED_SUPPLIER_INVOICE", count: supplierInvoices, severity: "MEDIUM" },
      { code: "PENDING_REFUND", count: refunds, severity: "HIGH" },
      { code: "FAILED_DURABLE_JOB", count: workerJobs, severity: "CRITICAL" },
      {
        code: "INVENTORY_GL_VARIANCE",
        count: inventoryGl.status === "VARIANCE" ? 1 : 0,
        severity: "HIGH",
      },
    ];
    const blockers = blockerCandidates.filter((blocker) => blocker.count > 0);
    const blockerCount = blockers
      .filter((blocker) => ["HIGH", "CRITICAL"].includes(blocker.severity))
      .reduce((total, blocker) => total + blocker.count, 0);
    const warningCount = blockers
      .filter((blocker) => !["HIGH", "CRITICAL"].includes(blocker.severity))
      .reduce((total, blocker) => total + blocker.count, 0);
    return {
      branchId: branch.id,
      businessDate,
      status:
        dayClose?.status === "CLOSED"
          ? "CLOSED"
          : blockerCount > 0
            ? "NOT_READY"
            : "READY_TO_CLOSE",
      blockerCount,
      warningCount,
      blockers,
      quality: inventoryGl.quality,
    };
  }

  private async calculateFinancialSummaries(
    branch: BranchRow,
    businessDate: string,
    day: DailyBranchMetric & {
      marketplaceCommissionMinor: number;
      paymentProcessingFeesMinor: number;
      deliveryFeesMinor: number;
    },
  ): Promise<FinancialSummary[]> {
    const daySummary = financialSummaryFromMetric(day, "DAY", businessDate, businessDate);
    const startOfWeek = mondayOfWeek(businessDate);
    const startOfMonth = `${businessDate.slice(0, 7)}-01`;
    const output = [daySummary];
    for (const [periodType, start] of [
      ["WEEK_TO_DATE", startOfWeek],
      ["MONTH_TO_DATE", startOfMonth],
    ] as const) {
      const rows = await this.db
        .prepare(
          `SELECT * FROM daily_branch_metrics WHERE tenant_id=? AND branch_id=?
           AND business_date BETWEEN ? AND ? ORDER BY business_date`,
        )
        .bind(this.actor.tenantId, branch.id, start, businessDate)
        .all<JsonRow>();
      const metrics = (rows.results ?? []).map(mapDailyBranchMetric);
      if (!metrics.some((metric) => metric.businessDate === businessDate)) metrics.push(day);
      output.push(
        aggregateFinancialSummary(
          metrics,
          periodType,
          branch.id,
          start,
          businessDate,
          branch.currency,
        ),
      );
    }
    return output;
  }

  private async generateThresholdActions(
    branchId: string,
    businessDate: string,
    facts: DailyBranchMetric,
    inventoryGl: Awaited<ReturnType<ManagementIntelligenceService["calculateInventoryGl"]>>,
    stamp: string,
    correlationId: string,
  ) {
    const policies = await this.db
      .prepare(
        `SELECT * FROM metric_threshold_policies WHERE tenant_id=? AND active=1
         AND (branch_id=? OR branch_id IS NULL) AND effective_from<=?
         AND (effective_to IS NULL OR effective_to>=?)
         ORDER BY metric_code,CASE WHEN branch_id=? THEN 0 ELSE 1 END,severity`,
      )
      .bind(this.actor.tenantId, branchId, businessDate, businessDate, branchId)
      .all<JsonRow>();
    const values: Record<string, MetricValue> = {
      FOOD_COST_BPS: metricValue(facts.foodCostBps, "BPS", "DAILY_BRANCH_METRIC", businessDate),
      LABOUR_COST_BPS: metricValue(facts.labourCostBps, "BPS", "DAILY_BRANCH_METRIC", businessDate),
      PAYMENT_VARIANCE_MINOR: metricValue(
        facts.paymentVarianceMinor,
        "MINOR",
        "DAILY_BRANCH_METRIC",
        businessDate,
      ),
      WASTAGE_MINOR: metricValue(facts.wastageMinor, "MINOR", "DAILY_BRANCH_METRIC", businessDate),
      INVENTORY_VARIANCE_MINOR: metricValue(
        facts.inventoryVarianceMinor,
        "MINOR",
        "DAILY_BRANCH_METRIC",
        businessDate,
      ),
      AVERAGE_PREP_TIME_MS: metricValue(
        facts.averagePrepTimeMs ?? 0,
        "MILLISECONDS",
        "DAILY_BRANCH_METRIC",
        businessDate,
      ),
      INVENTORY_GL_DIFFERENCE_MINOR: metricValue(
        inventoryGl.differenceMinor,
        "MINOR",
        "INVENTORY_GL_RECONCILIATION",
        inventoryGl.id,
      ),
    };
    const selected = new Map<string, JsonRow>();
    for (const policy of policies.results ?? []) {
      if (!selected.has(String(policy.metric_code)) || policy.branch_id === branchId) {
        selected.set(String(policy.metric_code), policy);
      }
    }
    for (const [metricCode, policy] of selected) {
      const metric = values[metricCode];
      if (!metric) continue;
      if (
        !evaluateThreshold(
          metric.value,
          String(policy.comparison) as "GREATER_THAN" | "LESS_THAN" | "ABSOLUTE_GREATER_THAN",
          integer(policy.threshold_value),
        )
      ) {
        continue;
      }
      await this.upsertGeneratedAction({
        branchId,
        businessDate,
        actionType: metricCode,
        severity: String(policy.severity) as ManagementSeverity,
        sourceType: metric.sourceType,
        sourceId: metric.sourceId,
        conditionKey: `${branchId}:${businessDate}:${metricCode}`,
        metricValue: metric.value,
        thresholdValue: integer(policy.threshold_value),
        valueUnit: metric.unit,
        evidence: {
          metricCode,
          comparison: policy.comparison,
          policyId: policy.id,
          deepLink: managementEvidenceRoute(metricCode),
          quality: facts.quality,
          qualityReasons: facts.qualityReasons,
        },
        reopenAfterMinutes:
          policy.reopen_after_minutes === null ? null : integer(policy.reopen_after_minutes),
        stamp,
        correlationId,
      });
    }
  }

  private async upsertGeneratedAction(input: {
    branchId: string;
    businessDate: string;
    actionType: string;
    severity: ManagementSeverity;
    sourceType: string;
    sourceId: string;
    conditionKey: string;
    metricValue: number;
    thresholdValue: number;
    valueUnit: string;
    evidence: Record<string, unknown>;
    reopenAfterMinutes: number | null;
    stamp: string;
    correlationId: string;
  }) {
    const existing = await this.db
      .prepare(
        `SELECT id,status,resolved_at FROM management_actions WHERE tenant_id=? AND condition_key=?`,
      )
      .bind(this.actor.tenantId, input.conditionKey)
      .first<{ id: string; status: ManagementActionStatus; resolved_at: string | null }>();
    if (!existing) {
      const id = crypto.randomUUID();
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO management_actions
              (tenant_id,id,branch_id,action_type,severity,status,source_type,source_id,condition_key,
               business_date,metric_value,threshold_value,value_unit,evidence_json,first_detected_at,
               last_detected_at,correlation_id,created_at,updated_at)
             VALUES (?,?,?,?,?,'OPEN',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            id,
            input.branchId,
            input.actionType,
            input.severity,
            input.sourceType,
            input.sourceId,
            input.conditionKey,
            input.businessDate,
            input.metricValue,
            input.thresholdValue,
            input.valueUnit,
            JSON.stringify(input.evidence),
            input.stamp,
            input.stamp,
            input.correlationId,
            input.stamp,
            input.stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO management_action_events
              (tenant_id,id,management_action_id,event_type,actor_id,evidence_json,correlation_id,created_at)
             VALUES (?,?,?,'DETECTED',?, ?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            this.actor.id,
            JSON.stringify(input.evidence),
            input.correlationId,
            input.stamp,
          ),
      ]);
      return;
    }
    const canReopen =
      RESOLVED_ACTION_STATUSES.includes(existing.status) &&
      input.reopenAfterMinutes !== null &&
      existing.resolved_at !== null &&
      Date.parse(input.stamp) - Date.parse(existing.resolved_at) >=
        input.reopenAfterMinutes * 60_000;
    await this.db
      .prepare(
        `UPDATE management_actions SET severity=?,metric_value=?,threshold_value=?,value_unit=?,
           evidence_json=?,last_detected_at=?,status=?,
           resolved_at=CASE WHEN ?=1 THEN NULL ELSE resolved_at END,
           resolution_actor_id=CASE WHEN ?=1 THEN NULL ELSE resolution_actor_id END,
           resolution_note=CASE WHEN ?=1 THEN NULL ELSE resolution_note END,
           correlation_id=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=?`,
      )
      .bind(
        input.severity,
        input.metricValue,
        input.thresholdValue,
        input.valueUnit,
        JSON.stringify(input.evidence),
        input.stamp,
        canReopen ? "OPEN" : existing.status,
        canReopen ? 1 : 0,
        canReopen ? 1 : 0,
        canReopen ? 1 : 0,
        input.correlationId,
        input.stamp,
        this.actor.tenantId,
        existing.id,
      )
      .run();
  }

  private async calculateAndPersistHealth(
    branchId: string,
    businessDate: string,
    quality: AnalyticsQuality,
    stamp: string,
  ): Promise<BranchHealth> {
    const result = await this.db
      .prepare(
        `SELECT id,action_type,severity,metric_value,threshold_value,value_unit,evidence_json
         FROM management_actions WHERE tenant_id=? AND branch_id=? AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<JsonRow>();
    const rows = result.results ?? [];
    const status = healthFromSeverities(
      rows.map((row) => String(row.severity) as ManagementSeverity),
    );
    const evidence = rows.map((row) => ({
      actionId: row.id,
      actionType: row.action_type,
      severity: row.severity,
      metricValue: row.metric_value,
      thresholdValue: row.threshold_value,
      valueUnit: row.value_unit,
      evidence: parseJson(row.evidence_json),
    }));
    await this.db
      .prepare(
        `INSERT INTO branch_health_snapshots
          (tenant_id,branch_id,business_date,status,evidence_json,quality,calculated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET
           status=excluded.status,evidence_json=excluded.evidence_json,
           quality=excluded.quality,calculated_at=excluded.calculated_at`,
      )
      .bind(
        this.actor.tenantId,
        branchId,
        businessDate,
        status,
        JSON.stringify(evidence),
        quality,
        stamp,
      )
      .run();
    return { branchId, businessDate, status, evidence, quality };
  }

  private async refreshApprovalInbox(branchId: string, stamp: string) {
    const [purchaseOrders, wastage, stockCounts, refunds, supplierInvoices, matches] =
      await Promise.all([
        this.db
          .prepare(
            `SELECT id,'PURCHASE_ORDER' AS source_type,'PROCUREMENT' AS category,status,total_minor AS amount_minor,
                  currency,created_at AS requested_at,updated_at AS source_updated_at,payload_json
           FROM purchase_orders WHERE tenant_id=? AND branch_id=? AND status='SUBMITTED'`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT id,'WASTAGE' AS source_type,'INVENTORY' AS category,status,NULL AS amount_minor,
                  NULL AS currency,created_at AS requested_at,created_at AS source_updated_at,payload_json
           FROM wastage WHERE tenant_id=? AND branch_id=? AND status IN ('SUBMITTED','REVIEW','PENDING')`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT id,'STOCK_COUNT' AS source_type,'INVENTORY' AS category,status,NULL AS amount_minor,
                  NULL AS currency,created_at AS requested_at,updated_at AS source_updated_at,scope_json AS payload_json
           FROM stock_count_sessions WHERE tenant_id=? AND branch_id=? AND status IN ('SUBMITTED','REVIEW')`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT id,'PAYMENT_REFUND' AS source_type,'FINANCE' AS category,status,amount_minor,currency,
                  created_at AS requested_at,updated_at AS source_updated_at,payload_json
           FROM payment_refunds WHERE tenant_id=? AND branch_id=? AND status IN ('REQUESTED','PENDING')`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT id,'SUPPLIER_INVOICE' AS source_type,'FINANCE' AS category,status,total_minor AS amount_minor,
                  currency,created_at AS requested_at,updated_at AS source_updated_at,payload_json
           FROM supplier_invoices WHERE tenant_id=? AND branch_id=? AND status IN ('REVIEW','DISPUTED')`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
        this.db
          .prepare(
            `SELECT pm.id,'PROCUREMENT_MATCH' AS source_type,'PROCUREMENT' AS category,pm.status,
                  ABS(pm.variance_minor) AS amount_minor,po.currency,pm.created_at AS requested_at,
                  pm.updated_at AS source_updated_at,pm.payload_json
           FROM procurement_matches pm JOIN purchase_orders po
             ON po.tenant_id=pm.tenant_id AND po.id=pm.purchase_order_id
           WHERE pm.tenant_id=? AND po.branch_id=? AND pm.status<>'MATCHED'`,
          )
          .bind(this.actor.tenantId, branchId)
          .all<JsonRow>(),
      ]);
    const rows = [purchaseOrders, wastage, stockCounts, refunds, supplierInvoices, matches].flatMap(
      (result) => result.results ?? [],
    );
    const statements = [
      this.db
        .prepare(`DELETE FROM approval_inbox_items WHERE tenant_id=? AND branch_id=?`)
        .bind(this.actor.tenantId, branchId),
      ...rows.map((row) =>
        this.db
          .prepare(
            `INSERT INTO approval_inbox_items
              (tenant_id,source_type,source_id,branch_id,category,status,amount_minor,currency,
               requested_at,source_updated_at,payload_json,calculated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            row.source_type,
            row.id,
            branchId,
            row.category,
            row.status,
            row.amount_minor ?? null,
            row.currency ?? null,
            row.requested_at,
            row.source_updated_at,
            row.payload_json ?? "{}",
            stamp,
          ),
      ),
    ];
    await this.db.batch(statements);
  }

  private dailyBranchStatement(
    metric: DailyBranchMetric & {
      marketplaceCommissionMinor: number;
      paymentProcessingFeesMinor: number;
      deliveryFeesMinor: number;
    },
    stamp: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO daily_branch_metrics
          (tenant_id,branch_id,business_date,currency,gross_sales_minor,discounts_minor,refunds_minor,
           net_sales_minor,tax_minor,service_charge_minor,net_revenue_minor,marketplace_commission_minor,
           payment_processing_fees_minor,delivery_fees_minor,cogs_minor,gross_profit_minor,
           gross_margin_bps,food_cost_bps,labour_cost_minor,labour_cost_bps,operating_expenses_minor,
           contribution_minor,order_count,average_order_value_minor,average_prep_time_ms,
           payment_variance_minor,wastage_minor,inventory_variance_minor,quality,quality_reasons_json,
           source_watermark,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET
           currency=excluded.currency,gross_sales_minor=excluded.gross_sales_minor,
           discounts_minor=excluded.discounts_minor,refunds_minor=excluded.refunds_minor,
           net_sales_minor=excluded.net_sales_minor,tax_minor=excluded.tax_minor,
           service_charge_minor=excluded.service_charge_minor,net_revenue_minor=excluded.net_revenue_minor,
           marketplace_commission_minor=excluded.marketplace_commission_minor,
           payment_processing_fees_minor=excluded.payment_processing_fees_minor,
           delivery_fees_minor=excluded.delivery_fees_minor,cogs_minor=excluded.cogs_minor,
           gross_profit_minor=excluded.gross_profit_minor,gross_margin_bps=excluded.gross_margin_bps,
           food_cost_bps=excluded.food_cost_bps,labour_cost_minor=excluded.labour_cost_minor,
           labour_cost_bps=excluded.labour_cost_bps,operating_expenses_minor=excluded.operating_expenses_minor,
           contribution_minor=excluded.contribution_minor,order_count=excluded.order_count,
           average_order_value_minor=excluded.average_order_value_minor,
           average_prep_time_ms=excluded.average_prep_time_ms,payment_variance_minor=excluded.payment_variance_minor,
           wastage_minor=excluded.wastage_minor,inventory_variance_minor=excluded.inventory_variance_minor,
           quality=excluded.quality,quality_reasons_json=excluded.quality_reasons_json,
           source_watermark=excluded.source_watermark,calculated_at=excluded.calculated_at`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.currency,
        metric.grossSalesMinor,
        metric.discountsMinor,
        metric.refundsMinor,
        metric.netSalesMinor,
        metric.taxMinor,
        metric.serviceChargeMinor,
        metric.netRevenueMinor,
        metric.marketplaceCommissionMinor,
        metric.paymentProcessingFeesMinor,
        metric.deliveryFeesMinor,
        metric.cogsMinor,
        metric.grossProfitMinor,
        metric.grossMarginBps,
        metric.foodCostBps,
        metric.labourCostMinor,
        metric.labourCostBps,
        metric.operatingExpensesMinor,
        metric.contributionMinor,
        metric.orderCount,
        metric.averageOrderValueMinor,
        metric.averagePrepTimeMs,
        metric.paymentVarianceMinor,
        metric.wastageMinor,
        metric.inventoryVarianceMinor,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
        stamp,
      );
  }

  private channelStatement(metric: ChannelMetric, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO daily_channel_metrics
          (tenant_id,branch_id,business_date,channel_key,channel_id,channel_label,currency,order_count,
           cancelled_count,refund_count,gross_sales_minor,discounts_minor,refunds_minor,net_sales_minor,
           commission_minor,provider_fees_minor,delivery_fees_minor,cogs_minor,contribution_minor,
           contribution_bps,average_order_value_minor,cancellation_bps,refund_bps,average_fulfilment_ms,
           settlement_difference_minor,quality,quality_reasons_json,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.channelKey,
        metric.channelId,
        metric.channelLabel,
        metric.currency,
        metric.orderCount,
        metric.cancelledCount,
        metric.refundCount,
        metric.grossSalesMinor,
        metric.discountsMinor,
        metric.refundsMinor,
        metric.netSalesMinor,
        metric.commissionMinor,
        metric.providerFeesMinor,
        metric.deliveryFeesMinor,
        metric.cogsMinor,
        metric.contributionMinor,
        metric.contributionBps,
        metric.averageOrderValueMinor,
        metric.cancellationBps,
        metric.refundBps,
        metric.averageFulfilmentMs,
        metric.settlementDifferenceMinor,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
      );
  }

  private stationStatement(metric: StationMetric, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO daily_station_metrics
          (tenant_id,branch_id,business_date,station_id,ticket_count,completed_count,late_count,
           average_prep_ms,median_prep_ms,p90_prep_ms,average_ready_pickup_ms,throughput_per_hour_milli,
           quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.stationId,
        metric.ticketCount,
        metric.completedCount,
        metric.lateCount,
        metric.averagePrepMs,
        metric.medianPrepMs,
        metric.p90PrepMs,
        metric.averageReadyPickupMs,
        metric.throughputPerHourMilli,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
      );
  }

  private staffStatement(metric: StaffMetric, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO daily_staff_metrics
          (tenant_id,branch_id,business_date,employee_id,shift_count,worked_minutes,late_minutes,
           labour_cost_minor,orders_handled,net_sales_minor,average_order_value_minor,average_service_ms,
           void_requests,approved_discounts,refund_involvement,quality,quality_reasons_json,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.employeeId,
        metric.shiftCount,
        metric.workedMinutes,
        metric.lateMinutes,
        metric.labourCostMinor,
        metric.ordersHandled,
        metric.netSalesMinor,
        metric.averageOrderValueMinor,
        metric.averageServiceMs,
        metric.voidRequests,
        metric.approvedDiscounts,
        metric.refundInvolvement,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
      );
  }

  private supplierStatement(metric: SupplierMetric, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO daily_supplier_metrics
          (tenant_id,branch_id,business_date,supplier_id,currency,purchase_value_minor,order_count,
           average_lead_time_minutes,on_time_bps,fill_rate_bps,rejected_quantity_micro,
           price_variance_minor,return_value_minor,invoice_match_exceptions,outstanding_payable_minor,
           quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.supplierId,
        metric.currency,
        metric.purchaseValueMinor,
        metric.orderCount,
        metric.averageLeadTimeMinutes,
        metric.onTimeBps,
        metric.fillRateBps,
        metric.rejectedQuantityMicro,
        metric.priceVarianceMinor,
        metric.returnValueMinor,
        metric.invoiceMatchExceptions,
        metric.outstandingPayableMinor,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
      );
  }

  private menuStatement(branchId: string, businessDate: string, metric: MenuMetric, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO daily_menu_item_metrics
          (tenant_id,branch_id,business_date,menu_item_id,quantity_sold,net_revenue_minor,
           theoretical_cost_minor,contribution_minor,food_cost_bps,sales_mix_bps,classification,
           quality,quality_reasons_json,calculated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        branchId,
        businessDate,
        metric.menuItemId,
        metric.quantitySold,
        metric.netRevenueMinor,
        metric.theoreticalCostMinor,
        metric.contributionMinor,
        metric.foodCostBps,
        metric.salesMixBps,
        metric.classification,
        metric.quality,
        JSON.stringify(metric.quality === "INSUFFICIENT_DATA" ? ["MISSING_RECIPE_OR_COST"] : []),
        stamp,
      );
  }

  private inventoryGlStatement(
    metric: Awaited<ReturnType<ManagementIntelligenceService["calculateInventoryGl"]>>,
    stamp: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO inventory_gl_reconciliations
          (tenant_id,id,branch_id,warehouse_id,business_date,currency,subledger_value_minor,
           gl_value_minor,difference_minor,tolerance_minor,status,quality,evidence_json,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,id) DO UPDATE SET
           subledger_value_minor=excluded.subledger_value_minor,gl_value_minor=excluded.gl_value_minor,
           difference_minor=excluded.difference_minor,tolerance_minor=excluded.tolerance_minor,
           status=excluded.status,quality=excluded.quality,evidence_json=excluded.evidence_json,
           calculated_at=excluded.calculated_at`,
      )
      .bind(
        this.actor.tenantId,
        metric.id,
        metric.branchId,
        metric.warehouseId,
        metric.businessDate,
        metric.currency,
        metric.subledgerValueMinor,
        metric.glValueMinor,
        metric.differenceMinor,
        metric.toleranceMinor,
        metric.status,
        metric.quality,
        JSON.stringify(metric.evidence),
        stamp,
      );
  }

  private closeReadinessStatement(metric: CloseReadiness, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO close_readiness_snapshots
          (tenant_id,branch_id,business_date,status,blocker_count,warning_count,blockers_json,quality,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,business_date) DO UPDATE SET
           status=excluded.status,blocker_count=excluded.blocker_count,warning_count=excluded.warning_count,
           blockers_json=excluded.blockers_json,quality=excluded.quality,calculated_at=excluded.calculated_at`,
      )
      .bind(
        this.actor.tenantId,
        metric.branchId,
        metric.businessDate,
        metric.status,
        metric.blockerCount,
        metric.warningCount,
        JSON.stringify(metric.blockers),
        metric.quality,
        stamp,
      );
  }

  private financialSummaryStatement(metric: FinancialSummary, stamp: string) {
    return this.db
      .prepare(
        `INSERT INTO financial_summary_periods
          (tenant_id,id,branch_id,period_type,period_start,period_end,currency,gross_sales_minor,
           discounts_minor,refunds_minor,net_sales_minor,tax_minor,service_charge_minor,net_revenue_minor,
           cogs_minor,gross_profit_minor,gross_margin_bps,labour_cost_minor,operating_expenses_minor,
           marketplace_commission_minor,payment_processing_fees_minor,delivery_fees_minor,
           contribution_minor,flash_operating_result_minor,quality,quality_reasons_json,calculated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,branch_id,period_type,period_start,period_end) DO UPDATE SET
           currency=excluded.currency,gross_sales_minor=excluded.gross_sales_minor,
           discounts_minor=excluded.discounts_minor,refunds_minor=excluded.refunds_minor,
           net_sales_minor=excluded.net_sales_minor,tax_minor=excluded.tax_minor,
           service_charge_minor=excluded.service_charge_minor,net_revenue_minor=excluded.net_revenue_minor,
           cogs_minor=excluded.cogs_minor,gross_profit_minor=excluded.gross_profit_minor,
           gross_margin_bps=excluded.gross_margin_bps,labour_cost_minor=excluded.labour_cost_minor,
           operating_expenses_minor=excluded.operating_expenses_minor,
           marketplace_commission_minor=excluded.marketplace_commission_minor,
           payment_processing_fees_minor=excluded.payment_processing_fees_minor,
           delivery_fees_minor=excluded.delivery_fees_minor,contribution_minor=excluded.contribution_minor,
           flash_operating_result_minor=excluded.flash_operating_result_minor,quality=excluded.quality,
           quality_reasons_json=excluded.quality_reasons_json,calculated_at=excluded.calculated_at`,
      )
      .bind(
        this.actor.tenantId,
        metric.id,
        metric.branchId,
        metric.periodType,
        metric.periodStart,
        metric.periodEnd,
        metric.currency,
        metric.grossSalesMinor,
        metric.discountsMinor,
        metric.refundsMinor,
        metric.netSalesMinor,
        metric.taxMinor,
        metric.serviceChargeMinor,
        metric.netRevenueMinor,
        metric.cogsMinor,
        metric.grossProfitMinor,
        metric.grossMarginBps,
        metric.labourCostMinor,
        metric.operatingExpensesMinor,
        metric.marketplaceCommissionMinor,
        metric.paymentProcessingFeesMinor,
        metric.deliveryFeesMinor,
        metric.contributionMinor,
        metric.flashOperatingResultMinor,
        metric.quality,
        JSON.stringify(metric.qualityReasons),
        stamp,
      );
  }

  private async effectiveThreshold(branchId: string, metricCode: string, businessDate: string) {
    return this.db
      .prepare(
        `SELECT * FROM metric_threshold_policies WHERE tenant_id=? AND metric_code=? AND active=1
         AND (branch_id=? OR branch_id IS NULL) AND effective_from<=?
         AND (effective_to IS NULL OR effective_to>=?)
         ORDER BY CASE WHEN branch_id=? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(this.actor.tenantId, metricCode, branchId, businessDate, businessDate, branchId)
      .first<{ threshold_value: number }>();
  }

  private async effectiveTargets(branchId: string, businessDate: string) {
    const result = await this.db
      .prepare(
        `SELECT branch_id,metric_code,target_value,value_unit,effective_from,effective_to
         FROM branch_targets WHERE tenant_id=? AND active=1 AND (branch_id=? OR branch_id IS NULL)
           AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
         ORDER BY metric_code,CASE WHEN branch_id=? THEN 0 ELSE 1 END,effective_from DESC`,
      )
      .bind(this.actor.tenantId, branchId, businessDate, businessDate, branchId)
      .all<JsonRow>();
    const selected = new Map<string, JsonRow>();
    for (const row of result.results ?? []) {
      const code = String(row.metric_code);
      if (!selected.has(code)) selected.set(code, row);
    }
    return [...selected.values()].map((row) => ({
      metricCode: String(row.metric_code),
      targetValue: integer(row.target_value),
      valueUnit: String(row.value_unit) as import("@/management/types").MetricUnit,
      source: row.branch_id ? ("BRANCH_OVERRIDE" as const) : ("TENANT_DEFAULT" as const),
      effectiveFrom: String(row.effective_from),
      effectiveTo: nullableString(row.effective_to),
    }));
  }

  private async sumCogs(branchId: string, start: string, end: string) {
    const mapping = await this.accountMapping(branchId);
    if (!mapping) return { value: 0, configured: false };
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit_minor-jl.credit_minor),0) AS value_minor
         FROM journal_lines jl JOIN journal_entries je
           ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
         WHERE jl.tenant_id=? AND je.branch_id=? AND je.status='POSTED'
           AND je.business_date BETWEEN ? AND ? AND jl.account_id=?`,
      )
      .bind(this.actor.tenantId, branchId, start, end, mapping.cogs_account_id)
      .first<{ value_minor: number }>();
    return { value: integer(row?.value_minor), configured: true };
  }

  private async sumMovementCost(branchId: string, start: string, end: string, types: string[]) {
    if (types.length === 0) return 0;
    const placeholders = types.map(() => "?").join(",");
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(total_cost_minor),0) AS value_minor FROM inventory_movements
         WHERE tenant_id=? AND branch_id=? AND business_date BETWEEN ? AND ?
           AND movement_type IN (${placeholders})`,
      )
      .bind(this.actor.tenantId, branchId, start, end, ...types)
      .first<{ value_minor: number }>();
    return integer(row?.value_minor);
  }

  private async sumReceiptPriceVariance(branchId: string, start: string, end: string) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(grl.price_variance_minor),0) AS value_minor
         FROM goods_receipt_lines grl JOIN goods_receipts gr
           ON gr.tenant_id=grl.tenant_id AND gr.id=grl.goods_receipt_id
         WHERE grl.tenant_id=? AND gr.branch_id=? AND gr.business_date BETWEEN ? AND ?`,
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .first<{ value_minor: number }>();
    return integer(row?.value_minor);
  }

  private async sumProductionYieldVariance(branchId: string, start: string, end: string) {
    const result = await this.db
      .prepare(
        `SELECT payload_json FROM production_batches WHERE tenant_id=? AND branch_id=?
         AND business_date BETWEEN ? AND ? AND status='COMPLETED'`,
      )
      .bind(this.actor.tenantId, branchId, start, end)
      .all<{ payload_json: string }>();
    return (result.results ?? []).reduce((total, row) => {
      const payload = parseJson(row.payload_json);
      return total + pickInteger(payload, ["yieldVarianceCostMinor", "actualYieldVarianceMinor"]);
    }, 0);
  }

  private async count(sql: string, values: unknown[]) {
    const row = await this.db
      .prepare(sql)
      .bind(...values)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  private async authorizedBranches(branchId?: string) {
    if (branchId) authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const result = await this.db
      .prepare(
        `SELECT b.id,b.name,b.payload_json,t.default_currency
         FROM branches b JOIN tenants t ON t.id=b.tenant_id
         WHERE b.tenant_id=? AND b.active=1 ORDER BY b.name`,
      )
      .bind(this.actor.tenantId)
      .all<{ id: string; name: string; payload_json: string; default_currency: string }>();
    return (result.results ?? [])
      .map((branch) => ({
        id: branch.id,
        name: branch.name,
        currency: String(parseJson(branch.payload_json)["currency"] ?? branch.default_currency),
      }))
      .filter((branch) => {
        if (branchId) return branch.id === branchId;
        if (this.isSystemActor()) return true;
        if (this.actor.permissions.includes(permissions.tenantScopeAllBranches)) return true;
        return this.actor.assignedBranchIds.includes(branch.id);
      });
  }

  private async serverBusinessDate(branchId: string) {
    const row = await this.db
      .prepare(
        `SELECT timezone,business_day_cutoff_minutes FROM branches WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    if (!row) throw new ServerOperationError("TENANT_SCOPE_VIOLATION", 403, "Branch unavailable");
    return authoritativeBusinessDate({
      timezone: row.timezone,
      cutoffMinutes: Number(row.business_day_cutoff_minutes),
    });
  }

  private auditStatement(
    action: string,
    entityType: string,
    entityId: string,
    branchId: string | undefined,
    correlationId: string,
    stamp: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,correlation_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId ?? null,
        this.actor.id,
        action,
        entityType,
        entityId,
        correlationId,
        JSON.stringify(metadata),
        stamp,
      );
  }

  private requirePermission(permission: string) {
    if (this.actor.permissions.includes(permission)) return;
    throw new ServerOperationError(
      "PERMISSION_DENIED",
      403,
      `${permission} permission is required`,
    );
  }

  private isSystemActor() {
    return this.actor.id.startsWith("system:");
  }
}

function emptyDailyBranchMetric(branch: BranchRow, businessDate: string): DailyBranchMetric {
  return {
    branchId: branch.id,
    branchName: branch.name,
    businessDate,
    currency: branch.currency,
    grossSalesMinor: 0,
    discountsMinor: 0,
    refundsMinor: 0,
    netSalesMinor: 0,
    taxMinor: 0,
    serviceChargeMinor: 0,
    netRevenueMinor: 0,
    marketplaceCommissionMinor: 0,
    paymentProcessingFeesMinor: 0,
    deliveryFeesMinor: 0,
    cogsMinor: 0,
    grossProfitMinor: 0,
    grossMarginBps: 0,
    foodCostBps: 0,
    labourCostMinor: 0,
    labourCostBps: 0,
    operatingExpensesMinor: 0,
    contributionMinor: 0,
    orderCount: 0,
    averageOrderValueMinor: 0,
    averagePrepTimeMs: null,
    paymentVarianceMinor: 0,
    wastageMinor: 0,
    inventoryVarianceMinor: 0,
    quality: "INSUFFICIENT_DATA",
    qualityReasons: ["MISSING_CALCULATED_BRANCH_METRICS"],
  };
}

function mapDailyBranchMetric(row: JsonRow): DailyBranchMetric {
  return {
    branchId: String(row.branch_id),
    branchName: String(row.branch_name ?? row.branch_id),
    businessDate: String(row.business_date),
    currency: String(row.currency),
    grossSalesMinor: integer(row.gross_sales_minor),
    discountsMinor: integer(row.discounts_minor),
    refundsMinor: integer(row.refunds_minor),
    netSalesMinor: integer(row.net_sales_minor),
    taxMinor: integer(row.tax_minor),
    serviceChargeMinor: integer(row.service_charge_minor),
    netRevenueMinor: integer(row.net_revenue_minor),
    marketplaceCommissionMinor: integer(row.marketplace_commission_minor),
    paymentProcessingFeesMinor: integer(row.payment_processing_fees_minor),
    deliveryFeesMinor: integer(row.delivery_fees_minor),
    cogsMinor: integer(row.cogs_minor),
    grossProfitMinor: integer(row.gross_profit_minor),
    grossMarginBps: integer(row.gross_margin_bps),
    foodCostBps: integer(row.food_cost_bps),
    labourCostMinor: integer(row.labour_cost_minor),
    labourCostBps: integer(row.labour_cost_bps),
    operatingExpensesMinor: integer(row.operating_expenses_minor),
    contributionMinor: integer(row.contribution_minor),
    orderCount: integer(row.order_count),
    averageOrderValueMinor: integer(row.average_order_value_minor),
    averagePrepTimeMs: nullableInteger(row.average_prep_time_ms),
    paymentVarianceMinor: integer(row.payment_variance_minor),
    wastageMinor: integer(row.wastage_minor),
    inventoryVarianceMinor: integer(row.inventory_variance_minor),
    quality: String(row.quality) as AnalyticsQuality,
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapFinancialSummary(row: JsonRow): FinancialSummary {
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    periodType: String(row.period_type) as FinancialSummary["periodType"],
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    currency: String(row.currency),
    grossSalesMinor: integer(row.gross_sales_minor),
    discountsMinor: integer(row.discounts_minor),
    refundsMinor: integer(row.refunds_minor),
    netSalesMinor: integer(row.net_sales_minor),
    taxMinor: integer(row.tax_minor),
    serviceChargeMinor: integer(row.service_charge_minor),
    netRevenueMinor: integer(row.net_revenue_minor),
    cogsMinor: integer(row.cogs_minor),
    grossProfitMinor: integer(row.gross_profit_minor),
    grossMarginBps: integer(row.gross_margin_bps),
    labourCostMinor: integer(row.labour_cost_minor),
    operatingExpensesMinor: integer(row.operating_expenses_minor),
    marketplaceCommissionMinor: integer(row.marketplace_commission_minor),
    paymentProcessingFeesMinor: integer(row.payment_processing_fees_minor),
    deliveryFeesMinor: integer(row.delivery_fees_minor),
    contributionMinor: integer(row.contribution_minor),
    flashOperatingResultMinor: integer(row.flash_operating_result_minor),
    quality: String(row.quality) as FinancialSummary["quality"],
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapManagementAction(row: JsonRow): ManagementAction {
  return {
    id: String(row.id),
    branchId: nullableString(row.branch_id),
    actionType: String(row.action_type),
    severity: String(row.severity) as ManagementSeverity,
    status: String(row.status) as ManagementActionStatus,
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    businessDate: nullableString(row.business_date),
    metricValue: nullableInteger(row.metric_value),
    thresholdValue: nullableInteger(row.threshold_value),
    valueUnit: nullableString(row.value_unit),
    evidence: parseJson(row.evidence_json),
    assignedUserId: nullableString(row.assigned_user_id),
    assignedRoleId: nullableString(row.assigned_role_id),
    firstDetectedAt: String(row.first_detected_at),
    lastDetectedAt: String(row.last_detected_at),
    resolutionNote: nullableString(row.resolution_note),
    correlationId: String(row.correlation_id),
  };
}

function mapChannelMetric(row: JsonRow): ChannelMetric {
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    channelKey: String(row.channel_key),
    channelId: nullableString(row.channel_id),
    channelLabel: String(row.channel_label),
    currency: String(row.currency),
    orderCount: integer(row.order_count),
    cancelledCount: integer(row.cancelled_count),
    refundCount: integer(row.refund_count),
    grossSalesMinor: integer(row.gross_sales_minor),
    discountsMinor: integer(row.discounts_minor),
    refundsMinor: integer(row.refunds_minor),
    netSalesMinor: integer(row.net_sales_minor),
    commissionMinor: integer(row.commission_minor),
    providerFeesMinor: integer(row.provider_fees_minor),
    deliveryFeesMinor: integer(row.delivery_fees_minor),
    cogsMinor: integer(row.cogs_minor),
    contributionMinor: integer(row.contribution_minor),
    contributionBps: integer(row.contribution_bps),
    averageOrderValueMinor: integer(row.average_order_value_minor),
    cancellationBps: integer(row.cancellation_bps),
    refundBps: integer(row.refund_bps),
    averageFulfilmentMs: nullableInteger(row.average_fulfilment_ms),
    settlementDifferenceMinor: nullableInteger(row.settlement_difference_minor),
    quality: String(row.quality) as AnalyticsQuality,
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapStationMetric(row: JsonRow): StationMetric {
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    stationId: String(row.station_id),
    stationName: String(row.station_name ?? row.station_id),
    ticketCount: integer(row.ticket_count),
    completedCount: integer(row.completed_count),
    lateCount: integer(row.late_count),
    averagePrepMs: nullableInteger(row.average_prep_ms),
    medianPrepMs: nullableInteger(row.median_prep_ms),
    p90PrepMs: nullableInteger(row.p90_prep_ms),
    averageReadyPickupMs: nullableInteger(row.average_ready_pickup_ms),
    throughputPerHourMilli: nullableInteger(row.throughput_per_hour_milli),
    quality: String(row.quality) as AnalyticsQuality,
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapStaffMetric(row: JsonRow): StaffMetric {
  const employee = parseJson(String(row.employee_payload ?? "{}"));
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    employeeId: String(row.employee_id),
    employeeName: String(employee["name"] ?? employee["fullName"] ?? row.employee_id),
    shiftCount: integer(row.shift_count),
    workedMinutes: integer(row.worked_minutes),
    lateMinutes: integer(row.late_minutes),
    labourCostMinor: integer(row.labour_cost_minor),
    ordersHandled: integer(row.orders_handled),
    netSalesMinor: integer(row.net_sales_minor),
    averageOrderValueMinor: integer(row.average_order_value_minor),
    averageServiceMs: nullableInteger(row.average_service_ms),
    voidRequests: integer(row.void_requests),
    approvedDiscounts: integer(row.approved_discounts),
    refundInvolvement: integer(row.refund_involvement),
    quality: String(row.quality) as AnalyticsQuality,
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapSupplierMetric(row: JsonRow): SupplierMetric {
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    supplierId: String(row.supplier_id),
    supplierName: String(row.supplier_name ?? row.supplier_id),
    currency: String(row.currency),
    purchaseValueMinor: integer(row.purchase_value_minor),
    orderCount: integer(row.order_count),
    averageLeadTimeMinutes: nullableInteger(row.average_lead_time_minutes),
    onTimeBps: nullableInteger(row.on_time_bps),
    fillRateBps: nullableInteger(row.fill_rate_bps),
    rejectedQuantityMicro: integer(row.rejected_quantity_micro),
    priceVarianceMinor: integer(row.price_variance_minor),
    returnValueMinor: integer(row.return_value_minor),
    invoiceMatchExceptions: integer(row.invoice_match_exceptions),
    outstandingPayableMinor: integer(row.outstanding_payable_minor),
    quality: String(row.quality) as AnalyticsQuality,
    qualityReasons: parseJsonArray(row.quality_reasons_json),
  };
}

function mapMenuMetric(row: JsonRow): MenuMetric {
  return {
    menuItemId: String(row.menu_item_id),
    quantitySold: integer(row.quantity_sold),
    netRevenueMinor: integer(row.net_revenue_minor),
    theoreticalCostMinor: integer(row.theoretical_cost_minor),
    contributionMinor: integer(row.contribution_minor),
    foodCostBps: integer(row.food_cost_bps),
    salesMixBps: integer(row.sales_mix_bps),
    classification: String(row.classification) as MenuMetric["classification"],
    quality: String(row.quality) as AnalyticsQuality,
  };
}

function mapInventoryGl(row: JsonRow): InventoryGlReconciliation {
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    warehouseId: nullableString(row.warehouse_id),
    businessDate: String(row.business_date),
    currency: String(row.currency),
    subledgerValueMinor: integer(row.subledger_value_minor),
    glValueMinor: integer(row.gl_value_minor),
    differenceMinor: integer(row.difference_minor),
    toleranceMinor: integer(row.tolerance_minor),
    status: String(row.status) as InventoryGlReconciliation["status"],
    quality: String(row.quality) as AnalyticsQuality,
    evidence: parseJson(row.evidence_json),
  };
}

function mapCloseReadiness(row: JsonRow): CloseReadiness {
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    status: String(row.status) as CloseReadiness["status"],
    blockerCount: integer(row.blocker_count),
    warningCount: integer(row.warning_count),
    blockers: parseJsonList(row.blockers_json) as CloseReadiness["blockers"],
    quality: String(row.quality) as AnalyticsQuality,
  };
}

function mapBranchHealth(row: JsonRow): BranchHealth {
  return {
    branchId: String(row.branch_id),
    businessDate: String(row.business_date),
    status: String(row.status) as BranchHealth["status"],
    evidence: parseJsonList(row.evidence_json),
    quality: String(row.quality) as AnalyticsQuality,
  };
}

function mapApproval(row: JsonRow): ApprovalInboxItem {
  return {
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    branchId: nullableString(row.branch_id),
    category: String(row.category),
    status: String(row.status),
    amountMinor: nullableInteger(row.amount_minor),
    currency: nullableString(row.currency),
    requestedAt: String(row.requested_at),
    payload: parseJson(row.payload_json),
  };
}

function financialSummaryFromMetric(
  metric: DailyBranchMetric,
  periodType: FinancialSummary["periodType"],
  start: string,
  end: string,
): FinancialSummary {
  return aggregateFinancialSummary(
    [metric],
    periodType,
    metric.branchId,
    start,
    end,
    metric.currency,
  );
}

function aggregateFinancialSummary(
  metrics: DailyBranchMetric[],
  periodType: FinancialSummary["periodType"],
  branchId: string,
  start: string,
  end: string,
  currency: string,
): FinancialSummary {
  const sum = (field: keyof DailyBranchMetric) =>
    metrics.reduce(
      (total, metric) => total + (typeof metric[field] === "number" ? Number(metric[field]) : 0),
      0,
    );
  const grossSalesMinor = sum("grossSalesMinor");
  const discountsMinor = sum("discountsMinor");
  const refundsMinor = sum("refundsMinor");
  const netSalesMinor = sum("netSalesMinor");
  const taxMinor = sum("taxMinor");
  const serviceChargeMinor = sum("serviceChargeMinor");
  const netRevenueMinor = sum("netRevenueMinor");
  const cogsMinor = sum("cogsMinor");
  const grossProfitMinor = netRevenueMinor - cogsMinor;
  const labourCostMinor = sum("labourCostMinor");
  const operatingExpensesMinor = sum("operatingExpensesMinor");
  const marketplaceCommissionMinor = sum("marketplaceCommissionMinor");
  const paymentProcessingFeesMinor = sum("paymentProcessingFeesMinor");
  const deliveryFeesMinor = sum("deliveryFeesMinor");
  const contributionMinor =
    grossProfitMinor -
    labourCostMinor -
    marketplaceCommissionMinor -
    paymentProcessingFeesMinor -
    deliveryFeesMinor;
  const qualityReasons = [...new Set(metrics.flatMap((metric) => metric.qualityReasons))];
  return {
    id: `${branchId}:${periodType}:${start}:${end}`,
    branchId,
    periodType,
    periodStart: start,
    periodEnd: end,
    currency,
    grossSalesMinor,
    discountsMinor,
    refundsMinor,
    netSalesMinor,
    taxMinor,
    serviceChargeMinor,
    netRevenueMinor,
    cogsMinor,
    grossProfitMinor,
    grossMarginBps: basisPoints(grossProfitMinor, netRevenueMinor),
    labourCostMinor,
    operatingExpensesMinor,
    marketplaceCommissionMinor,
    paymentProcessingFeesMinor,
    deliveryFeesMinor,
    contributionMinor,
    flashOperatingResultMinor: contributionMinor - operatingExpensesMinor,
    quality: financialQuality(
      metrics.some((metric) => metric.orderCount > 0),
      qualityReasons,
    ),
    qualityReasons,
  };
}

function metricValue(
  value: number,
  unit: string,
  sourceType: string,
  sourceId: string,
): MetricValue {
  return { value, unit, sourceType, sourceId };
}

function managementEvidenceRoute(metricCode: string) {
  const routes: Record<string, string> = {
    FOOD_COST_BPS: "/finance",
    LABOUR_COST_BPS: "/performance",
    PAYMENT_VARIANCE_MINOR: "/reconciliation",
    WASTAGE_MINOR: "/cost-control",
    INVENTORY_VARIANCE_MINOR: "/cost-control",
    AVERAGE_PREP_TIME_MS: "/kitchen-analytics",
    INVENTORY_GL_DIFFERENCE_MINOR: "/finance",
  };
  return routes[metricCode] ?? "/command-centre";
}

function validActionTransition(current: ManagementActionStatus, next: ManagementActionStatus) {
  if (current === next) return true;
  if (current === "OPEN")
    return ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"].includes(next);
  if (current === "ACKNOWLEDGED") return ["IN_PROGRESS", "RESOLVED", "DISMISSED"].includes(next);
  if (current === "IN_PROGRESS") return ["RESOLVED", "DISMISSED"].includes(next);
  return false;
}

function stationTiming(payload: Record<string, unknown>) {
  const started = pickString(payload, ["startedAt", "acceptedAt", "queuedAt"]);
  const ready = pickString(payload, ["readyAt", "completedAt"]);
  const picked = pickString(payload, ["pickedUpAt", "servedAt"]);
  return {
    prepMs: started && ready ? durationMs(started, ready) : null,
    readyPickupMs: ready && picked ? durationMs(ready, picked) : null,
  };
}

function countOrderFlag(rows: JsonRow[], key: string) {
  return rows.filter((row) => parseJson(row.payload_json)[key] === true).length;
}

function durationMs(start: string, end: string) {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function durationMinutes(start: string, end: string) {
  return Math.trunc(durationMs(start, end) / 60_000);
}

function pickInteger(payload: Record<string, unknown>, keys: string[], fallback = 0) {
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) return integer(payload[key]);
  }
  return fallback;
}

function pickString(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof payload[key] === "string" && payload[key]) return String(payload[key]);
  }
  return null;
}

function integer(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isSafeInteger(result) ? result : 0;
}

function nullableInteger(value: unknown) {
  return value === null || value === undefined ? null : integer(value);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonList(value: unknown): Array<Record<string, unknown>> {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object"),
        )
      : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function groupRows<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

function isoDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}

function mondayOfWeek(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return isoDate(value);
}
