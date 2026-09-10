import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";
import type { D1Database } from "@/server/database/d1";
import { ManagementIntelligenceService } from "@/management/management-intelligence-service";
import type { IntelligencePlan } from "@/intelligence/query-planner";
import type {
  EvidenceFinding,
  EvidenceMetric,
  EvidencePackage,
  EvidenceSource,
  IntelligenceQuality,
  IntelligenceToolDefinition,
  IntelligenceToolKey,
} from "@/intelligence/types";

type ToolResult = {
  metrics: EvidenceMetric[];
  findings: EvidenceFinding[];
  sources: EvidenceSource[];
  quality: IntelligenceQuality;
  qualityReasons: string[];
  configurationGaps: string[];
  limitations: string[];
};

type Row = Record<string, unknown> & {
  id?: unknown;
  source_id?: unknown;
  item_id?: unknown;
  menu_item_id?: unknown;
  supplier_id?: unknown;
  station_id?: unknown;
  branch_id?: unknown;
  branch_name?: unknown;
  business_date?: unknown;
  calculated_at?: unknown;
  updated_at?: unknown;
  currency?: unknown;
  quality?: unknown;
  quality_rank?: unknown;
  net_sales_minor?: unknown;
  order_count?: unknown;
  gross_profit_minor?: unknown;
  cogs_minor?: unknown;
  food_cost_bps?: unknown;
  flash_operating_result_minor?: unknown;
  net_revenue_minor?: unknown;
  labour_cost_minor?: unknown;
  channel_label?: unknown;
  contribution_minor?: unknown;
  quantity_sold?: unknown;
  commission_minor?: unknown;
  classification?: unknown;
  name?: unknown;
  quantity_minor?: unknown;
  item_name?: unknown;
  recommended_purchase_quantity_minor?: unknown;
  forecast_quantity_minor?: unknown;
  on_hand_quantity_minor?: unknown;
  incoming_quantity_minor?: unknown;
  supplier_name?: unknown;
  price_variance_minor?: unknown;
  fill_rate_bps?: unknown;
  on_time_bps?: unknown;
  station_name?: unknown;
  p90_prep_ms?: unknown;
  average_prep_ms?: unknown;
  late_count?: unknown;
  employee_id?: unknown;
  late_minutes?: unknown;
  orders_handled?: unknown;
  record_count?: unknown;
  amount_minor?: unknown;
  settled_minor?: unknown;
  expected_minor?: unknown;
  severity?: unknown;
  action_type?: unknown;
  blocker_count?: unknown;
  warning_count?: unknown;
  status?: unknown;
  code?: unknown;
  section_key?: unknown;
  provider_id?: unknown;
};

export const intelligenceToolDefinitions: Record<IntelligenceToolKey, IntelligenceToolDefinition> =
  {
    BRANCH_SUMMARY: tool(
      "BRANCH_SUMMARY",
      permissions.intelligenceManagement,
      [permissions.managementView, permissions.managementFinanceView],
      "Quality-aware branch sales, cost, margin, and order aggregates",
    ),
    OWNER_SUMMARY: tool(
      "OWNER_SUMMARY",
      permissions.intelligenceOwner,
      [
        permissions.managementView,
        permissions.managementFinanceView,
        permissions.tenantScopeAllBranches,
      ],
      "Authorized multi-branch management aggregates",
    ),
    ENTERPRISE_OVERVIEW: tool(
      "ENTERPRISE_OVERVIEW",
      permissions.intelligenceOwner,
      [permissions.enterpriseView],
      "Authorized hierarchy-scoped branch performance, rollout, and readiness evidence",
    ),
    FLASH_PNL: tool(
      "FLASH_PNL",
      permissions.intelligenceFinance,
      [permissions.managementFinanceView],
      "Managerial Flash P&L read model",
    ),
    FOOD_COST_BRIDGE: tool(
      "FOOD_COST_BRIDGE",
      permissions.intelligenceFinance,
      [permissions.managementFinanceView, permissions.inventoryCostControlView],
      "Persisted Pass 7 food-cost bridge and unexplained remainder",
    ),
    CHANNEL_PROFITABILITY: tool(
      "CHANNEL_PROFITABILITY",
      permissions.intelligenceManagement,
      [permissions.managementView, permissions.managementFinanceView],
      "Provider-neutral channel profitability read model",
    ),
    MENU_PROFITABILITY: tool(
      "MENU_PROFITABILITY",
      permissions.intelligenceInventory,
      [permissions.inventoryCostControlView],
      "Pass 6 and Pass 7 menu profitability evidence",
    ),
    INVENTORY_RISK: tool(
      "INVENTORY_RISK",
      permissions.intelligenceInventory,
      [permissions.inventoryView],
      "Authoritative balances, availability, forecast, and data-quality risks",
    ),
    PURCHASE_RECOMMENDATIONS: tool(
      "PURCHASE_RECOMMENDATIONS",
      permissions.intelligenceInventory,
      [permissions.inventoryView],
      "Deterministic Pass 6 purchase recommendations",
    ),
    SUPPLIER_PERFORMANCE: tool(
      "SUPPLIER_PERFORMANCE",
      permissions.intelligenceInventory,
      [permissions.inventoryView, permissions.reportsView],
      "Persisted supplier lead-time, fill-rate, price, and invoice facts",
    ),
    KITCHEN_PERFORMANCE: tool(
      "KITCHEN_PERFORMANCE",
      permissions.intelligenceManagement,
      [permissions.managementView],
      "Persisted station timing and ticket evidence",
    ),
    STAFF_OPERATIONS: tool(
      "STAFF_OPERATIONS",
      permissions.intelligenceStaff,
      [permissions.staffManage],
      "Factual staff operational metrics without character judgment",
    ),
    PAYMENT_RECONCILIATION: tool(
      "PAYMENT_RECONCILIATION",
      permissions.intelligenceFinance,
      [permissions.paymentsView, permissions.reconciliationView],
      "Confirmed collection and reconciliation exception evidence",
    ),
    SETTLEMENT_EXCEPTIONS: tool(
      "SETTLEMENT_EXCEPTIONS",
      permissions.intelligenceFinance,
      [permissions.reconciliationView],
      "Marketplace/provider settlement status and variance evidence",
    ),
    MANAGEMENT_ACTIONS: tool(
      "MANAGEMENT_ACTIONS",
      permissions.intelligenceManagement,
      [permissions.managementView],
      "Existing Management Action Centre evidence",
    ),
    CLOSE_READINESS: tool(
      "CLOSE_READINESS",
      permissions.intelligenceFinance,
      [permissions.reconciliationView],
      "Pass 7 close-readiness blockers",
    ),
    BRANCH_HEALTH: tool(
      "BRANCH_HEALTH",
      permissions.intelligenceManagement,
      [permissions.managementView],
      "Policy-backed branch health read model",
    ),
    SETUP_READINESS: tool(
      "SETUP_READINESS",
      permissions.intelligenceAdmin,
      [permissions.setupView],
      "Pass 8 readiness evidence",
    ),
    INTEGRATION_HEALTH: tool(
      "INTEGRATION_HEALTH",
      permissions.intelligenceManagement,
      [permissions.integrationsOrdersView],
      "Configured provider and durable-worker health evidence",
    ),
    CRM_SUMMARY: tool(
      "CRM_SUMMARY",
      permissions.intelligenceManagement,
      [permissions.crmView],
      "Aggregate customer activity and value without customer contact data",
    ),
    CRM_RETENTION: tool(
      "CRM_RETENTION",
      permissions.intelligenceManagement,
      [permissions.crmView],
      "Deterministic repeat, active, and lapsed customer metrics",
    ),
    CRM_LOYALTY: tool(
      "CRM_LOYALTY",
      permissions.intelligenceManagement,
      [permissions.crmView, permissions.loyaltyView],
      "Configured loyalty membership and append-only points ledger totals",
    ),
    CRM_CAMPAIGNS: tool(
      "CRM_CAMPAIGNS",
      permissions.intelligenceManagement,
      [permissions.crmView, permissions.campaignView],
      "Consent-gated campaign delivery aggregates and deterministic attribution",
    ),
    CRM_FEEDBACK: tool(
      "CRM_FEEDBACK",
      permissions.intelligenceManagement,
      [permissions.crmView, permissions.feedbackView],
      "Branch-scoped feedback, CSAT, and configured NPS aggregates",
    ),
    PRODUCT_HELP: tool(
      "PRODUCT_HELP",
      permissions.intelligenceAsk,
      [],
      "Curated Seramet product help",
    ),
  };

