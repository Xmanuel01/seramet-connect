import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  calculateFoodCostBridge,
  buildPurchaseRecommendation,
  deterministicForecast,
} from "@/inventory/forecasting";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import {
  QUANTITY_SCALE,
  multiplyDivide,
  quantityCostMinor,
  weightedAverageUnitCostMinor,
} from "@/inventory/quantity";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import { queueInventoryAvailabilityChanges } from "@/server/workers";

const tenantId = "tenant-a";
const branchId = "branch-a";
const warehouseId = "warehouse-a";
const secondBranchId = "branch-b";
const secondWarehouseId = "warehouse-b";

describe("Pass 6 inventory, procurement and food-cost intelligence", () => {
  let db: SqliteD1TestDatabase;
  let service: InventoryIntelligenceService;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    seedFoundation(db);
    service = new InventoryIntelligenceService(db, actor());
  });

  afterEach(() => db.close());

  it("applies schema version 7 with the production intelligence tables", async () => {
    const version = await db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .first<{ version: number }>();
    expect(version?.version).toBe(25);
    for (const table of [
      "unit_definitions",
      "item_unit_conversions",
      "suppliers",
      "purchase_requisitions",
      "goods_receipt_lines",
      "recipe_versions",
      "production_batches",
      "stock_count_sessions",
      "inventory_categories",
      "inventory_adjustments",
      "inventory_forecasts",
      "purchase_recommendations",
      "menu_inventory_availability",
      "supplier_returns",
      "portion_standards",
      "inventory_recalculation_events",
    ]) {
      const row = await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .bind(table)
        .first();
      expect(row, table).not.toBeNull();
    }
  });

  it("lists zero-stock item master records and counts them in branch stock health", async () => {
    await seedUnits(service);
    await service.createInventoryItem({
      id: "item-zero",
      code: "ZERO",
      name: "Zero stock item",
      baseUnitId: "unit-kg",
      purchaseUnitId: "unit-kg",
      defaultWarehouseId: warehouseId,
    });

    const catalogue = await service.listInventory({ branchId });
    expect(catalogue.items).toHaveLength(1);
    expect(catalogue.items[0]).toMatchObject({
      id: "item-zero",
      quantity_minor: 0,
      quantity_reserved_minor: 0,
      quantity_available_minor: 0,
      total_value_minor: 0,
      warehouse_count: 0,
      base_unit_symbol: "kg",
    });

    const summary = await service.summary(branchId);
    expect(summary.itemCount).toBe(1);
    expect(summary.outOfStockCount).toBe(1);
    expect(summary.inventoryValueMinor).toBe(0);
  });

  it("aggregates one inventory item across warehouses without duplicating the catalogue row", async () => {
    await seedBeef(service);
    const stamp = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
         VALUES (?,?,?,?,?,1,'{}')`,
      )
      .run(tenantId, "warehouse-a-2", branchId, "WAREHOUSE-A-2", "Second store");

    await opening(service, "opening-primary", 2 * QUANTITY_SCALE, 50_000);
    await service.appendMovement({
      branchId,
      warehouseId: "warehouse-a-2",
      inventoryItemId: "item-beef",
      movementType: "OPENING",
      quantityBaseMicro: QUANTITY_SCALE,
      unitCostMinor: 60_000,
      totalCostMinor: 60_000,
      sourceType: "OPENING",
      sourceId: "opening-secondary",
      idempotencyKey: "opening-secondary",
      businessDate: "2026-08-30",
      occurredAt: stamp,
    });

    const catalogue = await service.listInventory({ branchId });
    expect(catalogue.items).toHaveLength(1);
    expect(catalogue.items[0]).toMatchObject({
      id: "item-beef",
      quantity_minor: 3 * QUANTITY_SCALE,
      total_value_minor: 160_000,
      warehouse_count: 2,
    });
    expect(Number(catalogue.items[0]?.average_unit_cost_minor)).toBe(53_333);

    const detail = await service.inventoryItemDetail({ branchId, sku: "BEEF" });
    expect(detail.balances).toHaveLength(2);
    expect(detail.movements).toHaveLength(2);
  });

  it("uses exact integer quantity and weighted-average arithmetic", () => {
    expect(multiplyDivide(2 * QUANTITY_SCALE, 1_000, 1)).toBe(2_000 * QUANTITY_SCALE);
    expect(quantityCostMinor(2_500_000, 57_500)).toBe(143_750);
    expect(weightedAverageUnitCostMinor(10_000_000, 550_000, 10_000_000, 600_000)).toBe(57_500);
  });

  it("supports dimensional and item-specific unit conversions", async () => {
    await seedUnits(service);
    await service.createInventoryItem({
      id: "item-beef",
      code: "BEEF",
      name: "Beef",
      baseUnitId: "unit-kg",
      purchaseUnitId: "unit-kg",
    });
    expect(
      await service.convertItemQuantity("item-beef", 2 * QUANTITY_SCALE, "unit-kg", "unit-g"),
    ).toBe(2_000 * QUANTITY_SCALE);

    await service.createInventoryItem({
      id: "item-soda",
      code: "SODA",
      name: "Soda",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-box",
    });
    await service.createItemConversion({
      id: "conversion-box-soda",
      inventoryItemId: "item-soda",
      fromUnitId: "unit-box",
      toUnitId: "unit-piece",
      factorNumerator: 24,
      factorDenominator: 1,
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    });
    expect(
      await service.convertItemQuantity("item-soda", 2 * QUANTITY_SCALE, "unit-box", "unit-piece"),
    ).toBe(48 * QUANTITY_SCALE);
    await expect(
      service.convertItemQuantity("item-beef", QUANTITY_SCALE, "unit-kg", "unit-piece"),
    ).rejects.toThrow("item-specific conversion");
  });

  it("derives balances and weighted value only from immutable movements", async () => {
    await seedBeef(service);
    await opening(service, "opening-a", 10_000_000, 55_000);
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "PURCHASE_RECEIPT",
      quantityBaseMicro: 10_000_000,
      unitCostMinor: 60_000,
      totalCostMinor: 600_000,
      sourceType: "GOODS_RECEIPT",
      sourceId: "receipt-a",
      idempotencyKey: "receipt-a",
      businessDate: "2026-08-30",
    });
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -2_000_000,
      sourceType: "ORDER",
      sourceId: "order-a",
      idempotencyKey: "sale-a",
      businessDate: "2026-08-30",
    });
    const balance = await inventoryBalance(db, "item-beef");
    expect(balance).toMatchObject({
      quantity_minor: 18_000_000,
      average_unit_cost_minor: 57_500,
      total_value_minor: 1_035_000,
    });
    await expect(
      db
        .prepare(
          "UPDATE inventory_movements SET quantity_minor=1 WHERE tenant_id=? AND idempotency_key='sale-a'",
        )
        .bind(tenantId)
        .run(),
    ).rejects.toThrow("INVENTORY_MOVEMENT_IMMUTABLE");
  });

  it("deduplicates movements and enforces negative-stock policy", async () => {
    await seedBeef(service);
    const first = await opening(service, "same-opening", 1_000_000, 50_000);
    const repeated = await opening(service, "same-opening", 1_000_000, 50_000);
    expect(first.duplicate).toBe(false);
    expect(repeated.duplicate).toBe(true);
    await db
      .prepare(
        `INSERT INTO inventory_par_policies
          (tenant_id,id,branch_id,warehouse_id,inventory_item_id,negative_stock_policy,updated_at)
         VALUES (?,?,?,?,?,'BLOCK',?)`,
      )
      .bind(tenantId, "par-beef", branchId, warehouseId, "item-beef", new Date().toISOString())
      .run();
    await expect(
      service.appendMovement({
        branchId,
        warehouseId,
        inventoryItemId: "item-beef",
        movementType: "SALE_CONSUMPTION",
        quantityBaseMicro: -2_000_000,
        sourceType: "ORDER",
        sourceId: "order-negative",
        idempotencyKey: "negative-sale",
        businessDate: "2026-08-30",
      }),
    ).rejects.toThrow("NEGATIVE_INVENTORY_BLOCKED");
  });

  it("requires an explicit reason for every manual inventory adjustment", async () => {
    await seedBeef(service);
    await expect(
      service.appendMovement({
        branchId,
        warehouseId,
        inventoryItemId: "item-beef",
        movementType: "MANUAL_ADJUSTMENT",
        quantityBaseMicro: QUANTITY_SCALE,
        unitCostMinor: 55_000,
        sourceType: "MANAGER_ADJUSTMENT",
        sourceId: "adjustment-without-reason",
        idempotencyKey: "adjustment-without-reason",
        businessDate: "2026-08-30",
      }),
    ).rejects.toThrow("require a reason");
  });

  it("keeps periodic inventory movements out of perpetual COGS journals", async () => {
    await db
      .prepare("UPDATE inventory_account_mappings SET accounting_mode='PERIODIC' WHERE tenant_id=?")
      .bind(tenantId)
      .run();
    await seedBeef(service);
    await opening(service, "periodic-opening", 5 * QUANTITY_SCALE, 60_000);
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -QUANTITY_SCALE,
      sourceType: "ORDER",
      sourceId: "periodic-sale",
      idempotencyKey: "periodic-sale",
      businessDate: "2026-08-30",
    });
    const journalCount = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM journal_entries WHERE tenant_id=? AND source_type='INVENTORY_MOVEMENT'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    expect(journalCount?.count).toBe(0);
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(4 * QUANTITY_SCALE);
  });

  it("rejects cross-tenant item and warehouse relationships at the database boundary", async () => {
    await seedBeef(service);
    const tenantBService = new InventoryIntelligenceService(db, actor("tenant-b"));
    await expect(
      tenantBService.appendMovement({
        branchId: "branch-tenant-b",
        warehouseId,
        inventoryItemId: "item-beef",
        movementType: "OPENING",
        quantityBaseMicro: QUANTITY_SCALE,
        unitCostMinor: 1,
        totalCostMinor: 1,
        sourceType: "OPENING",
        sourceId: "cross-tenant",
        idempotencyKey: "cross-tenant",
        businessDate: "2026-08-30",
      }),
    ).rejects.toThrow();
  });

  it("runs requisition approval, PO approval, partial receiving and full receiving", async () => {
    const fixture = await seedProcurement(service);
    const requisition = await service.createPurchaseRequisition({
      id: "req-a",
      branchId,
      warehouseId,
      requisitionNumber: "REQ-0001",
      sourceType: "FORECAST",
      lines: [
        {
          inventoryItemId: fixture.itemId,
          requestedQuantityMicro: 2 * QUANTITY_SCALE,
          unitId: "unit-box",
        },
      ],
    });
    expect(requisition.status).toBe("SUBMITTED");
    await service.approvePurchaseRequisition(requisition.id, "Forecast reviewed");
    const po = await service.createPurchaseOrder({
      id: "po-a",
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      requisitionId: requisition.id,
      purchaseOrderNumber: "PO-0001",
      currency: "KES",
      lines: [
        {
          id: "po-line-a",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    });
    expect(po.totalMinor).toBe(480_000);
    await service.approvePurchaseOrder(po.id, "Within threshold");
    const first = await service.receiveGoods({
      id: "gr-a",
      branchId,
      warehouseId,
      purchaseOrderId: po.id,
      supplierId: fixture.supplierId,
      receiptNumber: "GR-0001",
      idempotencyKey: "gr-a",
      businessDate: "2026-08-30",
      lines: [
        {
          purchaseOrderLineId: "po-line-a",
          receivedPurchaseQuantityMicro: QUANTITY_SCALE,
          acceptedPurchaseQuantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 250_000,
          lotNumber: "LOT-1",
          expiryDate: "2026-09-02",
        },
      ],
    });
    expect(first.lines![0]).toMatchObject({
      baseQuantityMicro: 24 * QUANTITY_SCALE,
      priceVarianceMinor: 10_000,
    });
    expect(await poStatus(db, po.id)).toBe("PARTIALLY_RECEIVED");
    await service.receiveGoods({
      id: "gr-b",
      branchId,
      warehouseId,
      purchaseOrderId: po.id,
      supplierId: fixture.supplierId,
      receiptNumber: "GR-0002",
      idempotencyKey: "gr-b",
      businessDate: "2026-08-31",
      lines: [
        {
          purchaseOrderLineId: "po-line-a",
          receivedPurchaseQuantityMicro: QUANTITY_SCALE,
          acceptedPurchaseQuantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 250_000,
          lotNumber: "LOT-2",
          expiryDate: "2026-09-03",
        },
      ],
    });
    expect(await poStatus(db, po.id)).toBe("RECEIVED");
    expect((await inventoryBalance(db, fixture.itemId)).quantity_minor).toBe(48 * QUANTITY_SCALE);
    const history = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM supplier_item_price_history WHERE tenant_id=? AND inventory_item_id=?",
      )
      .bind(tenantId, fixture.itemId)
      .first<{ count: number }>();
    expect(history?.count).toBe(2);
  });

  it("rejects duplicate requisition items and unusable request units before submission", async () => {
    const fixture = await seedProcurement(service);
    const line = {
      inventoryItemId: fixture.itemId,
      requestedQuantityMicro: QUANTITY_SCALE,
      unitId: "unit-box",
    };
    await expect(
      service.createPurchaseRequisition({
        branchId,
        warehouseId,
        requisitionNumber: "REQ-DUPLICATE-ITEM",
        sourceType: "MANUAL_REQUEST",
        lines: [line, line],
      }),
    ).rejects.toThrow("Combine duplicate inventory items");

    await expect(
      service.createPurchaseRequisition({
        branchId,
        warehouseId,
        requisitionNumber: "REQ-INCOMPATIBLE-UNIT",
        sourceType: "MANUAL_REQUEST",
        lines: [{ ...line, unitId: "unit-kg" }],
      }),
    ).rejects.toThrow("item-specific conversion");

    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM purchase_requisitions WHERE tenant_id=?")
      .bind(tenantId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("rejects cross-branch procurement warehouses and a mismatched receiving supplier", async () => {
    const fixture = await seedProcurement(service);
    await expect(
      service.createPurchaseRequisition({
        branchId,
        warehouseId: secondWarehouseId,
        requisitionNumber: "REQ-WRONG-WAREHOUSE",
        sourceType: "MANUAL_REQUEST",
        lines: [
          {
            inventoryItemId: fixture.itemId,
            requestedQuantityMicro: QUANTITY_SCALE,
            unitId: "unit-box",
          },
        ],
      }),
    ).rejects.toThrow("warehouse must be active and belong");

    await expect(
      service.createPurchaseOrder({
        branchId,
        warehouseId: secondWarehouseId,
        supplierId: fixture.supplierId,
        purchaseOrderNumber: "PO-WRONG-WAREHOUSE",
        currency: "KES",
        lines: [
          {
            inventoryItemId: fixture.itemId,
            purchaseUnitId: "unit-box",
            quantityMicro: QUANTITY_SCALE,
            unitPriceMinor: 240_000,
          },
        ],
      }),
    ).rejects.toThrow("warehouse must be active and belong");

    const po = await createApprovedPo(
      service,
      fixture,
      "po-supplier-scope",
      "PO-SUPPLIER-SCOPE",
      "REJECT_OVER_RECEIPT",
    );
    await service.createSupplier({
      id: "supplier-mismatch",
      code: "SUP-MISMATCH",
      name: "Wrong delivery supplier",
    });
    await expect(
      receiveQuantity(
        service,
        po.id,
        "supplier-scope-line",
        "supplier-mismatch",
        QUANTITY_SCALE,
        "supplier-scope-receipt",
      ),
    ).rejects.toThrow("does not match the purchase order");
    expect(await poStatus(db, po.id)).toBe("APPROVED");
  });

  it("records fully rejected deliveries without stock, supplier bills or PO receipt progress", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-fully-rejected",
      "PO-FULLY-REJECTED",
      "REJECT_OVER_RECEIPT",
    );
    await expect(
      service.receiveGoods({
        branchId,
        warehouseId,
        purchaseOrderId: po.id,
        supplierId: fixture.supplierId,
        receiptNumber: "GR-BAD-REJECTED",
        idempotencyKey: "bad-rejected",
        businessDate: "2026-08-30",
        lines: [
          {
            purchaseOrderLineId: "fully-rejected-line",
            receivedPurchaseQuantityMicro: QUANTITY_SCALE,
            acceptedPurchaseQuantityMicro: QUANTITY_SCALE,
            rejectedPurchaseQuantityMicro: QUANTITY_SCALE,
            unitPriceMinor: 240_000,
          },
        ],
      }),
    ).rejects.toThrow("must equal accepted plus rejected");

    const receipt = await service.receiveGoods({
      branchId,
      warehouseId,
      purchaseOrderId: po.id,
      supplierId: fixture.supplierId,
      receiptNumber: "GR-FULLY-REJECTED",
      idempotencyKey: "fully-rejected",
      businessDate: "2026-08-30",
      lines: [
        {
          purchaseOrderLineId: "fully-rejected-line",
          receivedPurchaseQuantityMicro: QUANTITY_SCALE,
          acceptedPurchaseQuantityMicro: 0,
          rejectedPurchaseQuantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 240_000,
          qualityStatus: "REJECTED",
        },
      ],
    });
    expect(receipt.duplicate).toBe(false);
    expect(await poStatus(db, po.id)).toBe("APPROVED");
    const stockMovements = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=? AND source_id=?",
      )
      .bind(tenantId, receipt.id)
      .first<{ count: number }>();
    expect(stockMovements?.count).toBe(0);
    await expect(
      service.postSupplierInvoice({
        branchId,
        supplierId: fixture.supplierId,
        purchaseOrderId: po.id,
        goodsReceiptId: receipt.id,
        invoiceNumber: "INV-FULLY-REJECTED",
        invoiceDate: "2026-08-30",
        currency: "KES",
        subtotalMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
      }),
    ).rejects.toThrow("fully rejected");
  });

  it("records extended receipt price variance across accepted purchase quantities", async () => {
    const fixture = await seedProcurement(service);
    const po = await service.createPurchaseOrder({
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      purchaseOrderNumber: "PO-EXTENDED-VARIANCE",
      currency: "KES",
      lines: [
        {
          id: "extended-variance-line",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    });
    await service.approvePurchaseOrder(po.id);
    const receipt = await receiveQuantity(
      service,
      po.id,
      "extended-variance-line",
      fixture.supplierId,
      2 * QUANTITY_SCALE,
      "extended-variance-receipt",
      250_000,
    );
    const line = await db
      .prepare(
        "SELECT price_variance_minor FROM goods_receipt_lines WHERE tenant_id=? AND goods_receipt_id=?",
      )
      .bind(tenantId, receipt.id)
      .first<{ price_variance_minor: number }>();
    expect(line?.price_variance_minor).toBe(20_000);
  });

  it("tracks partial requisition ordering and reverses quantities when a PO is cancelled", async () => {
    const fixture = await seedProcurement(service);
    const requisition = await service.createPurchaseRequisition({
      id: "req-partial-ordering",
      branchId,
      warehouseId,
      requisitionNumber: "REQ-PARTIAL-ORDERING",
      sourceType: "MANUAL_REQUEST",
      lines: [
        {
          inventoryItemId: fixture.itemId,
          requestedQuantityMicro: 2 * QUANTITY_SCALE,
          unitId: "unit-box",
        },
      ],
    });
    await service.approvePurchaseRequisition(requisition.id, "Approved for partial sourcing");

    const partialPo = await service.createPurchaseOrder({
      id: "po-partial-requisition",
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      requisitionId: requisition.id,
      purchaseOrderNumber: "PO-PARTIAL-REQUISITION",
      currency: "KES",
      lines: [
        {
          id: "po-partial-requisition-line",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    });

    const partial = await db
      .prepare(
        `SELECT pr.status,prl.ordered_quantity_minor
         FROM purchase_requisitions pr
         JOIN purchase_requisition_lines prl
           ON prl.tenant_id=pr.tenant_id AND prl.requisition_id=pr.id
         WHERE pr.tenant_id=? AND pr.id=?`,
      )
      .bind(tenantId, requisition.id)
      .first<{ status: string; ordered_quantity_minor: number }>();
    expect(partial).toEqual({
      status: "PARTIALLY_ORDERED",
      ordered_quantity_minor: QUANTITY_SCALE,
    });

    await service.cancelPurchaseOrder(partialPo.id, "Supplier could not fulfil");
    const reopened = await db
      .prepare(
        `SELECT pr.status,prl.ordered_quantity_minor
         FROM purchase_requisitions pr
         JOIN purchase_requisition_lines prl
           ON prl.tenant_id=pr.tenant_id AND prl.requisition_id=pr.id
         WHERE pr.tenant_id=? AND pr.id=?`,
      )
      .bind(tenantId, requisition.id)
      .first<{ status: string; ordered_quantity_minor: number }>();
    expect(reopened).toEqual({ status: "APPROVED", ordered_quantity_minor: 0 });

    await service.createPurchaseOrder({
      id: "po-full-requisition",
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      requisitionId: requisition.id,
      purchaseOrderNumber: "PO-FULL-REQUISITION",
      currency: "KES",
      lines: [
        {
          id: "po-full-requisition-line",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    });
    const completed = await db
      .prepare(
        `SELECT pr.status,prl.ordered_quantity_minor
         FROM purchase_requisitions pr
         JOIN purchase_requisition_lines prl
           ON prl.tenant_id=pr.tenant_id AND prl.requisition_id=pr.id
         WHERE pr.tenant_id=? AND pr.id=?`,
      )
      .bind(tenantId, requisition.id)
      .first<{ status: string; ordered_quantity_minor: number }>();
    expect(completed).toEqual({
      status: "ORDERED",
      ordered_quantity_minor: 2 * QUANTITY_SCALE,
    });
  });

  it("enforces over-receipt policy and allows configured tolerance", async () => {
    const fixture = await seedProcurement(service);
    const strictPo = await createApprovedPo(
      service,
      fixture,
      "po-strict",
      "PO-STRICT",
      "REJECT_OVER_RECEIPT",
    );
    await expect(
      receiveQuantity(
        service,
        strictPo.id,
        "strict-line",
        fixture.supplierId,
        1_100_000,
        "strict-over",
      ),
    ).rejects.toThrow("Over receipt");

    const tolerantPo = await createApprovedPo(
      service,
      fixture,
      "po-tolerant",
      "PO-TOLERANT",
      "ALLOW_WITH_TOLERANCE",
      1_000,
    );
    await expect(
      receiveQuantity(
        service,
        tolerantPo.id,
        "tolerant-line",
        fixture.supplierId,
        1_100_000,
        "within-tolerance",
      ),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it("deduplicates receipt retries and creates one stock effect", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-retry",
      "PO-RETRY",
      "REJECT_OVER_RECEIPT",
    );
    const first = await receiveQuantity(
      service,
      po.id,
      "retry-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "same-receipt",
    );
    const second = await receiveQuantity(
      service,
      po.id,
      "retry-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "same-receipt",
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const movements = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=? AND source_type='GOODS_RECEIPT'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    expect(movements?.count).toBe(1);
  });

  it("keeps recipe versions, costs current ingredients and rejects recipe cycles", async () => {
    await seedBeef(service);
    await opening(service, "opening-recipe", 20 * QUANTITY_SCALE, 60_000);
    await service.createRecipe({ id: "recipe-main", menuItemId: "menu-main", name: "Main recipe" });
    const version = await service.createRecipeVersion({
      recipeId: "recipe-main",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 250 * QUANTITY_SCALE,
          unitId: "unit-g",
        },
      ],
    });
    expect(await service.recipeCostMinor(version.id)).toBe(15_000);
    await service.createRecipeVersion({
      recipeId: "recipe-main",
      version: 2,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-20T00:00:00.000Z",
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 300 * QUANTITY_SCALE,
          unitId: "unit-g",
        },
      ],
    });
    const versions = await db
      .prepare(
        "SELECT version,active FROM recipe_versions WHERE tenant_id=? AND recipe_id=? ORDER BY version",
      )
      .bind(tenantId, "recipe-main")
      .all<{ version: number; active: number }>();
    expect(versions.results).toEqual([
      { version: 1, active: 0 },
      { version: 2, active: 1 },
    ]);

    await service.createRecipe({ id: "recipe-a", productionItemId: "item-beef", name: "A" });
    await service.createRecipe({ id: "recipe-b", productionItemId: "item-beef", name: "B" });
    await service.createRecipeVersion({
      recipeId: "recipe-a",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        { subRecipeId: "recipe-b", quantityMicro: QUANTITY_SCALE, unitId: "unit-piece" },
      ],
    });
    await expect(
      service.createRecipeVersion({
        recipeId: "recipe-b",
        version: 1,
        yieldQuantityMicro: QUANTITY_SCALE,
        yieldUnitId: "unit-piece",
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        components: [
          { subRecipeId: "recipe-a", quantityMicro: QUANTITY_SCALE, unitId: "unit-piece" },
        ],
      }),
    ).rejects.toThrow("Circular recipe");
  });

  it("creates and versions authoritative recipes through the recipe editor model", async () => {
    await seedBeef(service);
    await service.createInventoryItem({
      id: "item-recipe-output",
      code: "RECIPE-OUTPUT",
      name: "Recipe output",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-piece",
    });
    await opening(service, "opening-recipe-editor", 8 * QUANTITY_SCALE, 50_000);

    const created = await service.saveRecipeDefinition({
      productionItemId: "item-recipe-output",
      name: "Authoritative prep",
      yieldQuantityMicro: 4 * QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      packagingCostMinor: 100,
      productionOverheadMinor: 200,
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitId: "unit-kg",
          wasteFactorBps: 500,
        },
      ],
    });
    expect(created).toMatchObject({ created: true, version: 1 });

    const edited = await service.saveRecipeDefinition({
      recipeId: created.recipeId,
      productionItemId: "item-recipe-output",
      name: "Authoritative prep updated",
      yieldQuantityMicro: 5 * QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      packagingCostMinor: 100,
      productionOverheadMinor: 300,
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitId: "unit-kg",
          wasteFactorBps: 250,
        },
      ],
    });
    expect(edited).toMatchObject({ created: false, version: 2 });

    const overview = await service.recipeOverview(branchId);
    const recipe = overview.recipes.find((row) => row["id"] === created.recipeId);
    expect(recipe).toMatchObject({
      name: "Authoritative prep updated",
      version: 2,
      production_item_id: "item-recipe-output",
    });
    expect(Number(recipe?.["cost_minor"])).toBeGreaterThan(0);
    expect(Number(recipe?.["available_output_quantity_minor"])).toBeGreaterThan(0);

    const versions = await db
      .prepare(
        "SELECT version,active FROM recipe_versions WHERE tenant_id=? AND recipe_id=? ORDER BY version",
      )
      .bind(tenantId, created.recipeId)
      .all<{ version: number; active: number }>();
    expect(versions.results).toEqual([
      { version: 1, active: 0 },
      { version: 2, active: 1 },
    ]);
  });

  it("imports multiple authoritative recipe definitions and reports row outcomes", async () => {
    await seedBeef(service);
    await service.createInventoryItem({
      id: "item-import-output-a",
      code: "IMPORT-A",
      name: "Imported output A",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-piece",
    });
    await service.createInventoryItem({
      id: "item-import-output-b",
      code: "IMPORT-B",
      name: "Imported output B",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-piece",
    });
    const result = await service.importRecipeDefinitions({
      idempotencyKey: "recipe-import-test",
      recipes: [
        {
          productionItemId: "item-import-output-a",
          name: "Imported recipe A",
          yieldQuantityMicro: QUANTITY_SCALE,
          yieldUnitId: "unit-piece",
          components: [
            {
              inventoryItemId: "item-beef",
              quantityMicro: QUANTITY_SCALE,
              unitId: "unit-kg",
            },
          ],
        },
        {
          productionItemId: "item-import-output-b",
          name: "Imported recipe B",
          yieldQuantityMicro: QUANTITY_SCALE,
          yieldUnitId: "unit-piece",
          components: [
            {
              inventoryItemId: "missing-item",
              quantityMicro: QUANTITY_SCALE,
              unitId: "unit-kg",
            },
          ],
        },
      ],
    });
    expect(result).toMatchObject({ imported: 1, failed: 1 });
    expect(result.results[0]).toMatchObject({ index: 0, created: true });
    expect(result.results[1]?.error).toMatch(/unavailable|base unit/i);
  });

  it("completes a production batch once and records actual yield", async () => {
    await seedBeef(service);
    await service.createInventoryItem({
      id: "item-prep",
      code: "PREP",
      name: "Prepared batch",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-piece",
    });
    await opening(service, "opening-production", 10 * QUANTITY_SCALE, 60_000);
    await service.createRecipe({
      id: "recipe-production",
      productionItemId: "item-prep",
      name: "Prep batch",
    });
    const version = await service.createRecipeVersion({
      recipeId: "recipe-production",
      version: 1,
      yieldQuantityMicro: 10 * QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 2_500_000,
          unitId: "unit-kg",
        },
      ],
    });
    const first = await service.completeProduction({
      id: "batch-a",
      branchId,
      warehouseId,
      recipeVersionId: version.id,
      outputItemId: "item-prep",
      plannedQuantityMicro: 10 * QUANTITY_SCALE,
      actualOutputQuantityMicro: 9 * QUANTITY_SCALE,
      idempotencyKey: "batch-a",
      businessDate: "2026-08-30",
    });
    const repeated = await service.completeProduction({
      branchId,
      warehouseId,
      recipeVersionId: version.id,
      outputItemId: "item-prep",
      plannedQuantityMicro: 10 * QUANTITY_SCALE,
      actualOutputQuantityMicro: 9 * QUANTITY_SCALE,
      idempotencyKey: "batch-a",
      businessDate: "2026-08-30",
    });
    expect(first).toMatchObject({ duplicate: false, yieldVarianceBps: -1_000 });
    expect(repeated.duplicate).toBe(true);
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(7_500_000);
    expect((await inventoryBalance(db, "item-prep")).quantity_minor).toBe(9 * QUANTITY_SCALE);
  });

  it("plans, starts, completes and cancels production batches through explicit states", async () => {
    await seedBeef(service);
    await service.createInventoryItem({
      id: "item-prep-lifecycle",
      code: "PREP-LIFE",
      name: "Prepared lifecycle batch",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-piece",
    });
    await opening(service, "opening-production-lifecycle", 12 * QUANTITY_SCALE, 60_000);
    await service.createRecipe({
      id: "recipe-production-lifecycle",
      productionItemId: "item-prep-lifecycle",
      name: "Lifecycle prep batch",
    });
    const version = await service.createRecipeVersion({
      recipeId: "recipe-production-lifecycle",
      version: 1,
      yieldQuantityMicro: 10 * QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        {
          inventoryItemId: "item-beef",
          quantityMicro: 2_500_000,
          unitId: "unit-kg",
        },
      ],
    });

    const planned = await service.planProduction({
      id: "batch-lifecycle",
      branchId,
      warehouseId,
      recipeVersionId: version.id,
      outputItemId: "item-prep-lifecycle",
      plannedQuantityMicro: 10 * QUANTITY_SCALE,
      idempotencyKey: "batch-lifecycle-plan",
      businessDate: "2026-08-30",
    });
    expect(planned).toMatchObject({ id: "batch-lifecycle", status: "PLANNED", duplicate: false });

    const beforeStart = await service.productionOverview(branchId, 10);
    expect(beforeStart.batches[0]).toMatchObject({
      id: "batch-lifecycle",
      status: "PLANNED",
      recipe_name: "Lifecycle prep batch",
    });

    await expect(service.startProduction("batch-lifecycle")).resolves.toMatchObject({
      status: "IN_PROGRESS",
      duplicate: false,
    });
    const completed = await service.completePlannedProduction(
      "batch-lifecycle",
      8 * QUANTITY_SCALE,
    );
    expect(completed).toMatchObject({ duplicate: false, yieldVarianceBps: -2_000 });
    await expect(
      service.completePlannedProduction("batch-lifecycle", 8 * QUANTITY_SCALE),
    ).resolves.toMatchObject({ duplicate: true, yieldVarianceBps: -2_000 });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(9_500_000);
    expect((await inventoryBalance(db, "item-prep-lifecycle")).quantity_minor).toBe(
      8 * QUANTITY_SCALE,
    );

    await service.planProduction({
      id: "batch-cancelled",
      branchId,
      warehouseId,
      recipeVersionId: version.id,
      outputItemId: "item-prep-lifecycle",
      plannedQuantityMicro: 5 * QUANTITY_SCALE,
      idempotencyKey: "batch-cancelled-plan",
      businessDate: "2026-08-30",
    });
    await expect(
      service.cancelProduction("batch-cancelled", "Demand changed before preparation"),
    ).resolves.toMatchObject({ status: "CANCELLED", duplicate: false });
    await expect(service.startProduction("batch-cancelled")).rejects.toThrow(/Cannot start/);
  });

  it("rolls category health and warehouse stock detail from authoritative balances", async () => {
    await service.createInventoryCategory({
      id: "category-meat",
      code: "MEAT",
      name: "Meat",
      description: "Fresh and frozen meat",
    });
    await seedUnits(service);
    await service.createInventoryItem({
      id: "item-category-beef",
      code: "CATEGORY-BEEF",
      name: "Category Beef",
      categoryId: "category-meat",
      baseUnitId: "unit-kg",
      purchaseUnitId: "unit-kg",
      defaultWarehouseId: warehouseId,
    });
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-category-beef",
      movementType: "OPENING",
      quantityBaseMicro: 5 * QUANTITY_SCALE,
      unitCostMinor: 60_000,
      totalCostMinor: 300_000,
      sourceType: "OPENING",
      sourceId: "category-opening",
      idempotencyKey: "category-opening",
      businessDate: "2026-08-30",
    });
    await service.upsertParPolicy({
      branchId,
      warehouseId,
      inventoryItemId: "item-category-beef",
      reorderPointMicro: 6 * QUANTITY_SCALE,
      targetQuantityMicro: 10 * QUANTITY_SCALE,
    });

    const categories = await service.listInventoryCategories(branchId);
    expect(categories).toEqual([
      expect.objectContaining({
        id: "category-meat",
        code: "MEAT",
        name: "Meat",
        item_count: 1,
        stock_value_minor: 300_000,
        low_stock_count: 1,
        out_of_stock_count: 0,
      }),
    ]);

    const detail = await service.stockDetail({ branchId, warehouseId });
    expect(detail.rows).toEqual([
      expect.objectContaining({
        item_id: "item-category-beef",
        category_name: "Meat",
        warehouse_id: warehouseId,
        quantity_minor: 5 * QUANTITY_SCALE,
        reorder_point_minor: 6 * QUANTITY_SCALE,
        target_quantity_minor: 10 * QUANTITY_SCALE,
        total_value_minor: 300_000,
      }),
    ]);
  });

  it("runs a stock count through draft, submit and approval before posting variance", async () => {
    await seedBeef(service);
    await opening(service, "lifecycle-count-opening", 10 * QUANTITY_SCALE, 58_200);
    const started = await service.startStockCount({
      id: "count-lifecycle",
      branchId,
      warehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "count-lifecycle",
      blindCount: true,
    });
    expect(started).toMatchObject({ duplicate: false, itemCount: 1 });

    let detail = await service.stockCountDetail("count-lifecycle");
    expect(detail.session).toMatchObject({ status: "DRAFT", blind_count: 1 });
    expect(detail.lines[0]).toMatchObject({
      inventory_item_id: "item-beef",
      expected_quantity_minor: null,
      variance_quantity_minor: null,
      variance_value_minor: null,
      unit_cost_minor: null,
      counted: 0,
    });

    await service.saveStockCount("count-lifecycle", {
      lines: [
        {
          inventoryItemId: "item-beef",
          countedQuantityMicro: 8_500_000,
          reason: "Independent recount",
        },
      ],
    });
    await expect(service.submitStockCount("count-lifecycle")).resolves.toMatchObject({
      status: "SUBMITTED",
    });
    await expect(
      service.approveStockCount("count-lifecycle", "Manager verified the recount"),
    ).resolves.toMatchObject({
      status: "POSTED",
      duplicate: false,
      varianceCount: 1,
    });

    detail = await service.stockCountDetail("count-lifecycle");
    expect(detail.session).toMatchObject({
      status: "POSTED",
      approval_reason: "Manager verified the recount",
    });
    expect(detail.lines[0]).toMatchObject({
      counted: 1,
      counted_quantity_minor: 8_500_000,
      variance_quantity_minor: -1_500_000,
      variance_value_minor: -87_300,
    });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(8_500_000);
    const movement = await db
      .prepare(
        `SELECT movement_type,source_type,source_id
           FROM inventory_movements
          WHERE tenant_id=? AND source_type='STOCK_COUNT' AND source_id=?`,
      )
      .bind(tenantId, "count-lifecycle")
      .first<Record<string, unknown>>();
    expect(movement).toMatchObject({
      movement_type: "STOCK_COUNT_ADJUSTMENT",
      source_type: "STOCK_COUNT",
      source_id: "count-lifecycle",
    });
  });

  it("keeps stock-count participation separate from general inventory viewing", async () => {
    await seedBeef(service);
    await opening(service, "permission-count-opening", 3 * QUANTITY_SCALE, 50_000);

    const counter = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryCount]),
    );
    const started = await counter.startStockCount({
      id: "count-permissions",
      branchId,
      warehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "count-permissions",
      blindCount: true,
    });
    expect(started).toMatchObject({ duplicate: false, itemCount: 1 });

    let detail = await counter.stockCountDetail("count-permissions");
    expect(detail.lines[0]).toMatchObject({
      expected_quantity_minor: null,
      variance_quantity_minor: null,
      unit_cost_minor: null,
      counted: 0,
    });

    await counter.saveStockCount("count-permissions", {
      lines: [{ inventoryItemId: "item-beef", countedQuantityMicro: 2_500_000 }],
    });
    await expect(counter.submitStockCount("count-permissions")).resolves.toMatchObject({
      status: "SUBMITTED",
    });

    const approver = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryCountApprove]),
    );
    await expect(
      approver.approveStockCount("count-permissions", "Independent approval"),
    ).resolves.toMatchObject({
      status: "POSTED",
      varianceCount: 1,
    });
    detail = await approver.stockCountDetail("count-permissions");
    expect(detail.lines[0]).toMatchObject({
      expected_quantity_minor: 3 * QUANTITY_SCALE,
      counted_quantity_minor: 2_500_000,
      variance_quantity_minor: -500_000,
    });
  });

  it("rejects a stale stock-count snapshot after inventory moves", async () => {
    await seedBeef(service);
    await opening(service, "stale-count-opening", 4 * QUANTITY_SCALE, 50_000);
    await service.startStockCount({
      id: "count-stale",
      branchId,
      warehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "count-stale",
    });
    const detail = await service.stockCountDetail("count-stale");
    await service.saveStockCount("count-stale", {
      lines: [{ inventoryItemId: "item-beef", countedQuantityMicro: 4 * QUANTITY_SCALE }],
    });
    const snapshotAt = String(detail.session["snapshot_at"]);
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "PURCHASE_RECEIPT",
      quantityBaseMicro: QUANTITY_SCALE,
      unitCostMinor: 50_000,
      totalCostMinor: 50_000,
      sourceType: "GOODS_RECEIPT",
      sourceId: "stale-after-snapshot",
      idempotencyKey: "stale-after-snapshot",
      businessDate: "2026-08-30",
      occurredAt: new Date(new Date(snapshotAt).getTime() + 1_000).toISOString(),
    });

    await expect(service.submitStockCount("count-stale")).rejects.toThrow(
      "Stock changed after this count started",
    );
    expect((await service.stockCountDetail("count-stale")).session).toMatchObject({
      status: "COUNTING",
    });
  });

  it("posts physical count variance as an append-only adjustment", async () => {
    await seedBeef(service);
    await opening(service, "opening-count", 10 * QUANTITY_SCALE, 58_200);
    const count = await service.postStockCount({
      id: "count-a",
      branchId,
      warehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "count-a",
      blindCount: true,
      approvalReason: "Independent recount confirmed",
      lines: [{ inventoryItemId: "item-beef", countedQuantityMicro: 8_500_000 }],
    });
    expect(count.variances![0]).toMatchObject({
      quantityMicro: -1_500_000,
      valueMinor: -87_300,
    });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(8_500_000);
    const movement = await db
      .prepare(
        "SELECT movement_type FROM inventory_movements WHERE tenant_id=? AND source_type='STOCK_COUNT'",
      )
      .bind(tenantId)
      .first<{ movement_type: string }>();
    expect(movement?.movement_type).toBe("STOCK_COUNT_ADJUSTMENT");
  });

  it("records inter-branch transfer shortage without forcing both sides equal", async () => {
    await seedBeef(service);
    await opening(service, "opening-transfer", 10 * QUANTITY_SCALE, 50_000);
    const transfer = await service.transferStock({
      transferNumber: "TR-0001",
      sourceBranchId: branchId,
      sourceWarehouseId: warehouseId,
      destinationBranchId: secondBranchId,
      destinationWarehouseId: secondWarehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "transfer-a",
      lines: [
        {
          inventoryItemId: "item-beef",
          sentQuantityMicro: 2_000_000,
          receivedQuantityMicro: 1_800_000,
        },
      ],
    });
    expect(transfer.shortages[0]).toEqual({
      itemId: "item-beef",
      quantityMicro: 200_000,
      valueMinor: 10_000,
    });
    expect((await inventoryBalance(db, "item-beef", branchId, warehouseId)).quantity_minor).toBe(
      8_000_000,
    );
    expect(
      (await inventoryBalance(db, "item-beef", secondBranchId, secondWarehouseId)).quantity_minor,
    ).toBe(1_800_000);
    expect(
      (
        await service.transferStock({
          transferNumber: "TR-0001-RETRY",
          sourceBranchId: branchId,
          sourceWarehouseId: warehouseId,
          destinationBranchId: secondBranchId,
          destinationWarehouseId: secondWarehouseId,
          businessDate: "2026-08-30",
          idempotencyKey: "transfer-a",
          lines: [
            {
              inventoryItemId: "item-beef",
              sentQuantityMicro: 2_000_000,
              receivedQuantityMicro: 1_800_000,
            },
          ],
        })
      ).duplicate,
    ).toBe(true);
  });

  it("keeps manual adjustments pending until a separate approval posts the ledger movement", async () => {
    await seedBeef(service);
    await opening(service, "adjustment-opening", 5 * QUANTITY_SCALE, 60_000);

    const requester = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryAdjust]),
    );
    const requested = await requester.requestInventoryAdjustment({
      id: "adjustment-controlled",
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: -500_000,
      reasonCode: "COUNT_CORRECTION",
      idempotencyKey: "adjustment-controlled",
      businessDate: "2026-08-30",
    });
    expect(requested).toMatchObject({ status: "PENDING", duplicate: false });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(5 * QUANTITY_SCALE);

    const approver = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryAdjustApprove]),
    );
    await expect(
      approver.approveInventoryAdjustment("adjustment-controlled", "Independent recount verified"),
    ).resolves.toMatchObject({ status: "APPROVED", duplicate: false });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(4_500_000);
    const movement = await db
      .prepare(
        "SELECT movement_type,source_type,source_id FROM inventory_movements WHERE tenant_id=? AND source_type='INVENTORY_ADJUSTMENT'",
      )
      .bind(tenantId)
      .first<Record<string, unknown>>();
    expect(movement).toMatchObject({
      movement_type: "MANUAL_ADJUSTMENT",
      source_type: "INVENTORY_ADJUSTMENT",
      source_id: "adjustment-controlled",
    });
  });

  it("keeps wastage pending until approval and does not move stock when rejected", async () => {
    await seedBeef(service);
    await opening(service, "controlled-waste-opening", 5 * QUANTITY_SCALE, 60_000);
    const recorder = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryWastageRecord]),
    );
    await recorder.requestWastage({
      id: "waste-controlled",
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: 500_000,
      reasonCode: "SPOILAGE",
      idempotencyKey: "waste-controlled",
      businessDate: "2026-08-30",
    });
    await recorder.requestWastage({
      id: "waste-rejected",
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: 250_000,
      reasonCode: "QUALITY",
      idempotencyKey: "waste-rejected",
      businessDate: "2026-08-30",
    });
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(5 * QUANTITY_SCALE);

    const approver = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryWastageApprove]),
    );
    await approver.rejectWastageRequest("waste-rejected", "Evidence did not support wastage");
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(5 * QUANTITY_SCALE);
    await approver.approveWastageRequest("waste-controlled", "Incident verified");
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(4_500_000);
    const row = await db
      .prepare("SELECT status,movement_id FROM wastage WHERE tenant_id=? AND id=?")
      .bind(tenantId, "waste-controlled")
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "APPROVED" });
    expect(row?.["movement_id"]).toBeTruthy();
  });

  it("approves breakage without creating a food inventory movement", async () => {
    await seedBeef(service);
    await opening(service, "breakage-opening", 2 * QUANTITY_SCALE, 50_000);
    const recorder = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryWastageRecord]),
    );
    await recorder.requestBreakage({
      id: "breakage-controlled",
      branchId,
      warehouseId,
      assetName: "Serving plate",
      quantityMicro: 2 * QUANTITY_SCALE,
      unitLabel: "pcs",
      reasonCode: "DAMAGED",
      estimatedValueMinor: 80_000,
      idempotencyKey: "breakage-controlled",
      businessDate: "2026-08-30",
    });
    const approver = new InventoryIntelligenceService(
      db,
      actor(tenantId, [permissions.inventoryWastageApprove]),
    );
    await approver.approveBreakageRequest("breakage-controlled", "Supervisor verified damage");
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(2 * QUANTITY_SCALE);
    const movements = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=? AND source_type='BREAKAGE'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    expect(movements?.count).toBe(0);
  });

  it("prevents archiving a live warehouse and archives an unused warehouse safely", async () => {
    await seedBeef(service);
    await opening(service, "warehouse-guard-opening", QUANTITY_SCALE, 50_000);
    await expect(service.archiveWarehouse(warehouseId, "No longer required")).rejects.toThrow(
      "Warehouse cannot be archived",
    );

    const created = await service.createWarehouse({
      id: "warehouse-unused",
      branchId,
      code: "UNUSED",
      name: "Unused store",
      locationType: "OTHER",
    });
    expect(created).toMatchObject({ id: "warehouse-unused", active: true });
    await expect(
      service.archiveWarehouse("warehouse-unused", "Configuration cleanup"),
    ).resolves.toMatchObject({ status: "ARCHIVED", duplicate: false });
    const warehouse = await db
      .prepare("SELECT active,archived_at FROM warehouses WHERE tenant_id=? AND id=?")
      .bind(tenantId, "warehouse-unused")
      .first<Record<string, unknown>>();
    expect(warehouse?.["active"]).toBe(0);
    expect(warehouse?.["archived_at"]).toBeTruthy();
  });

  it("lists PAR shortfalls from authoritative available stock", async () => {
    await seedBeef(service);
    await opening(service, "par-control-opening", 4 * QUANTITY_SCALE, 50_000);
    await service.upsertParPolicy({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      reorderPointMicro: 5 * QUANTITY_SCALE,
      targetQuantityMicro: 8 * QUANTITY_SCALE,
      safetyStockMicro: QUANTITY_SCALE,
      maximumQuantityMicro: 10 * QUANTITY_SCALE,
    });
    const rows = await service.listParPolicies(branchId);
    expect(rows).toEqual([
      expect.objectContaining({
        inventory_item_id: "item-beef",
        on_hand_minor: 4 * QUANTITY_SCALE,
        target_quantity_minor: 8 * QUANTITY_SCALE,
        suggested_quantity_minor: 4 * QUANTITY_SCALE,
        suggested_value_minor: 200_000,
      }),
    ]);
  });

  it("moves stock only after transfer approval, dispatch and destination receipt", async () => {
    await seedBeef(service);
    await opening(service, "staged-transfer-opening", 6 * QUANTITY_SCALE, 50_000);
    const stamp = "2026-08-01T00:00:00.000Z";
    db.sqlite
      .prepare(
        `INSERT INTO legal_entities
          (tenant_id,id,code,legal_name,trading_name,registration_reference,tax_identifiers_json,
           country_code,base_currency,fiscal_configuration_json,accounting_configuration_json,
           status,created_by,created_at,updated_by,updated_at)
         VALUES (?,?,?,?,NULL,NULL,'{}','KE','KES','{}','{}','ACTIVE',?,?,?,?)`,
      )
      .run(
        tenantId,
        "legal-main",
        "LEGAL-MAIN",
        "Main legal entity",
        "user-test",
        stamp,
        "user-test",
        stamp,
      );
    for (const [nodeId, code, branch] of [
      ["node-branch-a", "NODE-A", branchId],
      ["node-branch-b", "NODE-B", secondBranchId],
    ] as const) {
      db.sqlite
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,
             warehouse_id,status,effective_from,effective_to,timezone,currency,metadata_json,
             created_by,created_at,updated_by,updated_at,version)
           VALUES (?,?,'BRANCH',?,?,NULL,?,NULL,?,NULL,'ACTIVE',?,NULL,'Africa/Nairobi','KES','{}',
                   ?,?,?,?,1)`,
        )
        .run(
          tenantId,
          nodeId,
          code,
          branch,
          "legal-main",
          branch,
          stamp,
          "user-test",
          stamp,
          "user-test",
          stamp,
        );
    }

    const requested = await service.requestStockTransfer({
      id: "transfer-controlled",
      transferNumber: "TRF-CONTROLLED",
      sourceBranchId: branchId,
      sourceWarehouseId: warehouseId,
      destinationBranchId: secondBranchId,
      destinationWarehouseId: secondWarehouseId,
      idempotencyKey: "transfer-controlled",
      lines: [{ inventoryItemId: "item-beef", quantityMicro: 2 * QUANTITY_SCALE }],
    });
    expect(requested).toMatchObject({ status: "REQUESTED", duplicate: false });
    expect((await inventoryBalance(db, "item-beef", branchId, warehouseId)).quantity_minor).toBe(
      6 * QUANTITY_SCALE,
    );
    expect(await inventoryBalance(db, "item-beef", secondBranchId, secondWarehouseId)).toBeNull();

    await service.approveStockTransfer("transfer-controlled", "Supervisor approved");
    expect((await inventoryBalance(db, "item-beef", branchId, warehouseId)).quantity_minor).toBe(
      6 * QUANTITY_SCALE,
    );

    const dispatched = await service.dispatchApprovedTransfer("transfer-controlled", {
      idempotencyKey: "transfer-controlled-dispatch",
      businessDate: "2026-08-30",
    });
    expect(dispatched).toMatchObject({ status: "IN_TRANSIT", duplicate: false });
    expect((await inventoryBalance(db, "item-beef", branchId, warehouseId)).quantity_minor).toBe(
      4 * QUANTITY_SCALE,
    );
    expect(await inventoryBalance(db, "item-beef", secondBranchId, secondWarehouseId)).toBeNull();

    const detail = await service.transferDetail("transfer-controlled");
    const line = detail.lines[0] as Record<string, unknown>;
    await service.receiveTransferShipment({
      shipmentId: String(dispatched.shipmentId),
      receiptReference: "RCV-CONTROLLED",
      idempotencyKey: "transfer-controlled-receipt",
      businessDate: "2026-08-30",
      final: true,
      lines: [
        {
          transferLineId: String(line["id"]),
          receivedQuantityMicro: 2 * QUANTITY_SCALE,
        },
      ],
    });
    expect(
      (await inventoryBalance(db, "item-beef", secondBranchId, secondWarehouseId)).quantity_minor,
    ).toBe(2 * QUANTITY_SCALE);
    const finalTransfer = await service.transferDetail("transfer-controlled");
    expect(finalTransfer.transfer).toMatchObject({ status: "RECEIVED" });
  });

  it("blocks transfer dispatch when source available stock no longer covers the request", async () => {
    await seedBeef(service);
    await opening(service, "staged-transfer-insufficient-opening", QUANTITY_SCALE, 50_000);
    const stamp = "2026-08-01T00:00:00.000Z";
    db.sqlite
      .prepare(
        `INSERT INTO legal_entities
          (tenant_id,id,code,legal_name,trading_name,registration_reference,tax_identifiers_json,
           country_code,base_currency,fiscal_configuration_json,accounting_configuration_json,
           status,created_by,created_at,updated_by,updated_at)
         VALUES (?,?,?,?,NULL,NULL,'{}','KE','KES','{}','{}','ACTIVE',?,?,?,?)`,
      )
      .run(
        tenantId,
        "legal-transfer-guard",
        "LEGAL-GUARD",
        "Transfer legal entity",
        "user-test",
        stamp,
        "user-test",
        stamp,
      );
    for (const [nodeId, code, branch] of [
      ["node-guard-a", "GUARD-A", branchId],
      ["node-guard-b", "GUARD-B", secondBranchId],
    ] as const) {
      db.sqlite
        .prepare(
          `INSERT INTO enterprise_nodes
            (tenant_id,id,node_type,code,name,parent_id,legal_entity_id,brand_id,branch_id,
             warehouse_id,status,effective_from,effective_to,timezone,currency,metadata_json,
             created_by,created_at,updated_by,updated_at,version)
           VALUES (?,?,'BRANCH',?,?,NULL,?,NULL,?,NULL,'ACTIVE',?,NULL,'Africa/Nairobi','KES','{}',
                   ?,?,?,?,1)`,
        )
        .run(
          tenantId,
          nodeId,
          code,
          branch,
          "legal-transfer-guard",
          branch,
          stamp,
          "user-test",
          stamp,
          "user-test",
          stamp,
        );
    }
    await service.requestStockTransfer({
      id: "transfer-too-large",
      transferNumber: "TRF-TOO-LARGE",
      sourceBranchId: branchId,
      sourceWarehouseId: warehouseId,
      destinationBranchId: secondBranchId,
      destinationWarehouseId: secondWarehouseId,
      idempotencyKey: "transfer-too-large",
      lines: [{ inventoryItemId: "item-beef", quantityMicro: 2 * QUANTITY_SCALE }],
    });
    await service.approveStockTransfer("transfer-too-large", "Approved before stock changed");
    await expect(
      service.dispatchApprovedTransfer("transfer-too-large", {
        idempotencyKey: "transfer-too-large-dispatch",
        businessDate: "2026-08-30",
      }),
    ).rejects.toThrow("source available stock is insufficient");
    expect((await inventoryBalance(db, "item-beef", branchId, warehouseId)).quantity_minor).toBe(
      QUANTITY_SCALE,
    );
  });

  it("records wastage once with an evidence-backed cost", async () => {
    await seedBeef(service);
    await opening(service, "opening-waste", 5 * QUANTITY_SCALE, 60_000);
    const first = await service.recordWastage({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: 500_000,
      businessDate: "2026-08-30",
      reasonCode: "SPOILAGE",
      idempotencyKey: "waste-a",
    });
    const retry = await service.recordWastage({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: 500_000,
      businessDate: "2026-08-30",
      reasonCode: "SPOILAGE",
      idempotencyKey: "waste-a",
    });
    expect(first).toMatchObject({ duplicate: false, estimatedCostMinor: 30_000 });
    expect(retry.duplicate).toBe(true);
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(4_500_000);
  });

  it("posts supplier payable with configured balanced accounts and a price variance", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-invoice",
      "PO-INVOICE",
      "REJECT_OVER_RECEIPT",
    );
    const receipt = await receiveQuantity(
      service,
      po.id,
      "invoice-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "invoice-receipt",
      250_000,
    );
    const result = await service.postSupplierInvoice({
      id: "supplier-invoice-a",
      branchId,
      supplierId: fixture.supplierId,
      purchaseOrderId: po.id,
      goodsReceiptId: receipt.id,
      invoiceNumber: "SUP-INV-1",
      invoiceDate: "2026-08-30",
      currency: "KES",
      subtotalMinor: 250_000,
      taxMinor: 0,
      totalMinor: 250_000,
    });
    expect(result.matchStatus).toBe("PRICE_VARIANCE");
    const totals = await db
      .prepare(
        `SELECT SUM(debit_minor) AS debit,SUM(credit_minor) AS credit
         FROM journal_lines WHERE tenant_id=? AND journal_entry_id=?`,
      )
      .bind(tenantId, result.journalId)
      .first<{ debit: number; credit: number }>();
    expect(totals).toEqual({ debit: 250_000, credit: 250_000 });
  });

  it("matches an invoice to its actual partial delivery rather than the full PO", async () => {
    const fixture = await seedProcurement(service);
    const po = await service.createPurchaseOrder({
      id: "po-partial-invoice",
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      purchaseOrderNumber: "PO-PARTIAL-INVOICE",
      currency: "KES",
      lines: [
        {
          id: "partial-invoice-line",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: 2 * QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    });
    await service.approvePurchaseOrder(po.id, "Partial invoice test");
    const receipt = await receiveQuantity(
      service,
      po.id,
      "partial-invoice-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "partial-invoice-receipt",
    );
    const invoice = await service.postSupplierInvoice({
      branchId,
      supplierId: fixture.supplierId,
      purchaseOrderId: po.id,
      goodsReceiptId: receipt.id,
      invoiceNumber: "SUP-INV-PARTIAL",
      invoiceDate: "2026-08-30",
      currency: "KES",
      subtotalMinor: 240_000,
      taxMinor: 0,
      totalMinor: 240_000,
    });
    expect(invoice.matchStatus).toBe("MATCHED");
    const match = await db
      .prepare(
        `SELECT ordered_total_minor,received_total_minor,invoiced_total_minor,variance_minor
         FROM procurement_matches WHERE tenant_id=? AND supplier_invoice_id=?`,
      )
      .bind(tenantId, invoice.id)
      .first<{
        ordered_total_minor: number;
        received_total_minor: number;
        invoiced_total_minor: number;
        variance_minor: number;
      }>();
    expect(match).toEqual({
      ordered_total_minor: 240_000,
      received_total_minor: 240_000,
      invoiced_total_minor: 240_000,
      variance_minor: 0,
    });
  });

  it("blocks rebilling a disputed receipt to avoid duplicated supplier payables", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-disputed-invoice",
      "PO-DISPUTED-INVOICE",
      "REJECT_OVER_RECEIPT",
    );
    const receipt = await receiveQuantity(
      service,
      po.id,
      "disputed-invoice-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "disputed-invoice-receipt",
    );
    const stamp = "2026-08-30T00:00:00.000Z";
    await db
      .prepare(
        `INSERT INTO supplier_invoices
         (tenant_id,id,branch_id,supplier_id,purchase_order_id,goods_receipt_id,
          invoice_number,invoice_date,currency,subtotal_minor,tax_minor,total_minor,status,
          created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'2026-08-30','KES',240000,0,240000,'DISPUTED',?,?)`,
      )
      .bind(
        tenantId,
        "invoice-disputed-existing",
        branchId,
        fixture.supplierId,
        po.id,
        receipt.id,
        "SUP-INV-DISPUTED-EXISTING",
        stamp,
        stamp,
      )
      .run();
    await expect(
      service.postSupplierInvoice({
        branchId,
        supplierId: fixture.supplierId,
        purchaseOrderId: po.id,
        goodsReceiptId: receipt.id,
        invoiceNumber: "SUP-INV-DISPUTED-SECOND",
        invoiceDate: "2026-08-30",
        currency: "KES",
        subtotalMinor: 240_000,
        taxMinor: 0,
        totalMinor: 240_000,
      }),
    ).rejects.toThrow("already linked");
  });

  it("matches supplier invoice subtotal and tax independently", async () => {
    const fixture = await seedProcurement(service);
    const po = await service.createPurchaseOrder({
      id: "po-tax-match",
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      purchaseOrderNumber: "PO-TAX-MATCH",
      currency: "KES",
      lines: [
        {
          id: "po-tax-match-line",
          inventoryItemId: fixture.itemId,
          purchaseUnitId: "unit-box",
          conversionId: "conversion-box-soda",
          quantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 240_000,
          taxMinor: 38_400,
        },
      ],
    });
    await service.approvePurchaseOrder(po.id, "Tax match test");
    const receipt = await receiveQuantity(
      service,
      po.id,
      "po-tax-match-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "tax-match-receipt",
      240_000,
    );

    const result = await service.postSupplierInvoice({
      id: "supplier-invoice-tax-match",
      branchId,
      supplierId: fixture.supplierId,
      purchaseOrderId: po.id,
      goodsReceiptId: receipt.id,
      invoiceNumber: "SUP-INV-TAX-MATCH",
      invoiceDate: "2026-08-30",
      currency: "KES",
      subtotalMinor: 240_000,
      taxMinor: 38_400,
      totalMinor: 278_400,
    });

    expect(result.matchStatus).toBe("MATCHED");
    const journalLines = await db
      .prepare(
        `SELECT account_id,debit_minor,credit_minor
         FROM journal_lines WHERE tenant_id=? AND journal_entry_id=? ORDER BY line_number`,
      )
      .bind(tenantId, result.journalId)
      .all<{ account_id: string; debit_minor: number; credit_minor: number }>();
    expect(journalLines.results).toEqual([
      { account_id: "account-inventory", debit_minor: 240_000, credit_minor: 0 },
      { account_id: "account-tax", debit_minor: 38_400, credit_minor: 0 },
      { account_id: "account-payable", debit_minor: 0, credit_minor: 278_400 },
    ]);
  });

  it("produces deterministic forecasts and explained purchase recommendations", () => {
    const samples = [10, 12, 11, 13].map((value) => value * QUANTITY_SCALE);
    const first = deterministicForecast({ method: "WEIGHTED_MOVING_AVERAGE", samples });
    const second = deterministicForecast({ method: "WEIGHTED_MOVING_AVERAGE", samples });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ quantityMicro: 11_900_000, quality: "LOW" });
    const recommendation = buildPurchaseRecommendation({
      forecastConsumptionMicro: 20_000_000,
      safetyStockMicro: 5_000_000,
      targetClosingStockMicro: 3_000_000,
      onHandMicro: 6_000_000,
      incomingConfirmedMicro: 2_000_000,
      purchaseConversionNumerator: 24,
      purchaseConversionDenominator: 1,
      leadTimeDays: 2,
      asOfDate: "2026-08-31",
    });
    expect(recommendation).toMatchObject({
      recommendedBaseMicro: 20_000_000,
      recommendedPurchaseUnitMicro: QUANTITY_SCALE,
      recommendedOrderDate: "2026-08-29",
    });
  });

  it("keeps unsupported food-cost bridge residual explicitly unexplained", () => {
    const bridge = calculateFoodCostBridge({
      priorCostMinor: 3_120_000,
      currentCostMinor: 3_630_000,
      supportedDrivers: [
        { code: "SUPPLIER_PRICE", amountMinor: 180_000 },
        { code: "WASTAGE", amountMinor: 90_000 },
        { code: "YIELD", amountMinor: 70_000 },
      ],
    });
    expect(bridge.unexplainedMinor).toBe(170_000);
  });

  it("recalculates actual-versus-theoretical usage, recommendations and authoritative 86 state", async () => {
    await seedBeef(service);
    await opening(service, "opening-analytics", 10 * QUANTITY_SCALE, 58_200);
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -4_500_000,
      sourceType: "ORDER",
      sourceId: "order-analytics",
      idempotencyKey: "sale-analytics",
      businessDate: new Date().toISOString().slice(0, 10),
    });
    await service.recordWastage({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: 1_500_000,
      businessDate: new Date().toISOString().slice(0, 10),
      reasonCode: "SPOILAGE",
      idempotencyKey: "waste-analytics",
    });
    await db
      .prepare(
        `INSERT INTO inventory_par_policies
          (tenant_id,id,branch_id,warehouse_id,inventory_item_id,target_quantity_minor,
           reorder_point_minor,safety_stock_minor,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        tenantId,
        "par-analytics",
        branchId,
        warehouseId,
        "item-beef",
        8 * QUANTITY_SCALE,
        5 * QUANTITY_SCALE,
        2 * QUANTITY_SCALE,
        new Date().toISOString(),
      )
      .run();
    await service.createSupplier({
      id: "supplier-beef",
      code: "SUP-BEEF",
      name: "Configured supplier",
      leadTimeDays: 2,
    });
    await db
      .prepare("UPDATE inventory_items SET preferred_supplier_id=? WHERE tenant_id=? AND id=?")
      .bind("supplier-beef", tenantId, "item-beef")
      .run();
    await service.createRecipe({
      id: "recipe-86",
      menuItemId: "menu-86",
      name: "Availability recipe",
    });
    await service.createRecipeVersion({
      recipeId: "recipe-86",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        { inventoryItemId: "item-beef", quantityMicro: QUANTITY_SCALE, unitId: "unit-kg" },
      ],
    });
    const result = await service.recalculateTenant(branchId);
    expect(result.forecasts).toBeGreaterThan(0);
    const consumption = await db
      .prepare(
        `SELECT theoretical_quantity_minor,actual_quantity_minor,explained_quantity_minor,
                unexplained_quantity_minor,variance_value_minor
         FROM inventory_consumption_periods WHERE tenant_id=? AND branch_id=? AND inventory_item_id=?`,
      )
      .bind(tenantId, branchId, "item-beef")
      .first<{
        theoretical_quantity_minor: number;
        actual_quantity_minor: number;
        explained_quantity_minor: number;
        unexplained_quantity_minor: number;
        variance_value_minor: number;
      }>();
    expect(consumption).toMatchObject({
      theoretical_quantity_minor: 4_500_000,
      actual_quantity_minor: 6_000_000,
      explained_quantity_minor: 1_500_000,
      unexplained_quantity_minor: 0,
      variance_value_minor: 87_300,
    });
    const availability = await db
      .prepare(
        "SELECT available_portions,available,sync_status FROM menu_inventory_availability WHERE tenant_id=? AND branch_id=? AND menu_item_id=?",
      )
      .bind(tenantId, branchId, "menu-86")
      .first<{ available_portions: number; available: number; sync_status: string }>();
    expect(availability).toEqual({ available_portions: 4, available: 1, sync_status: "PENDING" });
  });

  it("blocks backdated inventory mutation in a closed period", async () => {
    await seedBeef(service);
    await db
      .prepare(
        `INSERT INTO day_closes
          (tenant_id,id,branch_id,business_date,status,version,payload_json,created_at,updated_at)
         VALUES (?,?,?,?, 'CLOSED',1,'{}',?,?)`,
      )
      .bind(
        tenantId,
        "close-a",
        branchId,
        "2026-08-29",
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run();
    const restricted = new InventoryIntelligenceService(
      db,
      actor(
        tenantId,
        allPermissionCodes.filter((permission) => permission !== "dayclose.reopen"),
      ),
    );
    await expect(
      restricted.appendMovement({
        branchId,
        warehouseId,
        inventoryItemId: "item-beef",
        movementType: "OPENING",
        quantityBaseMicro: QUANTITY_SCALE,
        unitCostMinor: 50_000,
        totalCostMinor: 50_000,
        sourceType: "OPENING",
        sourceId: "closed-opening",
        idempotencyKey: "closed-opening",
        businessDate: "2026-08-29",
      }),
    ).rejects.toThrow("closed business date");
  });

  it("versions item conversions by effective date and rejects incompatible dimensions", async () => {
    await seedUnits(service);
    await service.createInventoryItem({
      id: "item-crate",
      code: "CRATE",
      name: "Crated item",
      baseUnitId: "unit-piece",
      purchaseUnitId: "unit-box",
    });
    await service.createItemConversion({
      inventoryItemId: "item-crate",
      fromUnitId: "unit-box",
      toUnitId: "unit-piece",
      factorNumerator: 24,
      factorDenominator: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: "2026-06-30T23:59:59.000Z",
    });
    await service.createItemConversion({
      inventoryItemId: "item-crate",
      fromUnitId: "unit-box",
      toUnitId: "unit-piece",
      factorNumerator: 30,
      factorDenominator: 1,
      effectiveFrom: "2026-07-01T00:00:00.000Z",
    });
    expect(
      await service.convertItemQuantity(
        "item-crate",
        QUANTITY_SCALE,
        "unit-box",
        "unit-piece",
        "2026-05-01T00:00:00.000Z",
      ),
    ).toBe(24 * QUANTITY_SCALE);
    expect(
      await service.convertItemQuantity(
        "item-crate",
        QUANTITY_SCALE,
        "unit-box",
        "unit-piece",
        "2026-08-01T00:00:00.000Z",
      ),
    ).toBe(30 * QUANTITY_SCALE);
    await expect(
      service.convertItemQuantity("item-crate", QUANTITY_SCALE, "unit-kg", "unit-piece"),
    ).rejects.toThrow("item-specific conversion");
  });

  it("costs only the sub-recipe quantity consumed by a parent recipe", async () => {
    await seedBeef(service);
    await opening(service, "sub-opening", 20 * QUANTITY_SCALE, 60_000);
    await service.createInventoryItem({
      id: "item-sauce",
      code: "SAUCE",
      name: "Prepared sauce",
      baseUnitId: "unit-kg",
    });
    await service.createRecipe({
      id: "recipe-sauce",
      productionItemId: "item-sauce",
      name: "Sauce batch",
    });
    const sub = await service.createRecipeVersion({
      recipeId: "recipe-sauce",
      version: 1,
      yieldQuantityMicro: 2 * QUANTITY_SCALE,
      yieldUnitId: "unit-kg",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        { inventoryItemId: "item-beef", quantityMicro: 2 * QUANTITY_SCALE, unitId: "unit-kg" },
      ],
    });
    expect(await service.recipeCostMinor(sub.id)).toBe(120_000);
    await service.createRecipe({
      id: "recipe-parent",
      menuItemId: "menu-parent",
      name: "Parent dish",
    });
    const parent = await service.createRecipeVersion({
      recipeId: "recipe-parent",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [{ subRecipeId: "recipe-sauce", quantityMicro: 500_000, unitId: "unit-kg" }],
    });
    expect(await service.recipeCostMinor(parent.id)).toBe(30_000);
  });

  it("stores deterministic PAR policy and exposes it through bounded read models", async () => {
    await seedBeef(service);
    await opening(service, "par-opening", 4 * QUANTITY_SCALE, 60_000);
    const first = await service.upsertParPolicy({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      reorderPointMicro: 5 * QUANTITY_SCALE,
      targetQuantityMicro: 10 * QUANTITY_SCALE,
      safetyStockMicro: 2 * QUANTITY_SCALE,
      recommendationMode: "RECOMMEND",
    });
    const second = await service.upsertParPolicy({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      reorderPointMicro: 6 * QUANTITY_SCALE,
      targetQuantityMicro: 12 * QUANTITY_SCALE,
      safetyStockMicro: 3 * QUANTITY_SCALE,
      recommendationMode: "RECOMMEND",
    });
    expect(second.id).toBe(first.id);
    const policies = await db
      .prepare(
        "SELECT COUNT(*) AS count,target_quantity_minor FROM inventory_par_policies WHERE tenant_id=? AND inventory_item_id=?",
      )
      .bind(tenantId, "item-beef")
      .first<{ count: number; target_quantity_minor: number }>();
    expect(policies).toEqual({ count: 1, target_quantity_minor: 12 * QUANTITY_SCALE });
    const inventory = await service.listInventory({ branchId, limit: 1 });
    expect(inventory.items[0]).toMatchObject({
      id: "item-beef",
      target_quantity_minor: 12 * QUANTITY_SCALE,
    });
  });

  it("enforces branch authorization on inventory and procurement read models", async () => {
    const restrictedActor = {
      ...actor(),
      assignedBranchIds: [branchId],
      assignedBranches: [{ id: branchId, name: branchId }],
      branchScope: { type: "BRANCH" as const, branchId },
    };
    const restricted = new InventoryIntelligenceService(db, restrictedActor);
    await expect(restricted.listInventory({ branchId: secondBranchId })).rejects.toThrow();
    await expect(restricted.procurementOverview(secondBranchId)).rejects.toThrow();
    await expect(restricted.foodCostControlCentre(secondBranchId)).rejects.toThrow();
  });

  it("deduplicates simultaneous goods receipt submissions", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-concurrent",
      "PO-CONCURRENT",
      "REJECT_OVER_RECEIPT",
    );
    const input = {
      id: "receipt-concurrent",
      branchId,
      warehouseId,
      purchaseOrderId: po.id,
      supplierId: fixture.supplierId,
      receiptNumber: "GR-CONCURRENT",
      idempotencyKey: "receipt-concurrent",
      businessDate: "2026-08-30",
      lines: [
        {
          purchaseOrderLineId: "concurrent-line",
          receivedPurchaseQuantityMicro: QUANTITY_SCALE,
          acceptedPurchaseQuantityMicro: QUANTITY_SCALE,
          unitPriceMinor: 240_000,
        },
      ],
    };
    const results = await Promise.all([service.receiveGoods(input), service.receiveGoods(input)]);
    expect(results.filter((result) => result.duplicate)).toHaveLength(1);
    const movement = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(tenantId, "goods-receipt:receipt-concurrent:concurrent-line")
      .first<{ count: number }>();
    expect(movement?.count).toBe(1);
  });

  it("deduplicates simultaneous production and transfer retries", async () => {
    await seedBeef(service);
    await opening(service, "concurrency-opening", 10 * QUANTITY_SCALE, 60_000);
    await service.createInventoryItem({
      id: "item-output-concurrent",
      code: "OUT-C",
      name: "Prepared output",
      baseUnitId: "unit-kg",
    });
    await service.createRecipe({
      id: "recipe-concurrent",
      productionItemId: "item-output-concurrent",
      name: "Concurrent batch",
    });
    const version = await service.createRecipeVersion({
      recipeId: "recipe-concurrent",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-kg",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        { inventoryItemId: "item-beef", quantityMicro: QUANTITY_SCALE, unitId: "unit-kg" },
      ],
    });
    const productionInput = {
      id: "batch-concurrent",
      branchId,
      warehouseId,
      recipeVersionId: version.id,
      outputItemId: "item-output-concurrent",
      plannedQuantityMicro: QUANTITY_SCALE,
      actualOutputQuantityMicro: QUANTITY_SCALE,
      idempotencyKey: "batch-concurrent",
      businessDate: "2026-08-30",
    } as const;
    const production = await Promise.all([
      service.completeProduction(productionInput),
      service.completeProduction(productionInput),
    ]);
    expect(production.filter((result) => result.duplicate)).toHaveLength(1);
    const transferInput = {
      id: "transfer-concurrent",
      transferNumber: "TR-CONCURRENT",
      sourceBranchId: branchId,
      sourceWarehouseId: warehouseId,
      destinationBranchId: secondBranchId,
      destinationWarehouseId: secondWarehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "transfer-concurrent",
      lines: [
        {
          inventoryItemId: "item-beef",
          sentQuantityMicro: QUANTITY_SCALE,
          receivedQuantityMicro: QUANTITY_SCALE,
        },
      ],
    };
    const transfers = await Promise.all([
      service.transferStock(transferInput),
      service.transferStock(transferInput),
    ]);
    expect(transfers.filter((result) => result.duplicate)).toHaveLength(1);
    const transferMovements = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=? AND source_type='STOCK_TRANSFER' AND source_id=?",
      )
      .bind(tenantId, "transfer-concurrent")
      .first<{ count: number }>();
    expect(transferMovements?.count).toBe(2);
  });

  it("executes authoritative control-centre SQL after recalculation", async () => {
    await seedBeef(service);
    await opening(service, "read-model-opening", 3 * QUANTITY_SCALE, 60_000);
    await service.recalculateTenant(branchId);
    const summary = await service.summary(branchId);
    const control = await service.foodCostControlCentre(branchId, 10);
    const procurement = await service.procurementOverview(branchId, 10);
    expect(summary.inventoryValueMinor).toBe(180_000);
    expect(control.branchId).toBe(branchId);
    expect(control.movements).toHaveLength(1);
    expect(procurement.branchId).toBe(branchId);
  });

  it("posts configured perpetual journals and reconciles the inventory subledger to GL", async () => {
    await seedBeef(service);
    await opening(service, "journal-opening", 10 * QUANTITY_SCALE, 60_000);
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -2 * QUANTITY_SCALE,
      sourceType: "ORDER",
      sourceId: "journal-order",
      idempotencyKey: "journal-sale",
      businessDate: "2026-08-30",
    });
    await service.recordWastage({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      quantityMicro: QUANTITY_SCALE,
      businessDate: "2026-08-30",
      reasonCode: "RECORDED_WASTE",
      idempotencyKey: "journal-waste",
    });
    await service.postStockCount({
      branchId,
      warehouseId,
      businessDate: "2026-08-30",
      idempotencyKey: "journal-count",
      approvalReason: "Count reviewed",
      lines: [{ inventoryItemId: "item-beef", countedQuantityMicro: 6_500_000 }],
    });
    const accounts = await db
      .prepare(
        `SELECT jl.account_id,SUM(jl.debit_minor) AS debit,SUM(jl.credit_minor) AS credit
         FROM journal_lines jl JOIN journal_entries je
           ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
         WHERE jl.tenant_id=? AND je.source_type='INVENTORY_MOVEMENT'
         GROUP BY jl.account_id ORDER BY jl.account_id`,
      )
      .bind(tenantId)
      .all<{ account_id: string; debit: number; credit: number }>();
    expect(accounts.results).toEqual([
      { account_id: "account-cogs", debit: 120_000, credit: 0 },
      { account_id: "account-inventory", debit: 600_000, credit: 210_000 },
      { account_id: "account-opening", debit: 0, credit: 600_000 },
      { account_id: "account-variance", debit: 30_000, credit: 0 },
      { account_id: "account-waste", debit: 60_000, credit: 0 },
    ]);
    expect(await service.inventoryGlReconciliation(branchId)).toMatchObject({
      subledgerValueMinor: 390_000,
      glValueMinor: 390_000,
      varianceMinor: 0,
      status: "MATCHED",
    });
  });

  it("records supplier returns once and posts a balanced configured credit note", async () => {
    const fixture = await seedProcurement(service);
    const po = await createApprovedPo(
      service,
      fixture,
      "po-return",
      "PO-RETURN",
      "REJECT_OVER_RECEIPT",
    );
    const receipt = await receiveQuantity(
      service,
      po.id,
      "return-line",
      fixture.supplierId,
      QUANTITY_SCALE,
      "return-receipt",
    );
    await service.postSupplierInvoice({
      branchId,
      supplierId: fixture.supplierId,
      purchaseOrderId: po.id,
      goodsReceiptId: receipt.id,
      invoiceNumber: "SUP-RETURN-INVOICE",
      invoiceDate: "2026-08-30",
      currency: "KES",
      subtotalMinor: 240_000,
      taxMinor: 0,
      totalMinor: 240_000,
    });
    const receiptLine = await db
      .prepare("SELECT id FROM goods_receipt_lines WHERE tenant_id=? AND goods_receipt_id=?")
      .bind(tenantId, receipt.id)
      .first<{ id: string }>();
    const input = {
      branchId,
      warehouseId,
      supplierId: fixture.supplierId,
      goodsReceiptId: receipt.id,
      returnNumber: "SRET-0001",
      businessDate: "2026-08-30",
      idempotencyKey: "supplier-return-once",
      reason: "Quality rejected after inspection",
      lines: [
        {
          goodsReceiptLineId: receiptLine!.id,
          returnedBaseQuantityMicro: 12 * QUANTITY_SCALE,
          reason: "Quality rejected after inspection",
        },
      ],
    };
    const first = await service.returnToSupplier(input);
    const duplicate = await service.returnToSupplier(input);
    expect(first).toMatchObject({
      status: "PENDING_CREDIT",
      totalCostMinor: 120_000,
      duplicate: false,
    });
    expect(duplicate.duplicate).toBe(true);
    await expect(
      service.returnToSupplier({
        ...input,
        idempotencyKey: "supplier-return-overage",
        returnNumber: "SRET-0002",
        lines: [
          {
            goodsReceiptLineId: receiptLine!.id,
            returnedBaseQuantityMicro: 13 * QUANTITY_SCALE,
            reason: "Attempted quantity over received amount",
          },
        ],
      }),
    ).rejects.toThrow("SUPPLIER_RETURN_EXCEEDS_ACCEPTED_QUANTITY");
    expect((await inventoryBalance(db, fixture.itemId)).quantity_minor).toBe(12 * QUANTITY_SCALE);
    const credit = await service.confirmSupplierReturnCredit(first.id, "CN-0001");
    const lines = await db
      .prepare(
        `SELECT account_id,debit_minor,credit_minor FROM journal_lines
         WHERE tenant_id=? AND journal_entry_id=? ORDER BY line_number`,
      )
      .bind(tenantId, credit.journalId)
      .all<{ account_id: string; debit_minor: number; credit_minor: number }>();
    expect(lines.results).toEqual([
      { account_id: "account-payable", debit_minor: 120_000, credit_minor: 0 },
      { account_id: "account-inventory", debit_minor: 0, credit_minor: 120_000 },
    ]);
    expect(await service.inventoryGlReconciliation(branchId)).toMatchObject({
      subledgerValueMinor: 120_000,
      glValueMinor: 120_000,
      status: "MATCHED",
    });
  });

  it("keeps preferred supplier item terms synchronized with inventory replenishment", async () => {
    const fixture = await seedProcurement(service);
    await service.createSupplier({
      id: "supplier-preferred-b",
      code: "SUP-PREF-B",
      name: "Preferred supplier B",
      leadTimeDays: 1,
    });

    await service.linkSupplierItem({
      supplierId: "supplier-preferred-b",
      inventoryItemId: fixture.itemId,
      purchaseUnitId: "unit-box",
      conversionId: "conversion-box-soda",
      contractPriceMinor: 230_000,
      preferred: true,
    });

    const item = await db
      .prepare("SELECT preferred_supplier_id FROM inventory_items WHERE tenant_id=? AND id=?")
      .bind(tenantId, fixture.itemId)
      .first<{ preferred_supplier_id: string | null }>();
    expect(item?.preferred_supplier_id).toBe("supplier-preferred-b");

    const links = await db
      .prepare(
        `SELECT supplier_id,preferred,contract_price_minor
         FROM supplier_items
         WHERE tenant_id=? AND inventory_item_id=? AND active=1
         ORDER BY supplier_id`,
      )
      .bind(tenantId, fixture.itemId)
      .all<{ supplier_id: string; preferred: number; contract_price_minor: number | null }>();
    expect(
      links.results?.filter((row) => row.preferred === 1).map((row) => row.supplier_id),
    ).toEqual(["supplier-preferred-b"]);

    const relinked = await service.linkSupplierItem({
      supplierId: "supplier-preferred-b",
      inventoryItemId: fixture.itemId,
      purchaseUnitId: "unit-box",
      conversionId: "conversion-box-soda",
      contractPriceMinor: 225_000,
      preferred: true,
    });
    const original = await db
      .prepare(
        `SELECT id FROM supplier_items
         WHERE tenant_id=? AND supplier_id=? AND inventory_item_id=? AND purchase_unit_id=?`,
      )
      .bind(tenantId, "supplier-preferred-b", fixture.itemId, "unit-box")
      .first<{ id: string }>();
    expect(relinked.id).toBe(original?.id);

    const updated = await db
      .prepare(
        `SELECT COUNT(*) AS count,MAX(contract_price_minor) AS contract_price_minor
         FROM supplier_items
         WHERE tenant_id=? AND supplier_id=? AND inventory_item_id=? AND purchase_unit_id=?`,
      )
      .bind(tenantId, "supplier-preferred-b", fixture.itemId, "unit-box")
      .first<{ count: number; contract_price_minor: number }>();
    expect(updated).toEqual({ count: 1, contract_price_minor: 225_000 });

    await service.linkSupplierItem({
      supplierId: "supplier-preferred-b",
      inventoryItemId: fixture.itemId,
      purchaseUnitId: "unit-box",
      conversionId: "conversion-box-soda",
      contractPriceMinor: 225_000,
      preferred: false,
    });
    const unpreferred = await db
      .prepare("SELECT preferred_supplier_id FROM inventory_items WHERE tenant_id=? AND id=?")
      .bind(tenantId, fixture.itemId)
      .first<{ preferred_supplier_id: string | null }>();
    expect(unpreferred?.preferred_supplier_id).toBeNull();
  });

  it("compares supplier quotes without auto-selecting and records optional portion checks", async () => {
    const fixture = await seedProcurement(service);
    await service.createSupplier({
      id: "supplier-b",
      code: "SUP-B",
      name: "Alternative supplier",
      leadTimeDays: 1,
    });
    const requisition = await service.createPurchaseRequisition({
      branchId,
      warehouseId,
      requisitionNumber: "REQ-QUOTE",
      sourceType: "MANUAL_REQUEST",
      lines: [
        {
          inventoryItemId: fixture.itemId,
          requestedQuantityMicro: QUANTITY_SCALE,
          unitId: "unit-box",
        },
      ],
    });
    await service.createPurchaseQuote({
      requisitionId: requisition.id,
      supplierId: fixture.supplierId,
      currency: "KES",
      leadTimeDays: 2,
      deliveryFeeMinor: 5_000,
      lines: [
        {
          inventoryItemId: fixture.itemId,
          quantityMicro: QUANTITY_SCALE,
          unitId: "unit-box",
          unitPriceMinor: 240_000,
        },
      ],
    });
    await service.createPurchaseQuote({
      requisitionId: requisition.id,
      supplierId: "supplier-b",
      currency: "KES",
      leadTimeDays: 1,
      lines: [
        {
          inventoryItemId: fixture.itemId,
          quantityMicro: QUANTITY_SCALE,
          unitId: "unit-box",
          unitPriceMinor: 250_000,
        },
      ],
    });
    const comparison = await service.comparePurchaseQuotes(requisition.id);
    expect(comparison.quotes).toMatchObject([
      { supplier_id: fixture.supplierId, total_minor: 245_000, lead_time_days: 2 },
      { supplier_id: "supplier-b", total_minor: 250_000, lead_time_days: 1 },
    ]);
    const standard = await service.createPortionStandard({
      branchId,
      menuItemId: "menu-portion",
      expectedQuantityMicro: 340_000,
      unitId: "unit-g",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    });
    expect(
      await service.recordPortionCheck({
        branchId,
        portionStandardId: standard.id,
        actualQuantityMicro: 365_000,
        stationId: "station-kitchen",
      }),
    ).toMatchObject({ expectedQuantityMicro: 340_000, varianceQuantityMicro: 25_000 });
  });

  it("derives theoretical usage independently from dated sales, recipes and modifier recipes", async () => {
    await seedBeef(service);
    await opening(service, "theoretical-opening", 10 * QUANTITY_SCALE, 60_000);
    await service.createRecipe({ id: "recipe-sale", menuItemId: "menu-sale", name: "Sold dish" });
    await service.createRecipeVersion({
      recipeId: "recipe-sale",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [{ inventoryItemId: "item-beef", quantityMicro: 250_000, unitId: "unit-kg" }],
    });
    await service.createRecipe({
      id: "recipe-modifier",
      menuItemId: "modifier-extra",
      name: "Configured extra",
    });
    await service.createRecipeVersion({
      recipeId: "recipe-modifier",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [{ inventoryItemId: "item-beef", quantityMicro: 50_000, unitId: "unit-kg" }],
    });
    const stamp = new Date().toISOString();
    const businessDate = stamp.slice(0, 10);
    db.sqlite
      .prepare(
        `INSERT INTO invoices
        (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,paid_minor,version,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,'{}',?,?)`,
      )
      .run(
        tenantId,
        "invoice-theoretical",
        branchId,
        "INV-THEORETICAL",
        "PAID",
        businessDate,
        "KES",
        10_000,
        10_000,
        stamp,
        stamp,
      );
    db.sqlite
      .prepare(
        `INSERT INTO invoice_lines
        (tenant_id,id,invoice_id,description,quantity_minor,unit_price_minor,tax_minor,amount_minor,payload_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        tenantId,
        "invoice-line-theoretical",
        "invoice-theoretical",
        "Configured dish",
        10 * QUANTITY_SCALE,
        1_000,
        0,
        10_000,
        JSON.stringify({ productId: "menu-sale", modifierIds: ["modifier-extra"] }),
      );
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -3 * QUANTITY_SCALE,
      sourceType: "ORDER",
      sourceId: "order-theoretical",
      idempotencyKey: "sale-theoretical-independent",
      businessDate,
    });
    await service.recalculateTenant(branchId);
    const usage = await db
      .prepare(
        `SELECT theoretical_quantity_minor,actual_quantity_minor,variance_quantity_minor,quality
         FROM inventory_consumption_periods WHERE tenant_id=? AND branch_id=? AND inventory_item_id=?`,
      )
      .bind(tenantId, branchId, "item-beef")
      .first<Record<string, unknown>>();
    expect(usage).toMatchObject({
      theoretical_quantity_minor: 3 * QUANTITY_SCALE,
      actual_quantity_minor: 3 * QUANTITY_SCALE,
      variance_quantity_minor: 0,
      quality: "HIGH",
    });
  });

  it("prevents simultaneous stock over-consumption and duplicate count posting", async () => {
    await seedBeef(service);
    await opening(service, "concurrent-sale-opening", QUANTITY_SCALE, 60_000);
    await service.upsertParPolicy({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      reorderPointMicro: 0,
      targetQuantityMicro: 0,
    });
    await db
      .prepare(
        "UPDATE inventory_par_policies SET negative_stock_policy='BLOCK' WHERE tenant_id=? AND inventory_item_id=?",
      )
      .bind(tenantId, "item-beef")
      .run();
    const consume = (key: string) =>
      service.appendMovement({
        branchId,
        warehouseId,
        inventoryItemId: "item-beef",
        movementType: "SALE_CONSUMPTION" as const,
        quantityBaseMicro: -750_000,
        sourceType: "ORDER",
        sourceId: key,
        idempotencyKey: key,
        businessDate: "2026-08-30",
      });
    const sales = await Promise.allSettled([
      consume("concurrent-sale-a"),
      consume("concurrent-sale-b"),
    ]);
    expect(sales.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await inventoryBalance(db, "item-beef")).quantity_minor).toBe(250_000);

    const count = (key: string, quantity: number) =>
      service.postStockCount({
        branchId,
        warehouseId,
        businessDate: "2026-08-31",
        idempotencyKey: key,
        approvalReason: "Concurrent count test",
        lines: [{ inventoryItemId: "item-beef", countedQuantityMicro: quantity }],
      });
    const counts = await Promise.allSettled([count("count-a", 200_000), count("count-b", 150_000)]);
    expect(counts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const posted = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM stock_count_sessions WHERE tenant_id=? AND status='POSTED'",
      )
      .bind(tenantId)
      .first<{ count: number }>();
    expect(posted?.count).toBe(1);
  });

  it("mirrors existing POS stock effects atomically into the authoritative inventory ledger", async () => {
    await seedBeef(service);
    const state = createEmptyTransactionState(tenantId);
    const stamp = new Date().toISOString();
    state.stockMovements.push({
      id: "legacy-pos-sale",
      tenantId,
      branchId,
      branch: branchId,
      sku: "BEEF",
      quantity: -1,
      unit: "kg",
      unitCost: 600,
      type: "SALE_CONSUMPTION",
      reference: "order-pos-sale",
      actor: "Cashier",
      createdAt: stamp,
    });
    const repository = new D1AuthoritativeTransactionRepository(db);
    await repository.saveState(state, actor(), "POS compatibility bridge test");
    const movement = await db
      .prepare(
        `SELECT movement_type,quantity_minor,unit_cost_minor,total_cost_minor,source_id
         FROM inventory_movements WHERE tenant_id=? AND idempotency_key=?`,
      )
      .bind(tenantId, "legacy-stock:legacy-pos-sale")
      .first<Record<string, unknown>>();
    expect(movement).toMatchObject({
      movement_type: "SALE_CONSUMPTION",
      quantity_minor: -QUANTITY_SCALE,
      unit_cost_minor: 60_000,
      total_cost_minor: -60_000,
      source_id: "order-pos-sale",
    });
    const journal = await db
      .prepare(
        `SELECT SUM(debit_minor) AS debit,SUM(credit_minor) AS credit
         FROM journal_lines WHERE tenant_id=? AND journal_entry_id=?`,
      )
      .bind(tenantId, "inventory:legacy:legacy-pos-sale")
      .first<{ debit: number; credit: number }>();
    expect(journal).toEqual({ debit: 60_000, credit: 60_000 });
  });

  it("queues each authoritative 86 and restock availability transition once", async () => {
    await seedBeef(service);
    await opening(service, "auto86-opening", QUANTITY_SCALE, 60_000);
    await service.createRecipe({
      id: "recipe-auto86",
      menuItemId: "menu-auto86",
      name: "Availability test",
    });
    await service.createRecipeVersion({
      recipeId: "recipe-auto86",
      version: 1,
      yieldQuantityMicro: QUANTITY_SCALE,
      yieldUnitId: "unit-piece",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
      components: [
        { inventoryItemId: "item-beef", quantityMicro: QUANTITY_SCALE, unitId: "unit-kg" },
      ],
    });
    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "SALE_CONSUMPTION",
      quantityBaseMicro: -QUANTITY_SCALE,
      sourceType: "ORDER",
      sourceId: "order-last-portion",
      idempotencyKey: "auto86-last-portion",
      businessDate: new Date().toISOString().slice(0, 10),
    });
    await service.recalculateTenant(branchId);
    const queued: Array<{ available: boolean; quantityAvailable: number }> = [];
    const enqueue = async (input: { available: boolean; quantityAvailable: number }) => {
      queued.push(input);
      return { queued: true };
    };
    await queueInventoryAvailabilityChanges({ SERAMET_DB: db }, tenantId, branchId, enqueue);
    await queueInventoryAvailabilityChanges({ SERAMET_DB: db }, tenantId, branchId, enqueue);
    expect(queued).toMatchObject([{ available: false, quantityAvailable: 0 }]);

    await service.appendMovement({
      branchId,
      warehouseId,
      inventoryItemId: "item-beef",
      movementType: "PURCHASE_RECEIPT",
      quantityBaseMicro: 2 * QUANTITY_SCALE,
      unitCostMinor: 60_000,
      totalCostMinor: 120_000,
      sourceType: "GOODS_RECEIPT",
      sourceId: "receipt-restock",
      idempotencyKey: "auto86-restock",
      businessDate: new Date().toISOString().slice(0, 10),
    });
    await service.recalculateTenant(branchId);
    await queueInventoryAvailabilityChanges({ SERAMET_DB: db }, tenantId, branchId, enqueue);
    expect(queued).toMatchObject([
      { available: false, quantityAvailable: 0 },
      { available: true, quantityAvailable: 2 },
    ]);
  });
});

