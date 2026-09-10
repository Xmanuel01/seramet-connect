export type InventoryMovementType =
  | "OPENING"
  | "PURCHASE_RECEIPT"
  | "SALE_CONSUMPTION"
  | "PRODUCTION_INPUT"
  | "PRODUCTION_OUTPUT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT"
  | "WASTAGE"
  | "BREAKAGE"
  | "STOCK_COUNT_ADJUSTMENT"
  | "RETURN_TO_SUPPLIER"
  | "CUSTOMER_RETURN"
  | "MANUAL_ADJUSTMENT"
  | "EXPIRY"
  | "OTHER";

export type AnalyticsQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type ForecastMethod = "MOVING_AVERAGE" | "WEIGHTED_MOVING_AVERAGE" | "SAME_WEEKDAY_AVERAGE";

export type UnitDimension = "MASS" | "VOLUME" | "COUNT" | "LENGTH" | "OTHER";

export type UnitDefinitionInput = {
  id?: string;
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  baseScaleNumerator?: number;
  baseScaleDenominator?: number;
};

export type InventoryItemInput = {
  id?: string;
  code: string;
  sku?: string;
  name: string;
  description?: string;
  categoryId?: string;
  baseUnitId: string;
  purchaseUnitId?: string;
  storageUnitId?: string;
  issueUnitId?: string;
  trackInventory?: boolean;
  trackExpiry?: boolean;
  preferredSupplierId?: string;
  defaultWarehouseId?: string;
  barcode?: string;
  metadata?: Record<string, unknown>;
};

export type ItemUnitConversionInput = {
  id?: string;
  inventoryItemId: string;
  fromUnitId: string;
  toUnitId: string;
  factorNumerator: number;
  factorDenominator: number;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type SupplierInput = {
  id?: string;
  code: string;
  name: string;
  legalName?: string;
  phone?: string;
  email?: string;
  taxNumber?: string;
  address?: string;
  paymentTermsDays?: number;
  currency?: string;
  leadTimeDays?: number;
  minimumOrderMinor?: number;
  metadata?: Record<string, unknown>;
};

export type PurchaseQuoteInput = {
  id?: string;
  requisitionId: string;
  supplierId: string;
  currency: string;
  deliveryFeeMinor?: number;
  otherCostMinor?: number;
  validUntil?: string;
  leadTimeDays?: number;
  lines: Array<{
    inventoryItemId: string;
    quantityMicro: number;
    unitId: string;
    unitPriceMinor: number;
  }>;
};

export type SupplierReturnInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  supplierId: string;
  goodsReceiptId: string;
  returnNumber: string;
  businessDate: string;
  idempotencyKey: string;
  reason: string;
  lines: Array<{
    goodsReceiptLineId: string;
    returnedBaseQuantityMicro: number;
    reason: string;
  }>;
};

export type PortionStandardInput = {
  id?: string;
  branchId?: string;
  menuItemId?: string;
  inventoryItemId?: string;
  expectedQuantityMicro: number;
  unitId: string;
  effectiveFrom: string;
  effectiveTo?: string;
};

export type PortionCheckInput = {
  id?: string;
  branchId: string;
  portionStandardId: string;
  actualQuantityMicro: number;
  employeeId?: string;
  stationId?: string;
  checkedAt?: string;
  notes?: string;
};

export type InventoryMovementInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  inventoryItemId: string;
  movementType: InventoryMovementType;
  quantityBaseMicro: number;
  unitCostMinor?: number;
  totalCostMinor?: number;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  businessDate: string;
  occurredAt?: string;
  reason?: string;
  lotId?: string;
  negativeOverride?: boolean;
  metadata?: Record<string, unknown>;
};

export type RequisitionLineInput = {
  inventoryItemId: string;
  requestedQuantityMicro: number;
  unitId: string;
  notes?: string;
};

export type PurchaseRequisitionInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  requisitionNumber: string;
  sourceType: "LOW_STOCK" | "MANUAL_REQUEST" | "FORECAST";
  requiredAt?: string;
  lines: RequisitionLineInput[];
};

export type PurchaseOrderLineInput = {
  id?: string;
  inventoryItemId: string;
  purchaseUnitId: string;
  conversionId?: string;
  quantityMicro: number;
  unitPriceMinor: number;
  taxMinor?: number;
  discountMinor?: number;
};

