import { z, type ZodTypeAny } from "zod";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import type {
  GoodsReceiptInput,
  InventoryMovementInput,
  ProductionCompletionInput,
  ProductionPlanInput,
  PurchaseOrderInput,
  PurchaseRequisitionInput,
  StagedTransferDispatchInput,
  StagedTransferReceiptInput,
  StockCountInput,
  SupplierReturnInput,
} from "@/inventory/types";
import {
  approvalSchema,
  conversionSchema,
  goodsReceiptSchema,
  inventoryAdjustmentRequestSchema,
  inventoryBreakageRequestSchema,
  inventoryCategorySchema,
  inventoryDecisionSchema,
  inventoryItemSchema,
  inventoryWastageRequestSchema,
  movementSchema,
  parPolicySchema,
  portionCheckSchema,
  portionStandardSchema,
  productionBatchCompletionSchema,
  productionCancellationSchema,
  productionPlanSchema,
  productionSchema,
  purchaseQuoteSchema,
  purchaseOrderSchema,
  recipeDefinitionSchema,
  recipeImportSchema,
  recipeSchema,
  recipeVersionSchema,
  requisitionSchema,
  stockCountCancelSchema,
  stockCountDecisionSchema,
  stockCountSaveSchema,
  stockCountSchema,
  stockCountStartSchema,
  stockTransferRequestSchema,
  stagedTransferDispatchSchema,
  stagedTransferReceiptSchema,
  supplierInvoiceSchema,
  supplierItemSchema,
  supplierReturnCreditSchema,
  supplierReturnSchema,
  supplierSchema,
  transferDispatchSchema,
  transferSchema,
  unitSchema,
  warehouseSchema,
} from "@/inventory/schemas";
import { SerametHttpError, authenticateSerametRequest, type SerametEnv } from "@/lib/seramet-auth";
import { authoritativeBusinessDate } from "@/server/business-date";
import { DocumentNumberingService } from "@/server/database/document-numbering";
import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { enqueueInventoryRecalculation } from "@/server/workers";

