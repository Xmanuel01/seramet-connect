import { z } from "zod";

const id = z.string().trim().min(1).max(120);
const code = z.string().trim().min(1).max(40);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true });
const integer = z.number().int().safe();
const positiveInteger = integer.positive();
const nonNegativeInteger = integer.nonnegative();

export const unitSchema = z
  .object({
    id: id.optional(),
    code,
    name: z.string().trim().min(1).max(160),
    symbol: z.string().trim().min(1).max(20),
    dimension: z.enum(["MASS", "VOLUME", "COUNT", "LENGTH", "OTHER"]),
    baseScaleNumerator: positiveInteger.optional(),
    baseScaleDenominator: positiveInteger.optional(),
  })
  .strict();

export const inventoryItemSchema = z
  .object({
    id: id.optional(),
    code,
    sku: code.optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    categoryId: id.optional(),
    baseUnitId: id,
    purchaseUnitId: id.optional(),
    storageUnitId: id.optional(),
    issueUnitId: id.optional(),
    trackInventory: z.boolean().optional(),
    trackExpiry: z.boolean().optional(),
    preferredSupplierId: id.optional(),
    defaultWarehouseId: id.optional(),
    barcode: z.string().trim().min(1).max(120).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const conversionSchema = z
  .object({
    id: id.optional(),
    inventoryItemId: id,
    fromUnitId: id,
    toUnitId: id,
    factorNumerator: positiveInteger,
    factorDenominator: positiveInteger,
    effectiveFrom: timestamp,
    effectiveTo: timestamp.optional(),
  })
  .strict();

export const supplierSchema = z
  .object({
    id: id.optional(),
    code,
    name: z.string().trim().min(1).max(160),
    legalName: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().email().optional(),
    taxNumber: z.string().trim().max(80).optional(),
    address: z.string().trim().max(500).optional(),
    paymentTermsDays: nonNegativeInteger.optional(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    leadTimeDays: nonNegativeInteger.optional(),
    minimumOrderMinor: nonNegativeInteger.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const supplierItemSchema = z
  .object({
    id: id.optional(),
    supplierId: id,
    inventoryItemId: id,
    purchaseUnitId: id,
    conversionId: id.optional(),
    supplierSku: z.string().trim().max(80).optional(),
    contractPriceMinor: nonNegativeInteger.optional(),
    minimumQuantityMicro: nonNegativeInteger.optional(),
    leadTimeDays: nonNegativeInteger.optional(),
    preferred: z.boolean().optional(),
  })
  .strict();

export const purchaseQuoteSchema = z
  .object({
    id: id.optional(),
    requisitionId: id,
    supplierId: id,
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    deliveryFeeMinor: nonNegativeInteger.optional(),
    otherCostMinor: nonNegativeInteger.optional(),
    validUntil: timestamp.optional(),
    leadTimeDays: nonNegativeInteger.optional(),
    lines: z
      .array(
        z
          .object({
            inventoryItemId: id,
            quantityMicro: positiveInteger,
            unitId: id,
            unitPriceMinor: nonNegativeInteger,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const supplierReturnSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    supplierId: id,
    goodsReceiptId: id,
    returnNumber: id,
    businessDate: date,
    idempotencyKey: id,
    reason: z.string().trim().min(1).max(500),
    lines: z
      .array(
        z
          .object({
            goodsReceiptLineId: id,
            returnedBaseQuantityMicro: positiveInteger,
            reason: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const supplierReturnCreditSchema = z.object({ creditNoteNumber: id }).strict();

export const portionStandardSchema = z
  .object({
    id: id.optional(),
    branchId: id.optional(),
    menuItemId: id.optional(),
    inventoryItemId: id.optional(),
    expectedQuantityMicro: positiveInteger,
    unitId: id,
    effectiveFrom: timestamp,
    effectiveTo: timestamp.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.menuItemId) !== Boolean(value.inventoryItemId), {
    message: "Portion standard must reference one menu item or inventory item",
  });

export const portionCheckSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    portionStandardId: id,
    actualQuantityMicro: positiveInteger,
    employeeId: id.optional(),
    stationId: id.optional(),
    checkedAt: timestamp.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const movementSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    inventoryItemId: id,
    movementType: z.enum([
      "OPENING",
      "PURCHASE_RECEIPT",
      "SALE_CONSUMPTION",
      "PRODUCTION_INPUT",
      "PRODUCTION_OUTPUT",
      "TRANSFER_IN",
      "TRANSFER_OUT",
      "WASTAGE",
      "BREAKAGE",
      "STOCK_COUNT_ADJUSTMENT",
      "RETURN_TO_SUPPLIER",
      "CUSTOMER_RETURN",
      "MANUAL_ADJUSTMENT",
      "EXPIRY",
      "OTHER",
    ]),
    quantityBaseMicro: integer.refine((value) => value !== 0),
    unitCostMinor: nonNegativeInteger.optional(),
    totalCostMinor: integer.optional(),
    sourceType: code,
    sourceId: id,
    idempotencyKey: id,
    businessDate: date,
    occurredAt: timestamp.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    lotId: id.optional(),
    negativeOverride: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const stagedTransferDispatchSchema = z
  .object({
    id: id.optional(),
    sourceBranchId: id,
    sourceWarehouseId: id,
    destinationBranchId: id,
    destinationWarehouseId: id,
    idempotencyKey: id,
    lines: z
      .array(
        z
          .object({
            inventoryItemId: id,
            quantityMicro: positiveInteger,
            sourceLotId: id.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .refine(
    (value) =>
      value.sourceBranchId !== value.destinationBranchId ||
      value.sourceWarehouseId !== value.destinationWarehouseId,
    {
      message: "Transfer source and destination must differ",
    },
  );

export const stagedTransferReceiptSchema = z
  .object({
    receiptReference: id,
    idempotencyKey: id,
    final: z.boolean().default(false),
    lines: z
      .array(
        z
          .object({
            transferLineId: id,
            receivedQuantityMicro: nonNegativeInteger,
            damagedQuantityMicro: nonNegativeInteger.optional(),
            rejectedQuantityMicro: nonNegativeInteger.optional(),
            missingQuantityMicro: nonNegativeInteger.optional(),
          })
          .strict()
          .refine(
            (line) =>
              line.receivedQuantityMicro +
                (line.damagedQuantityMicro ?? 0) +
                (line.rejectedQuantityMicro ?? 0) +
                (line.missingQuantityMicro ?? 0) >
              0,
            { message: "A receipt line must account for a positive quantity" },
          ),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const requisitionSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    requisitionNumber: id,
    sourceType: z.enum(["LOW_STOCK", "MANUAL_REQUEST", "FORECAST"]),
    requiredAt: timestamp.optional(),
    lines: z
      .array(
        z
          .object({
            inventoryItemId: id,
            requestedQuantityMicro: positiveInteger,
            unitId: id,
            notes: z.string().trim().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const purchaseOrderSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    supplierId: id,
    requisitionId: id.optional(),
    purchaseOrderNumber: id,
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    expectedAt: timestamp.optional(),
    overReceiptPolicy: z
      .enum(["REJECT_OVER_RECEIPT", "ALLOW_WITH_APPROVAL", "ALLOW_WITH_TOLERANCE"])
      .optional(),
    overReceiptToleranceBps: nonNegativeInteger.max(10_000).optional(),
    lines: z
      .array(
        z
          .object({
            id: id.optional(),
            inventoryItemId: id,
            purchaseUnitId: id,
            conversionId: id.optional(),
            quantityMicro: positiveInteger,
            unitPriceMinor: nonNegativeInteger,
            taxMinor: nonNegativeInteger.optional(),
            discountMinor: nonNegativeInteger.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const goodsReceiptSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    purchaseOrderId: id,
    supplierId: id,
    receiptNumber: id,
    idempotencyKey: id,
    businessDate: date,
    lines: z
      .array(
        z
          .object({
            purchaseOrderLineId: id,
            receivedPurchaseQuantityMicro: positiveInteger,
            acceptedPurchaseQuantityMicro: nonNegativeInteger,
            rejectedPurchaseQuantityMicro: nonNegativeInteger.optional(),
            unitPriceMinor: nonNegativeInteger,
            lotNumber: z.string().trim().max(120).optional(),
            expiryDate: date.optional(),
            qualityStatus: code.optional(),
            notes: z.string().trim().max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

const recipeComponentSchema = z
  .object({
    inventoryItemId: id.optional(),
    subRecipeId: id.optional(),
    quantityMicro: positiveInteger,
    unitId: id,
    wasteFactorBps: nonNegativeInteger.max(100_000).optional(),
    optional: z.boolean().optional(),
    stationId: id.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.inventoryItemId) !== Boolean(value.subRecipeId), {
    message: "Component must reference one inventory item or sub-recipe",
  });

export const recipeSchema = z
  .object({
    id: id.optional(),
    menuItemId: id.optional(),
    productionItemId: id.optional(),
    branchOverrideId: id.optional(),
    name: z.string().trim().min(1).max(160),
  })
  .strict();

export const recipeVersionSchema = z
  .object({
    recipeId: id,
    version: positiveInteger,
    yieldQuantityMicro: positiveInteger,
    yieldUnitId: id,
    effectiveFrom: timestamp,
    packagingCostMinor: nonNegativeInteger.optional(),
    productionOverheadMinor: nonNegativeInteger.optional(),
    components: z.array(recipeComponentSchema).min(1).max(500),
  })
  .strict();

export const productionSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    recipeVersionId: id,
    outputItemId: id,
    plannedQuantityMicro: positiveInteger,
    actualOutputQuantityMicro: positiveInteger,
    idempotencyKey: id,
    businessDate: date,
    stationId: id.optional(),
    employeeId: id.optional(),
  })
  .strict();

export const stockCountSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    businessDate: date,
    idempotencyKey: id,
    blindCount: z.boolean().optional(),
    approvalReason: z.string().trim().min(1).max(500).optional(),
    lines: z
      .array(
        z
          .object({
            inventoryItemId: id,
            countedQuantityMicro: nonNegativeInteger,
            reason: z.string().trim().min(1).max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(2_000),
  })
  .strict();

export const parPolicySchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    inventoryItemId: id,
    dayOfWeek: z.number().int().min(0).max(6).optional(),
    reorderPointMicro: nonNegativeInteger,
    targetQuantityMicro: nonNegativeInteger,
    safetyStockMicro: nonNegativeInteger.optional(),
    minimumQuantityMicro: nonNegativeInteger.optional(),
    maximumQuantityMicro: nonNegativeInteger.optional(),
    recommendationMode: z.enum(["MANUAL", "RECOMMEND", "AUTO_REQUISITION"]).optional(),
  })
  .strict();

export const transferSchema = z
  .object({
    id: id.optional(),
    transferNumber: id,
    sourceBranchId: id,
    sourceWarehouseId: id,
    destinationBranchId: id,
    destinationWarehouseId: id,
    businessDate: date,
    idempotencyKey: id,
    lines: z
      .array(
        z
          .object({
            inventoryItemId: id,
            sentQuantityMicro: positiveInteger,
            receivedQuantityMicro: nonNegativeInteger,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const wastageSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    warehouseId: id,
    inventoryItemId: id,
    quantityMicro: positiveInteger,
    businessDate: date,
    reasonCode: code,
    idempotencyKey: id,
    stationId: id.optional(),
    employeeId: id.optional(),
  })
  .strict();

export const supplierInvoiceSchema = z
  .object({
    id: id.optional(),
    branchId: id,
    supplierId: id,
    purchaseOrderId: id,
    goodsReceiptId: id,
    invoiceNumber: id,
    invoiceDate: date,
    dueDate: date.optional(),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    subtotalMinor: nonNegativeInteger,
    taxMinor: nonNegativeInteger,
    totalMinor: nonNegativeInteger,
  })
  .strict();

export const approvalSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();