export type PurchaseOrderInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  supplierId: string;
  requisitionId?: string;
  purchaseOrderNumber: string;
  currency: string;
  expectedAt?: string;
  overReceiptPolicy?: "REJECT_OVER_RECEIPT" | "ALLOW_WITH_APPROVAL" | "ALLOW_WITH_TOLERANCE";
  overReceiptToleranceBps?: number;
  lines: PurchaseOrderLineInput[];
};

export type GoodsReceiptLineInput = {
  purchaseOrderLineId: string;
  receivedPurchaseQuantityMicro: number;
  acceptedPurchaseQuantityMicro: number;
  rejectedPurchaseQuantityMicro?: number;
  unitPriceMinor: number;
  lotNumber?: string;
  expiryDate?: string;
  qualityStatus?: string;
  notes?: string;
};

export type GoodsReceiptInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  purchaseOrderId: string;
  supplierId: string;
  receiptNumber: string;
  idempotencyKey: string;
  businessDate: string;
  lines: GoodsReceiptLineInput[];
};

export type StagedTransferDispatchInput = {
  id?: string;
  transferNumber: string;
  sourceBranchId: string;
  sourceWarehouseId: string;
  destinationBranchId: string;
  destinationWarehouseId: string;
  businessDate: string;
  idempotencyKey: string;
  lines: Array<{
    inventoryItemId: string;
    quantityMicro: number;
    sourceLotId?: string;
  }>;
};

export type StagedTransferReceiptInput = {
  shipmentId: string;
  receiptReference: string;
  businessDate: string;
  idempotencyKey: string;
  final: boolean;
  lines: Array<{
    transferLineId: string;
    receivedQuantityMicro: number;
    damagedQuantityMicro?: number;
    rejectedQuantityMicro?: number;
    missingQuantityMicro?: number;
  }>;
};

export type RecipeComponentInput = {
  inventoryItemId?: string;
  subRecipeId?: string;
  quantityMicro: number;
  unitId: string;
  wasteFactorBps?: number;
  optional?: boolean;
  stationId?: string;
};

export type RecipeVersionInput = {
  recipeId: string;
  version: number;
  yieldQuantityMicro: number;
  yieldUnitId: string;
  effectiveFrom: string;
  packagingCostMinor?: number;
  productionOverheadMinor?: number;
  components: RecipeComponentInput[];
};

export type ProductionCompletionInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  recipeVersionId: string;
  outputItemId: string;
  plannedQuantityMicro: number;
  actualOutputQuantityMicro: number;
  idempotencyKey: string;
  businessDate: string;
  stationId?: string;
  employeeId?: string;
};

export type StockCountInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  businessDate: string;
  idempotencyKey: string;
  blindCount?: boolean;
  approvalReason?: string;
  lines: Array<{ inventoryItemId: string; countedQuantityMicro: number; reason?: string }>;
};

export type InventoryParPolicyInput = {
  id?: string;
  branchId: string;
  warehouseId: string;
  inventoryItemId: string;
  dayOfWeek?: number;
  reorderPointMicro: number;
  targetQuantityMicro: number;
  safetyStockMicro?: number;
  minimumQuantityMicro?: number;
  maximumQuantityMicro?: number;
  recommendationMode?: "MANUAL" | "RECOMMEND" | "AUTO_REQUISITION";
};

export type ForecastInput = {
  method: ForecastMethod;
  samples: readonly number[];
  weights?: readonly number[];
};

export type PurchaseRecommendationInput = {
  forecastConsumptionMicro: number;
  safetyStockMicro: number;
  targetClosingStockMicro: number;
  onHandMicro: number;
  incomingConfirmedMicro: number;
  purchaseConversionNumerator: number;
  purchaseConversionDenominator: number;
  leadTimeDays: number;
  asOfDate: string;
};

export type InventorySummary = {
  branchId: string;
  inventoryValueMinor: number;
  itemCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  nearExpiryCount: number;
  openPurchaseOrderCount: number;
  actualFoodCostBps: number;
  theoreticalFoodCostBps: number;
  varianceMinor: number;
  unexplainedVarianceMinor: number;
  quality: AnalyticsQuality;
  dataQualityIssues: number;
  generatedAt: string;
};
