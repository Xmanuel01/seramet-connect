import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { InventoryIntelligenceService } from "./inventory-intelligence-service";
import type { ServerActor } from "@/lib/seramet-auth";
import * as auth from "@/lib/seramet-auth";
import { handleInventoryApi } from "@/server/inventory-api";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { createMigratedTestDatabase, migrationFiles } from "@/server/database/sqlite-test-adapter";

const actor: ServerActor = {
  id: "inventory-reviewer",
  name: "Inventory reviewer",
  tenantId: "inventory-test",
  roleIds: ["manager"],
  permissions: [...allPermissionCodes],
  assignedBranchIds: ["branch-a"],
  assignedBranches: [{ id: "branch-a", name: "Branch A" }],
  branchScope: { type: "BRANCH", branchId: "branch-a" },
  branchId: "branch-a",
  branch: "Branch A",
  role: "Manager",
};

// Every database is in memory. Never use the shared pilot fixture or environment connections.
for (const provider of ["sqlite", "postgres"] as const) {
  describe(`inventory/procurement reads (${provider}, disposable)`, () => {
    let db: D1Database;
    let close: () => void | Promise<void>;
    let service: InventoryIntelligenceService;
    beforeAll(async () => {
      if (provider === "sqlite") {
        const sqlite = createMigratedTestDatabase();
        db = sqlite;
        close = () => sqlite.close();
      } else {
        const pg = new PGlite();
        close = () => pg.close();
        await pg.exec(postgresCompatibilityPrelude);
        for (const file of migrationFiles) {
          await pg.exec(
            compileSqliteMigrationForPostgres(
              readFileSync(resolve(process.cwd(), "migrations", file), "utf8"),
            ).sql,
          );
        }
        const client = {
          async query(sql: string, values?: unknown[]) {
            const result = await pg.query(sql, values);
            return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
          },
          release() {},
        };
        db = new PostgresD1Database({ ...client, connect: async () => client } as unknown as Pool);
      }
      await db
        .prepare(
          `INSERT INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
        VALUES ('inventory-test','inventory-test','Inventory','Inventory','KES','Africa/Nairobi','en-KE',1,'{}','2026-10-18','2026-10-18')`,
        )
        .run();
      await db
        .prepare(
          `INSERT INTO branches
        (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
        VALUES ('inventory-test','branch-a','A','Branch A','Africa/Nairobi',240,1,'{}')`,
        )
        .run();
      service = new InventoryIntelligenceService(db, actor);
      await service.createWarehouse({
        id: "warehouse-a",
        branchId: "branch-a",
        code: "MAIN",
        name: "Main",
        locationType: "MAIN",
      });
      await service.createUnit({
        id: "unit-kg",
        code: "KG",
        name: "Kilogram",
        symbol: "kg",
        dimension: "MASS",
      });
      await service.createInventoryCategory({ id: "category-food", code: "FOOD", name: "Food" });
      await service.createInventoryItem({
        id: "item-rice",
        code: "RICE",
        name: "Rice",
        baseUnitId: "unit-kg",
        purchaseUnitId: "unit-kg",
        categoryId: "category-food",
        defaultWarehouseId: "warehouse-a",
      });
      await service.createSupplier({
        id: "supplier-a",
        code: "SUP",
        name: "Supplier",
        currency: "KES",
      });
    }, 120_000);
    afterAll(async () => {
      await close?.();
    });

    it("loads branch stock summary without a server exception", async () => {
      expect(await service.summary("branch-a")).toMatchObject({ itemCount: 1, outOfStockCount: 1 });
    });
    it("loads procurement including supplier and receipt aggregates", async () => {
      const overview = await service.procurementOverview("branch-a");
      expect(overview.suppliers).toHaveLength(1);
      expect(overview.receipts).toEqual([]);
    });
    it("loads authoritative prerequisites for add item/category/location/count and operations", async () => {
      expect((await service.listInventory({ branchId: "branch-a" })).items).toHaveLength(1);
      expect(await service.listInventoryCategories("branch-a")).toHaveLength(1);
      expect(await service.listWarehouses("branch-a")).toHaveLength(1);
      expect(await service.listUnits()).toHaveLength(1);
      expect(await service.listStockCounts("branch-a")).toEqual([]);
      expect(await service.listInventoryAdjustments("branch-a")).toEqual([]);
      expect(await service.listWastageRequests("branch-a")).toEqual([]);
      expect(await service.listBreakageRequests("branch-a")).toEqual([]);
      expect(await service.listParPolicies("branch-a")).toHaveLength(1);
      expect(await service.listTransfers("branch-a")).toEqual([]);
      expect(await service.foodCostControlCentre("branch-a")).toMatchObject({
        branchId: "branch-a",
      });
    });
    it("keeps branch and mutation permission enforcement intact", async () => {
      await expect(service.procurementOverview("branch-other")).rejects.toMatchObject({
        status: 403,
      });
      const viewer = new InventoryIntelligenceService(db, {
        ...actor,
        permissions: [permissions.inventoryView],
      });
      await expect(
        viewer.createInventoryCategory({ code: "DENIED", name: "Denied" }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        viewer.createWarehouse({
          branchId: "branch-a",
          code: "DENIED",
          name: "Denied",
          locationType: "MAIN",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("persists count, adjustment, waste, breakage, transfer and PAR commands without premature stock movement", async () => {
      const scope = {
        branchId: "branch-a",
        warehouseId: "warehouse-a",
        inventoryItemId: "item-rice",
        businessDate: "2026-10-18",
      };
      expect(await service.startStockCount({ ...scope, idempotencyKey: "count" })).toHaveProperty(
        "id",
      );
      expect(
        await service.requestInventoryAdjustment({
          ...scope,
          quantityMicro: 1_000_000,
          unitCostMinor: 100,
          reasonCode: "FOUND",
          idempotencyKey: "adjust",
        }),
      ).toMatchObject({ status: "PENDING" });
      expect(
        await service.requestWastage({
          ...scope,
          quantityMicro: 1_000_000,
          reasonCode: "SPOILAGE",
          idempotencyKey: "waste",
        }),
      ).toMatchObject({ status: "PENDING", estimatedCostMinor: 0 });
      expect(
        await service.requestBreakage({
          ...scope,
          assetName: "Glass",
          quantityMicro: 1_000_000,
          unitLabel: "pc",
          estimatedValueMinor: 100,
          reasonCode: "BROKEN",
          idempotencyKey: "break",
        }),
      ).toMatchObject({ status: "PENDING" });
      await service.createWarehouse({
        id: "warehouse-b",
        branchId: "branch-a",
        code: "SECOND",
        name: "Second",
        locationType: "OTHER",
      });
      expect(
        await service.requestStockTransfer({
          sourceBranchId: "branch-a",
          sourceWarehouseId: "warehouse-a",
          destinationBranchId: "branch-a",
          destinationWarehouseId: "warehouse-b",
          transferNumber: "TRF-1",
          idempotencyKey: "transfer",
          lines: [{ inventoryItemId: "item-rice", quantityMicro: 1_000_000 }],
        }),
      ).toMatchObject({ status: "REQUESTED" });
      await service.upsertParPolicy({
        ...scope,
        reorderPointMicro: 1_000_000,
        targetQuantityMicro: 2_000_000,
      });
      expect(await service.listParPolicies("branch-a")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            suggested_quantity_minor: 2_000_000,
            suggested_value_minor: 0,
          }),
        ]),
      );
      const movements = await db
        .prepare("SELECT COUNT(*) AS count FROM inventory_movements WHERE tenant_id=?")
        .bind(actor.tenantId)
        .first<{ count: number }>();
      expect(Number(movements?.count)).toBe(0);
    });
    it("runs requisition to approved PO to idempotent receipt using configured test accounts", async () => {
      for (const [id, type] of [
        ["inventory", "ASSET"],
        ["opening", "EQUITY"],
        ["payable", "LIABILITY"],
        ["cogs", "COGS"],
        ["waste", "EXPENSE"],
        ["variance", "EXPENSE"],
        ["tax", "ASSET"],
      ]) {
        await db
          .prepare(
            `INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
          VALUES (?,?,NULL,?,?,?,'KES',1,'{}')`,
          )
          .bind(actor.tenantId, id, id, id, type)
          .run();
      }
      await db
        .prepare(
          `INSERT INTO inventory_account_mappings
        (tenant_id,id,inventory_account_id,opening_balance_account_id,accounts_payable_account_id,cogs_account_id,wastage_account_id,variance_account_id,recoverable_tax_account_id,accounting_mode,active,created_at,updated_at)
        VALUES (?,'mapping','inventory','opening','payable','cogs','waste','variance','tax','PERPETUAL',1,'2026-10-18','2026-10-18')`,
        )
        .bind(actor.tenantId)
        .run();
      const scope = { branchId: "branch-a", warehouseId: "warehouse-a" };
      const requisition = await service.createPurchaseRequisition({
        ...scope,
        requisitionNumber: "REQ-1",
        sourceType: "MANUAL_REQUEST",
        lines: [
          { inventoryItemId: "item-rice", requestedQuantityMicro: 1_000_000, unitId: "unit-kg" },
        ],
      });
      await service.approvePurchaseRequisition(requisition.id, "Reviewed");
      const po = await service.createPurchaseOrder({
        ...scope,
        requisitionId: requisition.id,
        supplierId: "supplier-a",
        purchaseOrderNumber: "PO-1",
        currency: "KES",
        lines: [
          {
            id: "po-line",
            inventoryItemId: "item-rice",
            purchaseUnitId: "unit-kg",
            quantityMicro: 1_000_000,
            unitPriceMinor: 100,
          },
        ],
      });
      await service.approvePurchaseOrder(po.id, "Reviewed");
      const receipt = {
        ...scope,
        purchaseOrderId: po.id,
        supplierId: "supplier-a",
        receiptNumber: "GR-1",
        businessDate: "2026-10-18",
        idempotencyKey: "receipt",
        lines: [
          {
            purchaseOrderLineId: "po-line",
            receivedPurchaseQuantityMicro: 1_000_000,
            acceptedPurchaseQuantityMicro: 1_000_000,
            unitPriceMinor: 100,
          },
        ],
      };
      await service.receiveGoods(receipt);
      expect(await service.receiveGoods(receipt)).toMatchObject({ duplicate: true });
      const overview = await service.procurementOverview("branch-a");
      expect(overview.purchaseOrders[0]).toMatchObject({
        status: "RECEIVED",
        over_receipt_tolerance_bps: 0,
      });
      expect(overview.receipts).toHaveLength(1);
      expect(Number(overview.receipts[0]?.total_minor)).toBe(100);
      const stock = await service.listInventory({ branchId: "branch-a" });
      const item: Record<string, unknown> | undefined = stock.items[0];
      expect(Number(item?.quantity_minor)).toBe(1_000_000);
    });
    it("serves the real HTTP routes and rejects unauthorized writes without bypassing service checks", async () => {
      // Authentication alone is stubbed; schemas, branch checks, handlers, services and DB are real.
      const identity = vi.spyOn(auth, "authenticateSerametRequest").mockResolvedValue(actor);
      const request = (path: string, body?: unknown) =>
        handleInventoryApi(
          new Request(
            `http://localhost/api/seramet/${path}`,
            body === undefined
              ? {}
              : {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                },
          ),
          { SERAMET_DB: db },
        );
      try {
        for (const path of [
          "inventory/summary",
          "inventory/items",
          "inventory/categories",
          "inventory/warehouses",
          "inventory/stock-counts",
          "inventory/adjustments",
          "inventory/wastage",
          "inventory/breakages",
          "inventory/par-policies",
          "inventory/transfers",
          "inventory/control-centre",
          "procurement/overview",
          "procurement/requisition-workspace",
        ]) {
          expect((await request(`${path}?branchId=branch-a`))?.status, path).toBe(200);
        }
        expect(
          (await request("inventory/categories", { code: "HTTP", name: "HTTP category" }))?.status,
        ).toBe(201);
        expect(
          (
            await request("inventory/warehouses", {
              branchId: "branch-a",
              code: "HTTP",
              name: "HTTP location",
              locationType: "OTHER",
            })
          )?.status,
        ).toBe(201);
        identity.mockResolvedValue({ ...actor, permissions: [permissions.inventoryView] });
        await expect(
          request("inventory/categories", { code: "HTTP-DENIED", name: "Denied" }),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          request("procurement/requisitions", {
            branchId: "branch-a",
            warehouseId: "warehouse-a",
            sourceType: "MANUAL_REQUEST",
            lines: [
              {
                inventoryItemId: "item-rice",
                requestedQuantityMicro: 1_000_000,
                unitId: "unit-kg",
              },
            ],
          }),
        ).rejects.toMatchObject({ status: 403 });
        identity.mockResolvedValue(actor);
        await expect(request("inventory/items?branchId=branch-other")).rejects.toMatchObject({
          status: 403,
        });
      } finally {
        identity.mockRestore();
      }
    });
  });
}