const movementRequestSchema = movementSchema.extend({
  businessDate: movementSchema.shape.businessDate.optional(),
});
const requisitionRequestSchema = requisitionSchema.extend({
  requisitionNumber: requisitionSchema.shape.requisitionNumber.optional(),
});
const purchaseOrderRequestSchema = purchaseOrderSchema.extend({
  purchaseOrderNumber: purchaseOrderSchema.shape.purchaseOrderNumber.optional(),
});
const goodsReceiptRequestSchema = goodsReceiptSchema.extend({
  receiptNumber: goodsReceiptSchema.shape.receiptNumber.optional(),
  businessDate: goodsReceiptSchema.shape.businessDate.optional(),
});
const productionRequestSchema = productionSchema.extend({
  businessDate: productionSchema.shape.businessDate.optional(),
});
const productionPlanRequestSchema = productionPlanSchema.extend({
  businessDate: productionPlanSchema.shape.businessDate.optional(),
});
const stockCountRequestSchema = stockCountSchema.extend({
  businessDate: stockCountSchema.shape.businessDate.optional(),
});
const transferRequestSchema = transferSchema.extend({
  transferNumber: transferSchema.shape.transferNumber.optional(),
  businessDate: transferSchema.shape.businessDate.optional(),
});
const stagedTransferDispatchRequestSchema = stagedTransferDispatchSchema;
const stagedTransferReceiptRequestSchema = stagedTransferReceiptSchema.extend({
  businessDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const supplierReturnRequestSchema = supplierReturnSchema.extend({
  returnNumber: supplierReturnSchema.shape.returnNumber.optional(),
  businessDate: supplierReturnSchema.shape.businessDate.optional(),
});

type MovementRequest = Omit<InventoryMovementInput, "businessDate"> & { businessDate?: string };
type RequisitionRequest = Omit<PurchaseRequisitionInput, "requisitionNumber"> & {
  requisitionNumber?: string;
};
type PurchaseOrderRequest = Omit<PurchaseOrderInput, "purchaseOrderNumber"> & {
  purchaseOrderNumber?: string;
};
type GoodsReceiptRequest = Omit<GoodsReceiptInput, "receiptNumber" | "businessDate"> & {
  receiptNumber?: string;
  businessDate?: string;
};
type ProductionRequest = Omit<ProductionCompletionInput, "businessDate"> & {
  businessDate?: string;
};
type ProductionPlanRequest = Omit<ProductionPlanInput, "businessDate"> & {
  businessDate?: string;
};
type StockCountRequest = Omit<StockCountInput, "businessDate"> & { businessDate?: string };
type TransferInput = Parameters<InventoryIntelligenceService["transferStock"]>[0];
type TransferRequest = Omit<TransferInput, "transferNumber" | "businessDate"> & {
  transferNumber?: string;
  businessDate?: string;
};
type StagedTransferDispatchRequest = Omit<
  StagedTransferDispatchInput,
  "transferNumber" | "businessDate"
> & {
  transferNumber?: string;
  businessDate?: string;
};
type StagedTransferReceiptRequest = Omit<
  StagedTransferReceiptInput,
  "businessDate" | "shipmentId"
> & {
  businessDate?: string;
};
type SupplierReturnRequest = Omit<SupplierReturnInput, "returnNumber" | "businessDate"> & {
  returnNumber?: string;
  businessDate?: string;
};

export async function handleInventoryApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (
    !url.pathname.startsWith("/api/seramet/inventory") &&
    !url.pathname.startsWith("/api/seramet/procurement") &&
    !url.pathname.startsWith("/api/seramet/production")
  ) {
    return null;
  }
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative inventory database unavailable",
    );
  }
  const service = new InventoryIntelligenceService(env.SERAMET_DB, actor);

  if (url.pathname === "/api/seramet/inventory/categories" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, categories: await service.listInventoryCategories(branchId) });
  }
  if (url.pathname === "/api/seramet/inventory/stock-detail" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const warehouseId = url.searchParams.get("warehouseId")?.trim() || undefined;
    return json({
      ok: true,
      detail: await service.stockDetail({
        branchId,
        ...(warehouseId ? { warehouseId } : {}),
      }),
    });
  }
  if (url.pathname === "/api/seramet/inventory/stock-counts" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const limit = boundedLimit(url);
    return json({ ok: true, counts: await service.listStockCounts(branchId, limit) });
  }
  if (url.pathname === "/api/seramet/inventory/adjustments" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({
      ok: true,
      adjustments: await service.listInventoryAdjustments(branchId, boundedLimit(url)),
    });
  }
  if (url.pathname === "/api/seramet/inventory/wastage" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({
      ok: true,
      wastage: await service.listWastageRequests(branchId, boundedLimit(url)),
    });
  }
  if (url.pathname === "/api/seramet/inventory/breakages" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({
      ok: true,
      breakages: await service.listBreakageRequests(branchId, boundedLimit(url)),
    });
  }
  if (url.pathname === "/api/seramet/inventory/par-policies" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, policies: await service.listParPolicies(branchId) });
  }
  if (url.pathname === "/api/seramet/inventory/transfers" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, transfers: await service.listTransfers(branchId, boundedLimit(url)) });
  }
  const transferDetailRoute = /^\/api\/seramet\/inventory\/transfers\/([^/]+)$/.exec(url.pathname);
  if (transferDetailRoute && request.method === "GET") {
    return json({
      ok: true,
      detail: await service.transferDetail(decodeURIComponent(transferDetailRoute[1]!)),
    });
  }
  if (url.pathname === "/api/seramet/inventory/summary" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, summary: await service.summary(branchId) });
  }
  if (url.pathname === "/api/seramet/inventory/units" && request.method === "GET") {
    return json({ ok: true, units: await service.listUnits() });
  }
  if (url.pathname === "/api/seramet/inventory/warehouses" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, warehouses: await service.listWarehouses(branchId) });
  }
  if (url.pathname === "/api/seramet/inventory/warehouses" && request.method === "POST") {
    return json(
      { ok: true, warehouse: await service.createWarehouse(await parse(request, warehouseSchema)) },
      201,
    );
  }
  const warehouseArchiveRoute = /^\/api\/seramet\/inventory\/warehouses\/([^/]+)\/archive$/.exec(
    url.pathname,
  );
  if (warehouseArchiveRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryDecisionSchema>>(
      request,
      inventoryDecisionSchema,
    );
    return json({
      ok: true,
      warehouse: await service.archiveWarehouse(
        decodeURIComponent(warehouseArchiveRoute[1]!),
        body.reason,
      ),
    });
  }
  if (url.pathname === "/api/seramet/inventory/items" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const warehouseId = url.searchParams.get("warehouseId")?.trim() || undefined;
    const cursor = url.searchParams.get("cursor")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");
    if (!Number.isSafeInteger(limit)) throw new SerametHttpError(400, "limit is invalid");
    return json({
      ok: true,
      ...(await service.listInventory({
        branchId,
        ...(warehouseId ? { warehouseId } : {}),
        ...(cursor ? { cursor } : {}),
        limit,
      })),
    });
  }
  const itemDetailRoute = /^\/api\/seramet\/inventory\/items\/([^/]+)$/.exec(url.pathname);
  if (itemDetailRoute && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const limit = boundedLimit(url);
    return json({
      ok: true,
      detail: await service.inventoryItemDetail({
        branchId,
        sku: decodeURIComponent(itemDetailRoute[1]!),
        limit,
      }),
    });
  }
  if (url.pathname === "/api/seramet/inventory/control-centre" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const limit = boundedLimit(url);
    return json({ ok: true, controlCentre: await service.foodCostControlCentre(branchId, limit) });
  }
  if (url.pathname === "/api/seramet/inventory/gl-reconciliation" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, reconciliation: await service.inventoryGlReconciliation(branchId) });
  }
  if (url.pathname === "/api/seramet/procurement/overview" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const limit = boundedLimit(url);
    return json({ ok: true, overview: await service.procurementOverview(branchId, limit) });
  }
  if (url.pathname === "/api/seramet/inventory/units" && request.method === "POST") {
    return json(
      { ok: true, unit: await service.createUnit(await parse(request, unitSchema)) },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/categories" && request.method === "POST") {
    return json(
      {
        ok: true,
        category: await service.createInventoryCategory(
          await parse(request, inventoryCategorySchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/stock-counts/start" && request.method === "POST") {
    const body = await parse<z.infer<typeof stockCountStartSchema>>(request, stockCountStartSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        count: await service.startStockCount({
          ...body,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/items" && request.method === "POST") {
    return json(
      {
        ok: true,
        item: await service.createInventoryItem(await parse(request, inventoryItemSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/conversions" && request.method === "POST") {
    return json(
      {
        ok: true,
        conversion: await service.createItemConversion(await parse(request, conversionSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/adjustments" && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryAdjustmentRequestSchema>>(
      request,
      inventoryAdjustmentRequestSchema,
    );
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        adjustment: await service.requestInventoryAdjustment({
          ...body,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  const adjustmentDecisionRoute =
    /^\/api\/seramet\/inventory\/adjustments\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
  if (adjustmentDecisionRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryDecisionSchema>>(
      request,
      inventoryDecisionSchema,
    );
    const id = decodeURIComponent(adjustmentDecisionRoute[1]!);
    return json({
      ok: true,
      adjustment:
        adjustmentDecisionRoute[2] === "approve"
          ? await service.approveInventoryAdjustment(id, body.reason)
          : await service.rejectInventoryAdjustment(id, body.reason),
    });
  }
  if (url.pathname === "/api/seramet/inventory/breakages" && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryBreakageRequestSchema>>(
      request,
      inventoryBreakageRequestSchema,
    );
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        breakage: await service.requestBreakage({
          ...body,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  const breakageDecisionRoute =
    /^\/api\/seramet\/inventory\/breakages\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
  if (breakageDecisionRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryDecisionSchema>>(
      request,
      inventoryDecisionSchema,
    );
    const id = decodeURIComponent(breakageDecisionRoute[1]!);
    return json({
      ok: true,
      breakage:
        breakageDecisionRoute[2] === "approve"
          ? await service.approveBreakageRequest(id, body.reason)
          : await service.rejectBreakageRequest(id, body.reason),
    });
  }
  if (url.pathname === "/api/seramet/inventory/movements" && request.method === "POST") {
    const body = await parse<MovementRequest>(request, movementRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        movement: await service.appendMovement({ ...body, businessDate: context.businessDate }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/par-policies" && request.method === "POST") {
    return json({
      ok: true,
      policy: await service.upsertParPolicy(await parse(request, parPolicySchema)),
    });
  }
  if (url.pathname === "/api/seramet/inventory/recipes" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    return json({ ok: true, library: await service.recipeOverview(branchId) });
  }
  if (url.pathname === "/api/seramet/inventory/recipes/save" && request.method === "POST") {
    return json(
      {
        ok: true,
        recipe: await service.saveRecipeDefinition(await parse(request, recipeDefinitionSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/recipes/import" && request.method === "POST") {
    const imported = await service.importRecipeDefinitions(
      await parse(request, recipeImportSchema),
    );
    return json({ ok: imported.failed === 0, import: imported }, imported.failed === 0 ? 201 : 207);
  }
  if (url.pathname === "/api/seramet/inventory/recipes" && request.method === "POST") {
    return json(
      { ok: true, recipe: await service.createRecipe(await parse(request, recipeSchema)) },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/recipe-versions" && request.method === "POST") {
    return json(
      {
        ok: true,
        version: await service.createRecipeVersion(await parse(request, recipeVersionSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/portion-standards" && request.method === "POST") {
    return json(
      {
        ok: true,
        standard: await service.createPortionStandard(await parse(request, portionStandardSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/portion-checks" && request.method === "POST") {
    return json(
      {
        ok: true,
        check: await service.recordPortionCheck(await parse(request, portionCheckSchema)),
      },
      201,
    );
  }
  const recipeCost = /^\/api\/seramet\/inventory\/recipe-versions\/([^/]+)\/cost$/.exec(
    url.pathname,
  );
  if (recipeCost && request.method === "GET") {
    return json({
      ok: true,
      recipeVersionId: recipeCost[1],
      costMinor: await service.recipeCostMinor(decodeURIComponent(recipeCost[1]!)),
    });
  }
  const stockCountDetailRoute = /^\/api\/seramet\/inventory\/stock-counts\/([^/]+)$/.exec(
    url.pathname,
  );
  if (stockCountDetailRoute && request.method === "GET") {
    return json({
      ok: true,
      detail: await service.stockCountDetail(decodeURIComponent(stockCountDetailRoute[1]!)),
    });
  }
  const stockCountSaveRoute = /^\/api\/seramet\/inventory\/stock-counts\/([^/]+)\/save$/.exec(
    url.pathname,
  );
  if (stockCountSaveRoute && request.method === "POST") {
    return json({
      ok: true,
      detail: await service.saveStockCount(
        decodeURIComponent(stockCountSaveRoute[1]!),
        await parse(request, stockCountSaveSchema),
      ),
    });
  }
  const stockCountSubmitRoute = /^\/api\/seramet\/inventory\/stock-counts\/([^/]+)\/submit$/.exec(
    url.pathname,
  );
  if (stockCountSubmitRoute && request.method === "POST") {
    return json({
      ok: true,
      count: await service.submitStockCount(decodeURIComponent(stockCountSubmitRoute[1]!)),
    });
  }
  const stockCountApproveRoute = /^\/api\/seramet\/inventory\/stock-counts\/([^/]+)\/approve$/.exec(
    url.pathname,
  );
  if (stockCountApproveRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof stockCountDecisionSchema>>(
      request,
      stockCountDecisionSchema,
    );
    return json({
      ok: true,
      count: await service.approveStockCount(
        decodeURIComponent(stockCountApproveRoute[1]!),
        body.reason,
      ),
    });
  }
  const stockCountCancelRoute = /^\/api\/seramet\/inventory\/stock-counts\/([^/]+)\/cancel$/.exec(
    url.pathname,
  );
  if (stockCountCancelRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof stockCountCancelSchema>>(
      request,
      stockCountCancelSchema,
    );
    return json({
      ok: true,
      count: await service.cancelStockCount(
        decodeURIComponent(stockCountCancelRoute[1]!),
        body.reason,
      ),
    });
  }
  if (url.pathname === "/api/seramet/inventory/stock-counts/post" && request.method === "POST") {
    const body = await parse<StockCountRequest>(request, stockCountRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        count: await service.postStockCount({ ...body, businessDate: context.businessDate }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/transfers/request" && request.method === "POST") {
    const body = await parse<z.infer<typeof stockTransferRequestSchema>>(
      request,
      stockTransferRequestSchema,
    );
    const context = await branchOperationContext(
      env.SERAMET_DB,
      actor.tenantId,
      body.sourceBranchId,
    );
    const transferNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.sourceBranchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "STOCK_TRANSFER",
      prefix: "TRF",
    });
    return json(
      {
        ok: true,
        transfer: await service.requestStockTransfer({ ...body, transferNumber }),
      },
      201,
    );
  }
  const transferLifecycleRoute =
    /^\/api\/seramet\/inventory\/transfers\/([^/]+)\/(approve|cancel|dispatch)$/.exec(url.pathname);
  if (transferLifecycleRoute && request.method === "POST") {
    const id = decodeURIComponent(transferLifecycleRoute[1]!);
    if (transferLifecycleRoute[2] === "dispatch") {
      const body = await parse<z.infer<typeof transferDispatchSchema>>(
        request,
        transferDispatchSchema,
      );
      const detail = await service.transferDetail(id);
      const context = await branchOperationContext(
        env.SERAMET_DB,
        actor.tenantId,
        String(detail.transfer["source_branch_id"]),
      );
      return json({
        ok: true,
        transfer: await service.dispatchApprovedTransfer(id, {
          ...body,
          businessDate: context.businessDate,
        }),
      });
    }
    const body = await parse<z.infer<typeof inventoryDecisionSchema>>(
      request,
      inventoryDecisionSchema,
    );
    return json({
      ok: true,
      transfer:
        transferLifecycleRoute[2] === "approve"
          ? await service.approveStockTransfer(id, body.reason)
          : await service.cancelStockTransfer(id, body.reason),
    });
  }
  if (url.pathname === "/api/seramet/inventory/transfers" && request.method === "POST") {
    const body = await parse<TransferRequest>(request, transferRequestSchema);
    const context = await branchOperationContext(
      env.SERAMET_DB,
      actor.tenantId,
      body.sourceBranchId,
    );
    const transferNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.sourceBranchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "STOCK_TRANSFER",
      prefix: "TRF",
    });
    return json(
      {
        ok: true,
        transfer: await service.transferStock({
          ...body,
          transferNumber,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/transfers/dispatch" && request.method === "POST") {
    const body = await parse<StagedTransferDispatchRequest>(
      request,
      stagedTransferDispatchRequestSchema,
    );
    const context = await branchOperationContext(
      env.SERAMET_DB,
      actor.tenantId,
      body.sourceBranchId,
    );
    const transferNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.sourceBranchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "STOCK_TRANSFER",
      prefix: "TRF",
    });
    return json(
      {
        ok: true,
        transfer: await service.dispatchTransfer({
          ...body,
          transferNumber,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  const stagedReceiptRoute =
    /^\/api\/seramet\/inventory\/transfer-shipments\/([^/]+)\/receive$/.exec(url.pathname);
  if (stagedReceiptRoute && request.method === "POST") {
    const body = await parse<StagedTransferReceiptRequest>(
      request,
      stagedTransferReceiptRequestSchema,
    );
    const destination = await env.SERAMET_DB.prepare(
      `SELECT t.destination_branch_id FROM inventory_transfer_shipments s
         JOIN stock_transfers t ON t.tenant_id=s.tenant_id AND t.id=s.transfer_id
         WHERE s.tenant_id=? AND s.id=?`,
    )
      .bind(actor.tenantId, decodeURIComponent(stagedReceiptRoute[1]!))
      .first<{ destination_branch_id: string }>();
    if (!destination) throw new SerametHttpError(404, "Transfer shipment not found");
    const context = await branchOperationContext(
      env.SERAMET_DB,
      actor.tenantId,
      destination.destination_branch_id,
    );
    return json(
      {
        ok: true,
        receipt: await service.receiveTransferShipment({
          ...body,
          shipmentId: decodeURIComponent(stagedReceiptRoute[1]!),
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/wastage" && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryWastageRequestSchema>>(
      request,
      inventoryWastageRequestSchema,
    );
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        wastage: await service.requestWastage({ ...body, businessDate: context.businessDate }),
      },
      201,
    );
  }
  const wastageDecisionRoute =
    /^\/api\/seramet\/inventory\/wastage\/([^/]+)\/(approve|reject)$/.exec(url.pathname);
  if (wastageDecisionRoute && request.method === "POST") {
    const body = await parse<z.infer<typeof inventoryDecisionSchema>>(
      request,
      inventoryDecisionSchema,
    );
    const id = decodeURIComponent(wastageDecisionRoute[1]!);
    return json({
      ok: true,
      wastage:
        wastageDecisionRoute[2] === "approve"
          ? await service.approveWastageRequest(id, body.reason)
          : await service.rejectWastageRequest(id, body.reason),
    });
  }
  if (url.pathname === "/api/seramet/procurement/suppliers" && request.method === "POST") {
    return json(
      { ok: true, supplier: await service.createSupplier(await parse(request, supplierSchema)) },
      201,
    );
  }
  if (url.pathname === "/api/seramet/procurement/supplier-items" && request.method === "POST") {
    return json(
      {
        ok: true,
        supplierItem: await service.linkSupplierItem(await parse(request, supplierItemSchema)),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/procurement/requisitions" && request.method === "POST") {
    const body = await parse<RequisitionRequest>(request, requisitionRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    const requisitionNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.branchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "PURCHASE_REQUISITION",
      prefix: "REQ",
    });
    return json(
      {
        ok: true,
        requisition: await service.createPurchaseRequisition({ ...body, requisitionNumber }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/procurement/quotes" && request.method === "POST") {
    return json(
      {
        ok: true,
        quote: await service.createPurchaseQuote(await parse(request, purchaseQuoteSchema)),
      },
      201,
    );
  }
  const quoteComparison = /^\/api\/seramet\/procurement\/requisitions\/([^/]+)\/quotes$/.exec(
    url.pathname,
  );
  if (quoteComparison && request.method === "GET") {
    return json({
      ok: true,
      comparison: await service.comparePurchaseQuotes(decodeURIComponent(quoteComparison[1]!)),
    });
  }
  const requisitionApproval = /^\/api\/seramet\/procurement\/requisitions\/([^/]+)\/approve$/.exec(
    url.pathname,
  );
  if (requisitionApproval && request.method === "POST") {
    const body = await parse<{ reason?: string }>(request, approvalSchema);
    return json({
      ok: true,
      requisition: await service.approvePurchaseRequisition(
        decodeURIComponent(requisitionApproval[1]!),
        body.reason,
      ),
    });
  }
  if (url.pathname === "/api/seramet/procurement/purchase-orders" && request.method === "POST") {
    const body = await parse<PurchaseOrderRequest>(request, purchaseOrderRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    const purchaseOrderNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.branchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "PURCHASE_ORDER",
      prefix: "PO",
    });
    return json(
      {
        ok: true,
        purchaseOrder: await service.createPurchaseOrder({ ...body, purchaseOrderNumber }),
      },
      201,
    );
  }
  const poApproval = /^\/api\/seramet\/procurement\/purchase-orders\/([^/]+)\/approve$/.exec(
    url.pathname,
  );
  if (poApproval && request.method === "POST") {
    const body = await parse<{ reason?: string }>(request, approvalSchema);
    return json({
      ok: true,
      purchaseOrder: await service.approvePurchaseOrder(
        decodeURIComponent(poApproval[1]!),
        body.reason,
      ),
    });
  }
  const poCancellation = /^\/api\/seramet\/procurement\/purchase-orders\/([^/]+)\/cancel$/.exec(
    url.pathname,
  );
  if (poCancellation && request.method === "POST") {
    const body = await parse<{ reason?: string }>(request, approvalSchema);
    if (!body.reason) throw new SerametHttpError(400, "Cancellation reason is required");
    return json({
      ok: true,
      purchaseOrder: await service.cancelPurchaseOrder(
        decodeURIComponent(poCancellation[1]!),
        body.reason,
      ),
    });
  }
  if (url.pathname === "/api/seramet/procurement/goods-receipts" && request.method === "POST") {
    const body = await parse<GoodsReceiptRequest>(request, goodsReceiptRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    const receiptNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.branchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "GOODS_RECEIPT",
      prefix: "GR",
    });
    return json(
      {
        ok: true,
        goodsReceipt: await service.receiveGoods({
          ...body,
          receiptNumber,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/procurement/supplier-invoices" && request.method === "POST") {
    return json(
      {
        ok: true,
        supplierInvoice: await service.postSupplierInvoice(
          await parse(request, supplierInvoiceSchema),
        ),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/procurement/supplier-returns" && request.method === "POST") {
    const body = await parse<SupplierReturnRequest>(request, supplierReturnRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    const returnNumber = await nextDocumentNumber(env.SERAMET_DB, {
      tenantId: actor.tenantId,
      branchId: body.branchId,
      branchCode: context.branchCode,
      businessDate: context.businessDate,
      documentType: "SUPPLIER_RETURN",
      prefix: "SRET",
    });
    return json(
      {
        ok: true,
        supplierReturn: await service.returnToSupplier({
          ...body,
          returnNumber,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  const supplierReturnCredit =
    /^\/api\/seramet\/procurement\/supplier-returns\/([^/]+)\/credit$/.exec(url.pathname);
  if (supplierReturnCredit && request.method === "POST") {
    const body = await parse<{ creditNoteNumber: string }>(request, supplierReturnCreditSchema);
    return json({
      ok: true,
      supplierReturn: await service.confirmSupplierReturnCredit(
        decodeURIComponent(supplierReturnCredit[1]!),
        body.creditNoteNumber,
      ),
    });
  }
  if (url.pathname === "/api/seramet/production/overview" && request.method === "GET") {
    const branchId = requiredQuery(url, "branchId");
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, branchId);
    return json({
      ok: true,
      businessDate: context.businessDate,
      production: await service.productionOverview(branchId, boundedLimit(url)),
    });
  }
  if (url.pathname === "/api/seramet/production/batches/plan" && request.method === "POST") {
    const body = await parse<ProductionPlanRequest>(request, productionPlanRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        productionBatch: await service.planProduction({
          ...body,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  const productionStart = /^\/api\/seramet\/production\/batches\/([^/]+)\/start$/.exec(
    url.pathname,
  );
  if (productionStart && request.method === "POST") {
    return json({
      ok: true,
      productionBatch: await service.startProduction(decodeURIComponent(productionStart[1]!)),
    });
  }
  const productionComplete = /^\/api\/seramet\/production\/batches\/([^/]+)\/complete$/.exec(
    url.pathname,
  );
  if (productionComplete && request.method === "POST") {
    const body = await parse<{ actualOutputQuantityMicro: number }>(
      request,
      productionBatchCompletionSchema,
    );
    return json({
      ok: true,
      productionBatch: await service.completePlannedProduction(
        decodeURIComponent(productionComplete[1]!),
        body.actualOutputQuantityMicro,
      ),
    });
  }
  const productionCancel = /^\/api\/seramet\/production\/batches\/([^/]+)\/cancel$/.exec(
    url.pathname,
  );
  if (productionCancel && request.method === "POST") {
    const body = await parse<{ reason: string }>(request, productionCancellationSchema);
    return json({
      ok: true,
      productionBatch: await service.cancelProduction(
        decodeURIComponent(productionCancel[1]!),
        body.reason,
      ),
    });
  }
  if (url.pathname === "/api/seramet/production/batches/complete" && request.method === "POST") {
    const body = await parse<ProductionRequest>(request, productionRequestSchema);
    const context = await branchOperationContext(env.SERAMET_DB, actor.tenantId, body.branchId);
    return json(
      {
        ok: true,
        productionBatch: await service.completeProduction({
          ...body,
          businessDate: context.businessDate,
        }),
      },
      201,
    );
  }
  if (url.pathname === "/api/seramet/inventory/recalculate" && request.method === "POST") {
    const body = await parse<{ branchId?: string }>(
      request,
      z.object({ branchId: z.string().trim().min(1).max(120).optional() }).strict(),
    );
    if (!env.SERAMET_WORK_QUEUE) {
      throw new ServerOperationError(
        "QUEUE_UNAVAILABLE",
        503,
        "Durable inventory worker queue unavailable",
      );
    }
    return json(
      {
        ok: true,
        queued: await enqueueInventoryRecalculation(env, {
          tenantId: actor.tenantId,
          ...(body.branchId ? { branchId: body.branchId } : {}),
          idempotencyKey: `manual-inventory-recalc:${actor.tenantId}:${body.branchId ?? "all"}:${new Date().toISOString().slice(0, 13)}`,
        }),
      },
      202,
    );
  }
  return null;
}

async function parse<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data as T;
}

function requiredQuery(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  if (!value) throw new SerametHttpError(400, `${key} is required`);
  return value;
}

function boundedLimit(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new SerametHttpError(400, "limit must be an integer between 1 and 200");
  }
  return limit;
}

async function branchOperationContext(db: D1Database, tenantId: string, branchId: string) {
  const branch = await db
    .prepare(
      `SELECT code,timezone,business_day_cutoff_minutes
       FROM branches WHERE tenant_id=? AND id=? AND active=1`,
    )
    .bind(tenantId, branchId)
    .first<{ code: string; timezone: string; business_day_cutoff_minutes: number }>();
  if (!branch) {
    throw new SerametHttpError(403, "Branch is not available in the authenticated tenant");
  }
  return {
    branchCode: branch.code,
    businessDate: authoritativeBusinessDate({
      timezone: branch.timezone,
      cutoffMinutes: Number(branch.business_day_cutoff_minutes),
    }),
  };
}

async function nextDocumentNumber(
  db: D1Database,
  input: {
    tenantId: string;
    branchId: string;
    branchCode: string;
    businessDate: string;
    documentType: string;
    prefix: string;
  },
) {
  const allocation = await new DocumentNumberingService(db).next(input);
  return allocation.number;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
