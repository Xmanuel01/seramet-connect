import { authorizeBranchRead, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { buildPurchaseRecommendation, deterministicForecast } from "@/inventory/forecasting";
import { createInventoryValuationStrategy } from "@/inventory/valuation";
import {
  BASIS_POINTS_SCALE,
  QUANTITY_SCALE,
  assertScaledInteger,
  multiplyDivide,
  normalizeRational,
  quantityCostMinor,
  ratioBasisPoints,
} from "@/inventory/quantity";
import type {
  GoodsReceiptInput,
  InventoryItemInput,
  InventoryMovementInput,
  InventoryParPolicyInput,
  InventorySummary,
  ItemUnitConversionInput,
  PortionCheckInput,
  PortionStandardInput,
  ProductionCompletionInput,
  PurchaseQuoteInput,
  PurchaseOrderInput,
  PurchaseRequisitionInput,
  RecipeVersionInput,
  StagedTransferDispatchInput,
  StagedTransferReceiptInput,
  StockCountInput,
  SupplierInput,
  SupplierReturnInput,
  UnitDefinitionInput,
} from "@/inventory/types";

type InventoryBalanceRow = {
  quantity_minor: number;
  quantity_reserved_minor: number;
  average_unit_cost_minor: number;
  total_value_minor: number;
};

type PurchaseOrderLineRow = {
  id: string;
  item_id: string;
  purchase_unit_id: string | null;
  conversion_id: string | null;
  ordered_quantity_minor: number;
  ordered_purchase_quantity_minor: number | null;
  received_purchase_quantity_minor: number;
  unit_cost_minor: number;
};

type RecipeComponentRow = {
  id: string;
  inventory_item_id: string | null;
  sub_recipe_id: string | null;
  quantity_minor: number;
  unit_id: string;
  waste_factor_bps: number;
};

type AccountMappingRow = {
  inventory_account_id: string;
  opening_balance_account_id: string | null;
  accounts_payable_account_id: string;
  cogs_account_id: string;
  wastage_account_id: string;
  variance_account_id: string;
  recoverable_tax_account_id: string | null;
  accounting_mode: "PERPETUAL" | "PERIODIC";
};

const incomingMovementTypes = new Set([
  "OPENING",
  "PURCHASE_RECEIPT",
  "PRODUCTION_OUTPUT",
  "TRANSFER_IN",
  "CUSTOMER_RETURN",
]);
const outgoingMovementTypes = new Set([
  "SALE_CONSUMPTION",
  "PRODUCTION_INPUT",
  "TRANSFER_OUT",
  "WASTAGE",
  "BREAKAGE",
  "RETURN_TO_SUPPLIER",
  "EXPIRY",
]);

export class InventoryIntelligenceService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async createUnit(input: UnitDefinitionInput) {
    this.requirePermission(permissions.inventoryAdjust);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const scale = normalizeRational(input.baseScaleNumerator ?? 1, input.baseScaleDenominator ?? 1);
    await this.db
      .prepare(
        `INSERT INTO unit_definitions
          (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,
           base_scale_denominator,active,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        requiredCode(input.code, "unit code"),
        requiredText(input.name, "unit name"),
        requiredText(input.symbol, "unit symbol"),
        input.dimension,
        scale.numerator,
        scale.denominator,
        stamp,
        stamp,
      )
      .run();
    await this.audit("UNIT_CREATED", "UNIT_DEFINITION", id, stamp);
    return { id, ...input, ...scale };
  }

  async createInventoryItem(input: InventoryItemInput) {
    this.requirePermission(permissions.inventoryAdjust);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO inventory_items
          (tenant_id,id,sku,name,unit,active,payload_json,code,description,category_id,
           base_unit_id,purchase_unit_id,storage_unit_id,issue_unit_id,track_inventory,
           track_expiry,preferred_supplier_id,default_warehouse_id,barcode,updated_at)
         VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        requiredCode(input.sku ?? input.code, "item SKU"),
        requiredText(input.name, "item name"),
        input.baseUnitId,
        JSON.stringify(input.metadata ?? {}),
        requiredCode(input.code, "item code"),
        input.description ?? null,
        input.categoryId ?? null,
        input.baseUnitId,
        input.purchaseUnitId ?? input.baseUnitId,
        input.storageUnitId ?? input.baseUnitId,
        input.issueUnitId ?? input.baseUnitId,
        input.trackInventory === false ? 0 : 1,
        input.trackExpiry ? 1 : 0,
        input.preferredSupplierId ?? null,
        input.defaultWarehouseId ?? null,
        input.barcode ?? null,
        stamp,
      )
      .run();
    await this.audit("INVENTORY_ITEM_CREATED", "INVENTORY_ITEM", id, stamp);
    return { id, ...input };
  }

  async createItemConversion(input: ItemUnitConversionInput) {
    this.requirePermission(permissions.inventoryAdjust);
    if (input.fromUnitId === input.toUnitId) throw new Error("Conversion units must differ");
    const item = await this.db
      .prepare("SELECT id FROM inventory_items WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.inventoryItemId)
      .first();
    if (!item) throw new ServerOperationError("VALIDATION_FAILED", 400, "Inventory item not found");
    const units = await this.db
      .prepare("SELECT id,dimension FROM unit_definitions WHERE tenant_id=? AND id IN (?,?)")
      .bind(this.actor.tenantId, input.fromUnitId, input.toUnitId)
      .all<{ id: string; dimension: string }>();
    if ((units.results?.length ?? 0) !== 2) throw new Error("Conversion unit not found");
    const factor = normalizeRational(input.factorNumerator, input.factorDenominator);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO item_unit_conversions
          (tenant_id,id,inventory_item_id,from_unit_id,to_unit_id,factor_numerator,
           factor_denominator,effective_from,effective_to,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.inventoryItemId,
        input.fromUnitId,
        input.toUnitId,
        factor.numerator,
        factor.denominator,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        stamp,
      )
      .run();
    await this.audit("ITEM_CONVERSION_CREATED", "ITEM_UNIT_CONVERSION", id, stamp);
    return {
      id,
      ...input,
      factorNumerator: factor.numerator,
      factorDenominator: factor.denominator,
    };
  }

  async convertItemQuantity(
    inventoryItemId: string,
    quantityMicro: number,
    fromUnitId: string,
    toUnitId: string,
    effectiveAt = new Date().toISOString(),
  ) {
    assertScaledInteger(quantityMicro, "quantity", true);
    if (fromUnitId === toUnitId) return quantityMicro;
    const conversion = await this.db
      .prepare(
        `SELECT factor_numerator,factor_denominator FROM item_unit_conversions
         WHERE tenant_id=? AND inventory_item_id=? AND from_unit_id=? AND to_unit_id=?
           AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
         ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, inventoryItemId, fromUnitId, toUnitId, effectiveAt, effectiveAt)
      .first<{ factor_numerator: number; factor_denominator: number }>();
    if (conversion) {
      return multiplyDivide(
        quantityMicro,
        conversion.factor_numerator,
        conversion.factor_denominator,
        "converted quantity",
      );
    }
    const reverse = await this.db
      .prepare(
        `SELECT factor_numerator,factor_denominator FROM item_unit_conversions
         WHERE tenant_id=? AND inventory_item_id=? AND from_unit_id=? AND to_unit_id=?
           AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
         ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, inventoryItemId, toUnitId, fromUnitId, effectiveAt, effectiveAt)
      .first<{ factor_numerator: number; factor_denominator: number }>();
    if (reverse) {
      return multiplyDivide(
        quantityMicro,
        reverse.factor_denominator,
        reverse.factor_numerator,
        "reverse converted quantity",
      );
    }
    const units = await this.db
      .prepare(
        `SELECT id,dimension,base_scale_numerator,base_scale_denominator
         FROM unit_definitions WHERE tenant_id=? AND id IN (?,?)`,
      )
      .bind(this.actor.tenantId, fromUnitId, toUnitId)
      .all<{
        id: string;
        dimension: string;
        base_scale_numerator: number;
        base_scale_denominator: number;
      }>();
    const from = units.results?.find((unit) => unit.id === fromUnitId);
    const to = units.results?.find((unit) => unit.id === toUnitId);
    if (!from || !to || from.dimension !== to.dimension || from.dimension === "OTHER") {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "An item-specific conversion is required for these units",
      );
    }
    const inDimensionBase = multiplyDivide(
      quantityMicro,
      from.base_scale_numerator,
      from.base_scale_denominator,
      "dimension-base quantity",
    );
    return multiplyDivide(
      inDimensionBase,
      to.base_scale_denominator,
      to.base_scale_numerator,
      "converted quantity",
    );
  }

  async createSupplier(input: SupplierInput) {
    this.requirePermission(permissions.procurementCreate);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO suppliers
          (tenant_id,id,code,name,legal_name,phone,email,tax_number,address,payment_terms_days,
           currency,lead_time_days,minimum_order_minor,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        requiredCode(input.code, "supplier code"),
        requiredText(input.name, "supplier name"),
        input.legalName ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.taxNumber ?? null,
        input.address ?? null,
        input.paymentTermsDays ?? null,
        input.currency ?? null,
        input.leadTimeDays ?? null,
        input.minimumOrderMinor ?? null,
        JSON.stringify(input.metadata ?? {}),
        stamp,
        stamp,
      )
      .run();
    await this.audit("SUPPLIER_CREATED", "SUPPLIER", id, stamp);
    return { id, ...input };
  }

  async linkSupplierItem(input: {
    id?: string;
    supplierId: string;
    inventoryItemId: string;
    purchaseUnitId: string;
    conversionId?: string;
    supplierSku?: string;
    contractPriceMinor?: number;
    minimumQuantityMicro?: number;
    leadTimeDays?: number;
    preferred?: boolean;
  }) {
    this.requirePermission(permissions.procurementCreate);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO supplier_items
          (tenant_id,id,supplier_id,inventory_item_id,supplier_sku,purchase_unit_id,
           conversion_id,contract_price_minor,minimum_quantity_minor,lead_time_days,
           preferred,active,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.supplierId,
        input.inventoryItemId,
        input.supplierSku ?? null,
        input.purchaseUnitId,
        input.conversionId ?? null,
        input.contractPriceMinor ?? null,
        input.minimumQuantityMicro ?? null,
        input.leadTimeDays ?? null,
        input.preferred ? 1 : 0,
        stamp,
        stamp,
      )
      .run();
    return { id, ...input };
  }

  async createPurchaseQuote(input: PurchaseQuoteInput) {
    this.requirePermission(permissions.procurementCreate);
    const requisition = await this.db
      .prepare("SELECT branch_id,status FROM purchase_requisitions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.requisitionId)
      .first<{ branch_id: string; status: string }>();
    if (!requisition)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Purchase requisition not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, requisition.branch_id);
    if (!["SUBMITTED", "APPROVED", "PARTIALLY_ORDERED"].includes(requisition.status)) {
      throw invalidTransition("Purchase requisition", requisition.status, "QUOTE_RECEIVED");
    }
    const supplier = await this.db
      .prepare("SELECT id FROM suppliers WHERE tenant_id=? AND id=? AND active=1")
      .bind(this.actor.tenantId, input.supplierId)
      .first();
    if (!supplier) throw new ServerOperationError("VALIDATION_FAILED", 404, "Supplier not found");
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    let quotedItemsMinor = 0;
    const statements: D1PreparedStatement[] = [];
    for (const line of input.lines) {
      assertScaledInteger(line.quantityMicro, "quote quantity");
      assertScaledInteger(line.unitPriceMinor, "quote unit price");
      quotedItemsMinor += quantityCostMinor(line.quantityMicro, line.unitPriceMinor);
    }
    const totalMinor =
      quotedItemsMinor + (input.deliveryFeeMinor ?? 0) + (input.otherCostMinor ?? 0);
    statements.push(
      this.db
        .prepare(
          `INSERT INTO purchase_quotes
            (tenant_id,id,requisition_id,supplier_id,currency,delivery_fee_minor,other_cost_minor,
             valid_until,lead_time_days,status,payload_json,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,'RECEIVED',?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.requisitionId,
          input.supplierId,
          input.currency,
          input.deliveryFeeMinor ?? 0,
          input.otherCostMinor ?? 0,
          input.validUntil ?? null,
          input.leadTimeDays ?? null,
          JSON.stringify({ quotedItemsMinor, totalMinor }),
          stamp,
        ),
    );
    input.lines.forEach((line) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO purchase_quote_lines
              (tenant_id,id,quote_id,inventory_item_id,quantity_minor,unit_id,unit_price_minor)
             VALUES (?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.inventoryItemId,
            line.quantityMicro,
            line.unitId,
            line.unitPriceMinor,
          ),
      );
    });
    statements.push(
      this.auditStatement(
        "PURCHASE_QUOTE_RECORDED",
        "PURCHASE_QUOTE",
        id,
        stamp,
        crypto.randomUUID(),
        requisition.branch_id,
      ),
    );
    await this.db.batch(statements);
    return { id, totalMinor, status: "RECEIVED" as const };
  }

  async comparePurchaseQuotes(requisitionId: string) {
    this.requirePermission(permissions.inventoryView);
    const requisition = await this.db
      .prepare("SELECT branch_id FROM purchase_requisitions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, requisitionId)
      .first<{ branch_id: string }>();
    if (!requisition)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Purchase requisition not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, requisition.branch_id);
    const quotes = await this.db
      .prepare(
        `SELECT q.id,q.supplier_id,s.name AS supplier_name,q.currency,q.delivery_fee_minor,
                q.other_cost_minor,q.valid_until,q.lead_time_days,q.status,
                CAST(json_extract(q.payload_json,'$.quotedItemsMinor') AS INTEGER) AS quoted_items_minor,
                CAST(json_extract(q.payload_json,'$.totalMinor') AS INTEGER) AS total_minor,
                COUNT(ql.id) AS line_count
         FROM purchase_quotes q
         JOIN suppliers s ON s.tenant_id=q.tenant_id AND s.id=q.supplier_id
         LEFT JOIN purchase_quote_lines ql ON ql.tenant_id=q.tenant_id AND ql.quote_id=q.id
         WHERE q.tenant_id=? AND q.requisition_id=?
         GROUP BY q.id ORDER BY total_minor,q.lead_time_days,q.id`,
      )
      .bind(this.actor.tenantId, requisitionId)
      .all<Record<string, unknown>>();
    return { requisitionId, quotes: quotes.results ?? [] };
  }

  async appendMovement(input: InventoryMovementInput) {
    this.requirePermission(movementPermission(input.movementType));
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    if (input.movementType === "MANUAL_ADJUSTMENT" && !input.reason?.trim()) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Manual inventory adjustments require a reason",
      );
    }
    await this.assertBusinessDateOpen(input.branchId, input.businessDate, input.reason);
    assertMovementSign(input.movementType, input.quantityBaseMicro);
    const duplicate = await this.db
      .prepare("SELECT id FROM inventory_movements WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true };
    const stamp = input.occurredAt ?? new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const costing = await this.costMovement(input);
    const correlationId = crypto.randomUUID();
    const statements = [
      this.movementStatement({ ...input, id, occurredAt: stamp, ...costing }, correlationId),
      this.auditStatement(
        "INVENTORY_MOVEMENT_RECORDED",
        "INVENTORY_MOVEMENT",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
      this.recalculationEventStatement(
        input.branchId,
        "INVENTORY_MOVEMENT",
        "INVENTORY_ITEM",
        input.inventoryItemId,
        input.idempotencyKey,
        stamp,
        correlationId,
      ),
    ];
    statements.push(
      ...(await this.movementAccountingStatements(
        { ...input, id, occurredAt: stamp, ...costing },
        correlationId,
      )),
    );
    try {
      await this.db.batch(statements);
      return { id, duplicate: false, ...costing, correlationId };
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT id FROM inventory_movements WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { id: raced.id, duplicate: true };
      throw error;
    }
  }

  async createPurchaseRequisition(input: PurchaseRequisitionInput) {
    this.requirePermission(permissions.procurementRequisitionCreate);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    if (input.lines.length === 0) throw new Error("A requisition requires at least one line");
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO purchase_requisitions
            (tenant_id,id,branch_id,warehouse_id,requisition_number,source_type,status,
             requested_by,required_at,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,'SUBMITTED',?,?, '{}',?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.warehouseId,
          input.requisitionNumber,
          input.sourceType,
          this.actor.id,
          input.requiredAt ?? null,
          stamp,
          stamp,
        ),
    ];
    input.lines.forEach((line) => {
      assertScaledInteger(line.requestedQuantityMicro, "requisition quantity");
      if (line.requestedQuantityMicro <= 0)
        throw new Error("Requisition quantity must be positive");
      statements.push(
        this.db
          .prepare(
            `INSERT INTO purchase_requisition_lines
              (tenant_id,id,requisition_id,inventory_item_id,requested_quantity_minor,
               unit_id,ordered_quantity_minor,notes)
             VALUES (?,?,?,?,?,?,0,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.inventoryItemId,
            line.requestedQuantityMicro,
            line.unitId,
            line.notes ?? null,
          ),
      );
    });
    statements.push(
      this.auditStatement(
        "PURCHASE_REQUISITION_SUBMITTED",
        "PURCHASE_REQUISITION",
        id,
        stamp,
        crypto.randomUUID(),
        input.branchId,
      ),
    );
    await this.db.batch(statements);
    return { id, status: "SUBMITTED" as const };
  }

  async approvePurchaseRequisition(id: string, reason?: string) {
    this.requirePermission(permissions.procurementRequisitionApprove);
    const row = await this.db
      .prepare("SELECT branch_id,status FROM purchase_requisitions WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<{ branch_id: string; status: string }>();
    if (!row) throw new Error("Purchase requisition not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, row.branch_id);
    if (row.status !== "SUBMITTED")
      throw invalidTransition("Purchase requisition", row.status, "APPROVED");
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE purchase_requisitions SET status='APPROVED',approved_by=?,approved_at=?,approval_reason=?,
           updated_at=? WHERE tenant_id=? AND id=? AND status='SUBMITTED'`,
        )
        .bind(this.actor.id, stamp, reason ?? null, stamp, this.actor.tenantId, id),
      this.auditStatement(
        "PURCHASE_REQUISITION_APPROVED",
        "PURCHASE_REQUISITION",
        id,
        stamp,
        crypto.randomUUID(),
        row.branch_id,
      ),
    ]);
    return { id, status: "APPROVED" as const };
  }

  async createPurchaseOrder(input: PurchaseOrderInput) {
    this.requirePermission(permissions.procurementCreate);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertSupplierAllowedByEnterprisePolicy(input.branchId, input.supplierId);
    if (input.lines.length === 0) throw new Error("A purchase order requires at least one line");
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    let totalMinor = 0;
    const statements: D1PreparedStatement[] = [];
    const lineRows = input.lines.map((line) => {
      assertScaledInteger(line.quantityMicro, "purchase quantity");
      assertScaledInteger(line.unitPriceMinor, "purchase price");
      if (line.quantityMicro <= 0) throw new Error("Purchase quantity must be positive");
      const lineValue = quantityCostMinor(line.quantityMicro, line.unitPriceMinor);
      const lineTotal = lineValue + (line.taxMinor ?? 0) - (line.discountMinor ?? 0);
      totalMinor += lineTotal;
      return { ...line, id: line.id ?? crypto.randomUUID(), lineTotal };
    });
    statements.push(
      this.db
        .prepare(
          `INSERT INTO purchase_orders
            (tenant_id,id,branch_id,purchase_order_number,status,currency,total_minor,version,
             payload_json,created_at,updated_at,supplier_id,warehouse_id,requisition_id,
             expected_at,submitted_by)
           VALUES (?,?,?,?,'SUBMITTED',?,?,1,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.purchaseOrderNumber,
          input.currency,
          totalMinor,
          JSON.stringify({
            overReceiptPolicy: input.overReceiptPolicy ?? "REJECT_OVER_RECEIPT",
            overReceiptToleranceBps: input.overReceiptToleranceBps ?? 0,
          }),
          stamp,
          stamp,
          input.supplierId,
          input.warehouseId,
          input.requisitionId ?? null,
          input.expectedAt ?? null,
          this.actor.id,
        ),
    );
    for (const line of lineRows) {
      const baseQuantity = await this.convertToItemBase(
        line.inventoryItemId,
        line.quantityMicro,
        line.purchaseUnitId,
        stamp,
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO purchase_order_lines
              (tenant_id,id,purchase_order_id,item_id,ordered_quantity_minor,
               received_quantity_minor,unit_cost_minor,payload_json,purchase_unit_id,
               conversion_id,ordered_purchase_quantity_minor,received_purchase_quantity_minor,
               tax_minor,discount_minor)
             VALUES (?,?,?,?,?,0,?,'{}',?,?,?,0,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            line.id,
            id,
            line.inventoryItemId,
            baseQuantity,
            line.unitPriceMinor,
            line.purchaseUnitId,
            line.conversionId ?? null,
            line.quantityMicro,
            line.taxMinor ?? 0,
            line.discountMinor ?? 0,
          ),
      );
    }
    if (input.requisitionId) {
      statements.push(
        this.db
          .prepare(
            `UPDATE purchase_requisitions SET status='ORDERED',updated_at=?
             WHERE tenant_id=? AND id=? AND status IN ('APPROVED','PARTIALLY_ORDERED')`,
          )
          .bind(stamp, this.actor.tenantId, input.requisitionId),
      );
    }
    statements.push(
      this.auditStatement(
        "PURCHASE_ORDER_SUBMITTED",
        "PURCHASE_ORDER",
        id,
        stamp,
        crypto.randomUUID(),
        input.branchId,
      ),
    );
    await this.db.batch(statements);
    return { id, status: "SUBMITTED" as const, totalMinor };
  }

  async approvePurchaseOrder(id: string, reason?: string) {
    this.requirePermission(permissions.procurementApprove);
    const row = await this.db
      .prepare("SELECT branch_id,status FROM purchase_orders WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<{ branch_id: string; status: string }>();
    if (!row) throw new Error("Purchase order not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, row.branch_id);
    if (row.status !== "SUBMITTED")
      throw invalidTransition("Purchase order", row.status, "APPROVED");
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE purchase_orders SET status='APPROVED',approved_by=?,approval_reason=?,approved_at=?,
           version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND status='SUBMITTED'`,
        )
        .bind(this.actor.id, reason ?? null, stamp, stamp, this.actor.tenantId, id),
      this.auditStatement(
        "PURCHASE_ORDER_APPROVED",
        "PURCHASE_ORDER",
        id,
        stamp,
        crypto.randomUUID(),
        row.branch_id,
      ),
    ]);
    return { id, status: "APPROVED" as const };
  }

  async cancelPurchaseOrder(id: string, reason: string) {
    this.requirePermission(permissions.procurementCancel);
    if (!reason.trim()) throw new Error("Purchase order cancellation requires a reason");
    const purchaseOrder = await this.db
      .prepare("SELECT branch_id,status FROM purchase_orders WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<{ branch_id: string; status: string }>();
    if (!purchaseOrder) throw new Error("Purchase order not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, purchaseOrder.branch_id);
    if (!["DRAFT", "SUBMITTED", "APPROVED"].includes(purchaseOrder.status)) {
      throw new Error(`Purchase order cannot be cancelled from ${purchaseOrder.status}`);
    }
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE purchase_orders SET status='CANCELLED',payload_json=json_set(payload_json,
             '$.cancellationReason',?,'$.cancelledBy',?,'$.cancelledAt',?),version=version+1,
             updated_at=? WHERE tenant_id=? AND id=? AND status=?`,
        )
        .bind(
          reason.trim(),
          this.actor.id,
          stamp,
          stamp,
          this.actor.tenantId,
          id,
          purchaseOrder.status,
        ),
      this.auditStatement(
        "PURCHASE_ORDER_CANCELLED",
        "PURCHASE_ORDER",
        id,
        stamp,
        correlationId,
        purchaseOrder.branch_id,
      ),
    ]);
    return { id, status: "CANCELLED" as const };
  }

  async receiveGoods(input: GoodsReceiptInput) {
    this.requirePermission(permissions.procurementReceive);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertBusinessDateOpen(input.branchId, input.businessDate);
    const duplicate = await this.db
      .prepare("SELECT id FROM goods_receipts WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true };
    const purchaseOrder = await this.db
      .prepare(
        `SELECT branch_id,warehouse_id,supplier_id,status,currency,payload_json
         FROM purchase_orders WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, input.purchaseOrderId)
      .first<{
        branch_id: string;
        warehouse_id: string | null;
        supplier_id: string | null;
        status: string;
        currency: string;
        payload_json: string;
      }>();
    if (!purchaseOrder) throw new Error("Purchase order not found");
    if (!["APPROVED", "PARTIALLY_RECEIVED"].includes(purchaseOrder.status)) {
      throw invalidTransition("Purchase order", purchaseOrder.status, "PARTIALLY_RECEIVED");
    }
    if (
      purchaseOrder.branch_id !== input.branchId ||
      purchaseOrder.warehouse_id !== input.warehouseId
    ) {
      throw new ServerOperationError(
        "TENANT_SCOPE_VIOLATION",
        403,
        "Goods receipt scope does not match the purchase order",
      );
    }
    const lines = await this.db
      .prepare(
        `SELECT id,item_id,purchase_unit_id,conversion_id,ordered_quantity_minor,
                ordered_purchase_quantity_minor,received_purchase_quantity_minor,unit_cost_minor
         FROM purchase_order_lines WHERE tenant_id=? AND purchase_order_id=?`,
      )
      .bind(this.actor.tenantId, input.purchaseOrderId)
      .all<PurchaseOrderLineRow>();
    const byId = new Map((lines.results ?? []).map((line) => [line.id, line]));
    const receivingPolicy = JSON.parse(purchaseOrder.payload_json || "{}") as {
      overReceiptPolicy?: "REJECT_OVER_RECEIPT" | "ALLOW_WITH_APPROVAL" | "ALLOW_WITH_TOLERANCE";
      overReceiptToleranceBps?: number;
    };
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO goods_receipts
            (tenant_id,id,branch_id,purchase_order_id,receipt_number,idempotency_key,status,
             payload_json,received_at,supplier_id,warehouse_id,received_by,business_date)
           VALUES (?,?,?,?,?,?,'POSTED','{}',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.purchaseOrderId,
          input.receiptNumber,
          input.idempotencyKey,
          stamp,
          input.supplierId,
          input.warehouseId,
          this.actor.id,
          input.businessDate,
        ),
    ];
    const receiptLines: Array<{
      itemId: string;
      baseQuantityMicro: number;
      totalCostMinor: number;
      unitCostMinor: number;
      priceVarianceMinor: number;
    }> = [];
    for (const lineInput of input.lines) {
      const poLine = byId.get(lineInput.purchaseOrderLineId);
      if (!poLine) throw new Error("Goods receipt line is not on the purchase order");
      if (!poLine.purchase_unit_id)
        throw new Error("Purchase order line is missing a purchase unit");
      if (lineInput.acceptedPurchaseQuantityMicro > lineInput.receivedPurchaseQuantityMicro) {
        throw new Error("Accepted quantity cannot exceed received quantity");
      }
      const orderedPurchaseQuantity =
        poLine.ordered_purchase_quantity_minor ?? poLine.ordered_quantity_minor;
      const projectedReceived =
        poLine.received_purchase_quantity_minor + lineInput.acceptedPurchaseQuantityMicro;
      if (projectedReceived > orderedPurchaseQuantity) {
        const policy = receivingPolicy.overReceiptPolicy ?? "REJECT_OVER_RECEIPT";
        if (policy === "REJECT_OVER_RECEIPT") {
          throw new ServerOperationError("VALIDATION_FAILED", 409, "Over receipt is not allowed");
        }
        if (
          policy === "ALLOW_WITH_APPROVAL" &&
          !this.actor.permissions.includes(permissions.procurementApprove)
        ) {
          throw new ServerOperationError(
            "PERMISSION_DENIED",
            403,
            "Over receipt requires purchase-order approval permission",
          );
        }
        if (policy === "ALLOW_WITH_TOLERANCE") {
          const permitted = multiplyDivide(
            orderedPurchaseQuantity,
            BASIS_POINTS_SCALE + (receivingPolicy.overReceiptToleranceBps ?? 0),
            BASIS_POINTS_SCALE,
            "over-receipt tolerance",
          );
          if (projectedReceived > permitted) {
            throw new ServerOperationError(
              "VALIDATION_FAILED",
              409,
              "Over receipt exceeds the configured tolerance",
            );
          }
        }
      }
      const baseQuantityMicro = await this.convertToItemBase(
        poLine.item_id,
        lineInput.acceptedPurchaseQuantityMicro,
        poLine.purchase_unit_id,
        stamp,
      );
      const totalCostMinor = quantityCostMinor(
        lineInput.acceptedPurchaseQuantityMicro,
        lineInput.unitPriceMinor,
      );
      const normalizedUnitCostMinor =
        baseQuantityMicro > 0
          ? multiplyDivide(
              totalCostMinor,
              QUANTITY_SCALE,
              baseQuantityMicro,
              "normalized unit price",
            )
          : 0;
      const priceVarianceMinor = lineInput.unitPriceMinor - poLine.unit_cost_minor;
      const priceVarianceBps = ratioBasisPoints(priceVarianceMinor, poLine.unit_cost_minor || 1);
      const receiptLineId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO goods_receipt_lines
              (tenant_id,id,goods_receipt_id,purchase_order_line_id,inventory_item_id,
               purchase_unit_id,received_purchase_quantity_minor,accepted_purchase_quantity_minor,
               rejected_purchase_quantity_minor,converted_base_quantity_minor,unit_price_minor,
               total_cost_minor,lot_number,expiry_date,quality_status,price_variance_minor,
               price_variance_bps,notes,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            receiptLineId,
            id,
            poLine.id,
            poLine.item_id,
            poLine.purchase_unit_id,
            lineInput.receivedPurchaseQuantityMicro,
            lineInput.acceptedPurchaseQuantityMicro,
            lineInput.rejectedPurchaseQuantityMicro ?? 0,
            baseQuantityMicro,
            lineInput.unitPriceMinor,
            totalCostMinor,
            lineInput.lotNumber ?? null,
            lineInput.expiryDate ?? null,
            lineInput.qualityStatus ?? "ACCEPTED",
            priceVarianceMinor,
            priceVarianceBps,
            lineInput.notes ?? null,
            stamp,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `UPDATE purchase_order_lines SET
               received_purchase_quantity_minor=received_purchase_quantity_minor+?,
               received_quantity_minor=received_quantity_minor+?
             WHERE tenant_id=? AND id=?`,
          )
          .bind(
            lineInput.acceptedPurchaseQuantityMicro,
            baseQuantityMicro,
            this.actor.tenantId,
            poLine.id,
          ),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO supplier_item_price_history
              (tenant_id,id,supplier_id,inventory_item_id,branch_id,unit_price_minor,unit_id,
               normalized_base_unit_price_minor,effective_at,source_purchase_order_id,
               source_goods_receipt_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            input.supplierId,
            poLine.item_id,
            input.branchId,
            lineInput.unitPriceMinor,
            poLine.purchase_unit_id,
            normalizedUnitCostMinor,
            stamp,
            input.purchaseOrderId,
            id,
            stamp,
          ),
      );
      const movementId = crypto.randomUUID();
      statements.push(
        this.movementStatement(
          {
            id: movementId,
            branchId: input.branchId,
            warehouseId: input.warehouseId,
            inventoryItemId: poLine.item_id,
            movementType: "PURCHASE_RECEIPT",
            quantityBaseMicro: baseQuantityMicro,
            unitCostMinor: normalizedUnitCostMinor,
            totalCostMinor,
            sourceType: "GOODS_RECEIPT",
            sourceId: id,
            idempotencyKey: `goods-receipt:${input.idempotencyKey}:${poLine.id}`,
            businessDate: input.businessDate,
            occurredAt: stamp,
            ...(lineInput.lotNumber
              ? { lotId: `${input.warehouseId}:${poLine.item_id}:${lineInput.lotNumber}` }
              : {}),
            metadata: { receiptLineId, priceVarianceMinor, priceVarianceBps },
          },
          correlationId,
        ),
      );
      if (lineInput.lotNumber) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO inventory_lots
                (tenant_id,id,branch_id,warehouse_id,inventory_item_id,lot_number,
                 goods_receipt_line_id,received_at,expiry_date,quantity_received_minor,
                 quantity_remaining_minor,status,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,'AVAILABLE',?,?)`,
            )
            .bind(
              this.actor.tenantId,
              `${input.warehouseId}:${poLine.item_id}:${lineInput.lotNumber}`,
              input.branchId,
              input.warehouseId,
              poLine.item_id,
              lineInput.lotNumber,
              receiptLineId,
              stamp,
              lineInput.expiryDate ?? null,
              baseQuantityMicro,
              baseQuantityMicro,
              stamp,
              stamp,
            ),
        );
      }
      statements.push(
        this.recalculationEventStatement(
          input.branchId,
          "PURCHASE_RECEIPT",
          "INVENTORY_ITEM",
          poLine.item_id,
          `${input.idempotencyKey}:${poLine.id}`,
          stamp,
          correlationId,
        ),
      );
      receiptLines.push({
        itemId: poLine.item_id,
        baseQuantityMicro,
        totalCostMinor,
        unitCostMinor: normalizedUnitCostMinor,
        priceVarianceMinor,
      });
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE purchase_orders SET status=CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM purchase_order_lines
               WHERE tenant_id=? AND purchase_order_id=?
                 AND received_purchase_quantity_minor < COALESCE(ordered_purchase_quantity_minor,ordered_quantity_minor)
             ) THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END,
           received_at=CASE WHEN NOT EXISTS (
             SELECT 1 FROM purchase_order_lines
             WHERE tenant_id=? AND purchase_order_id=?
               AND received_purchase_quantity_minor < COALESCE(ordered_purchase_quantity_minor,ordered_quantity_minor)
           ) THEN COALESCE(received_at,?) ELSE received_at END,
           version=version+1,updated_at=? WHERE tenant_id=? AND id=?`,
        )
        .bind(
          this.actor.tenantId,
          input.purchaseOrderId,
          this.actor.tenantId,
          input.purchaseOrderId,
          stamp,
          stamp,
          this.actor.tenantId,
          input.purchaseOrderId,
        ),
      this.auditStatement(
        "GOODS_RECEIPT_POSTED",
        "GOODS_RECEIPT",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id, duplicate: false, lines: receiptLines, correlationId };
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT id FROM goods_receipts WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { id: raced.id, duplicate: true, lines: [], correlationId };
      throw error;
    }
  }

  async createRecipe(input: {
    id?: string;
    menuItemId?: string;
    productionItemId?: string;
    branchOverrideId?: string;
    name: string;
  }) {
    this.requirePermission(permissions.inventoryCostControlManage);
    if (!input.menuItemId && !input.productionItemId) {
      throw new Error("Recipe must target a menu item or production item");
    }
    if (input.branchOverrideId) {
      authorizeBranchRead(this.actor, this.actor.tenantId, input.branchOverrideId);
      await this.assertRecipeOverrideAllowed(
        input.branchOverrideId,
        input.menuItemId ?? input.productionItemId!,
      );
    }
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO recipes
          (tenant_id,id,menu_item_id,yield_minor,active,payload_json,name,branch_override_id,
           production_item_id,updated_at)
         VALUES (?,?,?,1,1,'{}',?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.menuItemId ?? `production:${id}`,
        input.name,
        input.branchOverrideId ?? null,
        input.productionItemId ?? null,
        stamp,
      )
      .run();
    return { id, ...input };
  }

  async createRecipeVersion(input: RecipeVersionInput) {
    this.requirePermission(permissions.inventoryCostControlManage);
    if (input.components.length === 0) throw new Error("Recipe version requires components");
    const governedRecipe = await this.db
      .prepare(
        "SELECT branch_override_id,menu_item_id,production_item_id FROM recipes WHERE tenant_id=? AND id=?",
      )
      .bind(this.actor.tenantId, input.recipeId)
      .first<{
        branch_override_id: string | null;
        menu_item_id: string;
        production_item_id: string | null;
      }>();
    if (!governedRecipe)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Recipe not found");
    if (governedRecipe.branch_override_id) {
      authorizeBranchRead(this.actor, this.actor.tenantId, governedRecipe.branch_override_id);
      await this.assertRecipeOverrideAllowed(
        governedRecipe.branch_override_id,
        governedRecipe.production_item_id ?? governedRecipe.menu_item_id,
      );
    }
    await this.assertNoRecipeCycle(
      input.recipeId,
      input.components.flatMap((line) => (line.subRecipeId ? [line.subRecipeId] : [])),
    );
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE recipe_versions SET active=0,effective_to=?
           WHERE tenant_id=? AND recipe_id=? AND active=1 AND effective_from<?`,
        )
        .bind(input.effectiveFrom, this.actor.tenantId, input.recipeId, input.effectiveFrom),
      this.db
        .prepare(
          `INSERT INTO recipe_versions
            (tenant_id,id,recipe_id,version,yield_quantity_minor,yield_unit_id,effective_from,
             active,packaging_cost_minor,production_overhead_minor,created_by,created_at)
           VALUES (?,?,?,?,?,?,?,1,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.recipeId,
          input.version,
          input.yieldQuantityMicro,
          input.yieldUnitId,
          input.effectiveFrom,
          input.packagingCostMinor ?? 0,
          input.productionOverheadMinor ?? 0,
          this.actor.id,
          stamp,
        ),
    ];
    input.components.forEach((component) => {
      if (!!component.inventoryItemId === !!component.subRecipeId) {
        throw new Error("Recipe component must reference exactly one item or sub-recipe");
      }
      statements.push(
        this.db
          .prepare(
            `INSERT INTO recipe_version_components
              (tenant_id,id,recipe_version_id,inventory_item_id,sub_recipe_id,quantity_minor,
               unit_id,waste_factor_bps,optional,station_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            component.inventoryItemId ?? null,
            component.subRecipeId ?? null,
            component.quantityMicro,
            component.unitId,
            component.wasteFactorBps ?? 0,
            component.optional ? 1 : 0,
            component.stationId ?? null,
          ),
      );
    });
    statements.push(
      this.db
        .prepare("UPDATE recipes SET current_version_id=?,updated_at=? WHERE tenant_id=? AND id=?")
        .bind(id, stamp, this.actor.tenantId, input.recipeId),
      this.auditStatement(
        "RECIPE_VERSION_CREATED",
        "RECIPE_VERSION",
        id,
        stamp,
        crypto.randomUUID(),
      ),
      this.recalculationEventStatement(
        undefined,
        "RECIPE_VERSION_CHANGED",
        "RECIPE",
        input.recipeId,
        `recipe-version:${input.recipeId}:${input.version}`,
        stamp,
        crypto.randomUUID(),
      ),
    );
    await this.db.batch(statements);
    return { id, ...input };
  }

  async createPortionStandard(input: PortionStandardInput) {
    this.requirePermission(permissions.inventoryCostControlManage);
    if (input.branchId) authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    if (Boolean(input.menuItemId) === Boolean(input.inventoryItemId)) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Portion standard must reference one menu item or inventory item",
      );
    }
    assertScaledInteger(input.expectedQuantityMicro, "expected portion quantity");
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO portion_standards
            (tenant_id,id,branch_id,menu_item_id,inventory_item_id,expected_quantity_minor,
             unit_id,effective_from,effective_to,active,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId ?? null,
          input.menuItemId ?? null,
          input.inventoryItemId ?? null,
          input.expectedQuantityMicro,
          input.unitId,
          input.effectiveFrom,
          input.effectiveTo ?? null,
          stamp,
          stamp,
        ),
      this.auditStatement(
        "PORTION_STANDARD_CREATED",
        "PORTION_STANDARD",
        id,
        stamp,
        crypto.randomUUID(),
        input.branchId,
      ),
    ]);
    return { id, ...input };
  }

  async recordPortionCheck(input: PortionCheckInput) {
    this.requirePermission(permissions.inventoryCostControlManage);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const standard = await this.db
      .prepare(
        `SELECT expected_quantity_minor FROM portion_standards
         WHERE tenant_id=? AND id=? AND active=1 AND (branch_id IS NULL OR branch_id=?)
           AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)`,
      )
      .bind(
        this.actor.tenantId,
        input.portionStandardId,
        input.branchId,
        input.checkedAt ?? new Date().toISOString(),
        input.checkedAt ?? new Date().toISOString(),
      )
      .first<{ expected_quantity_minor: number }>();
    if (!standard)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Active portion standard not found");
    assertScaledInteger(input.actualQuantityMicro, "actual portion quantity");
    const id = input.id ?? crypto.randomUUID();
    const stamp = input.checkedAt ?? new Date().toISOString();
    const varianceQuantityMicro = input.actualQuantityMicro - standard.expected_quantity_minor;
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO portion_checks
            (tenant_id,id,branch_id,portion_standard_id,expected_quantity_minor,
             actual_quantity_minor,variance_quantity_minor,employee_id,station_id,checked_by,
             checked_at,notes,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.portionStandardId,
          standard.expected_quantity_minor,
          input.actualQuantityMicro,
          varianceQuantityMicro,
          input.employeeId ?? null,
          input.stationId ?? null,
          this.actor.id,
          stamp,
          input.notes ?? null,
          new Date().toISOString(),
        ),
      this.auditStatement(
        "PORTION_CHECK_RECORDED",
        "PORTION_CHECK",
        id,
        stamp,
        crypto.randomUUID(),
        input.branchId,
      ),
    ]);
    return { id, expectedQuantityMicro: standard.expected_quantity_minor, varianceQuantityMicro };
  }

  async recipeCostMinor(recipeVersionId: string, visited = new Set<string>()): Promise<number> {
    if (visited.has(recipeVersionId)) throw new Error("Circular recipe dependency detected");
    visited.add(recipeVersionId);
    const version = await this.db
      .prepare(
        `SELECT packaging_cost_minor,production_overhead_minor FROM recipe_versions
         WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .first<{ packaging_cost_minor: number; production_overhead_minor: number }>();
    if (!version) throw new Error("Recipe version not found");
    const components = await this.db
      .prepare(
        `SELECT inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps
         FROM recipe_version_components WHERE tenant_id=? AND recipe_version_id=?`,
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .all<RecipeComponentRow>();
    let total = version.packaging_cost_minor + version.production_overhead_minor;
    for (const component of components.results ?? []) {
      if (component.inventory_item_id) {
        const item = await this.db
          .prepare("SELECT base_unit_id FROM inventory_items WHERE tenant_id=? AND id=?")
          .bind(this.actor.tenantId, component.inventory_item_id)
          .first<{ base_unit_id: string }>();
        if (!item?.base_unit_id) throw new Error("Recipe item is missing its base unit");
        const baseQuantity = await this.convertItemQuantity(
          component.inventory_item_id,
          component.quantity_minor,
          component.unit_id,
          item.base_unit_id,
        );
        const cost = await this.weightedItemCost(component.inventory_item_id);
        const withWaste = multiplyDivide(
          baseQuantity,
          BASIS_POINTS_SCALE + component.waste_factor_bps,
          BASIS_POINTS_SCALE,
          "yield-adjusted recipe quantity",
        );
        total += quantityCostMinor(withWaste, cost);
      } else if (component.sub_recipe_id) {
        const sub = await this.db
          .prepare(
            `SELECT r.current_version_id,r.production_item_id,rv.yield_quantity_minor,rv.yield_unit_id
             FROM recipes r LEFT JOIN recipe_versions rv ON rv.tenant_id=r.tenant_id
               AND rv.id=r.current_version_id
             WHERE r.tenant_id=? AND r.id=?`,
          )
          .bind(this.actor.tenantId, component.sub_recipe_id)
          .first<{
            current_version_id: string | null;
            production_item_id: string | null;
            yield_quantity_minor: number | null;
            yield_unit_id: string | null;
          }>();
        if (!sub?.current_version_id || !sub.yield_quantity_minor || !sub.yield_unit_id) {
          throw new Error("Sub-recipe has no active version or configured yield");
        }
        let requestedQuantity = component.quantity_minor;
        if (component.unit_id !== sub.yield_unit_id) {
          if (!sub.production_item_id) {
            throw new Error("Sub-recipe unit conversion requires a production inventory item");
          }
          requestedQuantity = await this.convertItemQuantity(
            sub.production_item_id,
            component.quantity_minor,
            component.unit_id,
            sub.yield_unit_id,
          );
        }
        const withWaste = multiplyDivide(
          requestedQuantity,
          BASIS_POINTS_SCALE + component.waste_factor_bps,
          BASIS_POINTS_SCALE,
          "sub-recipe waste quantity",
        );
        const subRecipeCost = await this.recipeCostMinor(sub.current_version_id, new Set(visited));
        total += multiplyDivide(
          subRecipeCost,
          withWaste,
          sub.yield_quantity_minor,
          "sub-recipe component cost",
        );
      }
    }
    visited.delete(recipeVersionId);
    return total;
  }

  async completeProduction(input: ProductionCompletionInput) {
    this.requirePermission(permissions.productionComplete);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertBusinessDateOpen(input.branchId, input.businessDate);
    const duplicate = await this.db
      .prepare("SELECT id FROM production_batches WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true };
    const version = await this.db
      .prepare(`SELECT yield_quantity_minor FROM recipe_versions WHERE tenant_id=? AND id=?`)
      .bind(this.actor.tenantId, input.recipeVersionId)
      .first<{ yield_quantity_minor: number }>();
    if (!version) throw new Error("Recipe version not found");
    const components = await this.db
      .prepare(
        `SELECT id,inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps
         FROM recipe_version_components WHERE tenant_id=? AND recipe_version_id=?`,
      )
      .bind(this.actor.tenantId, input.recipeVersionId)
      .all<RecipeComponentRow>();
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    let inputValueMinor = 0;
    const inputMovements: Array<{ itemId: string; quantityMicro: number; valueMinor: number }> = [];
    for (const component of components.results ?? []) {
      const itemId =
        component.inventory_item_id ??
        (await this.productionItemForRecipe(component.sub_recipe_id));
      if (!itemId) throw new Error("Production component has no inventory output item");
      const item = await this.db
        .prepare("SELECT base_unit_id FROM inventory_items WHERE tenant_id=? AND id=?")
        .bind(this.actor.tenantId, itemId)
        .first<{ base_unit_id: string }>();
      if (!item?.base_unit_id) throw new Error("Production input is missing its base unit");
      const componentForBatch = multiplyDivide(
        component.quantity_minor,
        input.plannedQuantityMicro,
        version.yield_quantity_minor,
        "production input quantity",
      );
      const withWaste = multiplyDivide(
        componentForBatch,
        BASIS_POINTS_SCALE + component.waste_factor_bps,
        BASIS_POINTS_SCALE,
        "production input with process loss",
      );
      const baseQuantity = await this.convertItemQuantity(
        itemId,
        withWaste,
        component.unit_id,
        item.base_unit_id,
      );
      const unitCost = await this.weightedItemCost(itemId, input.branchId, input.warehouseId);
      const value = quantityCostMinor(baseQuantity, unitCost);
      inputValueMinor += value;
      inputMovements.push({ itemId, quantityMicro: -baseQuantity, valueMinor: -value });
    }
    const outputUnitCost =
      input.actualOutputQuantityMicro > 0
        ? multiplyDivide(
            inputValueMinor,
            QUANTITY_SCALE,
            input.actualOutputQuantityMicro,
            "production output cost",
          )
        : 0;
    const yieldVarianceBps = ratioBasisPoints(
      input.actualOutputQuantityMicro - input.plannedQuantityMicro,
      input.plannedQuantityMicro,
    );
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO production_batches
            (tenant_id,id,branch_id,warehouse_id,recipe_version_id,planned_quantity_minor,
             actual_output_quantity_minor,output_item_id,station_id,employee_id,status,
             idempotency_key,started_at,completed_at,business_date,expected_yield_minor,
             yield_variance_bps,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'COMPLETED',?,?,?,?,?,?,'{}',?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.warehouseId,
          input.recipeVersionId,
          input.plannedQuantityMicro,
          input.actualOutputQuantityMicro,
          input.outputItemId,
          input.stationId ?? null,
          input.employeeId ?? null,
          input.idempotencyKey,
          stamp,
          stamp,
          input.businessDate,
          input.plannedQuantityMicro,
          yieldVarianceBps,
          stamp,
          stamp,
        ),
    ];
    inputMovements.forEach((movement, index) => {
      statements.push(
        this.movementStatement(
          {
            id: crypto.randomUUID(),
            branchId: input.branchId,
            warehouseId: input.warehouseId,
            inventoryItemId: movement.itemId,
            movementType: "PRODUCTION_INPUT",
            quantityBaseMicro: movement.quantityMicro,
            unitCostMinor: Math.abs(
              quantityCostFromTotal(movement.quantityMicro, movement.valueMinor),
            ),
            totalCostMinor: movement.valueMinor,
            sourceType: "PRODUCTION_BATCH",
            sourceId: id,
            idempotencyKey: `production:${input.idempotencyKey}:input:${index}`,
            businessDate: input.businessDate,
            occurredAt: stamp,
          },
          correlationId,
        ),
      );
    });
    statements.push(
      this.movementStatement(
        {
          id: crypto.randomUUID(),
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          inventoryItemId: input.outputItemId,
          movementType: "PRODUCTION_OUTPUT",
          quantityBaseMicro: input.actualOutputQuantityMicro,
          unitCostMinor: outputUnitCost,
          totalCostMinor: inputValueMinor,
          sourceType: "PRODUCTION_BATCH",
          sourceId: id,
          idempotencyKey: `production:${input.idempotencyKey}:output`,
          businessDate: input.businessDate,
          occurredAt: stamp,
        },
        correlationId,
      ),
      this.auditStatement(
        "PRODUCTION_BATCH_COMPLETED",
        "PRODUCTION_BATCH",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
      this.recalculationEventStatement(
        input.branchId,
        "PRODUCTION_COMPLETED",
        "PRODUCTION_BATCH",
        id,
        input.idempotencyKey,
        stamp,
        correlationId,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id, duplicate: false, inputValueMinor, outputUnitCost, yieldVarianceBps };
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT id FROM production_batches WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { id: raced.id, duplicate: true };
      throw error;
    }
  }

  async postStockCount(input: StockCountInput) {
    this.requirePermission(permissions.inventoryCountApprove);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertBusinessDateOpen(input.branchId, input.businessDate, input.approvalReason);
    const duplicate = await this.db
      .prepare("SELECT id FROM stock_count_sessions WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true };
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO stock_count_sessions
            (tenant_id,id,branch_id,warehouse_id,business_date,status,scope_json,blind_count,
             started_by,approved_by,approval_reason,idempotency_key,created_at,updated_at)
           VALUES (?,?,?,?,?,'POSTED','{}',?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.warehouseId,
          input.businessDate,
          input.blindCount ? 1 : 0,
          this.actor.id,
          this.actor.id,
          input.approvalReason ?? null,
          input.idempotencyKey,
          stamp,
          stamp,
        ),
    ];
    const variances: Array<{ itemId: string; quantityMicro: number; valueMinor: number }> = [];
    for (const [index, line] of input.lines.entries()) {
      const balance = await this.balance(input.branchId, input.warehouseId, line.inventoryItemId);
      const variance = line.countedQuantityMicro - balance.quantity_minor;
      const varianceValue =
        quantityCostMinor(Math.abs(variance), balance.average_unit_cost_minor) *
        Math.sign(variance);
      if (variance !== 0 && !input.approvalReason && !line.reason) {
        throw new Error("Stock count variance requires an approval reason");
      }
      const movementId = variance === 0 ? null : crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_count_lines
              (tenant_id,id,stock_count_session_id,inventory_item_id,counter_id,
               expected_quantity_minor,counted_quantity_minor,variance_quantity_minor,
               variance_value_minor,reason,posted_movement_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.inventoryItemId,
            this.actor.id,
            balance.quantity_minor,
            line.countedQuantityMicro,
            variance,
            varianceValue,
            line.reason ?? input.approvalReason ?? null,
            movementId,
            stamp,
          ),
      );
      if (movementId) {
        const movementInput: InventoryMovementInput & {
          id: string;
          occurredAt: string;
          unitCostMinor: number;
          totalCostMinor: number;
        } = {
          id: movementId,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          inventoryItemId: line.inventoryItemId,
          movementType: "STOCK_COUNT_ADJUSTMENT",
          quantityBaseMicro: variance,
          unitCostMinor: balance.average_unit_cost_minor,
          totalCostMinor: varianceValue,
          sourceType: "STOCK_COUNT",
          sourceId: id,
          idempotencyKey: `stock-count:${input.idempotencyKey}:${index}`,
          businessDate: input.businessDate,
          occurredAt: stamp,
          ...((line.reason ?? input.approvalReason)
            ? { reason: line.reason ?? input.approvalReason }
            : {}),
          negativeOverride: true,
        };
        statements.push(
          this.movementStatement(movementInput, correlationId),
          ...(await this.movementAccountingStatements(movementInput, correlationId)),
        );
      }
      variances.push({
        itemId: line.inventoryItemId,
        quantityMicro: variance,
        valueMinor: varianceValue,
      });
    }
    statements.push(
      this.auditStatement(
        "STOCK_COUNT_POSTED",
        "STOCK_COUNT",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
      this.recalculationEventStatement(
        input.branchId,
        "STOCK_COUNT_POSTED",
        "STOCK_COUNT",
        id,
        input.idempotencyKey,
        stamp,
        correlationId,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id, duplicate: false, variances };
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT id FROM stock_count_sessions WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { id: raced.id, duplicate: true, variances: [] };
      throw error;
    }
  }

  async upsertParPolicy(input: InventoryParPolicyInput) {
    this.requirePermission(permissions.inventoryCostControlManage);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    if (input.targetQuantityMicro < input.reorderPointMicro) {
      throw new Error("PAR target quantity cannot be below reorder point");
    }
    if (
      input.maximumQuantityMicro !== undefined &&
      input.minimumQuantityMicro !== undefined &&
      input.maximumQuantityMicro < input.minimumQuantityMicro
    ) {
      throw new Error("PAR maximum quantity cannot be below minimum quantity");
    }
    const id =
      input.id ??
      `par:${input.branchId}:${input.warehouseId}:${input.inventoryItemId}:${input.dayOfWeek ?? "default"}`;
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO inventory_par_policies
            (tenant_id,id,branch_id,warehouse_id,inventory_item_id,day_of_week,
             reorder_point_minor,target_quantity_minor,safety_stock_minor,
             minimum_quantity_minor,maximum_quantity_minor,recommendation_mode,active,
             created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
           ON CONFLICT(tenant_id,id)
           DO UPDATE SET reorder_point_minor=excluded.reorder_point_minor,
             target_quantity_minor=excluded.target_quantity_minor,
             safety_stock_minor=excluded.safety_stock_minor,
             minimum_quantity_minor=excluded.minimum_quantity_minor,
             maximum_quantity_minor=excluded.maximum_quantity_minor,
             recommendation_mode=excluded.recommendation_mode,active=1,
             updated_at=excluded.updated_at`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.warehouseId,
          input.inventoryItemId,
          input.dayOfWeek ?? null,
          input.reorderPointMicro,
          input.targetQuantityMicro,
          input.safetyStockMicro ?? 0,
          input.minimumQuantityMicro ?? 0,
          input.maximumQuantityMicro ?? null,
          input.recommendationMode ?? "RECOMMEND",
          stamp,
          stamp,
        ),
      this.recalculationEventStatement(
        input.branchId,
        "PAR_POLICY_CHANGED",
        "INVENTORY_ITEM",
        input.inventoryItemId,
        `par:${input.branchId}:${input.warehouseId}:${input.inventoryItemId}:${input.dayOfWeek ?? "default"}:${stamp}`,
        stamp,
        correlationId,
      ),
      this.auditStatement(
        "PAR_POLICY_UPDATED",
        "INVENTORY_ITEM",
        input.inventoryItemId,
        stamp,
        correlationId,
        input.branchId,
      ),
    ]);
    return { id, ...input, recommendationMode: input.recommendationMode ?? "RECOMMEND" };
  }

  async transferStock(input: {
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
      sentQuantityMicro: number;
      receivedQuantityMicro: number;
    }>;
  }) {
    this.requirePermission(permissions.inventoryTransfer);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.sourceBranchId);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.destinationBranchId);
    await this.assertBusinessDateOpen(input.sourceBranchId, input.businessDate);
    await this.assertBusinessDateOpen(input.destinationBranchId, input.businessDate);
    const duplicate = await this.db
      .prepare(
        `SELECT id FROM stock_transfers WHERE tenant_id=?
         AND json_extract(payload_json,'$.idempotencyKey')=?`,
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string }>();
    if (duplicate) return { id: duplicate.id, duplicate: true, shortages: [] };
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO stock_transfers
            (tenant_id,id,transfer_number,source_branch_id,source_warehouse_id,
             destination_branch_id,destination_warehouse_id,status,requested_by,approved_by,
             received_by,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'RECEIVED',?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.transferNumber,
          input.sourceBranchId,
          input.sourceWarehouseId,
          input.destinationBranchId,
          input.destinationWarehouseId,
          this.actor.id,
          this.actor.id,
          this.actor.id,
          JSON.stringify({ idempotencyKey: input.idempotencyKey }),
          stamp,
          stamp,
        ),
    ];
    const shortages: Array<{ itemId: string; quantityMicro: number; valueMinor: number }> = [];
    for (const [index, line] of input.lines.entries()) {
      if (line.receivedQuantityMicro > line.sentQuantityMicro) {
        throw new Error("Transfer received quantity cannot exceed sent quantity");
      }
      const unitCost = await this.weightedItemCost(
        line.inventoryItemId,
        input.sourceBranchId,
        input.sourceWarehouseId,
      );
      const sentValue = quantityCostMinor(line.sentQuantityMicro, unitCost);
      const receivedValue = quantityCostMinor(line.receivedQuantityMicro, unitCost);
      const shortage = line.sentQuantityMicro - line.receivedQuantityMicro;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_transfer_lines
              (tenant_id,id,transfer_id,inventory_item_id,requested_quantity_minor,
               sent_quantity_minor,received_quantity_minor,shortage_quantity_minor,unit_cost_minor)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.inventoryItemId,
            line.sentQuantityMicro,
            line.sentQuantityMicro,
            line.receivedQuantityMicro,
            shortage,
            unitCost,
          ),
        this.movementStatement(
          {
            id: crypto.randomUUID(),
            branchId: input.sourceBranchId,
            warehouseId: input.sourceWarehouseId,
            inventoryItemId: line.inventoryItemId,
            movementType: "TRANSFER_OUT",
            quantityBaseMicro: -line.sentQuantityMicro,
            unitCostMinor: unitCost,
            totalCostMinor: -sentValue,
            sourceType: "STOCK_TRANSFER",
            sourceId: id,
            idempotencyKey: `transfer:${input.idempotencyKey}:${index}:out`,
            businessDate: input.businessDate,
            occurredAt: stamp,
          },
          correlationId,
        ),
        this.movementStatement(
          {
            id: crypto.randomUUID(),
            branchId: input.destinationBranchId,
            warehouseId: input.destinationWarehouseId,
            inventoryItemId: line.inventoryItemId,
            movementType: "TRANSFER_IN",
            quantityBaseMicro: line.receivedQuantityMicro,
            unitCostMinor: unitCost,
            totalCostMinor: receivedValue,
            sourceType: "STOCK_TRANSFER",
            sourceId: id,
            idempotencyKey: `transfer:${input.idempotencyKey}:${index}:in`,
            businessDate: input.businessDate,
            occurredAt: stamp,
          },
          correlationId,
        ),
      );
      shortages.push({
        itemId: line.inventoryItemId,
        quantityMicro: shortage,
        valueMinor: sentValue - receivedValue,
      });
    }
    statements.push(
      this.auditStatement(
        "STOCK_TRANSFER_RECEIVED",
        "STOCK_TRANSFER",
        id,
        stamp,
        correlationId,
        input.destinationBranchId,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id, duplicate: false, shortages };
    } catch (error) {
      const raced = await this.db
        .prepare(
          `SELECT id FROM stock_transfers WHERE tenant_id=?
           AND json_extract(payload_json,'$.idempotencyKey')=?`,
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string }>();
      if (raced) return { id: raced.id, duplicate: true, shortages: [] };
      throw error;
    }
  }

  async dispatchTransfer(input: StagedTransferDispatchInput) {
    this.requirePermission(permissions.inventoryTransfer);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.sourceBranchId);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.destinationBranchId);
    await this.assertBusinessDateOpen(input.sourceBranchId, input.businessDate);
    if (input.lines.length === 0) throw new Error("A transfer requires at least one line");
    if (
      input.sourceBranchId === input.destinationBranchId &&
      input.sourceWarehouseId === input.destinationWarehouseId
    ) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Transfer source and destination must differ",
      );
    }
    const duplicate = await this.db
      .prepare(
        "SELECT id,transfer_id FROM inventory_transfer_shipments WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; transfer_id: string }>();
    if (duplicate) return { id: duplicate.transfer_id, shipmentId: duplicate.id, duplicate: true };

    const accounting = await this.transferAccountingConfiguration(
      input.sourceBranchId,
      input.destinationBranchId,
    );
    const id = input.id ?? crypto.randomUUID();
    const shipmentId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO stock_transfers
            (tenant_id,id,transfer_number,source_branch_id,source_warehouse_id,
             destination_branch_id,destination_warehouse_id,status,requested_by,approved_by,
             received_by,payload_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'IN_TRANSIT',?,?,NULL,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.transferNumber,
          input.sourceBranchId,
          input.sourceWarehouseId,
          input.destinationBranchId,
          input.destinationWarehouseId,
          this.actor.id,
          this.actor.id,
          JSON.stringify({ idempotencyKey: input.idempotencyKey, staged: true }),
          stamp,
          stamp,
        ),
      this.db
        .prepare(
          `INSERT INTO inventory_transfer_shipments
            (tenant_id,id,transfer_id,source_legal_entity_id,destination_legal_entity_id,status,
             idempotency_key,dispatched_by,dispatched_at,created_at,updated_at)
           VALUES (?,?,?,?,?,'IN_TRANSIT',?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          shipmentId,
          id,
          accounting.sourceLegalEntityId,
          accounting.destinationLegalEntityId,
          input.idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
          stamp,
        ),
    ];
    for (const [index, line] of input.lines.entries()) {
      assertScaledInteger(line.quantityMicro, "transfer quantity");
      if (line.quantityMicro <= 0) throw new Error("Transfer quantity must be positive");
      const lot = line.sourceLotId
        ? await this.db
            .prepare(
              `SELECT id,lot_number,expiry_date,quantity_remaining_minor
               FROM inventory_lots WHERE tenant_id=? AND id=? AND branch_id=?
                 AND warehouse_id=? AND inventory_item_id=? AND status='AVAILABLE'`,
            )
            .bind(
              this.actor.tenantId,
              line.sourceLotId,
              input.sourceBranchId,
              input.sourceWarehouseId,
              line.inventoryItemId,
            )
            .first<{
              id: string;
              lot_number: string;
              expiry_date: string | null;
              quantity_remaining_minor: number;
            }>()
        : null;
      if (line.sourceLotId && !lot) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Transfer source lot is unavailable",
        );
      }
      if (lot && lot.quantity_remaining_minor < line.quantityMicro) {
        throw new ServerOperationError(
          "CONFLICT",
          409,
          "Transfer quantity exceeds the selected lot balance",
        );
      }
      const unitCost = await this.weightedItemCost(
        line.inventoryItemId,
        input.sourceBranchId,
        input.sourceWarehouseId,
      );
      const valueMinor = quantityCostMinor(line.quantityMicro, unitCost);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO stock_transfer_lines
              (tenant_id,id,transfer_id,inventory_item_id,requested_quantity_minor,
               sent_quantity_minor,received_quantity_minor,shortage_quantity_minor,unit_cost_minor,
               source_lot_id,lot_number,expiry_date)
             VALUES (?,?,?,?,?,?,0,0,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.inventoryItemId,
            line.quantityMicro,
            line.quantityMicro,
            unitCost,
            lot?.id ?? null,
            lot?.lot_number ?? null,
            lot?.expiry_date ?? null,
          ),
        this.movementStatement(
          {
            id: crypto.randomUUID(),
            branchId: input.sourceBranchId,
            warehouseId: input.sourceWarehouseId,
            inventoryItemId: line.inventoryItemId,
            movementType: "TRANSFER_OUT",
            quantityBaseMicro: -line.quantityMicro,
            unitCostMinor: unitCost,
            totalCostMinor: -valueMinor,
            sourceType: "TRANSFER_SHIPMENT",
            sourceId: shipmentId,
            idempotencyKey: `transfer-dispatch:${input.idempotencyKey}:${index}`,
            businessDate: input.businessDate,
            occurredAt: stamp,
            metadata: {
              destinationBranchId: input.destinationBranchId,
              accountingTreatment: accounting.treatment,
              intercompanyConfigurationId: accounting.configurationId,
              sourceLotId: lot?.id,
              lotNumber: lot?.lot_number,
              expiryDate: lot?.expiry_date,
            },
          },
          correlationId,
        ),
      );
    }
    statements.push(
      this.auditStatement(
        "STOCK_TRANSFER_DISPATCHED",
        "INVENTORY_TRANSFER_SHIPMENT",
        shipmentId,
        stamp,
        correlationId,
        input.sourceBranchId,
      ),
    );
    try {
      await this.db.batch(statements);
      return {
        id,
        shipmentId,
        duplicate: false,
        accountingTreatment: accounting.treatment,
      };
    } catch (error) {
      const raced = await this.db
        .prepare(
          "SELECT id,transfer_id FROM inventory_transfer_shipments WHERE tenant_id=? AND idempotency_key=?",
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string; transfer_id: string }>();
      if (raced) return { id: raced.transfer_id, shipmentId: raced.id, duplicate: true };
      throw error;
    }
  }

  async receiveTransferShipment(input: StagedTransferReceiptInput) {
    this.requirePermission(permissions.inventoryTransfer);
    const duplicate = await this.db
      .prepare(
        "SELECT id,variance_json FROM inventory_transfer_receipts WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; variance_json: string }>();
    if (duplicate) {
      return {
        id: duplicate.id,
        duplicate: true,
        variances: JSON.parse(duplicate.variance_json) as unknown[],
      };
    }
    const shipment = await this.db
      .prepare(
        `SELECT s.id,s.transfer_id,s.status,t.destination_branch_id,t.destination_warehouse_id
         FROM inventory_transfer_shipments s
         JOIN stock_transfers t ON t.tenant_id=s.tenant_id AND t.id=s.transfer_id
         WHERE s.tenant_id=? AND s.id=?`,
      )
      .bind(this.actor.tenantId, input.shipmentId)
      .first<{
        id: string;
        transfer_id: string;
        status: string;
        destination_branch_id: string;
        destination_warehouse_id: string;
      }>();
    if (!shipment)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Transfer shipment not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, shipment.destination_branch_id);
    await this.assertBusinessDateOpen(shipment.destination_branch_id, input.businessDate);
    if (!["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(shipment.status)) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Transfer shipment is not receivable",
      );
    }
    const rows = await this.db
      .prepare(
        `SELECT l.id,l.inventory_item_id,l.sent_quantity_minor,l.received_quantity_minor,l.unit_cost_minor,
                l.source_lot_id,l.lot_number,l.expiry_date,
                COALESCE(SUM(rl.damaged_quantity_micro+rl.rejected_quantity_micro+rl.missing_quantity_micro),0) exception_quantity
         FROM stock_transfer_lines l
         LEFT JOIN inventory_transfer_receipt_lines rl
           ON rl.tenant_id=l.tenant_id AND rl.transfer_line_id=l.id
         WHERE l.tenant_id=? AND l.transfer_id=?
         GROUP BY l.id,l.inventory_item_id,l.sent_quantity_minor,l.received_quantity_minor,l.unit_cost_minor`,
      )
      .bind(this.actor.tenantId, shipment.transfer_id)
      .all<{
        id: string;
        inventory_item_id: string;
        sent_quantity_minor: number;
        received_quantity_minor: number;
        unit_cost_minor: number;
        source_lot_id: string | null;
        lot_number: string | null;
        expiry_date: string | null;
        exception_quantity: number;
      }>();
    const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));
    const supplied = new Map<string, StagedTransferReceiptInput["lines"][number]>();
    for (const line of input.lines) {
      if (supplied.has(line.transferLineId))
        throw new Error("Transfer receipt contains a duplicate line");
      const source = byId.get(line.transferLineId);
      if (!source)
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Transfer line does not belong to this shipment",
        );
      const accounted =
        line.receivedQuantityMicro +
        (line.damagedQuantityMicro ?? 0) +
        (line.rejectedQuantityMicro ?? 0) +
        (line.missingQuantityMicro ?? 0);
      assertScaledInteger(accounted, "transfer received quantity");
      if (accounted <= 0)
        throw new Error("Transfer receipt line must account for a positive quantity");
      if (
        source.received_quantity_minor + source.exception_quantity + accounted >
        source.sent_quantity_minor
      ) {
        throw new ServerOperationError(
          "CONFLICT",
          409,
          "Transfer receipt exceeds dispatched quantity",
        );
      }
      supplied.set(line.transferLineId, line);
    }
    const complete = (rows.results ?? []).every((row) => {
      const line = supplied.get(row.id);
      const additional = line
        ? line.receivedQuantityMicro +
          (line.damagedQuantityMicro ?? 0) +
          (line.rejectedQuantityMicro ?? 0) +
          (line.missingQuantityMicro ?? 0)
        : 0;
      return (
        row.received_quantity_minor + row.exception_quantity + additional ===
        row.sent_quantity_minor
      );
    });
    if (input.final && !complete) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Final transfer receipt must account for every dispatched quantity",
      );
    }
    const receiptId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const variances = input.lines
      .map((line) => ({
        transferLineId: line.transferLineId,
        damagedQuantityMicro: line.damagedQuantityMicro ?? 0,
        rejectedQuantityMicro: line.rejectedQuantityMicro ?? 0,
        missingQuantityMicro: line.missingQuantityMicro ?? 0,
      }))
      .filter(
        (line) =>
          line.damagedQuantityMicro + line.rejectedQuantityMicro + line.missingQuantityMicro > 0,
      );
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO inventory_transfer_receipts
            (tenant_id,id,shipment_id,receipt_reference,idempotency_key,received_json,
             variance_json,received_by,received_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          receiptId,
          input.shipmentId,
          input.receiptReference,
          input.idempotencyKey,
          JSON.stringify(input.lines),
          JSON.stringify(variances),
          this.actor.id,
          stamp,
        ),
    ];
    for (const [index, line] of input.lines.entries()) {
      const source = byId.get(line.transferLineId)!;
      const received = line.receivedQuantityMicro;
      const damaged = line.damagedQuantityMicro ?? 0;
      const rejected = line.rejectedQuantityMicro ?? 0;
      const missing = line.missingQuantityMicro ?? 0;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_transfer_receipt_lines
              (tenant_id,id,receipt_id,shipment_id,transfer_line_id,inventory_item_id,
               received_quantity_micro,damaged_quantity_micro,rejected_quantity_micro,missing_quantity_micro)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            receiptId,
            input.shipmentId,
            line.transferLineId,
            source.inventory_item_id,
            received,
            damaged,
            rejected,
            missing,
          ),
        this.db
          .prepare(
            `UPDATE stock_transfer_lines SET
               received_quantity_minor=received_quantity_minor+?,
               shortage_quantity_minor=CASE WHEN ?=1 THEN sent_quantity_minor-(received_quantity_minor+?) ELSE 0 END
             WHERE tenant_id=? AND id=?`,
          )
          .bind(received, complete ? 1 : 0, received, this.actor.tenantId, line.transferLineId),
      );
      if (received > 0) {
        const valueMinor = quantityCostMinor(received, source.unit_cost_minor);
        if (source.lot_number) {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO inventory_lots
                  (tenant_id,id,branch_id,warehouse_id,inventory_item_id,lot_number,
                   received_at,expiry_date,quantity_received_minor,quantity_remaining_minor,
                   status,created_at,updated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,'AVAILABLE',?,?)
                 ON CONFLICT(tenant_id,warehouse_id,inventory_item_id,lot_number) DO UPDATE SET
                   quantity_received_minor=inventory_lots.quantity_received_minor+excluded.quantity_received_minor,
                   quantity_remaining_minor=inventory_lots.quantity_remaining_minor+excluded.quantity_remaining_minor,
                   expiry_date=COALESCE(inventory_lots.expiry_date,excluded.expiry_date),
                   status='AVAILABLE',updated_at=excluded.updated_at`,
              )
              .bind(
                this.actor.tenantId,
                crypto.randomUUID(),
                shipment.destination_branch_id,
                shipment.destination_warehouse_id,
                source.inventory_item_id,
                source.lot_number,
                stamp,
                source.expiry_date,
                received,
                received,
                stamp,
                stamp,
              ),
          );
        }
        statements.push(
          this.movementStatement(
            {
              id: crypto.randomUUID(),
              branchId: shipment.destination_branch_id,
              warehouseId: shipment.destination_warehouse_id,
              inventoryItemId: source.inventory_item_id,
              movementType: "TRANSFER_IN",
              quantityBaseMicro: received,
              unitCostMinor: source.unit_cost_minor,
              totalCostMinor: valueMinor,
              sourceType: "TRANSFER_RECEIPT",
              sourceId: receiptId,
              idempotencyKey: `transfer-receipt:${input.idempotencyKey}:${index}`,
              businessDate: input.businessDate,
              occurredAt: stamp,
              metadata: {
                shipmentId: input.shipmentId,
                sourceLotId: source.source_lot_id,
                lotNumber: source.lot_number,
                expiryDate: source.expiry_date,
              },
            },
            correlationId,
          ),
        );
      }
    }
    const nextStatus = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
    statements.push(
      this.db
        .prepare(
          "UPDATE inventory_transfer_shipments SET status=?,updated_at=? WHERE tenant_id=? AND id=? AND status IN ('IN_TRANSIT','PARTIALLY_RECEIVED')",
        )
        .bind(nextStatus, stamp, this.actor.tenantId, input.shipmentId),
      this.db
        .prepare(
          "UPDATE stock_transfers SET status=?,received_by=?,updated_at=? WHERE tenant_id=? AND id=? AND status='IN_TRANSIT'",
        )
        .bind(
          complete ? "RECEIVED" : "IN_TRANSIT",
          complete ? this.actor.id : null,
          stamp,
          this.actor.tenantId,
          shipment.transfer_id,
        ),
      this.auditStatement(
        "STOCK_TRANSFER_RECEIPT_POSTED",
        "INVENTORY_TRANSFER_RECEIPT",
        receiptId,
        stamp,
        correlationId,
        shipment.destination_branch_id,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id: receiptId, duplicate: false, status: nextStatus, variances };
    } catch (error) {
      const raced = await this.db
        .prepare(
          "SELECT id,variance_json FROM inventory_transfer_receipts WHERE tenant_id=? AND idempotency_key=?",
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string; variance_json: string }>();
      if (raced)
        return {
          id: raced.id,
          duplicate: true,
          variances: JSON.parse(raced.variance_json) as unknown[],
        };
      throw error;
    }
  }

  async recordWastage(input: {
    id?: string;
    branchId: string;
    warehouseId: string;
    inventoryItemId: string;
    quantityMicro: number;
    businessDate: string;
    reasonCode: string;
    idempotencyKey: string;
    stationId?: string;
    employeeId?: string;
  }) {
    this.requirePermission(permissions.inventoryWastageRecord);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertBusinessDateOpen(input.branchId, input.businessDate, input.reasonCode);
    const duplicate = await this.db
      .prepare("SELECT id,payload_json FROM wastage WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; payload_json: string }>();
    if (duplicate) {
      const payload = JSON.parse(duplicate.payload_json) as {
        movementId: string;
        estimatedCostMinor: number;
      };
      return {
        id: duplicate.id,
        movementId: payload.movementId,
        duplicate: true,
        estimatedCostMinor: payload.estimatedCostMinor,
      };
    }
    const balance = await this.balance(input.branchId, input.warehouseId, input.inventoryItemId);
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const cost = quantityCostMinor(input.quantityMicro, balance.average_unit_cost_minor);
    const movementId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const payload = JSON.stringify({ ...input, estimatedCostMinor: cost, movementId });
    try {
      const movementInput: InventoryMovementInput & {
        id: string;
        occurredAt: string;
        unitCostMinor: number;
        totalCostMinor: number;
      } = {
        id: movementId,
        branchId: input.branchId,
        warehouseId: input.warehouseId,
        inventoryItemId: input.inventoryItemId,
        movementType: "WASTAGE",
        quantityBaseMicro: -input.quantityMicro,
        unitCostMinor: balance.average_unit_cost_minor,
        totalCostMinor: -cost,
        sourceType: "WASTAGE",
        sourceId: id,
        idempotencyKey: `wastage-movement:${input.idempotencyKey}`,
        businessDate: input.businessDate,
        occurredAt: stamp,
        reason: input.reasonCode,
        metadata: { stationId: input.stationId, employeeId: input.employeeId },
      };
      const statements: D1PreparedStatement[] = [
        this.db
          .prepare(
            `INSERT INTO wastage
            (tenant_id,id,branch_id,status,idempotency_key,payload_json,created_at)
           VALUES (?,?,?,'APPROVED',?,?,?)`,
          )
          .bind(this.actor.tenantId, id, input.branchId, input.idempotencyKey, payload, stamp),
        this.movementStatement(movementInput, correlationId),
        this.auditStatement(
          "WASTAGE_RECORDED",
          "WASTAGE",
          id,
          stamp,
          correlationId,
          input.branchId,
        ),
        this.recalculationEventStatement(
          input.branchId,
          "WASTAGE_RECORDED",
          "INVENTORY_ITEM",
          input.inventoryItemId,
          input.idempotencyKey,
          stamp,
          correlationId,
        ),
      ];
      statements.push(...(await this.movementAccountingStatements(movementInput, correlationId)));
      await this.db.batch(statements);
    } catch (error) {
      const raced = await this.db
        .prepare("SELECT id,payload_json FROM wastage WHERE tenant_id=? AND idempotency_key=?")
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string; payload_json: string }>();
      if (raced) {
        const racedPayload = JSON.parse(raced.payload_json) as {
          movementId: string;
          estimatedCostMinor: number;
        };
        return {
          id: raced.id,
          movementId: racedPayload.movementId,
          duplicate: true,
          estimatedCostMinor: racedPayload.estimatedCostMinor,
        };
      }
      throw error;
    }
    return { id, movementId, duplicate: false, estimatedCostMinor: cost };
  }

  async postSupplierInvoice(input: {
    id?: string;
    branchId: string;
    supplierId: string;
    purchaseOrderId: string;
    goodsReceiptId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string;
    currency: string;
    subtotalMinor: number;
    taxMinor: number;
    totalMinor: number;
  }) {
    this.requirePermission(permissions.procurementInvoiceApprove);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    if (input.subtotalMinor + input.taxMinor !== input.totalMinor) {
      throw new Error("Supplier invoice total does not equal subtotal plus tax");
    }
    const po = await this.db
      .prepare("SELECT total_minor FROM purchase_orders WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, input.purchaseOrderId)
      .first<{ total_minor: number }>();
    const receipt = await this.db
      .prepare(
        "SELECT COALESCE(SUM(total_cost_minor),0) AS total FROM goods_receipt_lines WHERE tenant_id=? AND goods_receipt_id=?",
      )
      .bind(this.actor.tenantId, input.goodsReceiptId)
      .first<{ total: number }>();
    const quantities = await this.db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(ordered_purchase_quantity_minor,ordered_quantity_minor)),0) AS ordered,
                COALESCE(SUM(received_purchase_quantity_minor),0) AS received
         FROM purchase_order_lines WHERE tenant_id=? AND purchase_order_id=?`,
      )
      .bind(this.actor.tenantId, input.purchaseOrderId)
      .first<{ ordered: number; received: number }>();
    if (!po) throw new Error("Purchase order not found");
    const mapping = await this.accountMapping(input.branchId);
    const receivedTotal = receipt?.total ?? 0;
    const matchStatus =
      receivedTotal === 0
        ? "MISSING_DOCUMENT"
        : (quantities?.received ?? 0) !== (quantities?.ordered ?? 0)
          ? "QUANTITY_VARIANCE"
          : receivedTotal !== po.total_minor || input.totalMinor !== po.total_minor
            ? "PRICE_VARIANCE"
            : "MATCHED";
    const id = input.id ?? crypto.randomUUID();
    const journalId = crypto.randomUUID();
    const matchId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const journalStatement = this.db
      .prepare(
        `INSERT INTO journal_entries
          (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
           correlation_id,payload_json,created_at)
         VALUES (?,?,?,?,?,?,'DRAFT',?,?,'{}',?)`,
      )
      .bind(
        this.actor.tenantId,
        journalId,
        input.branchId,
        "SUPPLIER_INVOICE",
        id,
        input.invoiceDate,
        `Supplier invoice ${input.invoiceNumber}`,
        correlationId,
        stamp,
      );
    const supplierInvoiceStatement = this.db
      .prepare(
        `INSERT INTO supplier_invoices
          (tenant_id,id,branch_id,supplier_id,purchase_order_id,goods_receipt_id,
           invoice_number,invoice_date,due_date,currency,subtotal_minor,tax_minor,total_minor,
           status,journal_entry_id,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'POSTED',?,'{}',?,?)`,
      )
      .bind(
        this.actor.tenantId,
        id,
        input.branchId,
        input.supplierId,
        input.purchaseOrderId,
        input.goodsReceiptId,
        input.invoiceNumber,
        input.invoiceDate,
        input.dueDate ?? null,
        input.currency,
        input.subtotalMinor,
        input.taxMinor,
        input.totalMinor,
        journalId,
        stamp,
        stamp,
      );
    const procurementMatchStatement = this.db
      .prepare(
        `INSERT INTO procurement_matches
          (tenant_id,id,purchase_order_id,goods_receipt_id,supplier_invoice_id,status,
           ordered_total_minor,received_total_minor,invoiced_total_minor,variance_minor,
           payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, '{}',?,?)`,
      )
      .bind(
        this.actor.tenantId,
        matchId,
        input.purchaseOrderId,
        input.goodsReceiptId,
        id,
        matchStatus,
        po.total_minor,
        receivedTotal,
        input.totalMinor,
        input.totalMinor - po.total_minor,
        stamp,
        stamp,
      );
    const statements: D1PreparedStatement[] = [
      journalStatement,
      supplierInvoiceStatement,
      procurementMatchStatement,
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        1,
        mapping.inventory_account_id,
        input.subtotalMinor,
        0,
        input.currency,
      ),
    ];
    let lineNumber = 2;
    if (input.taxMinor > 0) {
      if (!mapping.recoverable_tax_account_id) {
        throw new Error("Recoverable tax account mapping is required for supplier invoice tax");
      }
      statements.push(
        journalLine(
          this.db,
          this.actor.tenantId,
          journalId,
          lineNumber++,
          mapping.recoverable_tax_account_id,
          input.taxMinor,
          0,
          input.currency,
        ),
      );
    }
    statements.push(
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        lineNumber,
        mapping.accounts_payable_account_id,
        0,
        input.totalMinor,
        input.currency,
      ),
      this.db
        .prepare(
          "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=?",
        )
        .bind(stamp, this.actor.tenantId, journalId),
      this.auditStatement(
        "SUPPLIER_INVOICE_POSTED",
        "SUPPLIER_INVOICE",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
    );
    await this.db.batch(statements);
    return { id, status: "POSTED" as const, matchStatus, journalId };
  }

  async returnToSupplier(input: SupplierReturnInput) {
    this.requirePermission(permissions.procurementReceive);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    await this.assertBusinessDateOpen(input.branchId, input.businessDate, input.reason);
    const duplicate = await this.db
      .prepare(
        "SELECT id,status,total_cost_minor FROM supplier_returns WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(this.actor.tenantId, input.idempotencyKey)
      .first<{ id: string; status: string; total_cost_minor: number }>();
    if (duplicate)
      return {
        id: duplicate.id,
        status: duplicate.status,
        totalCostMinor: duplicate.total_cost_minor,
        duplicate: true,
      };
    const receipt = await this.db
      .prepare(
        `SELECT branch_id,warehouse_id,supplier_id FROM goods_receipts
         WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, input.goodsReceiptId)
      .first<{ branch_id: string; warehouse_id: string; supplier_id: string }>();
    if (
      !receipt ||
      receipt.branch_id !== input.branchId ||
      receipt.warehouse_id !== input.warehouseId ||
      receipt.supplier_id !== input.supplierId
    ) {
      throw new ServerOperationError(
        "TENANT_SCOPE_VIOLATION",
        403,
        "Supplier return does not match the authoritative goods receipt scope",
      );
    }
    if (input.lines.length === 0) throw new Error("Supplier return requires at least one line");
    const id = input.id ?? crypto.randomUUID();
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    const resolvedLines: Array<{
      goodsReceiptLineId: string;
      inventoryItemId: string;
      quantityMicro: number;
      unitCostMinor: number;
      totalCostMinor: number;
      reason: string;
      movementId: string;
    }> = [];
    let totalCostMinor = 0;
    for (const line of input.lines) {
      assertScaledInteger(line.returnedBaseQuantityMicro, "supplier return quantity");
      const receiptLine = await this.db
        .prepare(
          `SELECT inventory_item_id,converted_base_quantity_minor,total_cost_minor
           FROM goods_receipt_lines WHERE tenant_id=? AND id=? AND goods_receipt_id=?`,
        )
        .bind(this.actor.tenantId, line.goodsReceiptLineId, input.goodsReceiptId)
        .first<{
          inventory_item_id: string;
          converted_base_quantity_minor: number;
          total_cost_minor: number;
        }>();
      if (!receiptLine || receiptLine.converted_base_quantity_minor <= 0) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          404,
          "Accepted goods receipt line not found",
        );
      }
      const unitCostMinor = multiplyDivide(
        receiptLine.total_cost_minor,
        QUANTITY_SCALE,
        receiptLine.converted_base_quantity_minor,
        "supplier return unit cost",
      );
      const lineCostMinor = quantityCostMinor(line.returnedBaseQuantityMicro, unitCostMinor);
      totalCostMinor += lineCostMinor;
      resolvedLines.push({
        goodsReceiptLineId: line.goodsReceiptLineId,
        inventoryItemId: receiptLine.inventory_item_id,
        quantityMicro: line.returnedBaseQuantityMicro,
        unitCostMinor,
        totalCostMinor: lineCostMinor,
        reason: line.reason,
        movementId: crypto.randomUUID(),
      });
    }
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO supplier_returns
            (tenant_id,id,branch_id,warehouse_id,supplier_id,goods_receipt_id,return_number,
             business_date,status,total_cost_minor,reason,idempotency_key,returned_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?, 'PENDING_CREDIT',?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          input.branchId,
          input.warehouseId,
          input.supplierId,
          input.goodsReceiptId,
          input.returnNumber,
          input.businessDate,
          totalCostMinor,
          input.reason,
          input.idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
        ),
    ];
    resolvedLines.forEach((line, index) => {
      const movementInput: InventoryMovementInput & {
        id: string;
        occurredAt: string;
        unitCostMinor: number;
        totalCostMinor: number;
      } = {
        id: line.movementId,
        branchId: input.branchId,
        warehouseId: input.warehouseId,
        inventoryItemId: line.inventoryItemId,
        movementType: "RETURN_TO_SUPPLIER",
        quantityBaseMicro: -line.quantityMicro,
        unitCostMinor: line.unitCostMinor,
        totalCostMinor: -line.totalCostMinor,
        sourceType: "SUPPLIER_RETURN",
        sourceId: id,
        idempotencyKey: `supplier-return:${input.idempotencyKey}:${index}`,
        businessDate: input.businessDate,
        occurredAt: stamp,
        reason: line.reason,
      };
      statements.push(
        this.movementStatement(movementInput, correlationId),
        this.db
          .prepare(
            `INSERT INTO supplier_return_lines
              (tenant_id,id,supplier_return_id,goods_receipt_line_id,inventory_item_id,
               returned_base_quantity_minor,unit_cost_minor,total_cost_minor,movement_id,reason,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            id,
            line.goodsReceiptLineId,
            line.inventoryItemId,
            line.quantityMicro,
            line.unitCostMinor,
            line.totalCostMinor,
            line.movementId,
            line.reason,
            stamp,
          ),
        this.recalculationEventStatement(
          input.branchId,
          "SUPPLIER_RETURN",
          "INVENTORY_ITEM",
          line.inventoryItemId,
          `supplier-return:${input.idempotencyKey}:${index}`,
          stamp,
          correlationId,
        ),
      );
    });
    statements.push(
      this.auditStatement(
        "SUPPLIER_RETURN_RECORDED",
        "SUPPLIER_RETURN",
        id,
        stamp,
        correlationId,
        input.branchId,
      ),
    );
    try {
      await this.db.batch(statements);
      return { id, status: "PENDING_CREDIT" as const, totalCostMinor, duplicate: false };
    } catch (error) {
      const raced = await this.db
        .prepare(
          "SELECT id,status,total_cost_minor FROM supplier_returns WHERE tenant_id=? AND idempotency_key=?",
        )
        .bind(this.actor.tenantId, input.idempotencyKey)
        .first<{ id: string; status: string; total_cost_minor: number }>();
      if (raced)
        return {
          id: raced.id,
          status: raced.status,
          totalCostMinor: raced.total_cost_minor,
          duplicate: true,
        };
      throw error;
    }
  }

  async confirmSupplierReturnCredit(id: string, creditNoteNumber: string) {
    this.requirePermission(permissions.procurementInvoiceApprove);
    const returned = await this.db
      .prepare(
        `SELECT branch_id,business_date,status,total_cost_minor,journal_entry_id
         FROM supplier_returns WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{
        branch_id: string;
        business_date: string;
        status: string;
        total_cost_minor: number;
        journal_entry_id: string | null;
      }>();
    if (!returned)
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Supplier return not found");
    authorizeBranchRead(this.actor, this.actor.tenantId, returned.branch_id);
    if (returned.status === "CREDIT_POSTED") {
      return {
        id,
        status: "CREDIT_POSTED" as const,
        journalId: returned.journal_entry_id,
        duplicate: true,
      };
    }
    if (returned.status !== "PENDING_CREDIT") {
      throw invalidTransition("Supplier return", returned.status, "CREDIT_POSTED");
    }
    const mapping = await this.accountMapping(returned.branch_id);
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    if (!tenant?.default_currency) throw new Error("Tenant default currency is not configured");
    const journalId = `supplier-return-credit:${id}`;
    const stamp = new Date().toISOString();
    const correlationId = crypto.randomUUID();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO journal_entries
            (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
             correlation_id,payload_json,created_at)
           VALUES (?,?,?,?,?,?,'DRAFT',?,?,'{}',?)`,
        )
        .bind(
          this.actor.tenantId,
          journalId,
          returned.branch_id,
          "SUPPLIER_RETURN_CREDIT",
          id,
          returned.business_date,
          `Supplier return credit ${creditNoteNumber}`,
          correlationId,
          stamp,
        ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        1,
        mapping.accounts_payable_account_id,
        returned.total_cost_minor,
        0,
        tenant.default_currency,
      ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        2,
        mapping.inventory_account_id,
        0,
        returned.total_cost_minor,
        tenant.default_currency,
      ),
      this.db
        .prepare(
          `UPDATE journal_entries SET status='POSTED',posted_at=?
           WHERE tenant_id=? AND id=? AND status='DRAFT'`,
        )
        .bind(stamp, this.actor.tenantId, journalId),
      this.db
        .prepare(
          `UPDATE supplier_returns SET status='CREDIT_POSTED',credit_note_number=?,journal_entry_id=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status='PENDING_CREDIT'`,
        )
        .bind(creditNoteNumber, journalId, stamp, this.actor.tenantId, id),
      this.auditStatement(
        "SUPPLIER_RETURN_CREDIT_POSTED",
        "SUPPLIER_RETURN",
        id,
        stamp,
        correlationId,
        returned.branch_id,
      ),
    ]);
    return { id, status: "CREDIT_POSTED" as const, journalId, duplicate: false };
  }

  async inventoryGlReconciliation(branchId: string) {
    this.requirePermission(permissions.financeJournalView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const mapping = await this.accountMapping(branchId);
    const subledger = await this.db
      .prepare(
        "SELECT COALESCE(SUM(total_value_minor),0) AS value_minor FROM inventory_balances WHERE tenant_id=? AND branch_id=?",
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ value_minor: number }>();
    const ledger = await this.db
      .prepare(
        `SELECT COALESCE(SUM(jl.debit_minor-jl.credit_minor),0) AS value_minor
         FROM journal_lines jl
         JOIN journal_entries je ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
         WHERE jl.tenant_id=? AND je.branch_id=? AND je.status='POSTED' AND jl.account_id=?`,
      )
      .bind(this.actor.tenantId, branchId, mapping.inventory_account_id)
      .first<{ value_minor: number }>();
    const subledgerValueMinor = subledger?.value_minor ?? 0;
    const glValueMinor = ledger?.value_minor ?? 0;
    const varianceMinor = subledgerValueMinor - glValueMinor;
    return {
      branchId,
      accountingMode: mapping.accounting_mode,
      inventoryAccountId: mapping.inventory_account_id,
      subledgerValueMinor,
      glValueMinor,
      varianceMinor,
      status:
        mapping.accounting_mode === "PERIODIC"
          ? "NOT_APPLICABLE"
          : varianceMinor === 0
            ? "MATCHED"
            : "REVIEW_REQUIRED",
      generatedAt: new Date().toISOString(),
    };
  }

  async procurementOverview(branchId: string, limit = 25) {
    this.requirePermission(permissions.inventoryView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const pageSize = Math.min(100, Math.max(1, limit));
    const purchaseOrders = await this.db
      .prepare(
        `SELECT po.id,po.purchase_order_number,po.supplier_id,s.name AS supplier_name,
                po.warehouse_id,
                po.status,po.currency,po.total_minor,po.expected_at,po.created_at,
                po.approved_at,po.received_at
         FROM purchase_orders po
         JOIN suppliers s ON s.tenant_id=po.tenant_id AND s.id=po.supplier_id
         WHERE po.tenant_id=? AND po.branch_id=?
         ORDER BY po.created_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, branchId, pageSize)
      .all<Record<string, unknown> & { id: string }>();
    const rows = [];
    for (const purchaseOrder of purchaseOrders.results ?? []) {
      const lines = await this.db
        .prepare(
          `SELECT pol.id,pol.item_id AS inventory_item_id,i.name AS item_name,i.sku,
                  pol.purchase_unit_id,u.symbol AS unit_symbol,
                  COALESCE(pol.ordered_purchase_quantity_minor,pol.ordered_quantity_minor) AS ordered_quantity_minor,
                  pol.received_purchase_quantity_minor,pol.unit_cost_minor AS unit_price_minor,
                  ((COALESCE(pol.ordered_purchase_quantity_minor,pol.ordered_quantity_minor)
                    * pol.unit_cost_minor) / 1000000) + pol.tax_minor - pol.discount_minor AS line_total_minor
           FROM purchase_order_lines pol
           JOIN inventory_items i ON i.tenant_id=pol.tenant_id AND i.id=pol.item_id
           LEFT JOIN unit_definitions u ON u.tenant_id=pol.tenant_id AND u.id=pol.purchase_unit_id
           WHERE pol.tenant_id=? AND pol.purchase_order_id=? ORDER BY pol.id`,
        )
        .bind(this.actor.tenantId, purchaseOrder.id)
        .all<Record<string, unknown>>();
      rows.push({ ...purchaseOrder, lines: lines.results ?? [] });
    }
    const suppliers = await this.db
      .prepare(
        `SELECT s.id,s.code,s.name,s.lead_time_days,s.payment_terms_days,s.currency,
                COUNT(DISTINCT po.id) AS order_count,
                COALESCE(SUM(po.total_minor),0) AS ordered_minor,
                COALESCE(SUM(CASE WHEN po.status IN ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED')
                  THEN po.total_minor ELSE 0 END),0) AS outstanding_minor,
                SUM(CASE WHEN po.received_at IS NOT NULL AND po.expected_at IS NOT NULL
                  AND po.received_at<=po.expected_at THEN 1 ELSE 0 END) AS on_time_count,
                SUM(CASE WHEN po.received_at IS NOT NULL THEN 1 ELSE 0 END) AS received_count
         FROM suppliers s
         LEFT JOIN purchase_orders po ON po.tenant_id=s.tenant_id AND po.supplier_id=s.id
           AND po.branch_id=?
         WHERE s.tenant_id=? AND s.active=1
         GROUP BY s.id ORDER BY ordered_minor DESC,s.name LIMIT ?`,
      )
      .bind(branchId, this.actor.tenantId, pageSize)
      .all<Record<string, unknown>>();
    const requisitions = await this.db
      .prepare(
        `SELECT id,requisition_number,status,source_type,required_at,created_at,approved_at
         FROM purchase_requisitions WHERE tenant_id=? AND branch_id=?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, branchId, pageSize)
      .all<Record<string, unknown>>();
    const receipts = await this.db
      .prepare(
        `SELECT gr.id,gr.receipt_number,gr.purchase_order_id,gr.status,gr.received_at,
                COALESCE(SUM(grl.total_cost_minor),0) AS total_minor
         FROM goods_receipts gr
         LEFT JOIN goods_receipt_lines grl ON grl.tenant_id=gr.tenant_id AND grl.goods_receipt_id=gr.id
         WHERE gr.tenant_id=? AND gr.branch_id=?
         GROUP BY gr.id ORDER BY gr.received_at DESC LIMIT ?`,
      )
      .bind(this.actor.tenantId, branchId, pageSize)
      .all<Record<string, unknown>>();
    return {
      branchId,
      purchaseOrders: rows,
      suppliers: suppliers.results ?? [],
      requisitions: requisitions.results ?? [],
      receipts: receipts.results ?? [],
    };
  }

  async foodCostControlCentre(branchId: string, limit = 50) {
    this.requirePermission(permissions.inventoryCostControlView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const pageSize = Math.min(200, Math.max(1, limit));
    const [
      movements,
      recommendations,
      qualityIssues,
      menuProfitability,
      recipes,
      consumption,
      prepRecommendations,
    ] = await Promise.all([
      this.db
        .prepare(
          `SELECT m.id,m.business_date,m.movement_type,m.quantity_minor,m.unit_cost_minor,
                    m.total_cost_minor,m.source_type,m.source_id,m.reason,m.occurred_at,
                    m.warehouse_id,i.id AS inventory_item_id,i.code,i.sku,i.name,u.symbol AS unit_symbol
             FROM inventory_movements m
             JOIN inventory_items i ON i.tenant_id=m.tenant_id AND i.id=m.item_id
             LEFT JOIN unit_definitions u ON u.tenant_id=i.tenant_id AND u.id=i.base_unit_id
             WHERE m.tenant_id=? AND m.branch_id=?
             ORDER BY m.occurred_at DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT r.id,r.warehouse_id,r.inventory_item_id,i.name AS item_name,
                    r.recommended_base_quantity_minor,r.recommended_purchase_quantity_minor,
                    r.purchase_unit_id,u.symbol AS purchase_unit_symbol,r.recommended_order_date,
                    r.quality,r.explanation_json,r.status,r.generated_at
             FROM purchase_recommendations r
             JOIN inventory_items i ON i.tenant_id=r.tenant_id AND i.id=r.inventory_item_id
             LEFT JOIN unit_definitions u ON u.tenant_id=r.tenant_id AND u.id=r.purchase_unit_id
             WHERE r.tenant_id=? AND r.branch_id=? AND r.status='OPEN'
             ORDER BY r.recommended_order_date,r.id LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT id,entity_type,entity_id,issue_code,severity,message,detected_at
             FROM inventory_data_quality_issues
             WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL) AND status='OPEN'
             ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
               WHEN 'MEDIUM' THEN 2 ELSE 3 END,detected_at DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT p.menu_item_id,p.period_start,p.period_end,p.quantity_sold,
                    p.net_revenue_minor,p.theoretical_cost_minor,p.contribution_minor,
                    p.food_cost_bps,p.classification,p.quality,p.generated_at
             FROM menu_profitability_snapshots p WHERE p.tenant_id=? AND p.branch_id=?
             ORDER BY p.period_end DESC,p.contribution_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT r.id,r.name,r.menu_item_id,r.production_item_id,r.branch_override_id,
                    rv.id AS active_version_id,rv.version,rv.yield_quantity_minor,
                    rv.yield_unit_id,rv.effective_from,rv.packaging_cost_minor,
                    rv.production_overhead_minor
             FROM recipes r
             LEFT JOIN recipe_versions rv ON rv.tenant_id=r.tenant_id AND rv.recipe_id=r.id AND rv.active=1
             WHERE r.tenant_id=? AND r.active=1
               AND (r.branch_override_id IS NULL OR r.branch_override_id=?)
             ORDER BY r.name LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT c.inventory_item_id,i.name AS item_name,c.period_start,c.period_end,
                    c.actual_quantity_minor,c.theoretical_quantity_minor,c.variance_quantity_minor,
                    c.variance_value_minor,c.explained_quantity_minor,c.unexplained_quantity_minor,
                    c.quality,c.drivers_json
             FROM inventory_consumption_periods c
             JOIN inventory_items i ON i.tenant_id=c.tenant_id AND i.id=c.inventory_item_id
             WHERE c.tenant_id=? AND c.branch_id=?
             ORDER BY c.period_end DESC,ABS(c.variance_value_minor) DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
      this.db
        .prepare(
          `SELECT p.id,p.business_date,p.recipe_id,r.name AS recipe_name,p.recipe_version_id,
                    p.output_item_id,i.name AS output_item_name,p.forecast_required_minor,
                    p.prepared_available_minor,p.safety_buffer_minor,p.recommended_batch_minor,
                    p.due_at,p.station_id,p.status,p.quality,p.explanation_json,p.generated_at
             FROM production_prep_recommendations p
             JOIN recipes r ON r.tenant_id=p.tenant_id AND r.id=p.recipe_id
             JOIN inventory_items i ON i.tenant_id=p.tenant_id AND i.id=p.output_item_id
             WHERE p.tenant_id=? AND p.branch_id=?
             ORDER BY p.business_date DESC,p.recommended_batch_minor DESC LIMIT ?`,
        )
        .bind(this.actor.tenantId, branchId, pageSize)
        .all<Record<string, unknown>>(),
    ]);
    return {
      branchId,
      movements: movements.results ?? [],
      recommendations: recommendations.results ?? [],
      qualityIssues: qualityIssues.results ?? [],
      menuProfitability: menuProfitability.results ?? [],
      recipes: recipes.results ?? [],
      consumption: consumption.results ?? [],
      prepRecommendations: prepRecommendations.results ?? [],
      generatedAt: new Date().toISOString(),
    };
  }

  async listUnits() {
    this.requirePermission(permissions.inventoryView);
    const units = await this.db
      .prepare(
        `SELECT id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator
         FROM unit_definitions WHERE tenant_id=? AND active=1 ORDER BY dimension,name`,
      )
      .bind(this.actor.tenantId)
      .all<Record<string, unknown>>();
    return units.results ?? [];
  }

  async listInventory(input: {
    branchId: string;
    warehouseId?: string;
    limit?: number;
    cursor?: string;
  }) {
    this.requirePermission(permissions.inventoryView);
    authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const predicates = ["b.tenant_id=?", "b.branch_id=?"];
    const values: unknown[] = [this.actor.tenantId, input.branchId];
    if (input.warehouseId) {
      predicates.push("b.warehouse_id=?");
      values.push(input.warehouseId);
    }
    if (input.cursor) {
      predicates.push("i.id>?");
      values.push(input.cursor);
    }
    values.push(limit + 1);
    const result = await this.db
      .prepare(
        `SELECT i.id,i.code,i.sku,i.name,i.category_id,i.base_unit_id,i.purchase_unit_id,i.track_expiry,
                b.warehouse_id,b.quantity_minor,b.quantity_reserved_minor,
                b.quantity_minor-b.quantity_reserved_minor AS quantity_available_minor,
                b.average_unit_cost_minor,b.total_value_minor,b.last_movement_at,
                p.reorder_point_minor,p.target_quantity_minor,p.safety_stock_minor
         FROM inventory_balances b
         JOIN inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
         LEFT JOIN inventory_par_policies p ON p.tenant_id=b.tenant_id
           AND p.branch_id=b.branch_id AND p.warehouse_id=b.warehouse_id
           AND p.inventory_item_id=b.item_id AND p.day_of_week IS NULL
         WHERE ${predicates.join(" AND ")}
         ORDER BY i.id LIMIT ?`,
      )
      .bind(...values)
      .all<Record<string, unknown> & { id: string }>();
    const rows = result.results ?? [];
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    };
  }

  async summary(branchId: string): Promise<InventorySummary> {
    this.requirePermission(permissions.inventoryView);
    authorizeBranchRead(this.actor, this.actor.tenantId, branchId);
    const [balance, low, expiry, po, variance, quality] = await Promise.all([
      this.db
        .prepare(
          `SELECT COUNT(*) AS item_count,COALESCE(SUM(total_value_minor),0) AS value_minor,
                  SUM(CASE WHEN quantity_minor<=0 THEN 1 ELSE 0 END) AS out_count
           FROM inventory_balances WHERE tenant_id=? AND branch_id=?`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ item_count: number; value_minor: number; out_count: number }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM inventory_balances b
           JOIN inventory_par_policies p ON p.tenant_id=b.tenant_id AND p.branch_id=b.branch_id
             AND p.warehouse_id=b.warehouse_id AND p.inventory_item_id=b.item_id
           WHERE b.tenant_id=? AND b.branch_id=? AND p.day_of_week IS NULL
             AND b.quantity_minor<=p.reorder_point_minor`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ count: number }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM inventory_lots WHERE tenant_id=? AND branch_id=?
             AND status='AVAILABLE' AND expiry_date IS NOT NULL
             AND expiry_date<=date('now','+3 day')`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ count: number }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM purchase_orders WHERE tenant_id=? AND branch_id=?
           AND status IN ('SUBMITTED','APPROVED','PARTIALLY_RECEIVED')`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ count: number }>(),
      this.db
        .prepare(
          `SELECT COALESCE(SUM(variance_value_minor),0) AS variance_minor,
                  COALESCE(SUM(CASE WHEN unexplained_quantity_minor<>0 THEN
                    ABS(unexplained_quantity_minor) ELSE 0 END),0) AS unexplained_quantity
           FROM inventory_consumption_periods WHERE tenant_id=? AND branch_id=?`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ variance_minor: number; unexplained_quantity: number }>(),
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM inventory_data_quality_issues
           WHERE tenant_id=? AND (branch_id=? OR branch_id IS NULL) AND status='OPEN'`,
        )
        .bind(this.actor.tenantId, branchId)
        .first<{ count: number }>(),
    ]);
    const actual = await this.actualAndTheoreticalCost(branchId);
    const issueCount = quality?.count ?? 0;
    return {
      branchId,
      inventoryValueMinor: balance?.value_minor ?? 0,
      itemCount: balance?.item_count ?? 0,
      lowStockCount: low?.count ?? 0,
      outOfStockCount: balance?.out_count ?? 0,
      nearExpiryCount: expiry?.count ?? 0,
      openPurchaseOrderCount: po?.count ?? 0,
      actualFoodCostBps: actual.actualFoodCostBps,
      theoreticalFoodCostBps: actual.theoreticalFoodCostBps,
      varianceMinor: variance?.variance_minor ?? 0,
      unexplainedVarianceMinor: await this.unexplainedVarianceValue(branchId),
      quality: issueCount === 0 ? "HIGH" : issueCount < 3 ? "MEDIUM" : "LOW",
      dataQualityIssues: issueCount,
      generatedAt: new Date().toISOString(),
    };
  }

  async recalculateTenant(branchId?: string) {
    const branches = branchId
      ? [{ id: branchId }]
      : ((
          await this.db
            .prepare("SELECT id FROM branches WHERE tenant_id=? AND active=1")
            .bind(this.actor.tenantId)
            .all<{ id: string }>()
        ).results ?? []);
    let forecasts = 0;
    let recommendations = 0;
    let qualityIssues = 0;
    for (const branch of branches) {
      const result = await this.recalculateBranch(branch.id);
      forecasts += result.forecasts;
      recommendations += result.recommendations;
      qualityIssues += result.qualityIssues;
    }
    return { forecasts, recommendations, qualityIssues };
  }

  private async recalculateBranch(branchId: string) {
    const stamp = new Date().toISOString();
    const date = stamp.slice(0, 10);
    const balances = await this.db
      .prepare(
        `SELECT b.warehouse_id,b.item_id,b.quantity_minor,
                COALESCE(p.safety_stock_minor,0) AS safety_stock_minor,
                COALESCE(p.target_quantity_minor,0) AS target_quantity_minor,
                i.purchase_unit_id,i.preferred_supplier_id,i.base_unit_id,
                COALESCE(s.lead_time_days,0) AS lead_time_days
         FROM inventory_balances b
         JOIN inventory_items i ON i.tenant_id=b.tenant_id AND i.id=b.item_id
         LEFT JOIN inventory_par_policies p ON p.tenant_id=b.tenant_id
           AND p.branch_id=b.branch_id AND p.warehouse_id=b.warehouse_id
           AND p.inventory_item_id=b.item_id AND p.day_of_week IS NULL
         LEFT JOIN suppliers s ON s.tenant_id=i.tenant_id AND s.id=i.preferred_supplier_id
         WHERE b.tenant_id=? AND b.branch_id=?`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<{
        warehouse_id: string;
        item_id: string;
        quantity_minor: number;
        safety_stock_minor: number;
        target_quantity_minor: number;
        purchase_unit_id: string | null;
        preferred_supplier_id: string | null;
        base_unit_id: string | null;
        lead_time_days: number;
      }>();
    let forecasts = 0;
    let recommendations = 0;
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE purchase_recommendations SET status='DISMISSED'
           WHERE tenant_id=? AND branch_id=? AND status='OPEN'`,
        )
        .bind(this.actor.tenantId, branchId),
    ];
    for (const balance of balances.results ?? []) {
      const usage = await this.db
        .prepare(
          `SELECT business_date,ABS(SUM(quantity_minor)) AS quantity
           FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND warehouse_id=?
             AND item_id=? AND movement_type IN ('SALE_CONSUMPTION','PRODUCTION_INPUT')
             AND business_date>=date(?,'-28 day')
           GROUP BY business_date ORDER BY business_date`,
        )
        .bind(this.actor.tenantId, branchId, balance.warehouse_id, balance.item_id, date)
        .all<{ business_date: string; quantity: number }>();
      const forecast = deterministicForecast({
        method: "WEIGHTED_MOVING_AVERAGE",
        samples: (usage.results ?? []).map((row) => row.quantity),
      });
      const forecastId = crypto.randomUUID();
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_forecasts
              (tenant_id,id,branch_id,warehouse_id,inventory_item_id,forecast_date,method,
               lookback_days,forecast_quantity_minor,quality,inputs_json,generated_at)
             VALUES (?,?,?,?,?,?,'WEIGHTED_MOVING_AVERAGE',28,?,?,?,?)
             ON CONFLICT(tenant_id,branch_id,warehouse_id,inventory_item_id,forecast_date,method)
             DO UPDATE SET forecast_quantity_minor=excluded.forecast_quantity_minor,
               quality=excluded.quality,inputs_json=excluded.inputs_json,generated_at=excluded.generated_at`,
          )
          .bind(
            this.actor.tenantId,
            forecastId,
            branchId,
            balance.warehouse_id,
            balance.item_id,
            date,
            forecast.quantityMicro,
            forecast.quality,
            JSON.stringify({ samples: usage.results ?? [], sampleCount: forecast.sampleCount }),
            stamp,
          ),
      );
      forecasts++;
      if (balance.purchase_unit_id && balance.base_unit_id) {
        const conversion = await this.conversionRatio(
          balance.item_id,
          balance.purchase_unit_id,
          balance.base_unit_id,
          stamp,
        );
        const incoming = await this.incomingQuantity(
          branchId,
          balance.warehouse_id,
          balance.item_id,
        );
        const recommendation = buildPurchaseRecommendation({
          forecastConsumptionMicro: forecast.quantityMicro * Math.max(1, balance.lead_time_days),
          safetyStockMicro: balance.safety_stock_minor,
          targetClosingStockMicro: balance.target_quantity_minor,
          onHandMicro: balance.quantity_minor,
          incomingConfirmedMicro: incoming,
          purchaseConversionNumerator: conversion.numerator,
          purchaseConversionDenominator: conversion.denominator,
          leadTimeDays: balance.lead_time_days,
          asOfDate: date,
        });
        if (recommendation.recommendedBaseMicro > 0) {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO purchase_recommendations
                  (tenant_id,id,branch_id,warehouse_id,inventory_item_id,supplier_id,
                   forecast_quantity_minor,safety_stock_minor,target_closing_quantity_minor,
                   on_hand_quantity_minor,incoming_quantity_minor,recommended_base_quantity_minor,
                   recommended_purchase_quantity_minor,purchase_unit_id,recommended_order_date,
                   quality,explanation_json,status,generated_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?)`,
              )
              .bind(
                this.actor.tenantId,
                crypto.randomUUID(),
                branchId,
                balance.warehouse_id,
                balance.item_id,
                balance.preferred_supplier_id,
                forecast.quantityMicro,
                balance.safety_stock_minor,
                balance.target_quantity_minor,
                balance.quantity_minor,
                incoming,
                recommendation.recommendedBaseMicro,
                recommendation.recommendedPurchaseUnitMicro,
                balance.purchase_unit_id,
                recommendation.recommendedOrderDate,
                forecast.quality,
                JSON.stringify(recommendation.explanation),
                stamp,
              ),
          );
          recommendations++;
        }
      }
    }
    statements.push(
      this.db
        .prepare(
          `DELETE FROM inventory_data_quality_issues
           WHERE tenant_id=? AND branch_id=? AND status='OPEN'`,
        )
        .bind(this.actor.tenantId, branchId),
    );
    const issues = await this.detectDataQuality(branchId);
    for (const issue of issues) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_data_quality_issues
              (tenant_id,id,branch_id,entity_type,entity_id,issue_code,severity,message,status,detected_at)
             VALUES (?,?,?,?,?,?,?,?,'OPEN',?)`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            branchId,
            issue.entityType,
            issue.entityId,
            issue.code,
            issue.severity,
            issue.message,
            stamp,
          ),
      );
    }
    statements.push(...(await this.consumptionPeriodStatements(branchId, date, stamp)));
    statements.push(...(await this.availabilityStatements(branchId, stamp)));
    statements.push(...(await this.menuProfitabilityStatements(branchId, date, stamp)));
    statements.push(...(await this.productionPrepStatements(branchId, date, stamp)));
    if (statements.length) await this.executeInChunks(statements);
    return { forecasts, recommendations, qualityIssues: issues.length };
  }

  private async consumptionPeriodStatements(branchId: string, periodEnd: string, stamp: string) {
    const periodStartDate = new Date(`${periodEnd}T00:00:00.000Z`);
    periodStartDate.setUTCDate(periodStartDate.getUTCDate() - 29);
    const periodStart = periodStartDate.toISOString().slice(0, 10);
    const rows = await this.db
      .prepare(
        `SELECT warehouse_id,item_id,
           ABS(COALESCE(SUM(CASE WHEN movement_type IN
             ('SALE_CONSUMPTION','PRODUCTION_INPUT','WASTAGE','BREAKAGE','EXPIRY','MANUAL_ADJUSTMENT')
             AND quantity_minor<0 THEN quantity_minor ELSE 0 END),0)) AS actual,
           ABS(COALESCE(SUM(CASE WHEN movement_type='WASTAGE' AND quantity_minor<0
             THEN quantity_minor ELSE 0 END),0)) AS wastage,
           ABS(COALESCE(SUM(CASE WHEN movement_type='BREAKAGE' AND quantity_minor<0
             THEN quantity_minor ELSE 0 END),0)) AS breakage,
           ABS(COALESCE(SUM(CASE WHEN movement_type='EXPIRY' AND quantity_minor<0
             THEN quantity_minor ELSE 0 END),0)) AS expiry
         FROM inventory_movements WHERE tenant_id=? AND branch_id=?
           AND business_date BETWEEN ? AND ?
         GROUP BY warehouse_id,item_id`,
      )
      .bind(this.actor.tenantId, branchId, periodStart, periodEnd)
      .all<{
        warehouse_id: string;
        item_id: string;
        actual: number;
        wastage: number;
        breakage: number;
        expiry: number;
      }>();
    const theoretical = await this.theoreticalUsageFromSales(branchId, periodStart, periodEnd);
    const actualByKey = new Map(
      (rows.results ?? []).map((row) => [`${row.warehouse_id}:${row.item_id}`, row]),
    );
    const keys = new Set([...actualByKey.keys(), ...theoretical.quantities.keys()]);
    const statements: D1PreparedStatement[] = [];
    for (const key of keys) {
      const row = actualByKey.get(key);
      const [warehouseId, itemId] = splitInventoryKey(key);
      const theoreticalQuantity =
        theoretical.quantities.get(key) ??
        (theoretical.salesFound
          ? 0
          : await this.legacyTheoreticalMovementQuantity(
              branchId,
              warehouseId,
              itemId,
              periodStart,
              periodEnd,
            ));
      const actualQuantity = row?.actual ?? 0;
      const wastage = row?.wastage ?? 0;
      const breakage = row?.breakage ?? 0;
      const expiry = row?.expiry ?? 0;
      const variance = actualQuantity - theoreticalQuantity;
      const explained = wastage + breakage + expiry;
      const unexplained = variance - explained;
      const unitCost = await this.weightedItemCost(itemId, branchId, warehouseId);
      const varianceValue = quantityCostMinor(Math.abs(variance), unitCost) * Math.sign(variance);
      const drivers = [
        ...(wastage ? [{ code: "RECORDED_WASTAGE", quantityMicro: wastage }] : []),
        ...(breakage ? [{ code: "RECORDED_BREAKAGE", quantityMicro: breakage }] : []),
        ...(expiry ? [{ code: "RECORDED_EXPIRY", quantityMicro: expiry }] : []),
      ];
      const quality = theoretical.salesFound
        ? theoretical.missingRecipeCount === 0
          ? "HIGH"
          : theoretical.missingRecipeCount < theoretical.saleLineCount
            ? "MEDIUM"
            : "LOW"
        : actualQuantity > 0
          ? "LOW"
          : "INSUFFICIENT_DATA";
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_consumption_periods
              (tenant_id,id,branch_id,warehouse_id,inventory_item_id,period_start,period_end,
               theoretical_quantity_minor,actual_quantity_minor,variance_quantity_minor,
               variance_value_minor,explained_quantity_minor,unexplained_quantity_minor,
               drivers_json,quality,generated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(tenant_id,branch_id,warehouse_id,inventory_item_id,period_start,period_end)
             DO UPDATE SET theoretical_quantity_minor=excluded.theoretical_quantity_minor,
               actual_quantity_minor=excluded.actual_quantity_minor,
               variance_quantity_minor=excluded.variance_quantity_minor,
               variance_value_minor=excluded.variance_value_minor,
               explained_quantity_minor=excluded.explained_quantity_minor,
               unexplained_quantity_minor=excluded.unexplained_quantity_minor,
               drivers_json=excluded.drivers_json,quality=excluded.quality,
               generated_at=excluded.generated_at`,
          )
          .bind(
            this.actor.tenantId,
            crypto.randomUUID(),
            branchId,
            warehouseId,
            itemId,
            periodStart,
            periodEnd,
            theoreticalQuantity,
            actualQuantity,
            variance,
            varianceValue,
            explained,
            unexplained,
            JSON.stringify(drivers),
            quality,
            stamp,
          ),
      );
    }
    return statements;
  }

  private async theoreticalUsageFromSales(
    branchId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    const sales = await this.db
      .prepare(
        `SELECT il.quantity_minor,il.payload_json,i.business_date
         FROM invoice_lines il
         JOIN invoices i ON i.tenant_id=il.tenant_id AND i.id=il.invoice_id
         WHERE i.tenant_id=? AND i.branch_id=? AND i.business_date BETWEEN ? AND ?
           AND i.status NOT IN ('CANCELLED','VOID')`,
      )
      .bind(this.actor.tenantId, branchId, periodStart, periodEnd)
      .all<{ quantity_minor: number; payload_json: string; business_date: string }>();
    const quantities = new Map<string, number>();
    let saleLineCount = 0;
    let missingRecipeCount = 0;
    for (const sale of sales.results ?? []) {
      const payload = parseJsonObject(sale.payload_json);
      const menuItemId = stringProperty(payload, "productId");
      if (!menuItemId || sale.quantity_minor <= 0) continue;
      saleLineCount++;
      const effectiveAt = `${sale.business_date}T23:59:59.999Z`;
      const recipeVersionId = await this.effectiveRecipeVersionForMenuItem(
        menuItemId,
        branchId,
        effectiveAt,
      );
      if (!recipeVersionId) {
        missingRecipeCount++;
      } else {
        await this.accumulateRecipeRequirements(
          recipeVersionId,
          sale.quantity_minor,
          branchId,
          effectiveAt,
          quantities,
          new Set<string>(),
        );
      }
      const modifierIds = Array.isArray(payload["modifierIds"])
        ? payload["modifierIds"].filter((value): value is string => typeof value === "string")
        : [];
      for (const modifierId of modifierIds) {
        const modifierVersionId = await this.effectiveRecipeVersionForMenuItem(
          modifierId,
          branchId,
          effectiveAt,
        );
        if (!modifierVersionId) {
          missingRecipeCount++;
          continue;
        }
        await this.accumulateRecipeRequirements(
          modifierVersionId,
          sale.quantity_minor,
          branchId,
          effectiveAt,
          quantities,
          new Set<string>(),
        );
      }
    }
    return {
      quantities,
      salesFound: saleLineCount > 0,
      saleLineCount,
      missingRecipeCount,
    };
  }

  private async effectiveRecipeVersionForMenuItem(
    menuItemId: string,
    branchId: string,
    effectiveAt: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT rv.id FROM recipes r
         JOIN recipe_versions rv ON rv.tenant_id=r.tenant_id AND rv.recipe_id=r.id
         WHERE r.tenant_id=? AND r.menu_item_id=? AND r.active=1
           AND (r.branch_override_id IS NULL OR r.branch_override_id=?)
           AND rv.effective_from<=? AND (rv.effective_to IS NULL OR rv.effective_to>?)
         ORDER BY CASE WHEN r.branch_override_id=? THEN 0 ELSE 1 END,
                  rv.effective_from DESC,rv.version DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, menuItemId, branchId, effectiveAt, effectiveAt, branchId)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  private async accumulateRecipeRequirements(
    recipeVersionId: string,
    outputQuantityMicro: number,
    branchId: string,
    effectiveAt: string,
    quantities: Map<string, number>,
    visited: Set<string>,
  ) {
    if (visited.has(recipeVersionId)) throw new Error("Recipe dependency cycle detected");
    const version = await this.db
      .prepare(
        "SELECT recipe_id,yield_quantity_minor FROM recipe_versions WHERE tenant_id=? AND id=?",
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .first<{ recipe_id: string; yield_quantity_minor: number }>();
    if (!version || version.yield_quantity_minor <= 0) return;
    const nextVisited = new Set(visited).add(recipeVersionId);
    const components = await this.db
      .prepare(
        `SELECT inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps
         FROM recipe_version_components WHERE tenant_id=? AND recipe_version_id=?`,
      )
      .bind(this.actor.tenantId, recipeVersionId)
      .all<{
        inventory_item_id: string | null;
        sub_recipe_id: string | null;
        quantity_minor: number;
        unit_id: string;
        waste_factor_bps: number;
      }>();
    for (const component of components.results ?? []) {
      const batchRequirement = multiplyDivide(
        component.quantity_minor,
        BASIS_POINTS_SCALE + component.waste_factor_bps,
        BASIS_POINTS_SCALE,
        "recipe component with process loss",
      );
      const requiredQuantity = multiplyDivide(
        batchRequirement,
        outputQuantityMicro,
        version.yield_quantity_minor,
        "recipe component requirement",
      );
      if (component.inventory_item_id) {
        const baseQuantity = await this.convertToItemBase(
          component.inventory_item_id,
          requiredQuantity,
          component.unit_id,
          effectiveAt,
        );
        const location = await this.inventoryLocation(component.inventory_item_id, branchId);
        const key = `${location.warehouseId}:${component.inventory_item_id}`;
        quantities.set(key, (quantities.get(key) ?? 0) + baseQuantity);
      } else if (component.sub_recipe_id) {
        const subVersion = await this.db
          .prepare(
            `SELECT id FROM recipe_versions WHERE tenant_id=? AND recipe_id=?
               AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
             ORDER BY effective_from DESC,version DESC LIMIT 1`,
          )
          .bind(this.actor.tenantId, component.sub_recipe_id, effectiveAt, effectiveAt)
          .first<{ id: string }>();
        if (subVersion) {
          await this.accumulateRecipeRequirements(
            subVersion.id,
            requiredQuantity,
            branchId,
            effectiveAt,
            quantities,
            nextVisited,
          );
        }
      }
    }
  }

  private async inventoryLocation(itemId: string, branchId: string) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE((
           SELECT configured.id FROM warehouses configured
           WHERE configured.tenant_id=i.tenant_id AND configured.id=i.default_warehouse_id
             AND configured.branch_id=? AND configured.active=1
         ),(
           SELECT w.id FROM warehouses w WHERE w.tenant_id=i.tenant_id AND w.branch_id=? AND w.active=1
           ORDER BY w.id LIMIT 1
         )) AS warehouse_id
         FROM inventory_items i WHERE i.tenant_id=? AND i.id=?`,
      )
      .bind(branchId, branchId, this.actor.tenantId, itemId)
      .first<{ warehouse_id: string | null }>();
    if (!row?.warehouse_id) throw new Error("Recipe ingredient has no active warehouse");
    return { warehouseId: row.warehouse_id };
  }

  private async legacyTheoreticalMovementQuantity(
    branchId: string,
    warehouseId: string,
    itemId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT ABS(COALESCE(SUM(quantity_minor),0)) AS quantity
         FROM inventory_movements WHERE tenant_id=? AND branch_id=? AND warehouse_id=? AND item_id=?
           AND movement_type IN ('SALE_CONSUMPTION','PRODUCTION_INPUT')
           AND quantity_minor<0 AND business_date BETWEEN ? AND ?`,
      )
      .bind(this.actor.tenantId, branchId, warehouseId, itemId, periodStart, periodEnd)
      .first<{ quantity: number }>();
    return row?.quantity ?? 0;
  }

  private async availabilityStatements(branchId: string, stamp: string) {
    const recipes = await this.db
      .prepare(
        `SELECT r.id,r.menu_item_id,rv.id AS version_id,rv.yield_quantity_minor
         FROM recipes r JOIN recipe_versions rv
           ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
         WHERE r.tenant_id=? AND r.active=1 AND r.menu_item_id NOT LIKE 'production:%'
           AND (r.branch_override_id IS NULL OR r.branch_override_id=?)`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<{
        id: string;
        menu_item_id: string;
        version_id: string;
        yield_quantity_minor: number;
      }>();
    const statements: D1PreparedStatement[] = [];
    for (const recipe of recipes.results ?? []) {
      const components = await this.db
        .prepare(
          `SELECT inventory_item_id,sub_recipe_id,quantity_minor,unit_id,waste_factor_bps
           FROM recipe_version_components WHERE tenant_id=? AND recipe_version_id=? AND optional=0`,
        )
        .bind(this.actor.tenantId, recipe.version_id)
        .all<RecipeComponentRow>();
      let portions: number | null = null;
      let quality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA" = "HIGH";
      for (const component of components.results ?? []) {
        const itemId =
          component.inventory_item_id ??
          (await this.productionItemForRecipe(component.sub_recipe_id));
        if (!itemId) {
          quality = "INSUFFICIENT_DATA";
          portions = 0;
          break;
        }
        const item = await this.db
          .prepare("SELECT base_unit_id FROM inventory_items WHERE tenant_id=? AND id=?")
          .bind(this.actor.tenantId, itemId)
          .first<{ base_unit_id: string | null }>();
        if (!item?.base_unit_id) {
          quality = "INSUFFICIENT_DATA";
          portions = 0;
          break;
        }
        const componentBase = await this.convertItemQuantity(
          itemId,
          component.quantity_minor,
          component.unit_id,
          item.base_unit_id,
          stamp,
        );
        const adjustedComponent = multiplyDivide(
          componentBase,
          BASIS_POINTS_SCALE + component.waste_factor_bps,
          BASIS_POINTS_SCALE,
          "availability recipe quantity",
        );
        const available = await this.db
          .prepare(
            `SELECT COALESCE(SUM(quantity_minor-quantity_reserved_minor),0) AS quantity
             FROM inventory_balances WHERE tenant_id=? AND branch_id=? AND item_id=?`,
          )
          .bind(this.actor.tenantId, branchId, itemId)
          .first<{ quantity: number }>();
        const capacityMicro =
          adjustedComponent > 0
            ? multiplyDivide(
                Math.max(0, available?.quantity ?? 0),
                recipe.yield_quantity_minor,
                adjustedComponent,
                "available portions",
              )
            : 0;
        const componentPortions = Math.floor(capacityMicro / QUANTITY_SCALE);
        portions = portions === null ? componentPortions : Math.min(portions, componentPortions);
      }
      if ((components.results?.length ?? 0) === 0) {
        portions = 0;
        quality = "INSUFFICIENT_DATA";
      }
      const resolvedPortions = Math.max(0, portions ?? 0);
      statements.push(
        this.db
          .prepare(
            `INSERT INTO menu_inventory_availability
              (tenant_id,branch_id,menu_item_id,available_portions,available,quality,
               sync_status,calculated_at,payload_json)
             VALUES (?,?,?,?,?,?,'PENDING',?,'{}')
             ON CONFLICT(tenant_id,branch_id,menu_item_id) DO UPDATE SET
               available_portions=excluded.available_portions,
               available=excluded.available,
               quality=excluded.quality,
               sync_status=CASE
                 WHEN menu_inventory_availability.available<>excluded.available
                   OR menu_inventory_availability.available_portions<>excluded.available_portions
                 THEN 'PENDING' ELSE menu_inventory_availability.sync_status END,
               calculated_at=excluded.calculated_at`,
          )
          .bind(
            this.actor.tenantId,
            branchId,
            recipe.menu_item_id,
            resolvedPortions,
            resolvedPortions > 0 ? 1 : 0,
            quality,
            stamp,
          ),
      );
    }
    return statements;
  }

  private async menuProfitabilityStatements(branchId: string, periodEnd: string, stamp: string) {
    const start = new Date(`${periodEnd}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - 29);
    const periodStart = start.toISOString().slice(0, 10);
    const sales = await this.db
      .prepare(
        `SELECT json_extract(il.payload_json,'$.productId') AS menu_item_id,
                COALESCE(SUM(il.quantity_minor),0) AS quantity,
                COALESCE(SUM(il.amount_minor-il.tax_minor),0) AS revenue
         FROM invoice_lines il JOIN invoices i
           ON i.tenant_id=il.tenant_id AND i.id=il.invoice_id
         WHERE i.tenant_id=? AND i.branch_id=? AND i.business_date BETWEEN ? AND ?
           AND i.status NOT IN ('CANCELLED','VOID')
           AND json_extract(il.payload_json,'$.productId') IS NOT NULL
         GROUP BY json_extract(il.payload_json,'$.productId')`,
      )
      .bind(this.actor.tenantId, branchId, periodStart, periodEnd)
      .all<{ menu_item_id: string; quantity: number; revenue: number }>();
    const computed: Array<{
      menuItemId: string;
      quantity: number;
      revenue: number;
      cost: number;
      contribution: number;
      foodCostBps: number;
      quality: "HIGH" | "INSUFFICIENT_DATA";
    }> = [];
    for (const sale of sales.results ?? []) {
      const recipe = await this.db
        .prepare(
          `SELECT rv.id,rv.yield_quantity_minor FROM recipes r JOIN recipe_versions rv
             ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
           WHERE r.tenant_id=? AND r.menu_item_id=?
             AND (r.branch_override_id IS NULL OR r.branch_override_id=?)
           ORDER BY CASE WHEN r.branch_override_id=? THEN 0 ELSE 1 END LIMIT 1`,
        )
        .bind(this.actor.tenantId, sale.menu_item_id, branchId, branchId)
        .first<{ id: string; yield_quantity_minor: number }>();
      const recipeCost = recipe ? await this.recipeCostMinor(recipe.id) : 0;
      const cost = recipe
        ? multiplyDivide(
            recipeCost,
            sale.quantity,
            recipe.yield_quantity_minor,
            "menu theoretical cost",
          )
        : 0;
      computed.push({
        menuItemId: sale.menu_item_id,
        quantity: sale.quantity,
        revenue: sale.revenue,
        cost,
        contribution: sale.revenue - cost,
        foodCostBps: sale.revenue > 0 ? ratioBasisPoints(cost, sale.revenue) : 0,
        quality: recipe ? "HIGH" : "INSUFFICIENT_DATA",
      });
    }
    const sufficient = computed.filter((row) => row.quality === "HIGH");
    const totalQuantity = sufficient.reduce((sum, row) => sum + row.quantity, 0);
    const totalContribution = sufficient.reduce((sum, row) => sum + row.contribution, 0);
    return computed.map((row) => {
      const popular = sufficient.length > 0 && row.quantity * sufficient.length >= totalQuantity;
      const profitable =
        sufficient.length > 0 && row.contribution * sufficient.length >= totalContribution;
      const classification =
        row.quality === "INSUFFICIENT_DATA"
          ? "INSUFFICIENT_DATA"
          : popular && profitable
            ? "STAR"
            : popular
              ? "PLOWHORSE"
              : profitable
                ? "PUZZLE"
                : "DOG";
      return this.db
        .prepare(
          `INSERT INTO menu_profitability_snapshots
            (tenant_id,id,branch_id,menu_item_id,period_start,period_end,quantity_sold,
             net_revenue_minor,theoretical_cost_minor,contribution_minor,food_cost_bps,
             classification,quality,generated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(tenant_id,branch_id,menu_item_id,period_start,period_end)
           DO UPDATE SET quantity_sold=excluded.quantity_sold,
             net_revenue_minor=excluded.net_revenue_minor,
             theoretical_cost_minor=excluded.theoretical_cost_minor,
             contribution_minor=excluded.contribution_minor,
             food_cost_bps=excluded.food_cost_bps,
             classification=excluded.classification,quality=excluded.quality,
             generated_at=excluded.generated_at`,
        )
        .bind(
          this.actor.tenantId,
          crypto.randomUUID(),
          branchId,
          row.menuItemId,
          periodStart,
          periodEnd,
          row.quantity,
          row.revenue,
          row.cost,
          row.contribution,
          row.foodCostBps,
          classification,
          row.quality,
          stamp,
        );
    });
  }

  private async productionPrepStatements(branchId: string, businessDate: string, stamp: string) {
    const recipes = await this.db
      .prepare(
        `SELECT r.id,r.name,r.production_item_id,r.current_version_id,r.payload_json,
                rv.yield_quantity_minor
         FROM recipes r JOIN recipe_versions rv
           ON rv.tenant_id=r.tenant_id AND rv.id=r.current_version_id
         WHERE r.tenant_id=? AND r.active=1 AND r.production_item_id IS NOT NULL
           AND (r.branch_override_id IS NULL OR r.branch_override_id=?)`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<{
        id: string;
        name: string;
        production_item_id: string;
        current_version_id: string;
        payload_json: string;
        yield_quantity_minor: number;
      }>();
    const statements: D1PreparedStatement[] = [];
    for (const recipe of recipes.results ?? []) {
      const demandRows = await this.db
        .prepare(
          `SELECT mp.quantity_sold,pvc.quantity_minor,parent_version.yield_quantity_minor
           FROM recipe_version_components pvc
           JOIN recipe_versions parent_version ON parent_version.tenant_id=pvc.tenant_id
             AND parent_version.id=pvc.recipe_version_id
           JOIN recipes parent_recipe ON parent_recipe.tenant_id=parent_version.tenant_id
             AND parent_recipe.current_version_id=parent_version.id
           JOIN menu_profitability_snapshots mp ON mp.tenant_id=parent_recipe.tenant_id
             AND mp.branch_id=? AND mp.menu_item_id=parent_recipe.menu_item_id
             AND mp.period_end=(SELECT MAX(latest.period_end) FROM menu_profitability_snapshots latest
               WHERE latest.tenant_id=mp.tenant_id AND latest.branch_id=mp.branch_id
                 AND latest.menu_item_id=mp.menu_item_id)
           WHERE pvc.tenant_id=? AND pvc.sub_recipe_id=?`,
        )
        .bind(branchId, this.actor.tenantId, recipe.id)
        .all<{ quantity_sold: number; quantity_minor: number; yield_quantity_minor: number }>();
      const forecastRequired = (demandRows.results ?? []).reduce(
        (sum, row) =>
          sum +
          multiplyDivide(
            row.quantity_sold,
            row.quantity_minor,
            row.yield_quantity_minor,
            "production prep demand",
          ),
        0,
      );
      const prepared = await this.db
        .prepare(
          `SELECT COALESCE(SUM(quantity_minor-quantity_reserved_minor),0) AS quantity
           FROM inventory_balances WHERE tenant_id=? AND branch_id=? AND item_id=?`,
        )
        .bind(this.actor.tenantId, branchId, recipe.production_item_id)
        .first<{ quantity: number }>();
      const payload = parseJsonObject(recipe.payload_json);
      const safetyBps = safeConfiguredInteger(
        payload["prepSafetyBufferBps"],
        0,
        BASIS_POINTS_SCALE,
      );
      const safetyBuffer = multiplyDivide(
        forecastRequired,
        safetyBps,
        BASIS_POINTS_SCALE,
        "production prep safety buffer",
      );
      const preparedAvailable = Math.max(0, prepared?.quantity ?? 0);
      const recommended = Math.max(0, forecastRequired + safetyBuffer - preparedAvailable);
      const quality = (demandRows.results?.length ?? 0) > 0 ? "HIGH" : "INSUFFICIENT_DATA";
      const id = `prep:${branchId}:${businessDate}:${recipe.id}`;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO production_prep_recommendations
              (tenant_id,id,branch_id,business_date,recipe_id,recipe_version_id,output_item_id,
               forecast_required_minor,prepared_available_minor,safety_buffer_minor,
               recommended_batch_minor,due_at,station_id,status,quality,explanation_json,
               generated_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,'RECOMMENDED',?,?,?,?)
             ON CONFLICT(tenant_id,branch_id,business_date,recipe_id) DO UPDATE SET
               recipe_version_id=excluded.recipe_version_id,output_item_id=excluded.output_item_id,
               forecast_required_minor=excluded.forecast_required_minor,
               prepared_available_minor=excluded.prepared_available_minor,
               safety_buffer_minor=excluded.safety_buffer_minor,
               recommended_batch_minor=excluded.recommended_batch_minor,
               station_id=excluded.station_id,quality=excluded.quality,
               explanation_json=excluded.explanation_json,generated_at=excluded.generated_at,
               updated_at=excluded.updated_at,
               status=CASE WHEN production_prep_recommendations.status IN ('APPROVED','ADJUSTED','STARTED','COMPLETED')
                 THEN production_prep_recommendations.status ELSE 'RECOMMENDED' END`,
          )
          .bind(
            this.actor.tenantId,
            id,
            branchId,
            businessDate,
            recipe.id,
            recipe.current_version_id,
            recipe.production_item_id,
            forecastRequired,
            preparedAvailable,
            safetyBuffer,
            recommended,
            typeof payload["stationId"] === "string" ? payload["stationId"] : null,
            quality,
            JSON.stringify({
              demandSource: "LATEST_MENU_PROFITABILITY",
              demandRows: demandRows.results?.length ?? 0,
              forecastRequiredMicro: forecastRequired,
              preparedAvailableMicro: preparedAvailable,
              safetyBufferBps: safetyBps,
            }),
            stamp,
            stamp,
          ),
      );
    }
    return statements;
  }

  private async executeInChunks(statements: D1PreparedStatement[], chunkSize = 75) {
    for (let index = 0; index < statements.length; index += chunkSize) {
      await this.db.batch(statements.slice(index, index + chunkSize));
    }
  }

  private async detectDataQuality(branchId: string) {
    const issues: Array<{
      entityType: string;
      entityId: string;
      code: string;
      severity: "INFO" | "WARNING" | "CRITICAL";
      message: string;
    }> = [];
    const missingUnits = await this.db
      .prepare(
        `SELECT id,name FROM inventory_items WHERE tenant_id=? AND active=1
         AND (base_unit_id IS NULL OR purchase_unit_id IS NULL)`,
      )
      .bind(this.actor.tenantId)
      .all<{ id: string; name: string }>();
    (missingUnits.results ?? []).forEach((item) =>
      issues.push({
        entityType: "INVENTORY_ITEM",
        entityId: item.id,
        code: "ITEM_MISSING_UNIT",
        severity: "CRITICAL",
        message: `${item.name} is missing a base or purchase unit`,
      }),
    );
    const negative = await this.db
      .prepare(
        `SELECT item_id,quantity_minor FROM inventory_balances
         WHERE tenant_id=? AND branch_id=? AND quantity_minor<0`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<{ item_id: string; quantity_minor: number }>();
    (negative.results ?? []).forEach((row) =>
      issues.push({
        entityType: "INVENTORY_ITEM",
        entityId: row.item_id,
        code: "NEGATIVE_STOCK",
        severity: "WARNING",
        message: `Authoritative stock is negative by ${Math.abs(row.quantity_minor)} micro-units`,
      }),
    );
    const recipes = await this.db
      .prepare(
        `SELECT id,name FROM recipes WHERE tenant_id=? AND active=1 AND current_version_id IS NULL`,
      )
      .bind(this.actor.tenantId)
      .all<{ id: string; name: string }>();
    (recipes.results ?? []).forEach((recipe) =>
      issues.push({
        entityType: "RECIPE",
        entityId: recipe.id,
        code: "RECIPE_MISSING_VERSION",
        severity: "WARNING",
        message: `${recipe.name ?? recipe.id} has no active recipe version`,
      }),
    );
    return issues;
  }

  private async actualAndTheoreticalCost(branchId: string) {
    const values = await this.db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN movement_type IN ('SALE_CONSUMPTION','PRODUCTION_INPUT','WASTAGE','EXPIRY')
             THEN ABS(COALESCE(total_cost_minor,0)) ELSE 0 END),0) AS actual,
           COALESCE(SUM(CASE WHEN movement_type='SALE_CONSUMPTION'
             THEN ABS(COALESCE(total_cost_minor,0)) ELSE 0 END),0) AS theoretical
         FROM inventory_movements WHERE tenant_id=? AND branch_id=?`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ actual: number; theoretical: number }>();
    const revenue = await this.db
      .prepare(
        `SELECT COALESCE(SUM(total_minor),0) AS total
         FROM invoices WHERE tenant_id=? AND branch_id=? AND status IN ('PAID','SETTLED')`,
      )
      .bind(this.actor.tenantId, branchId)
      .first<{ total: number }>();
    const denominator = revenue?.total ?? 0;
    return {
      actualFoodCostBps: denominator > 0 ? ratioBasisPoints(values?.actual ?? 0, denominator) : 0,
      theoreticalFoodCostBps:
        denominator > 0 ? ratioBasisPoints(values?.theoretical ?? 0, denominator) : 0,
    };
  }

  private async unexplainedVarianceValue(branchId: string) {
    const periods = await this.db
      .prepare(
        `SELECT unexplained_quantity_minor,inventory_item_id FROM inventory_consumption_periods
         WHERE tenant_id=? AND branch_id=?`,
      )
      .bind(this.actor.tenantId, branchId)
      .all<{ unexplained_quantity_minor: number; inventory_item_id: string }>();
    let value = 0;
    for (const row of periods.results ?? []) {
      value += quantityCostMinor(
        Math.abs(row.unexplained_quantity_minor),
        await this.weightedItemCost(row.inventory_item_id, branchId),
      );
    }
    return value;
  }

  private async costMovement(input: InventoryMovementInput) {
    if (input.totalCostMinor !== undefined && input.unitCostMinor !== undefined) {
      assertScaledInteger(input.totalCostMinor, "movement total cost", true);
      assertScaledInteger(input.unitCostMinor, "movement unit cost");
      return { totalCostMinor: input.totalCostMinor, unitCostMinor: input.unitCostMinor };
    }
    const currentCost = await this.weightedItemCost(
      input.inventoryItemId,
      input.branchId,
      input.warehouseId,
    );
    return createInventoryValuationStrategy("WEIGHTED_AVERAGE").movementCost({
      quantityBaseMicro: input.quantityBaseMicro,
      currentAverageUnitCostMinor: currentCost,
      ...(input.unitCostMinor === undefined ? {} : { suppliedUnitCostMinor: input.unitCostMinor }),
      ...(input.totalCostMinor === undefined
        ? {}
        : { suppliedTotalCostMinor: input.totalCostMinor }),
    });
  }

  private movementStatement(
    input: InventoryMovementInput & {
      id: string;
      occurredAt: string;
      unitCostMinor: number;
      totalCostMinor: number;
    },
    correlationId: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO inventory_movements
          (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,
           source_type,source_id,idempotency_key,correlation_id,payload_json,created_at,
           unit_cost_minor,total_cost_minor,business_date,occurred_at,actor_id,reason,lot_id,
           negative_override)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        input.id,
        input.branchId,
        input.warehouseId,
        input.inventoryItemId,
        input.movementType,
        input.quantityBaseMicro,
        input.sourceType,
        input.sourceId,
        input.idempotencyKey,
        correlationId,
        JSON.stringify(input.metadata ?? {}),
        input.occurredAt,
        input.unitCostMinor,
        input.totalCostMinor,
        input.businessDate,
        input.occurredAt,
        this.actor.id,
        input.reason ?? null,
        input.lotId ?? null,
        input.negativeOverride ? 1 : 0,
      );
  }

  private async balance(branchId: string, warehouseId: string, itemId: string) {
    return (
      (await this.db
        .prepare(
          `SELECT quantity_minor,quantity_reserved_minor,average_unit_cost_minor,total_value_minor
           FROM inventory_balances WHERE tenant_id=? AND branch_id=? AND warehouse_id=? AND item_id=?`,
        )
        .bind(this.actor.tenantId, branchId, warehouseId, itemId)
        .first<InventoryBalanceRow>()) ?? {
        quantity_minor: 0,
        quantity_reserved_minor: 0,
        average_unit_cost_minor: 0,
        total_value_minor: 0,
      }
    );
  }

  private async weightedItemCost(itemId: string, branchId?: string, warehouseId?: string) {
    if (branchId && warehouseId) {
      const row = await this.balance(branchId, warehouseId, itemId);
      return row.average_unit_cost_minor;
    }
    const row = await this.db
      .prepare(
        `SELECT CASE WHEN SUM(quantity_minor)>0
          THEN (SUM(total_value_minor)*1000000 + SUM(quantity_minor)/2)/SUM(quantity_minor)
          ELSE 0 END AS cost
         FROM inventory_balances WHERE tenant_id=? AND item_id=?
           AND (? IS NULL OR branch_id=?)`,
      )
      .bind(this.actor.tenantId, itemId, branchId ?? null, branchId ?? null)
      .first<{ cost: number }>();
    return row?.cost ?? 0;
  }

  private async assertSupplierAllowedByEnterprisePolicy(branchId: string, supplierId: string) {
    const policy = await this.effectiveBranchEnterprisePolicy(
      branchId,
      "PROCUREMENT.APPROVED_SUPPLIERS",
    );
    if (!policy || policy.state === "NOT_APPLICABLE") return;
    let approved: unknown;
    try {
      approved = policy.value_json == null ? null : JSON.parse(policy.value_json);
    } catch {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Approved-supplier policy is malformed and procurement is blocked",
      );
    }
    if (!Array.isArray(approved) || !approved.every((value) => typeof value === "string")) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Approved-supplier policy must contain supplier identifiers",
      );
    }
    if (!approved.includes(supplierId)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        "Supplier is not allowed by the effective enterprise procurement policy",
      );
    }
  }

  private async assertRecipeOverrideAllowed(branchId: string, resourceId: string) {
    const policy = await this.effectiveBranchEnterprisePolicy(branchId, `RECIPE:${resourceId}`);
    if (!policy || policy.state === "NOT_APPLICABLE") return;
    if (policy.state === "LOCKED") {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        "Recipe is locked by the effective enterprise policy",
      );
    }
    if (policy.state === "APPROVAL_REQUIRED") {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        "Recipe override requires an approved enterprise policy exception",
      );
    }
  }

  private async effectiveBranchEnterprisePolicy(branchId: string, policyCode: string) {
    return this.db
      .prepare(
        `SELECT a.state,a.value_json
         FROM enterprise_nodes n
         JOIN enterprise_node_closure c
           ON c.tenant_id=n.tenant_id AND c.descendant_id=n.id
         JOIN enterprise_policy_definitions d
           ON d.tenant_id=n.tenant_id AND UPPER(d.code)=UPPER(?) AND d.active=1
         JOIN enterprise_policy_assignments a
           ON a.tenant_id=d.tenant_id AND a.policy_id=d.id AND a.scope_node_id=c.ancestor_id
         WHERE n.tenant_id=? AND n.node_type='BRANCH' AND n.branch_id=?
           AND a.state<>'INHERIT' AND a.effective_from<=?
           AND (a.effective_to IS NULL OR a.effective_to>?)
         ORDER BY c.depth ASC,a.effective_from DESC,a.version DESC LIMIT 1`,
      )
      .bind(
        policyCode,
        this.actor.tenantId,
        branchId,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .first<{ state: string; value_json: string | null }>();
  }

  private async transferAccountingConfiguration(
    sourceBranchId: string,
    destinationBranchId: string,
  ) {
    const entities = await this.db
      .prepare(
        `SELECT branch_id,legal_entity_id FROM enterprise_nodes
         WHERE tenant_id=? AND node_type='BRANCH' AND branch_id IN (?,?)`,
      )
      .bind(this.actor.tenantId, sourceBranchId, destinationBranchId)
      .all<{ branch_id: string; legal_entity_id: string | null }>();
    const source = (entities.results ?? []).find((row) => row.branch_id === sourceBranchId);
    const destination = (entities.results ?? []).find(
      (row) => row.branch_id === destinationBranchId,
    );
    if (!source?.legal_entity_id || !destination?.legal_entity_id) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Transfer branches require authoritative legal-entity mappings",
      );
    }
    if (source.legal_entity_id === destination.legal_entity_id) {
      return {
        treatment: "INTRA_ENTITY" as const,
        sourceLegalEntityId: source.legal_entity_id,
        destinationLegalEntityId: destination.legal_entity_id,
        configurationId: undefined,
      };
    }
    const at = new Date().toISOString();
    const configuration = await this.db
      .prepare(
        `SELECT id FROM intercompany_configurations
         WHERE tenant_id=? AND source_legal_entity_id=? AND destination_legal_entity_id=?
           AND active=1 AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
         ORDER BY effective_from DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId, source.legal_entity_id, destination.legal_entity_id, at, at)
      .first<{ id: string }>();
    if (!configuration) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Cross-entity transfer requires configured intercompany accounts and transfer-price policy",
      );
    }
    return {
      treatment: "INTERCOMPANY" as const,
      sourceLegalEntityId: source.legal_entity_id,
      destinationLegalEntityId: destination.legal_entity_id,
      configurationId: configuration.id,
    };
  }

  private async convertToItemBase(
    itemId: string,
    quantityMicro: number,
    fromUnitId: string,
    effectiveAt: string,
  ) {
    const item = await this.db
      .prepare("SELECT base_unit_id FROM inventory_items WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, itemId)
      .first<{ base_unit_id: string | null }>();
    if (!item?.base_unit_id) throw new Error("Inventory item is missing a base unit");
    return this.convertItemQuantity(
      itemId,
      quantityMicro,
      fromUnitId,
      item.base_unit_id,
      effectiveAt,
    );
  }

  private async conversionRatio(itemId: string, fromUnitId: string, toUnitId: string, at: string) {
    if (fromUnitId === toUnitId) return { numerator: 1, denominator: 1 };
    const one = await this.convertItemQuantity(itemId, QUANTITY_SCALE, fromUnitId, toUnitId, at);
    return normalizeRational(one, QUANTITY_SCALE);
  }

  private async incomingQuantity(branchId: string, warehouseId: string, itemId: string) {
    const row = await this.db
      .prepare(
        `SELECT COALESCE(SUM(pol.ordered_quantity_minor-pol.received_quantity_minor),0) AS incoming
         FROM purchase_order_lines pol JOIN purchase_orders po
           ON po.tenant_id=pol.tenant_id AND po.id=pol.purchase_order_id
         WHERE po.tenant_id=? AND po.branch_id=? AND po.warehouse_id=? AND pol.item_id=?
           AND po.status IN ('APPROVED','PARTIALLY_RECEIVED')`,
      )
      .bind(this.actor.tenantId, branchId, warehouseId, itemId)
      .first<{ incoming: number }>();
    return row?.incoming ?? 0;
  }

  private async productionItemForRecipe(recipeId: string | null) {
    if (!recipeId) return null;
    const recipe = await this.db
      .prepare("SELECT production_item_id FROM recipes WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, recipeId)
      .first<{ production_item_id: string | null }>();
    return recipe?.production_item_id ?? null;
  }

  private async assertNoRecipeCycle(recipeId: string, newEdges: string[]) {
    const graph = new Map<string, string[]>();
    const rows = await this.db
      .prepare(
        `SELECT rv.recipe_id,rvc.sub_recipe_id FROM recipe_version_components rvc
         JOIN recipe_versions rv ON rv.tenant_id=rvc.tenant_id AND rv.id=rvc.recipe_version_id
         WHERE rvc.tenant_id=? AND rvc.sub_recipe_id IS NOT NULL AND rv.active=1`,
      )
      .bind(this.actor.tenantId)
      .all<{ recipe_id: string; sub_recipe_id: string }>();
    (rows.results ?? []).forEach((row) => {
      graph.set(row.recipe_id, [...(graph.get(row.recipe_id) ?? []), row.sub_recipe_id]);
    });
    graph.set(recipeId, newEdges);
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const target of graph.get(node) ?? []) if (visit(target)) return true;
      visiting.delete(node);
      visited.add(node);
      return false;
    };
    if (visit(recipeId)) throw new Error("Circular recipe dependency is not allowed");
  }

  private async accountMapping(branchId: string) {
    const mapping = await this.db
      .prepare(
        `SELECT inventory_account_id,opening_balance_account_id,accounts_payable_account_id,cogs_account_id,
                wastage_account_id,variance_account_id,recoverable_tax_account_id,accounting_mode
         FROM inventory_account_mappings WHERE tenant_id=? AND active=1
           AND (branch_id=? OR branch_id IS NULL)
         ORDER BY CASE WHEN branch_id=? THEN 0 ELSE 1 END LIMIT 1`,
      )
      .bind(this.actor.tenantId, branchId, branchId)
      .first<AccountMappingRow>();
    if (!mapping) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Inventory accounting mappings must be configured before posting",
      );
    }
    return mapping;
  }

  private async movementAccountingStatements(
    input: InventoryMovementInput & { id: string; occurredAt: string },
    correlationId: string,
  ) {
    const mapping = await this.accountMapping(input.branchId);
    if (mapping.accounting_mode !== "PERPETUAL") return [];
    const valueMinor = Math.abs(input.totalCostMinor ?? 0);
    if (valueMinor === 0) return [];
    let debitAccount: string | null = null;
    let creditAccount: string | null = null;
    switch (input.movementType) {
      case "OPENING":
        if (!mapping.opening_balance_account_id) {
          throw new Error("Opening balance account mapping is required for opening inventory");
        }
        debitAccount = mapping.inventory_account_id;
        creditAccount = mapping.opening_balance_account_id;
        break;
      case "SALE_CONSUMPTION":
        debitAccount = mapping.cogs_account_id;
        creditAccount = mapping.inventory_account_id;
        break;
      case "WASTAGE":
      case "BREAKAGE":
      case "EXPIRY":
        debitAccount = mapping.wastage_account_id;
        creditAccount = mapping.inventory_account_id;
        break;
      case "STOCK_COUNT_ADJUSTMENT":
      case "MANUAL_ADJUSTMENT":
        if (input.quantityBaseMicro > 0) {
          debitAccount = mapping.inventory_account_id;
          creditAccount = mapping.variance_account_id;
        } else {
          debitAccount = mapping.variance_account_id;
          creditAccount = mapping.inventory_account_id;
        }
        break;
      default:
        return [];
    }
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=?")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    if (!tenant?.default_currency) throw new Error("Tenant default currency is not configured");
    const journalId = `inventory:${input.id}`;
    const stamp = input.occurredAt;
    return [
      this.db
        .prepare(
          `INSERT INTO journal_entries
            (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
             correlation_id,payload_json,created_at)
           VALUES (?,?,?,?,?,?,'DRAFT',?,?,'{}',?)`,
        )
        .bind(
          this.actor.tenantId,
          journalId,
          input.branchId,
          "INVENTORY_MOVEMENT",
          input.id,
          input.businessDate,
          `${input.movementType} inventory posting`,
          correlationId,
          stamp,
        ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        1,
        debitAccount,
        valueMinor,
        0,
        tenant.default_currency,
      ),
      journalLine(
        this.db,
        this.actor.tenantId,
        journalId,
        2,
        creditAccount,
        0,
        valueMinor,
        tenant.default_currency,
      ),
      this.db
        .prepare(
          "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=?",
        )
        .bind(stamp, this.actor.tenantId, journalId),
    ];
  }

  private async assertBusinessDateOpen(branchId: string, businessDate: string, reason?: string) {
    const close = await this.db
      .prepare(
        `SELECT status FROM day_closes WHERE tenant_id=? AND branch_id=? AND business_date=?`,
      )
      .bind(this.actor.tenantId, branchId, businessDate)
      .first<{ status: string }>();
    if (close?.status !== "CLOSED") return;
    if (this.actor.permissions.includes(permissions.dayCloseReopen) && reason?.trim()) return;
    throw new ServerOperationError(
      "INVALID_STATE_TRANSITION",
      409,
      "Inventory mutation is blocked for a closed business date",
    );
  }

  private requirePermission(permission: string) {
    if (!this.actor.permissions.includes(permission)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        `${permission} permission is required`,
      );
    }
  }

  private async audit(action: string, entityType: string, entityId: string, stamp: string) {
    await this.auditStatement(action, entityType, entityId, stamp, crypto.randomUUID()).run();
  }

  private auditStatement(
    action: string,
    entityType: string,
    entityId: string,
    stamp: string,
    correlationId: string,
    branchId = this.actor.branchId,
  ) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, '{}',?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        entityType,
        entityId,
        correlationId,
        this.actor.sessionId ?? null,
        stamp,
      );
  }

  private recalculationEventStatement(
    branchId: string | undefined,
    eventType: string,
    entityType: string,
    entityId: string,
    sourceIdempotencyKey: string,
    stamp: string,
    correlationId: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO inventory_recalculation_events
          (tenant_id,id,branch_id,event_type,entity_type,entity_id,idempotency_key,status,
           correlation_id,payload_json,created_at)
         VALUES (?,?,?,?,?,?,?,'PENDING',?,'{}',?)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        branchId ?? null,
        eventType,
        entityType,
        entityId,
        `inventory-recalc:${sourceIdempotencyKey}`,
        correlationId,
        stamp,
      );
  }
}