function actor(id = tenantId, permissionCodes = allPermissionCodes): ServerActor {
  const branches = id === tenantId ? [branchId, secondBranchId] : ["branch-tenant-b"];
  return {
    id: `user-${id}`,
    name: "Inventory manager",
    tenantId: id,
    roleIds: ["manager"],
    permissions: [...permissionCodes],
    assignedBranchIds: branches,
    assignedBranches: branches.map((branch) => ({ id: branch, name: branch })),
    branchScope: { type: "ALL" },
    branchId: branches[0]!,
    branch: branches[0]!,
    role: "Manager",
  };
}

function seedFoundation(db: SqliteD1TestDatabase) {
  const stamp = new Date().toISOString();
  for (const [id, slug] of [
    [tenantId, "tenant-a"],
    ["tenant-b", "tenant-b"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .run(id, slug, id, id, stamp, stamp);
  }
  for (const [tenant, branch, warehouse] of [
    [tenantId, branchId, warehouseId],
    [tenantId, secondBranchId, secondWarehouseId],
    ["tenant-b", "branch-tenant-b", "warehouse-tenant-b"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO branches
          (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
         VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')`,
      )
      .run(tenant, branch, branch.toUpperCase(), branch);
    db.sqlite
      .prepare(
        `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
         VALUES (?,?,?,?,?,1,'{}')`,
      )
      .run(tenant, warehouse, branch, warehouse.toUpperCase(), warehouse);
  }
  for (const [id, code, name, type] of [
    ["account-inventory", "INV", "Inventory", "ASSET"],
    ["account-opening", "OPEN", "Opening balance", "EQUITY"],
    ["account-payable", "AP", "Accounts payable", "LIABILITY"],
    ["account-cogs", "COGS", "Cost of goods", "COGS"],
    ["account-waste", "WASTE", "Wastage", "EXPENSE"],
    ["account-variance", "VAR", "Inventory variance", "EXPENSE"],
    ["account-tax", "TAX", "Recoverable tax", "ASSET"],
  ] as const) {
    db.sqlite
      .prepare(
        `INSERT INTO accounts
          (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
         VALUES (?,?,NULL,?,?,?,?,1,'{}')`,
      )
      .run(tenantId, id, code, name, type, "KES");
  }
  db.sqlite
    .prepare(
      `INSERT INTO inventory_account_mappings
        (tenant_id,id,inventory_account_id,opening_balance_account_id,accounts_payable_account_id,cogs_account_id,
         wastage_account_id,variance_account_id,recoverable_tax_account_id,accounting_mode,
          active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'PERPETUAL',1,?,?)`,
    )
    .run(
      tenantId,
      "mapping-default",
      "account-inventory",
      "account-opening",
      "account-payable",
      "account-cogs",
      "account-waste",
      "account-variance",
      "account-tax",
      stamp,
      stamp,
    );
}

async function seedUnits(service: InventoryIntelligenceService) {
  await service.createUnit({
    id: "unit-kg",
    code: "KG",
    name: "Kilogram",
    symbol: "kg",
    dimension: "MASS",
  });
  await service.createUnit({
    id: "unit-g",
    code: "G",
    name: "Gram",
    symbol: "g",
    dimension: "MASS",
    baseScaleNumerator: 1,
    baseScaleDenominator: 1_000,
  });
  await service.createUnit({
    id: "unit-piece",
    code: "PC",
    name: "Piece",
    symbol: "pc",
    dimension: "COUNT",
  });
  await service.createUnit({
    id: "unit-box",
    code: "BOX",
    name: "Box",
    symbol: "box",
    dimension: "OTHER",
  });
}

async function seedBeef(service: InventoryIntelligenceService) {
  await seedUnits(service);
  await service.createInventoryItem({
    id: "item-beef",
    code: "BEEF",
    name: "Beef",
    baseUnitId: "unit-kg",
    purchaseUnitId: "unit-kg",
    defaultWarehouseId: warehouseId,
  });
}

async function seedProcurement(service: InventoryIntelligenceService) {
  await seedUnits(service);
  await service.createInventoryItem({
    id: "item-soda",
    code: "SODA",
    name: "Soda",
    baseUnitId: "unit-piece",
    purchaseUnitId: "unit-box",
    trackExpiry: true,
  });
  await service.createItemConversion({
    id: "conversion-box-soda",
    inventoryItemId: "item-soda",
    fromUnitId: "unit-box",
    toUnitId: "unit-piece",
    factorNumerator: 24,
    factorDenominator: 1,
    effectiveFrom: "2026-08-01T00:00:00.000Z",
  });
  await service.createSupplier({
    id: "supplier-a",
    code: "SUP-A",
    name: "Configured supplier",
    leadTimeDays: 2,
  });
  await service.linkSupplierItem({
    id: "supplier-item-a",
    supplierId: "supplier-a",
    inventoryItemId: "item-soda",
    purchaseUnitId: "unit-box",
    conversionId: "conversion-box-soda",
    preferred: true,
  });
  return { itemId: "item-soda", supplierId: "supplier-a" };
}

async function opening(
  service: InventoryIntelligenceService,
  key: string,
  quantityBaseMicro: number,
  unitCostMinor: number,
) {
  return service.appendMovement({
    branchId,
    warehouseId,
    inventoryItemId: "item-beef",
    movementType: "OPENING",
    quantityBaseMicro,
    unitCostMinor,
    totalCostMinor: quantityCostMinor(quantityBaseMicro, unitCostMinor),
    sourceType: "OPENING",
    sourceId: key,
    idempotencyKey: key,
    businessDate: "2026-08-30",
  });
}

async function createApprovedPo(
  service: InventoryIntelligenceService,
  fixture: { itemId: string; supplierId: string },
  id: string,
  number: string,
  policy: "REJECT_OVER_RECEIPT" | "ALLOW_WITH_APPROVAL" | "ALLOW_WITH_TOLERANCE",
  toleranceBps?: number,
) {
  const po = await service.createPurchaseOrder({
    id,
    branchId,
    warehouseId,
    supplierId: fixture.supplierId,
    purchaseOrderNumber: number,
    currency: "KES",
    overReceiptPolicy: policy,
    ...(toleranceBps === undefined ? {} : { overReceiptToleranceBps: toleranceBps }),
    lines: [
      {
        id: id.replace("po-", "") + "-line",
        inventoryItemId: fixture.itemId,
        purchaseUnitId: "unit-box",
        conversionId: "conversion-box-soda",
        quantityMicro: QUANTITY_SCALE,
        unitPriceMinor: 240_000,
      },
    ],
  });
  await service.approvePurchaseOrder(po.id, "Approved for test");
  return po;
}

async function receiveQuantity(
  service: InventoryIntelligenceService,
  poId: string,
  lineId: string,
  supplierId: string,
  quantityMicro: number,
  idempotencyKey: string,
  unitPriceMinor = 240_000,
) {
  return service.receiveGoods({
    branchId,
    warehouseId,
    purchaseOrderId: poId,
    supplierId,
    receiptNumber: `GR-${idempotencyKey}`,
    idempotencyKey,
    businessDate: "2026-08-30",
    lines: [
      {
        purchaseOrderLineId: lineId,
        receivedPurchaseQuantityMicro: quantityMicro,
        acceptedPurchaseQuantityMicro: quantityMicro,
        unitPriceMinor,
      },
    ],
  });
}

async function inventoryBalance(
  db: SqliteD1TestDatabase,
  itemId: string,
  branch = branchId,
  warehouse = warehouseId,
) {
  return db
    .prepare(
      `SELECT quantity_minor,average_unit_cost_minor,total_value_minor FROM inventory_balances
       WHERE tenant_id=? AND branch_id=? AND warehouse_id=? AND item_id=?`,
    )
    .bind(tenantId, branch, warehouse, itemId)
    .first<{
      quantity_minor: number;
      average_unit_cost_minor: number;
      total_value_minor: number;
    }>() as Promise<{
    quantity_minor: number;
    average_unit_cost_minor: number;
    total_value_minor: number;
  }>;
}

async function poStatus(db: SqliteD1TestDatabase, id: string) {
  const row = await db
    .prepare("SELECT status FROM purchase_orders WHERE tenant_id=? AND id=?")
    .bind(tenantId, id)
    .first<{ status: string }>();
  return row?.status;
}