export class IntelligenceEvidenceService {
  private currency = "XXX";
  private locale = "en";

  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async build(plan: IntelligencePlan, requestedBranchIds?: string[]): Promise<EvidencePackage> {
    const tenant = await this.db
      .prepare("SELECT default_currency,locale FROM tenants WHERE id=? AND active=1")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string; locale: string }>();
    this.currency = tenant?.default_currency || "XXX";
    this.locale = tenant?.locale || "en";
    const branchIds = await this.authorizedBranchIds(
      requestedBranchIds,
      plan.intent === "OWNER_OVERVIEW" || plan.intent === "ENTERPRISE_OVERVIEW",
    );
    const results: ToolResult[] = [];
    for (const key of plan.tools) {
      this.authorizeTool(key);
      results.push(await this.execute(key, branchIds, plan));
    }
    const qualityReasons = unique(results.flatMap((result) => result.qualityReasons));
    const sources = results.flatMap((result) => result.sources);
    const calculatedAt = new Date().toISOString();
    const branchRows = await this.db
      .prepare(
        `SELECT id,name FROM branches WHERE tenant_id=? AND id IN (${placeholders(branchIds.length)})
         ORDER BY name`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<{ id: string; name: string }>();
    const watermark = await hashJson({
      tenantId: this.actor.tenantId,
      branchIds,
      period: plan.period,
      sources: sources.map((source) => [source.ref, source.payloadHash, source.calculatedAt]),
    });
    return {
      id: crypto.randomUUID(),
      intent: plan.intent,
      tenantId: this.actor.tenantId,
      authorizedBranchIds: branchIds,
      branchLabels: (branchRows.results ?? []).map((branch) => branch.name),
      period: plan.period,
      metrics: results.flatMap((result) => result.metrics),
      findings: results.flatMap((result) => result.findings).slice(0, 50),
      sources,
      quality: combineQuality(results.map((result) => result.quality)),
      qualityReasons,
      configurationGaps: unique(results.flatMap((result) => result.configurationGaps)),
      limitations: unique(results.flatMap((result) => result.limitations)),
      evidenceWatermark: watermark,
      calculatedAt,
    };
  }

  private authorizeTool(key: IntelligenceToolKey) {
    const definition = intelligenceToolDefinitions[key];
    for (const permission of [definition.intelligencePermission, ...definition.sourcePermissions]) {
      if (!this.actor.permissions.includes(permission)) {
        if (permission === permissions.tenantScopeAllBranches) {
          throw new Error(`All-branch permission is required before retrieving ${key} evidence`);
        }
        throw new Error(`Permission ${permission} is required before retrieving ${key} evidence`);
      }
    }
  }

  private async authorizedBranchIds(requested: string[] | undefined, owner: boolean) {
    const assigned = new Set(this.actor.assignedBranchIds);
    const canUseAll = this.actor.permissions.includes(permissions.tenantScopeAllBranches);
    const branchIds = unique(
      requested?.length
        ? requested
        : owner && canUseAll
          ? this.actor.assignedBranchIds
          : [this.actor.branchId],
    );
    if (branchIds.length === 0) throw new Error("No authorized branch is available");
    for (const branchId of branchIds) {
      authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
      if (!assigned.has(branchId) && !canUseAll) throw new Error("Branch scope is not authorized");
    }
    return branchIds;
  }

  private execute(key: IntelligenceToolKey, branchIds: string[], plan: IntelligencePlan) {
    switch (key) {
      case "BRANCH_SUMMARY":
        return this.branchSummary(branchIds, plan);
      case "OWNER_SUMMARY":
        return this.ownerSummary(branchIds, plan);
      case "ENTERPRISE_OVERVIEW":
        return this.enterpriseOverview(branchIds, plan);
      case "FLASH_PNL":
        return this.flashPnl(branchIds, plan);
      case "FOOD_COST_BRIDGE":
        return this.foodCostBridge(branchIds, plan);
      case "CHANNEL_PROFITABILITY":
        return this.channelProfitability(branchIds, plan);
      case "MENU_PROFITABILITY":
        return this.menuProfitability(branchIds, plan);
      case "INVENTORY_RISK":
        return this.inventoryRisk(branchIds);
      case "PURCHASE_RECOMMENDATIONS":
        return this.purchaseRecommendations(branchIds);
      case "SUPPLIER_PERFORMANCE":
        return this.supplierPerformance(branchIds, plan);
      case "KITCHEN_PERFORMANCE":
        return this.kitchenPerformance(branchIds, plan);
      case "STAFF_OPERATIONS":
        return this.staffOperations(branchIds, plan);
      case "PAYMENT_RECONCILIATION":
        return this.paymentReconciliation(branchIds, plan);
      case "SETTLEMENT_EXCEPTIONS":
        return this.settlementExceptions(branchIds, plan);
      case "MANAGEMENT_ACTIONS":
        return this.managementActions(branchIds);
      case "CLOSE_READINESS":
        return this.closeReadiness(branchIds, plan);
      case "BRANCH_HEALTH":
        return this.branchHealth(branchIds, plan);
      case "SETUP_READINESS":
        return this.setupReadiness(branchIds);
      case "INTEGRATION_HEALTH":
        return this.integrationHealth(branchIds);
      case "CRM_SUMMARY":
        return this.crmSummary(branchIds);
      case "CRM_RETENTION":
        return this.crmRetention(branchIds);
      case "CRM_LOYALTY":
        return this.crmLoyalty(branchIds);
      case "CRM_CAMPAIGNS":
        return this.crmCampaigns(branchIds);
      case "CRM_FEEDBACK":
        return this.crmFeedback(branchIds);
      case "PRODUCT_HELP":
        return Promise.resolve(this.productHelp());
    }
  }