function journalLine(
  db: D1Database,
  tenantId: string,
  journalId: string,
  lineNumber: number,
  accountId: string,
  debitMinor: number,
  creditMinor: number,
  currency: string,
) {
  return db
    .prepare(
      `INSERT INTO journal_lines
        (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
       VALUES (?,?,?,?,?,?,?,'{}')`,
    )
    .bind(tenantId, journalId, lineNumber, accountId, debitMinor, creditMinor, currency);
}

function assertMovementSign(type: string, quantity: number) {
  assertScaledInteger(quantity, "movement quantity", true);
  if (quantity === 0) throw new Error("Inventory movement quantity cannot be zero");
  if (incomingMovementTypes.has(type) && quantity < 0) {
    throw new Error(`${type} must have a positive quantity`);
  }
  if (outgoingMovementTypes.has(type) && quantity > 0) {
    throw new Error(`${type} must have a negative quantity`);
  }
}

function movementPermission(type: string) {
  if (type === "WASTAGE" || type === "EXPIRY") return permissions.inventoryWastageRecord;
  if (type.startsWith("TRANSFER_")) return permissions.inventoryTransfer;
  if (type.startsWith("PRODUCTION_")) return permissions.productionComplete;
  if (type === "PURCHASE_RECEIPT") return permissions.procurementReceive;
  return permissions.inventoryAdjust;
}

function requiredCode(value: string, label: string) {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) throw new Error(`${label} is invalid`);
  return normalized;
}

function invalidTransition(entity: string, from: string, to: string) {
  return new ServerOperationError(
    "INVALID_STATE_TRANSITION",
    409,
    `${entity} cannot transition from ${from} to ${to}`,
  );
}

function quantityCostFromTotal(quantityMicro: number, totalMinor: number) {
  if (quantityMicro === 0) return 0;
  return multiplyDivide(
    Math.abs(totalMinor),
    QUANTITY_SCALE,
    Math.abs(quantityMicro),
    "movement unit cost",
  );
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringProperty(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function splitInventoryKey(key: string) {
  const separator = key.indexOf(":");
  if (separator <= 0 || separator === key.length - 1) {
    throw new Error("Invalid inventory location key");
  }
  return [key.slice(0, separator), key.slice(separator + 1)] as const;
}

function safeConfiguredInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : minimum;
}
