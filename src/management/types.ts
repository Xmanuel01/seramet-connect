export type AnalyticsQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type FinancialQuality = "COMPLETE" | "PARTIAL" | "INSUFFICIENT_DATA";
export type ManagementSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ManagementActionStatus =
  "OPEN" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "DISMISSED";
export type BranchHealthStatus = "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL";
export type MetricUnit = "MINOR" | "BPS" | "COUNT" | "MILLISECONDS" | "MICRO";

export type ThresholdPolicyInput = {
  id?: string;
  branchId?: string;
  metricCode: string;
  comparison: "GREATER_THAN" | "LESS_THAN" | "ABSOLUTE_GREATER_THAN";
  severity: ManagementSeverity;
  thresholdValue: number;
  valueUnit: MetricUnit;
  effectiveFrom: string;
  effectiveTo?: string;
  reopenAfterMinutes?: number;
};

export type BranchTargetInput = {
  id?: string;
  branchId?: string;
  metricCode: string;
  targetValue: number;
  valueUnit: MetricUnit;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type ManagementAction = {
  id: string;
  branchId: string | null;
  actionType: string;
  severity: ManagementSeverity;
  status: ManagementActionStatus;
  sourceType: string;
  sourceId: string;
  businessDate: string | null;
  metricValue: number | null;
  thresholdValue: number | null;
  valueUnit: string | null;
  evidence: Record<string, unknown>;
  assignedUserId: string | null;
  assignedRoleId: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolutionNote: string | null;
  correlationId: string;
};

export type DailyBranchMetric = {
  branchId: string;
  branchName: string;
  businessDate: string;
  currency: string;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  netRevenueMinor: number;
  marketplaceCommissionMinor: number;
  paymentProcessingFeesMinor: number;
  deliveryFeesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginBps: number;
  foodCostBps: number;
  labourCostMinor: number;
  labourCostBps: number;
  operatingExpensesMinor: number;
  contributionMinor: number;
  orderCount: number;
  averageOrderValueMinor: number;
  averagePrepTimeMs: number | null;
  paymentVarianceMinor: number;
  wastageMinor: number;
  inventoryVarianceMinor: number;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type FinancialSummary = {
  id: string;
  branchId: string;
  periodType: "DAY" | "WEEK_TO_DATE" | "MONTH_TO_DATE" | "CUSTOM";
  periodStart: string;
  periodEnd: string;
  currency: string;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  netRevenueMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  grossMarginBps: number;
  labourCostMinor: number;
  operatingExpensesMinor: number;
  marketplaceCommissionMinor: number;
  paymentProcessingFeesMinor: number;
  deliveryFeesMinor: number;
  contributionMinor: number;
  flashOperatingResultMinor: number;
  quality: FinancialQuality;
  qualityReasons: string[];
};

export type ChannelMetric = {
  branchId: string;
  businessDate: string;
  channelKey: string;
  channelId: string | null;
  channelLabel: string;
  currency: string;
  orderCount: number;
  cancelledCount: number;
  refundCount: number;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  netSalesMinor: number;
  commissionMinor: number;
  providerFeesMinor: number;
  deliveryFeesMinor: number;
  cogsMinor: number;
  contributionMinor: number;
  contributionBps: number;
  averageOrderValueMinor: number;
  cancellationBps: number;
  refundBps: number;
  averageFulfilmentMs: number | null;
  settlementDifferenceMinor: number | null;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type StationMetric = {
  branchId: string;
  businessDate: string;
  stationId: string;
  stationName: string;
  ticketCount: number;
  completedCount: number;
  lateCount: number;
  averagePrepMs: number | null;
  medianPrepMs: number | null;
  p90PrepMs: number | null;
  averageReadyPickupMs: number | null;
  throughputPerHourMilli: number | null;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type StaffMetric = {
  branchId: string;
  businessDate: string;
  employeeId: string;
  employeeName: string;
  shiftCount: number;
  workedMinutes: number;
  lateMinutes: number;
  labourCostMinor: number;
  ordersHandled: number;
  netSalesMinor: number;
  averageOrderValueMinor: number;
  averageServiceMs: number | null;
  voidRequests: number;
  approvedDiscounts: number;
  refundInvolvement: number;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type SupplierMetric = {
  branchId: string;
  businessDate: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  purchaseValueMinor: number;
  orderCount: number;
  averageLeadTimeMinutes: number | null;
  onTimeBps: number | null;
  fillRateBps: number | null;
  rejectedQuantityMicro: number;
  priceVarianceMinor: number;
  returnValueMinor: number;
  invoiceMatchExceptions: number;
  outstandingPayableMinor: number;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type MenuMetric = {
  menuItemId: string;
  quantitySold: number;
  netRevenueMinor: number;
  theoreticalCostMinor: number;
  contributionMinor: number;
  foodCostBps: number;
  salesMixBps: number;
  classification: "STAR" | "WORKHORSE" | "PUZZLE" | "LOW_PERFORMER" | "INSUFFICIENT_DATA";
  quality: AnalyticsQuality;
};

export type CloseReadiness = {
  branchId: string;
  businessDate: string;
  status: "READY_TO_CLOSE" | "NOT_READY" | "CLOSED";
  blockerCount: number;
  warningCount: number;
  blockers: Array<{ code: string; count: number; severity: ManagementSeverity }>;
  quality: AnalyticsQuality;
};

export type InventoryGlReconciliation = {
  id: string;
  branchId: string;
  warehouseId: string | null;
  businessDate: string;
  currency: string;
  subledgerValueMinor: number;
  glValueMinor: number;
  differenceMinor: number;
  toleranceMinor: number;
  status: "MATCHED" | "VARIANCE" | "MISSING_CONFIGURATION";
  quality: AnalyticsQuality;
  evidence: Record<string, unknown>;
};

export type BranchHealth = {
  branchId: string;
  businessDate: string;
  status: BranchHealthStatus;
  evidence: Array<Record<string, unknown>>;
  quality: AnalyticsQuality;
};

export type ApprovalInboxItem = {
  sourceType: string;
  sourceId: string;
  branchId: string | null;
  category: string;
  status: string;
  amountMinor: number | null;
  currency: string | null;
  requestedAt: string;
  payload: Record<string, unknown>;
};

export type FoodCostBridge = {
  branchId: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  previousCostMinor: number;
  currentCostMinor: number;
  changeMinor: number;
  drivers: Array<{
    code: string;
    label: string;
    amountMinor: number;
    evidence: Record<string, unknown>;
  }>;
  unexplainedMinor: number;
  quality: AnalyticsQuality;
  qualityReasons: string[];
};

export type OwnerControlCentre = {
  periodStart: string;
  periodEnd: string;
  branches: Array<{
    metric: DailyBranchMetric;
    health: BranchHealth | null;
    openActionCount: number;
  }>;
  generatedAt: string;
};

export type ManagementControlCentre = {
  branchId: string;
  periodStart: string;
  periodEnd: string;
  latest: DailyBranchMetric | null;
  trend: DailyBranchMetric[];
  flashPnl: FinancialSummary | null;
  actions: ManagementAction[];
  channels: ChannelMetric[];
  stations: StationMetric[];
  staff: StaffMetric[];
  suppliers: SupplierMetric[];
  menu: MenuMetric[];
  inventoryGl: InventoryGlReconciliation | null;
  closeReadiness: CloseReadiness | null;
  health: BranchHealth | null;
  approvals: ApprovalInboxItem[];
  targets: Array<{
    metricCode: string;
    targetValue: number;
    valueUnit: MetricUnit;
    source: "TENANT_DEFAULT" | "BRANCH_OVERRIDE";
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  generatedAt: string;
};