  private async branchSummary(branchIds: string[], plan: IntelligencePlan): Promise<ToolResult> {
    const rows = await this.db
      .prepare(
        `SELECT m.branch_id,b.name branch_name,m.currency,
          SUM(m.net_sales_minor) net_sales_minor,SUM(m.gross_profit_minor) gross_profit_minor,
          SUM(m.cogs_minor) cogs_minor,SUM(m.order_count) order_count,
          SUM(m.wastage_minor) wastage_minor,SUM(m.inventory_variance_minor) inventory_variance_minor,
          MAX(m.calculated_at) calculated_at,
          CASE WHEN SUM(m.net_revenue_minor)=0 THEN 0
            ELSE CAST(SUM(m.cogs_minor)*10000/SUM(m.net_revenue_minor) AS INTEGER) END food_cost_bps,
          MIN(CASE m.quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END) quality_rank
         FROM daily_branch_metrics m JOIN branches b ON b.tenant_id=m.tenant_id AND b.id=m.branch_id
         WHERE m.tenant_id=? AND m.branch_id IN (${placeholders(branchIds.length)})
           AND m.business_date BETWEEN ? AND ? GROUP BY m.branch_id,b.name,m.currency ORDER BY b.name`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return await this.rowsToResult("BRANCH_SUMMARY", rows.results ?? [], (row, ref) => {
      const netSales = num(row.net_sales_minor);
      const orders = num(row.order_count);
      return {
        metrics: [
          metric("NET_SALES", `${str(row.branch_name)} net sales`, netSales, "MINOR", row, ref),
          metric(
            "GROSS_PROFIT",
            `${str(row.branch_name)} gross profit`,
            num(row.gross_profit_minor),
            "MINOR",
            row,
            ref,
          ),
          metric("COGS", `${str(row.branch_name)} COGS`, num(row.cogs_minor), "MINOR", row, ref),
          metric(
            "FOOD_COST",
            `${str(row.branch_name)} food cost`,
            num(row.food_cost_bps),
            "BPS",
            row,
            ref,
          ),
          metric("ORDER_COUNT", `${str(row.branch_name)} orders`, orders, "COUNT", row, ref),
        ],
        findings: [
          finding(
            `${str(row.branch_name)} recorded net sales of ${money(netSales, this.currency, this.locale)} across ${orders} orders for the selected period.`,
            ref,
            "/command-centre",
          ),
        ],
      };
    });
  }

  private async ownerSummary(branchIds: string[], plan: IntelligencePlan) {
    const result = await this.branchSummary(branchIds, plan);
    const sales = result.metrics.filter((metricRow) => metricRow.code === "NET_SALES");
    if (sales.length > 1) {
      const sorted = [...sales].sort((left, right) => right.value - left.value);
      const best = sorted[0]!;
      result.findings.unshift(
        finding(
          `${best.label.replace(" net sales", "")} had the highest net sales at ${money(best.value, this.currency, this.locale)} for this revenue comparison.`,
          best.evidenceRef,
          "/command-centre",
        ),
      );
    }
    return result;
  }

  private async flashPnl(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,currency,SUM(net_revenue_minor) net_revenue_minor,SUM(cogs_minor) cogs_minor,
          SUM(gross_profit_minor) gross_profit_minor,SUM(labour_cost_minor) labour_cost_minor,
          SUM(operating_expenses_minor) operating_expenses_minor,
          SUM(flash_operating_result_minor) flash_operating_result_minor,
          MAX(calculated_at) calculated_at,
          MIN(CASE quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'PARTIAL' THEN 1 ELSE 2 END) quality_rank
         FROM financial_summary_periods WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
           AND period_type='DAY' AND period_end BETWEEN ? AND ? GROUP BY branch_id,currency`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult(
      "FLASH_PNL",
      rows.results ?? [],
      (row, ref) => {
        const result = num(row.flash_operating_result_minor);
        return {
          metrics: [
            metric("NET_REVENUE", "Net revenue", num(row.net_revenue_minor), "MINOR", row, ref),
            metric("COGS", "COGS", num(row.cogs_minor), "MINOR", row, ref),
            metric("GROSS_PROFIT", "Gross profit", num(row.gross_profit_minor), "MINOR", row, ref),
            metric("LABOUR_COST", "Labour cost", num(row.labour_cost_minor), "MINOR", row, ref),
            metric(
              "FLASH_OPERATING_RESULT",
              "Managerial Flash Operating Result",
              result,
              "MINOR",
              row,
              ref,
            ),
          ],
          findings: [
            finding(
              `Seramet's managerial Flash Operating Result is ${money(result, this.currency, this.locale)} for the selected period; it is not a statutory financial statement.`,
              ref,
              "/finance",
            ),
          ],
        };
      },
      ["Managerial Flash P&L is an operational read model, not an audited statutory statement."],
    );
  }

  private async foodCostBridge(branchIds: string[], plan: IntelligencePlan) {
    const outputs: ToolResult[] = [];
    for (const branchId of branchIds) {
      const bridge = await new ManagementIntelligenceService(this.db, this.actor).foodCostBridge({
        branchId,
        currentStart: plan.period.start,
        currentEnd: plan.period.end,
        previousStart: plan.period.comparisonStart ?? plan.period.start,
        previousEnd: plan.period.comparisonEnd ?? plan.period.end,
      });
      const ref = `FOOD_COST_BRIDGE:${branchId}:${plan.period.end}`;
      const hash = await hashJson(bridge);
      const metrics = [
        simpleMetric(
          "PREVIOUS_FOOD_COST",
          "Previous food cost",
          bridge.previousCostMinor,
          "MINOR",
          bridge.quality,
          ref,
        ),
        simpleMetric(
          "CURRENT_FOOD_COST",
          "Current food cost",
          bridge.currentCostMinor,
          "MINOR",
          bridge.quality,
          ref,
        ),
        simpleMetric(
          "FOOD_COST_CHANGE",
          "Food cost change",
          bridge.changeMinor,
          "MINOR",
          bridge.quality,
          ref,
        ),
        simpleMetric(
          "UNEXPLAINED_FOOD_COST",
          "Unexplained food-cost change",
          bridge.unexplainedMinor,
          "MINOR",
          bridge.quality,
          ref,
        ),
        ...bridge.drivers.map((driver) =>
          simpleMetric(driver.code, driver.label, driver.amountMinor, "MINOR", bridge.quality, ref),
        ),
      ];
      const findings = bridge.drivers.map((driver) =>
        finding(
          `${driver.label} contributed ${money(driver.amountMinor, this.currency, this.locale)} based on persisted operational evidence.`,
          ref,
          "/cost-control",
        ),
      );
      if (bridge.unexplainedMinor !== 0) {
        findings.push({
          id: crypto.randomUUID(),
          title: "Unexplained food-cost variance",
          statement: `${money(bridge.unexplainedMinor, this.currency, this.locale)} of the food-cost change remains unexplained.`,
          classification: "UNEXPLAINED",
          severity: "HIGH",
          evidenceRefs: [ref],
          route: "/cost-control",
        });
      }
      outputs.push({
        metrics,
        findings,
        sources: [
          {
            ref,
            toolKey: "FOOD_COST_BRIDGE",
            sourceType: "PASS_7_FOOD_COST_BRIDGE",
            sourceId: `${branchId}:${plan.period.end}`,
            branchId,
            quality: bridge.quality,
            calculatedAt: new Date().toISOString(),
            payloadHash: hash,
          },
        ],
        quality: bridge.quality,
        qualityReasons: bridge.qualityReasons,
        configurationGaps: bridge.qualityReasons.filter((reason) => reason.startsWith("MISSING_")),
        limitations: ["Only persisted drivers are attributed; the residual remains UNEXPLAINED."],
      });
    }
    return mergeResults(outputs);
  }

  private async channelProfitability(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,channel_key,channel_label,currency,SUM(order_count) order_count,
       SUM(net_sales_minor) net_sales_minor,SUM(commission_minor) commission_minor,
       SUM(provider_fees_minor) provider_fees_minor,SUM(contribution_minor) contribution_minor,
       MAX(calculated_at) calculated_at,MIN(CASE quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END) quality_rank
       FROM daily_channel_metrics WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
       AND business_date BETWEEN ? AND ? GROUP BY branch_id,channel_key,channel_label,currency
       ORDER BY contribution_minor DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("CHANNEL_PROFITABILITY", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "CHANNEL_NET_SALES",
          `${str(row.channel_label)} net sales`,
          num(row.net_sales_minor),
          "MINOR",
          row,
          ref,
        ),
        metric(
          "CHANNEL_CONTRIBUTION",
          `${str(row.channel_label)} contribution`,
          num(row.contribution_minor),
          "MINOR",
          row,
          ref,
        ),
        metric(
          "CHANNEL_COMMISSION",
          `${str(row.channel_label)} commission`,
          num(row.commission_minor),
          "MINOR",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `${str(row.channel_label)} contributed ${money(num(row.contribution_minor), this.currency, this.locale)} after persisted channel costs.`,
          ref,
          "/command-centre",
        ),
      ],
    }));
  }

  private async menuProfitability(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,menu_item_id,SUM(quantity_sold) quantity_sold,SUM(net_revenue_minor) net_revenue_minor,
       SUM(theoretical_cost_minor) theoretical_cost_minor,SUM(contribution_minor) contribution_minor,
       MAX(food_cost_bps) food_cost_bps,MAX(classification) classification,MAX(calculated_at) calculated_at,
       MIN(CASE quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END) quality_rank
       FROM daily_menu_item_metrics WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
       AND business_date BETWEEN ? AND ? GROUP BY branch_id,menu_item_id ORDER BY contribution_minor DESC LIMIT 50`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("MENU_PROFITABILITY", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "MENU_CONTRIBUTION",
          `Menu item ${str(row.menu_item_id)} contribution`,
          num(row.contribution_minor),
          "MINOR",
          row,
          ref,
        ),
        metric(
          "MENU_FOOD_COST",
          `Menu item ${str(row.menu_item_id)} food cost`,
          num(row.food_cost_bps),
          "BPS",
          row,
          ref,
        ),
        metric(
          "MENU_QUANTITY",
          `Menu item ${str(row.menu_item_id)} sold`,
          num(row.quantity_sold),
          "COUNT",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `Menu item ${str(row.menu_item_id)} has persisted contribution of ${money(num(row.contribution_minor), this.currency, this.locale)} and classification ${str(row.classification)}.`,
          ref,
          "/cost-control",
        ),
      ],
    }));
  }

  private async inventoryRisk(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT b.branch_id,b.item_id,i.name,b.quantity_minor,b.updated_at calculated_at,
       COALESCE(a.available_portions,0) available_portions,COALESCE(a.available,1) available,
       COALESCE(a.quality,'INSUFFICIENT_DATA') quality
       FROM inventory_balances b JOIN inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
       LEFT JOIN menu_inventory_availability a ON a.tenant_id=b.tenant_id AND a.branch_id=b.branch_id
         AND a.menu_item_id=b.item_id
       WHERE b.tenant_id=? AND b.branch_id IN (${placeholders(branchIds.length)})
       ORDER BY b.quantity_minor ASC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    const result = await this.rowsToResult("INVENTORY_RISK", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "QUANTITY_ON_HAND",
          `${str(row.name)} on hand`,
          num(row.quantity_minor),
          "MICRO",
          row,
          ref,
        ),
      ],
      findings:
        num(row.quantity_minor) <= 0
          ? [
              finding(
                `${str(row.name)} has authoritative on-hand quantity of ${num(row.quantity_minor)} base micro-units.`,
                ref,
                "/inventory",
              ),
            ]
          : [],
    }));
    const issues = await this.db
      .prepare(
        `SELECT COUNT(*) count FROM inventory_data_quality_issues WHERE tenant_id=?
       AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)})) AND status='OPEN'`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .first<{ count: number }>();
    if ((issues?.count ?? 0) > 0) result.qualityReasons.push("OPEN_INVENTORY_DATA_QUALITY_ISSUES");
    return result;
  }

  private async purchaseRecommendations(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT r.*,i.name item_name,s.name supplier_name FROM purchase_recommendations r
       JOIN inventory_items i ON i.tenant_id=r.tenant_id AND i.id=r.inventory_item_id
       LEFT JOIN suppliers s ON s.tenant_id=r.tenant_id AND s.id=r.supplier_id
       WHERE r.tenant_id=? AND r.branch_id IN (${placeholders(branchIds.length)}) AND r.status='OPEN'
       ORDER BY r.recommended_order_date,r.recommended_base_quantity_minor DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult(
      "PURCHASE_RECOMMENDATIONS",
      rows.results ?? [],
      (row, ref) => ({
        metrics: [
          metric(
            "RECOMMENDED_PURCHASE",
            `${str(row.item_name)} recommended purchase`,
            num(row.recommended_purchase_quantity_minor),
            "MICRO",
            row,
            ref,
          ),
          metric(
            "FORECAST_CONSUMPTION",
            `${str(row.item_name)} forecast`,
            num(row.forecast_quantity_minor),
            "MICRO",
            row,
            ref,
          ),
          metric(
            "ON_HAND",
            `${str(row.item_name)} on hand`,
            num(row.on_hand_quantity_minor),
            "MICRO",
            row,
            ref,
          ),
          metric(
            "INCOMING",
            `${str(row.item_name)} incoming`,
            num(row.incoming_quantity_minor),
            "MICRO",
            row,
            ref,
          ),
        ],
        findings: [
          finding(
            `${str(row.item_name)} has a deterministic purchase recommendation of ${num(row.recommended_purchase_quantity_minor)} purchase-unit micro-units; Seramet has not placed an order.`,
            ref,
            "/procurement",
          ),
        ],
      }),
      ["Purchase recommendations are review-only and never create supplier orders automatically."],
    );
  }

  private async supplierPerformance(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT m.branch_id,m.supplier_id,s.name supplier_name,m.currency,SUM(m.purchase_value_minor) purchase_value_minor,
       SUM(m.price_variance_minor) price_variance_minor,SUM(m.invoice_match_exceptions) invoice_match_exceptions,
       AVG(m.fill_rate_bps) fill_rate_bps,AVG(m.on_time_bps) on_time_bps,MAX(m.calculated_at) calculated_at,
       MIN(CASE m.quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END) quality_rank
       FROM daily_supplier_metrics m JOIN suppliers s ON s.tenant_id=m.tenant_id AND s.id=m.supplier_id
       WHERE m.tenant_id=? AND m.branch_id IN (${placeholders(branchIds.length)})
       AND m.business_date BETWEEN ? AND ? GROUP BY m.branch_id,m.supplier_id,s.name,m.currency
       ORDER BY price_variance_minor DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("SUPPLIER_PERFORMANCE", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "SUPPLIER_PRICE_VARIANCE",
          `${str(row.supplier_name)} price variance`,
          num(row.price_variance_minor),
          "MINOR",
          row,
          ref,
        ),
        metric(
          "SUPPLIER_FILL_RATE",
          `${str(row.supplier_name)} fill rate`,
          num(row.fill_rate_bps),
          "BPS",
          row,
          ref,
        ),
        metric(
          "SUPPLIER_ON_TIME",
          `${str(row.supplier_name)} on-time rate`,
          num(row.on_time_bps),
          "BPS",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `${str(row.supplier_name)} has persisted purchase-price variance of ${money(num(row.price_variance_minor), this.currency, this.locale)}.`,
          ref,
          "/supplier-performance",
        ),
      ],
    }));
  }

  private async kitchenPerformance(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT m.*,s.name station_name FROM daily_station_metrics m
       JOIN stations s ON s.tenant_id=m.tenant_id AND s.id=m.station_id
       WHERE m.tenant_id=? AND m.branch_id IN (${placeholders(branchIds.length)})
       AND m.business_date BETWEEN ? AND ? ORDER BY m.p90_prep_ms DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("KITCHEN_PERFORMANCE", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "STATION_P90",
          `${str(row.station_name)} P90 prep time`,
          num(row.p90_prep_ms),
          "MILLISECONDS",
          row,
          ref,
        ),
        metric(
          "STATION_AVERAGE",
          `${str(row.station_name)} average prep time`,
          num(row.average_prep_ms),
          "MILLISECONDS",
          row,
          ref,
        ),
        metric(
          "STATION_LATE_TICKETS",
          `${str(row.station_name)} late tickets`,
          num(row.late_count),
          "COUNT",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `${str(row.station_name)} recorded P90 prep time of ${num(row.p90_prep_ms)} milliseconds from persisted kitchen timestamps.`,
          ref,
          "/kitchen-analytics",
        ),
      ],
    }));
  }

  private async staffOperations(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,employee_id,SUM(late_minutes) late_minutes,SUM(orders_handled) orders_handled,
       SUM(worked_minutes) worked_minutes,AVG(average_service_ms) average_service_ms,
       SUM(approved_discounts) approved_discounts,SUM(refund_involvement) refund_involvement,
       MAX(calculated_at) calculated_at,
       MIN(CASE quality WHEN 'INSUFFICIENT_DATA' THEN 0 WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END) quality_rank
       FROM daily_staff_metrics WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
       AND business_date BETWEEN ? AND ? GROUP BY branch_id,employee_id ORDER BY late_minutes DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("STAFF_OPERATIONS", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "STAFF_LATE_MINUTES",
          `Employee ${shortId(str(row.employee_id))} late minutes`,
          num(row.late_minutes),
          "COUNT",
          row,
          ref,
        ),
        metric(
          "STAFF_ORDERS",
          `Employee ${shortId(str(row.employee_id))} orders handled`,
          num(row.orders_handled),
          "COUNT",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `Employee ${shortId(str(row.employee_id))} recorded ${num(row.late_minutes)} late minutes in the selected period. This is an operational fact, not a character judgment.`,
          ref,
          "/performance",
        ),
      ],
    }));
  }

  private async paymentReconciliation(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,status,severity,currency,COUNT(*) record_count,SUM(amount_minor) amount_minor,
       MAX(updated_at) calculated_at FROM reconciliation_exceptions
       WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
       AND date(created_at) BETWEEN ? AND ? AND status NOT IN ('RESOLVED','IGNORED')
       GROUP BY branch_id,status,severity,currency ORDER BY amount_minor DESC`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("PAYMENT_RECONCILIATION", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "RECONCILIATION_EXCEPTION_COUNT",
          "Open reconciliation exceptions",
          num(row.record_count),
          "COUNT",
          row,
          ref,
        ),
        metric(
          "RECONCILIATION_EXCEPTION_VALUE",
          "Open reconciliation exception value",
          num(row.amount_minor),
          "MINOR",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `${num(row.record_count)} reconciliation exceptions remain open with value ${money(num(row.amount_minor), this.currency, this.locale)}.`,
          ref,
          "/reconciliation",
        ),
      ],
    }));
  }

  private async settlementExceptions(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,status,currency,COUNT(*) record_count,SUM(net_expected_minor) expected_minor,
       SUM(net_settled_minor) settled_minor,MAX(updated_at) calculated_at
       FROM settlement_batches WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
       AND period_end BETWEEN ? AND ? GROUP BY branch_id,status,currency ORDER BY period_end DESC`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("SETTLEMENT_EXCEPTIONS", rows.results ?? [], (row, ref) => {
      const difference = num(row.settled_minor) - num(row.expected_minor);
      return {
        metrics: [
          metric(
            "SETTLEMENT_EXPECTED",
            "Settlement expected",
            num(row.expected_minor),
            "MINOR",
            row,
            ref,
          ),
          metric(
            "SETTLEMENT_RECEIVED",
            "Settlement received",
            num(row.settled_minor),
            "MINOR",
            row,
            ref,
          ),
          metric("SETTLEMENT_VARIANCE", "Settlement variance", difference, "MINOR", row, ref),
        ],
        findings:
          difference !== 0
            ? [
                finding(
                  `Settlement variance is ${money(difference, this.currency, this.locale)} and remains subject to reconciliation.`,
                  ref,
                  "/reconciliation",
                ),
              ]
            : [],
      };
    });
  }

  private async managementActions(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT * FROM management_actions WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
       AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,last_detected_at DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult("MANAGEMENT_ACTIONS", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric("ACTION_COUNT", `${str(row.severity)} management action`, 1, "COUNT", row, ref),
      ],
      findings: [
        {
          id: str(row.id),
          title: str(row.action_type).replaceAll("_", " "),
          statement: `${str(row.severity)} management action ${str(row.action_type).replaceAll("_", " ")} requires review.`,
          classification: "CONFIRMED",
          severity: severity(row.severity),
          evidenceRefs: [ref],
          route: "/command-centre",
        },
      ],
    }));
  }

  private async closeReadiness(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT * FROM close_readiness_snapshots WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
       AND business_date BETWEEN ? AND ? ORDER BY business_date DESC`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("CLOSE_READINESS", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric("CLOSE_BLOCKERS", "Close blockers", num(row.blocker_count), "COUNT", row, ref),
        metric("CLOSE_WARNINGS", "Close warnings", num(row.warning_count), "COUNT", row, ref),
      ],
      findings:
        num(row.blocker_count) > 0
          ? [
              finding(
                `${num(row.blocker_count)} blockers prevent a clean close for business date ${str(row.business_date)}.`,
                ref,
                "/period-close",
              ),
            ]
          : [],
    }));
  }

  private async branchHealth(branchIds: string[], plan: IntelligencePlan) {
    const rows = await this.db
      .prepare(
        `SELECT * FROM branch_health_snapshots WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})
       AND business_date BETWEEN ? AND ? ORDER BY business_date DESC`,
      )
      .bind(this.actor.tenantId, ...branchIds, plan.period.start, plan.period.end)
      .all<Row>();
    return this.rowsToResult("BRANCH_HEALTH", rows.results ?? [], (row, ref) => ({
      metrics: [],
      findings: [
        finding(
          `Branch health is ${str(row.status)} for business date ${str(row.business_date)} based on persisted policy evidence.`,
          ref,
          "/command-centre",
        ),
      ],
    }));
  }

  private async setupReadiness(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT branch_id,status,severity,section_key,code,message,calculated_at FROM setup_readiness_results
       WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
       AND status IN ('WARNING','BLOCKED') ORDER BY CASE severity WHEN 'SECURITY' THEN 0 WHEN 'CRITICAL' THEN 1 ELSE 2 END LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult("SETUP_READINESS", rows.results ?? [], (row, ref) => ({
      metrics: [metric("READINESS_ISSUE", `${str(row.status)} setup issue`, 1, "COUNT", row, ref)],
      findings: [
        finding(
          `Setup ${str(row.status).toLowerCase()} ${str(row.code)} remains open in ${str(row.section_key)}.`,
          ref,
          "/seramet-setup",
        ),
      ],
    }));
  }

  private async integrationHealth(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT id source_id,branch_id,provider_id,status,updated_at calculated_at FROM provider_connections
       WHERE tenant_id=? AND (branch_id IS NULL OR branch_id IN (${placeholders(branchIds.length)}))
       ORDER BY updated_at DESC LIMIT 100`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult("INTEGRATION_HEALTH", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric("PROVIDER_CONNECTION", `${str(row.provider_id)} connection`, 1, "COUNT", row, ref),
      ],
      findings: !["ACTIVE", "CONNECTED", "HEALTHY"].includes(str(row.status))
        ? [
            finding(
              `Configured provider ${str(row.provider_id)} reports status ${str(row.status)}.`,
              ref,
              "/integrations",
            ),
          ]
        : [],
    }));
  }

  private async enterpriseOverview(
    branchIds: string[],
    plan: IntelligencePlan,
  ): Promise<ToolResult> {
    const rows = await this.db
      .prepare(
        `SELECT b.id branch_id,b.name branch_name,
                COALESCE(SUM(m.net_sales_minor),0) net_sales_minor,
                COALESCE(SUM(m.gross_profit_minor),0) gross_profit_minor,
                COALESCE(SUM(m.order_count),0) order_count,
                COALESCE(MAX(m.currency),'') currency,
                CASE WHEN COUNT(m.business_date)=0 THEN 'INSUFFICIENT_DATA' ELSE MIN(m.quality) END quality,
                COALESCE((SELECT COUNT(*) FROM enterprise_rollout_items i
                  WHERE i.tenant_id=b.tenant_id AND i.branch_id=b.id
                    AND i.status IN ('BLOCKED','FAILED')),0) rollout_issue_count,
                COALESCE((SELECT COUNT(*) FROM enterprise_readiness_results r
                  WHERE r.tenant_id=b.tenant_id AND r.branch_id=b.id
                    AND r.status IN ('BLOCKED','WARNING','UNKNOWN')),0) readiness_issue_count,
                COALESCE(MAX(m.calculated_at),CURRENT_TIMESTAMP) calculated_at
         FROM branches b
         LEFT JOIN daily_branch_metrics m ON m.tenant_id=b.tenant_id AND m.branch_id=b.id
           AND m.business_date BETWEEN ? AND ?
         WHERE b.tenant_id=? AND b.id IN (${placeholders(branchIds.length)})
         GROUP BY b.id,b.name,b.tenant_id ORDER BY b.name`,
      )
      .bind(plan.period.start, plan.period.end, this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult(
      "ENTERPRISE_OVERVIEW",
      rows.results ?? [],
      (row, ref) => ({
        metrics: [
          metric(
            "ENTERPRISE_NET_SALES",
            `${str(row.branch_name)} net sales`,
            num(row.net_sales_minor),
            "MINOR",
            row,
            ref,
          ),
          metric(
            "ENTERPRISE_GROSS_PROFIT",
            `${str(row.branch_name)} gross profit`,
            num(row.gross_profit_minor),
            "MINOR",
            row,
            ref,
          ),
          metric(
            "ENTERPRISE_ORDER_COUNT",
            `${str(row.branch_name)} orders`,
            num(row.order_count),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "ENTERPRISE_ROLLOUT_ISSUES",
            `${str(row.branch_name)} rollout issues`,
            num(row["rollout_issue_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "ENTERPRISE_READINESS_ISSUES",
            `${str(row.branch_name)} readiness issues`,
            num(row["readiness_issue_count"]),
            "COUNT",
            row,
            ref,
          ),
        ],
        findings: [
          finding(
            `${str(row.branch_name)} has ${num(row["rollout_issue_count"])} rollout issues and ${num(row["readiness_issue_count"])} readiness issues in persisted enterprise evidence.`,
            ref,
            "/enterprise",
          ),
        ],
      }),
      [
        "Enterprise figures are management aggregation, not statutory consolidation.",
        "Cross-currency figures remain branch-attributed unless an authoritative FX basis is configured.",
      ],
    );
  }

  private async crmSummary(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `WITH scoped AS (
           SELECT customer_id,net_minor,business_date FROM customer_transaction_links
           WHERE tenant_id=? AND completed=1 AND branch_id IN (${placeholders(branchIds.length)})
         ), customer_totals AS (
           SELECT customer_id,COUNT(*) order_count,SUM(net_minor) net_minor,MAX(business_date) last_visit
           FROM scoped GROUP BY customer_id
         )
         SELECT 'crm-summary' source_id,COUNT(*) customer_count,
                COALESCE(SUM(order_count),0) order_count,COALESCE(SUM(net_minor),0) net_spend_minor,
                COALESCE(SUM(CASE WHEN order_count>=2 THEN 1 ELSE 0 END),0) repeat_count,
                COALESCE(SUM(CASE WHEN last_visit>=date('now','-30 days') THEN 1 ELSE 0 END),0) active_count,
                CASE WHEN COUNT(*)=0 THEN 'INSUFFICIENT_DATA' ELSE 'HIGH' END quality,
                MAX(last_visit) calculated_at
         FROM customer_totals`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult(
      "CRM_SUMMARY",
      rows.results ?? [],
      (row, ref) => {
        const customers = num(row["customer_count"]);
        const repeat = num(row["repeat_count"]);
        return {
          metrics: [
            metric(
              "CRM_CUSTOMERS",
              "Customers with completed transactions",
              customers,
              "COUNT",
              row,
              ref,
            ),
            metric(
              "CRM_ORDERS",
              "Linked completed orders",
              num(row.order_count),
              "COUNT",
              row,
              ref,
            ),
            metric(
              "CRM_NET_SPEND",
              "Historical linked net spend",
              num(row["net_spend_minor"]),
              "MINOR",
              row,
              ref,
            ),
            metric("CRM_REPEAT_CUSTOMERS", "Repeat customers", repeat, "COUNT", row, ref),
            metric(
              "CRM_RETURN_RATE",
              "Repeat customer rate",
              customers ? Math.round((repeat * 10_000) / customers) : 0,
              "BPS",
              row,
              ref,
            ),
          ],
          findings: [
            finding(
              `${repeat} of ${customers} customers with completed linked orders have returned at least once.`,
              ref,
              "/crm",
            ),
          ],
        };
      },
      ["Only exact customer links on authoritative completed transactions are included."],
    );
  }

  private async crmRetention(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `WITH visits AS (
           SELECT customer_id,COUNT(*) visits,MAX(business_date) last_visit
           FROM customer_transaction_links WHERE tenant_id=? AND completed=1
             AND branch_id IN (${placeholders(branchIds.length)}) GROUP BY customer_id
         )
         SELECT 'crm-retention' source_id,COUNT(*) customer_count,
                COALESCE(SUM(CASE WHEN visits>=2 THEN 1 ELSE 0 END),0) retained_count,
                COALESCE(SUM(CASE WHEN last_visit<date('now','-60 days') THEN 1 ELSE 0 END),0) lapsed_count,
                COALESCE(SUM(CASE WHEN last_visit>=date('now','-30 days') THEN 1 ELSE 0 END),0) active_count,
                CASE WHEN COUNT(*)=0 THEN 'INSUFFICIENT_DATA' ELSE 'HIGH' END quality,
                CURRENT_TIMESTAMP calculated_at FROM visits`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult(
      "CRM_RETENTION",
      rows.results ?? [],
      (row, ref) => ({
        metrics: [
          metric(
            "RETENTION_CUSTOMERS",
            "Customers measured",
            num(row["customer_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "RETURNED_CUSTOMERS",
            "Customers with two or more visits",
            num(row["retained_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "LAPSED_CUSTOMERS",
            "Customers inactive for more than 60 days",
            num(row["lapsed_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "ACTIVE_CUSTOMERS",
            "Customers active in the last 30 days",
            num(row["active_count"]),
            "COUNT",
            row,
            ref,
          ),
        ],
        findings: [
          finding(
            `${num(row["lapsed_count"])} customers meet the documented 60-day lapsed definition.`,
            ref,
            "/segments",
          ),
        ],
      }),
      ["Lapsed means no completed linked transaction for more than 60 days in this evidence tool."],
    );
  }

  private async crmLoyalty(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `WITH scoped_customers AS (
           SELECT DISTINCT customer_id FROM customer_transaction_links
           WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)}) AND completed=1
         )
         SELECT 'crm-loyalty' source_id,
           (SELECT COUNT(DISTINCT m.customer_id) FROM customer_loyalty_memberships m
             WHERE m.tenant_id=? AND m.status='ACTIVE' AND m.customer_id IN (SELECT customer_id FROM scoped_customers)) member_count,
           COALESCE(SUM(CASE WHEN l.points>0 THEN l.points ELSE 0 END),0) points_issued,
           ABS(COALESCE(SUM(CASE WHEN l.entry_type='REDEEM' THEN l.points ELSE 0 END),0)) points_redeemed,
           COALESCE(SUM(l.points),0) points_outstanding,
           CASE WHEN COUNT(l.id)=0 THEN 'INSUFFICIENT_DATA' ELSE 'HIGH' END quality,
           MAX(l.created_at) calculated_at
         FROM loyalty_ledger l WHERE l.tenant_id=?
           AND l.customer_id IN (SELECT customer_id FROM scoped_customers)`,
      )
      .bind(this.actor.tenantId, ...branchIds, this.actor.tenantId, this.actor.tenantId)
      .all<Row>();
    return this.rowsToResult("CRM_LOYALTY", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "LOYALTY_MEMBERS",
          "Active loyalty members",
          num(row["member_count"]),
          "COUNT",
          row,
          ref,
        ),
        metric("POINTS_ISSUED", "Points issued", num(row["points_issued"]), "COUNT", row, ref),
        metric(
          "POINTS_REDEEMED",
          "Points redeemed",
          num(row["points_redeemed"]),
          "COUNT",
          row,
          ref,
        ),
        metric(
          "POINTS_OUTSTANDING",
          "Points outstanding",
          num(row["points_outstanding"]),
          "COUNT",
          row,
          ref,
        ),
      ],
      findings: [
        finding(
          `${num(row["points_outstanding"])} loyalty points remain outstanding for customers in the authorized branch scope.`,
          ref,
          "/loyalty",
        ),
      ],
    }));
  }

  private async crmCampaigns(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `WITH scoped_customers AS (
           SELECT DISTINCT customer_id FROM customer_transaction_links
           WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)}) AND completed=1
         )
         SELECT 'crm-campaigns' source_id,
           COUNT(DISTINCT d.campaign_id) campaign_count,
           COALESCE(SUM(CASE WHEN d.status='SENT' THEN 1 ELSE 0 END),0) sent_count,
           COALESCE(SUM(CASE WHEN d.status='DEAD_LETTER' THEN 1 ELSE 0 END),0) dead_letter_count,
           COALESCE(SUM(CASE WHEN d.status='UNSUBSCRIBED' THEN 1 ELSE 0 END),0) suppressed_count,
           CASE WHEN COUNT(d.id)=0 THEN 'INSUFFICIENT_DATA' ELSE 'HIGH' END quality,
           MAX(d.updated_at) calculated_at
         FROM campaign_deliveries d JOIN campaign_audiences a
           ON a.tenant_id=d.tenant_id AND a.id=d.audience_id
         WHERE d.tenant_id=? AND a.customer_id IN (SELECT customer_id FROM scoped_customers)`,
      )
      .bind(this.actor.tenantId, ...branchIds, this.actor.tenantId)
      .all<Row>();
    return this.rowsToResult(
      "CRM_CAMPAIGNS",
      rows.results ?? [],
      (row, ref) => ({
        metrics: [
          metric(
            "CAMPAIGNS",
            "Campaigns with scoped audience",
            num(row["campaign_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric("CAMPAIGN_SENT", "Messages sent", num(row["sent_count"]), "COUNT", row, ref),
          metric(
            "CAMPAIGN_DEAD_LETTER",
            "Dead-letter deliveries",
            num(row["dead_letter_count"]),
            "COUNT",
            row,
            ref,
          ),
          metric(
            "CAMPAIGN_SUPPRESSED",
            "Consent or suppression removals",
            num(row["suppressed_count"]),
            "COUNT",
            row,
            ref,
          ),
        ],
        findings: [
          finding(
            `${num(row["sent_count"])} consent-gated campaign deliveries were sent to customers in scope.`,
            ref,
            "/campaigns",
          ),
        ],
      }),
      ["Campaign delivery is reported as an observed event; sales causation is not inferred."],
    );
  }

  private async crmFeedback(branchIds: string[]) {
    const rows = await this.db
      .prepare(
        `SELECT 'crm-feedback' source_id,COUNT(*) feedback_count,
          COALESCE(SUM(CASE WHEN status IN ('OPEN','IN_REVIEW','FOLLOW_UP') THEN 1 ELSE 0 END),0) open_count,
          CAST(AVG(CASE WHEN survey_type='CSAT' THEN rating END)*100 AS INTEGER) csat_score,
          CAST((SUM(CASE WHEN survey_type='NPS' AND rating>=9 THEN 1 ELSE 0 END)*100.0 /
            NULLIF(SUM(CASE WHEN survey_type='NPS' THEN 1 ELSE 0 END),0)) -
            (SUM(CASE WHEN survey_type='NPS' AND rating<=6 THEN 1 ELSE 0 END)*100.0 /
            NULLIF(SUM(CASE WHEN survey_type='NPS' THEN 1 ELSE 0 END),0)) AS INTEGER) nps_score,
          CASE WHEN COUNT(*)=0 THEN 'INSUFFICIENT_DATA' ELSE 'HIGH' END quality,
          MAX(updated_at) calculated_at FROM customer_feedback
         WHERE tenant_id=? AND branch_id IN (${placeholders(branchIds.length)})`,
      )
      .bind(this.actor.tenantId, ...branchIds)
      .all<Row>();
    return this.rowsToResult("CRM_FEEDBACK", rows.results ?? [], (row, ref) => ({
      metrics: [
        metric(
          "FEEDBACK_COUNT",
          "Feedback responses",
          num(row["feedback_count"]),
          "COUNT",
          row,
          ref,
        ),
        metric(
          "FEEDBACK_OPEN",
          "Feedback requiring follow-up",
          num(row["open_count"]),
          "COUNT",
          row,
          ref,
        ),
        metric("CSAT_SCORE", "Configured CSAT average", num(row["csat_score"]), "BPS", row, ref),
        metric("NPS_SCORE", "Configured NPS score", num(row["nps_score"]), "COUNT", row, ref),
      ],
      findings: [
        finding(
          `${num(row["open_count"])} feedback records remain open or under follow-up in the authorized branches.`,
          ref,
          "/feedback",
        ),
      ],
    }));
  }
  private productHelp(): ToolResult {
    const ref = "PRODUCT_HELP:seramet:v1";
    return {
      metrics: [],
      findings: [
        {
          id: "product-help",
          title: "Seramet product help",
          statement:
            "Use the dedicated Seramet workflow for receiving purchase orders, KOT printing, payment reconciliation, branch setup, and period close.",
          classification: "CONFIRMED",
          severity: "INFO",
          evidenceRefs: [ref],
          route: "/seramet-setup",
        },
      ],
      sources: [
        {
          ref,
          toolKey: "PRODUCT_HELP",
          sourceType: "CURATED_PRODUCT_HELP",
          sourceId: "seramet-help-v1",
          quality: "HIGH",
          calculatedAt: new Date().toISOString(),
          payloadHash: "curated-help-v1",
        },
      ],
      quality: "HIGH",
      qualityReasons: [],
      configurationGaps: [],
      limitations: ["Product help does not expose implementation or security internals."],
    };
  }

  private async rowsToResult(
    key: IntelligenceToolKey,
    rows: Row[],
    map: (row: Row, ref: string) => { metrics: EvidenceMetric[]; findings: EvidenceFinding[] },
    limitations: string[] = [],
  ): Promise<ToolResult> {
    const metrics: EvidenceMetric[] = [];
    const findings: EvidenceFinding[] = [];
    const sources: EvidenceSource[] = [];
    const qualities: IntelligenceQuality[] = [];
    for (const [index, row] of rows.entries()) {
      const quality = qualityFromRow(row);
      qualities.push(quality);
      const sourceId = str(
        row.source_id ||
          row.id ||
          row.item_id ||
          row.menu_item_id ||
          row.supplier_id ||
          row.station_id ||
          `${index}`,
      );
      const branchId = str(row.branch_id) || undefined;
      const ref = `${key}:${branchId ?? "tenant"}:${sourceId}:${index}`;
      const mapped = map(row, ref);
      metrics.push(...mapped.metrics);
      findings.push(...mapped.findings);
      sources.push({
        ref,
        toolKey: key,
        sourceType: key,
        sourceId,
        ...(branchId ? { branchId } : {}),
        quality,
        calculatedAt: str(row.calculated_at || row.updated_at || new Date().toISOString()),
        payloadHash: await hashJson(row),
      });
    }
    const noData = rows.length === 0;
    return {
      metrics,
      findings,
      sources,
      quality: noData ? "INSUFFICIENT_DATA" : combineQuality(qualities),
      qualityReasons: noData ? [`${key}_NO_DATA`] : [],
      configurationGaps: [],
      limitations,
    };
  }
}

function tool(
  key: IntelligenceToolKey,
  intelligencePermission: PermissionCode,
  sourcePermissions: PermissionCode[],
  description: string,
): IntelligenceToolDefinition {
  return { key, intelligencePermission, sourcePermissions, description };
}

function metric(
  code: string,
  label: string,
  value: number,
  unit: EvidenceMetric["unit"],
  row: Row,
  evidenceRef: string,
): EvidenceMetric {
  return {
    code,
    label,
    value,
    unit,
    ...(str(row.currency) ? { currency: str(row.currency) } : {}),
    quality: qualityFromRow(row),
    evidenceRef,
  };
}

function simpleMetric(
  code: string,
  label: string,
  value: number,
  unit: EvidenceMetric["unit"],
  quality: IntelligenceQuality,
  evidenceRef: string,
): EvidenceMetric {
  return { code, label, value, unit, quality, evidenceRef };
}

function finding(statement: string, evidenceRef: string, route: string): EvidenceFinding {
  return {
    id: crypto.randomUUID(),
    title: "Authoritative evidence",
    statement,
    classification: "CONFIRMED",
    severity: "INFO",
    evidenceRefs: [evidenceRef],
    route,
  };
}

function qualityFromRow(row: Row): IntelligenceQuality {
  if (typeof row.quality === "string") return row.quality as IntelligenceQuality;
  const rank = num(row.quality_rank);
  if (rank <= 0) return "INSUFFICIENT_DATA";
  if (rank === 1) return "LOW";
  if (rank === 2) return "MEDIUM";
  return "HIGH";
}

function combineQuality(values: IntelligenceQuality[]): IntelligenceQuality {
  if (values.length === 0) return "INSUFFICIENT_DATA";
  const rank: Record<IntelligenceQuality, number> = {
    INSUFFICIENT_DATA: 0,
    LOW: 1,
    PARTIAL: 1,
    MEDIUM: 2,
    HIGH: 3,
    COMPLETE: 3,
  };
  const worst = Math.min(...values.map((value) => rank[value]));
  return worst === 0 ? "INSUFFICIENT_DATA" : worst === 1 ? "LOW" : worst === 2 ? "MEDIUM" : "HIGH";
}

function mergeResults(results: ToolResult[]): ToolResult {
  return {
    metrics: results.flatMap((result) => result.metrics),
    findings: results.flatMap((result) => result.findings),
    sources: results.flatMap((result) => result.sources),
    quality: combineQuality(results.map((result) => result.quality)),
    qualityReasons: unique(results.flatMap((result) => result.qualityReasons)),
    configurationGaps: unique(results.flatMap((result) => result.configurationGaps)),
    limitations: unique(results.flatMap((result) => result.limitations)),
  };
}

function placeholders(count: number) {
  return Array.from({ length: Math.max(1, count) }, () => "?").join(",");
}
function num(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? Math.trunc(result) : 0;
}
function str(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function shortId(value: string) {
  return value.length <= 10 ? value : `${value.slice(0, 6)}...${value.slice(-3)}`;
}
function money(minor: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
function unique<T>(values: T[]) {
  return [...new Set(values)];
}
function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function configuredOpenMinutes(serialized: string, start: string, end: string) {
  let schedule: Record<string, [string, string]> = {};
  try {
    schedule = JSON.parse(serialized) as Record<string, [string, string]>;
  } catch {
    return 0;
  }
  let current = start;
  let minutes = 0;
  while (current <= end) {
    const key = new Date(`${current}T12:00:00.000Z`)
      .toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
      .toLowerCase();
    const hours = schedule[key];
    if (hours) {
      const from = clockMinutes(hours[0]);
      const until = clockMinutes(hours[1]);
      if (from !== null && until !== null)
        minutes += until >= from ? until - from : 1440 - from + until;
    }
    current = nextDate(current);
  }
  return minutes;
}
function clockMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
function severity(value: unknown): EvidenceFinding["severity"] {
  const text = str(value);
  return ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(text)
    ? (text as EvidenceFinding["severity"])
    : "INFO";
}
async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
