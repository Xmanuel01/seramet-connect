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

const tenantId = "store-issue-test";
const baseActor: ServerActor = {
  id: "manager-1",
  name: "Store manager",
  tenantId,
  roleIds: ["manager"],
  permissions: [...allPermissionCodes],
  assignedBranchIds: ["branch-a"],
  assignedBranches: [{ id: "branch-a", name: "Branch A" }],
  branchScope: { type: "BRANCH", branchId: "branch-a" },
  branchId: "branch-a",
  branch: "Branch A",
  role: "Manager",
};
const as = (id: string, granted: string[]): ServerActor => ({
  ...baseActor,
  id,
  name: id,
  permissions: granted,
});
const KG = 1_000_000;
type HttpBody = {
  workspace: {
    canApprove: boolean;
    canViewAll: boolean;
    departments: { id: string; name: string }[];
  };
  issue: { id: string; issueNumber: string; status: string };
  issues: { id: string; status: string; department_name: string; business_date: string }[];
};

// Every database is in memory. Never use the shared pilot fixture or environment connections.
for (const provider of ["sqlite", "postgres"] as const) {
  describe(`store issues (${provider}, disposable)`, () => {
    let db: D1Database;
    let close: () => void | Promise<void>;
    let manager: InventoryIntelligenceService;
    let staff: InventoryIntelligenceService;
    let otherStaff: InventoryIntelligenceService;
    let viewer: InventoryIntelligenceService;
    let counter = 0;
    const key = () => `key-${provider}-${++counter}`;
    const number = () => `SIV-${provider}-${++counter}`;
    const today = "2026-11-11";

    const balance = async (itemId = "item-rice") =>
      db
        .prepare(
          `SELECT quantity_minor,average_unit_cost_minor,total_value_minor FROM inventory_balances
            WHERE tenant_id=? AND warehouse_id='store-main' AND item_id=?`,
        )
        .bind(tenantId, itemId)
        .first<{
          quantity_minor: number;
          average_unit_cost_minor: number;
          total_value_minor: number;
        }>();
    const accountBalance = async (accountId: string) => {
      const row = await db
        .prepare(
          `SELECT COALESCE(SUM(jl.debit_minor),0) AS debit,COALESCE(SUM(jl.credit_minor),0) AS credit
             FROM journal_lines jl JOIN journal_entries je
               ON je.tenant_id=jl.tenant_id AND je.id=jl.journal_entry_id
            WHERE jl.tenant_id=? AND jl.account_id=? AND je.status='POSTED'`,
        )
        .bind(tenantId, accountId)
        .first<{ debit: number; credit: number }>();
      return Number(row?.debit ?? 0) - Number(row?.credit ?? 0);
    };
    const request = (
      service: InventoryIntelligenceService,
      kind: "REQUEST" | "DIRECT",
      lines: { inventoryItemId: string; quantityMicro: number }[],
      extra: Record<string, unknown> = {},
    ) =>
      service.createStoreIssue({
        branchId: "branch-a",
        warehouseId: "store-main",
        kind,
        issueNumber: number(),
        departmentCode: "KITCHEN",
        departmentName: "Kitchen",
        reason: "Lunch prep",
        idempotencyKey: key(),
        businessDate: today,
        lines,
        ...extra,
      });

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
           VALUES (?,?,'Store','Store','KES','Africa/Nairobi','en-KE',1,'{}','2026-11-01','2026-11-01')`,
        )
        .bind(tenantId, tenantId)
        .run();
      await db
        .prepare(
          `INSERT INTO branches
            (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
           VALUES (?,'branch-a','A','Branch A','Africa/Nairobi',240,1,'{}'),
                  (?,'branch-b','B','Branch B','Africa/Nairobi',240,1,'{}')`,
        )
        .bind(tenantId, tenantId)
        .run();
      for (const [id, type] of [
        ["inventory", "ASSET"],
        ["opening", "EQUITY"],
        ["payable", "LIABILITY"],
        ["cogs", "COGS"],
        ["waste", "EXPENSE"],
        ["variance", "EXPENSE"],
        ["cleaning", "EXPENSE"],
      ]) {
        await db
          .prepare(
            `INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
             VALUES (?,?,NULL,?,?,?,'KES',1,'{}')`,
          )
          .bind(tenantId, id, id, id, type)
          .run();
      }
      await db
        .prepare(
          `INSERT INTO inventory_account_mappings
            (tenant_id,id,inventory_account_id,opening_balance_account_id,accounts_payable_account_id,
             cogs_account_id,wastage_account_id,variance_account_id,accounting_mode,active,created_at,updated_at)
           VALUES (?,'mapping','inventory','opening','payable','cogs','waste','variance','PERPETUAL',1,'2026-11-01','2026-11-01')`,
        )
        .bind(tenantId)
        .run();
      await db
        .prepare(
          `INSERT INTO departments (tenant_id,id,branch_id,code,name,active,payload_json)
           VALUES (?,'dept-hk','branch-a','HOUSEKEEPING','Housekeeping',1,?),
                  (?,'dept-b','branch-b','BAR_B','Branch B bar',1,'{}')`,
        )
        .bind(tenantId, JSON.stringify({ storeIssueAccountId: "cleaning" }), tenantId)
        .run();
      manager = new InventoryIntelligenceService(db, baseActor);
      staff = new InventoryIntelligenceService(
        db,
        as("staff-1", [permissions.inventoryIssueRequest]),
      );
      otherStaff = new InventoryIntelligenceService(
        db,
        as("staff-2", [permissions.inventoryIssueRequest]),
      );
      viewer = new InventoryIntelligenceService(
        db,
        as("viewer-1", [permissions.inventoryIssueView]),
      );
      await manager.createWarehouse({
        id: "store-main",
        branchId: "branch-a",
        code: "MAIN",
        name: "Main store",
        locationType: "MAIN",
      });
      await manager.createUnit({
        id: "unit-kg",
        code: "KG",
        name: "Kilogram",
        symbol: "kg",
        dimension: "MASS",
      });
      for (const [id, code, name] of [
        ["item-rice", "RICE", "Rice"],
        ["item-oil", "OIL", "Oil"],
        ["item-soap", "SOAP", "Soap"],
      ]) {
        await manager.createInventoryItem({
          id,
          code,
          name,
          baseUnitId: "unit-kg",
          purchaseUnitId: "unit-kg",
          defaultWarehouseId: "store-main",
        });
      }
      // 10 kg rice at 200.00/kg, 5 kg oil at 300.00/kg, 4 kg soap at 50.00/kg.
      for (const [itemId, quantity, unitCost] of [
        ["item-rice", 10 * KG, 20_000],
        ["item-oil", 5 * KG, 30_000],
        ["item-soap", 4 * KG, 5_000],
      ] as const) {
        await manager.appendMovement({
          branchId: "branch-a",
          warehouseId: "store-main",
          inventoryItemId: itemId,
          movementType: "OPENING",
          quantityBaseMicro: quantity,
          unitCostMinor: unitCost,
          totalCostMinor: (quantity / KG) * unitCost,
          sourceType: "OPENING",
          sourceId: `opening-${itemId}`,
          idempotencyKey: `opening-${provider}-${itemId}`,
          businessDate: "2026-11-01",
        });
      }
    }, 120_000);
    afterAll(async () => {
      await close?.();
    });

    it("a request moves no stock until it is approved and issued at average cost", async () => {
      const created = await request(staff, "REQUEST", [
        { inventoryItemId: "item-rice", quantityMicro: 3 * KG },
        { inventoryItemId: "item-oil", quantityMicro: 1 * KG },
      ]);
      expect(created.status).toBe("REQUESTED");
      expect((await balance())?.quantity_minor).toBe(10 * KG);

      const [listed] = await manager.listStoreIssues("branch-a");
      const riceLine = listed!.lines.find((line) => line.inventory_item_id === "item-rice")!;
      await manager.approveStoreIssue(created.id, {
        reason: "OK",
        lines: [{ lineId: String(riceLine.id), quantityMicro: 2 * KG }],
      });
      expect((await balance())?.quantity_minor).toBe(10 * KG);

      await expect(
        manager.issueStoreIssue(created.id, {
          businessDate: today,
          lines: [{ lineId: String(riceLine.id), quantityMicro: 3 * KG }],
        }),
      ).rejects.toThrow(/approved quantity/);

      const issued = await manager.issueStoreIssue(created.id, { businessDate: today });
      // 2 kg rice x 200.00 + 1 kg oil x 300.00 = 700.00
      expect(issued).toMatchObject({ status: "ISSUED", totalCostMinor: 70_000 });
      expect(await balance()).toMatchObject({
        quantity_minor: 8 * KG,
        average_unit_cost_minor: 20_000,
        total_value_minor: 160_000,
      });
      expect((await balance("item-oil"))?.quantity_minor).toBe(4 * KG);
      const movements = await db
        .prepare(
          `SELECT movement_type,quantity_minor,unit_cost_minor,total_cost_minor,source_type
             FROM inventory_movements WHERE tenant_id=? AND source_id=? ORDER BY item_id`,
        )
        .bind(tenantId, created.id)
        .all<Record<string, unknown>>();
      expect(movements.results).toEqual([
        expect.objectContaining({
          movement_type: "STORE_ISSUE",
          quantity_minor: -1 * KG,
          unit_cost_minor: 30_000,
          total_cost_minor: -30_000,
        }),
        expect.objectContaining({
          movement_type: "STORE_ISSUE",
          quantity_minor: -2 * KG,
          unit_cost_minor: 20_000,
          total_cost_minor: -40_000,
        }),
      ]);
      // Issuing twice posts nothing new.
      expect(await manager.issueStoreIssue(created.id, { businessDate: today })).toMatchObject({
        duplicate: true,
      });
    });

    it("posts issued cost to COGS by default, tagged with the department, and balances the GL", async () => {
      expect(await accountBalance("cogs")).toBe(70_000);
      const journals = await db
        .prepare(
          `SELECT je.description,je.payload_json,jl.account_id,jl.debit_minor,jl.credit_minor,
                  jl.payload_json AS line_payload
             FROM journal_entries je JOIN journal_lines jl
               ON jl.tenant_id=je.tenant_id AND jl.journal_entry_id=je.id
            WHERE je.tenant_id=? AND je.description LIKE 'Store issue %' AND jl.account_id='cogs'`,
        )
        .bind(tenantId)
        .all<Record<string, unknown>>();
      expect(journals.results).toHaveLength(2);
      for (const row of journals.results ?? []) {
        expect(JSON.parse(String(row.payload_json))).toMatchObject({
          departmentCode: "KITCHEN",
          departmentName: "Kitchen",
        });
        expect(JSON.parse(String(row.line_payload))).toMatchObject({ departmentCode: "KITCHEN" });
      }
      const reconciliation = await manager.inventoryGlReconciliation("branch-a");
      expect(reconciliation).toBeTruthy();
      // Inventory asset falls by exactly what was expensed.
      const opening = 10 * 20_000 + 5 * 30_000 + 4 * 5_000;
      expect(await accountBalance("inventory")).toBe(opening - 70_000);
    });

    it("uses the department's own expense account and the mapping's store-issue account", async () => {
      const hk = await request(
        manager,
        "REQUEST",
        [{ inventoryItemId: "item-soap", quantityMicro: 1 * KG }],
        { departmentId: "dept-hk", departmentCode: undefined, departmentName: undefined },
      );
      await manager.issueStoreIssue(hk.id, { businessDate: today });
      expect(await accountBalance("cleaning")).toBe(5_000);

      await db
        .prepare(
          `UPDATE inventory_account_mappings SET store_issue_account_id='waste' WHERE tenant_id=?`,
        )
        .bind(tenantId)
        .run();
      const bar = await request(manager, "REQUEST", [
        { inventoryItemId: "item-soap", quantityMicro: 1 * KG },
      ]);
      await manager.issueStoreIssue(bar.id, { businessDate: today });
      expect(await accountBalance("waste")).toBe(5_000);
      await db
        .prepare(
          `UPDATE inventory_account_mappings SET store_issue_account_id=NULL WHERE tenant_id=?`,
        )
        .bind(tenantId)
        .run();
      await expect(
        request(manager, "REQUEST", [{ inventoryItemId: "item-soap", quantityMicro: KG }], {
          departmentId: "dept-b",
        }),
      ).rejects.toThrow(/not available in this branch/);
    });

    it("a direct issue reduces stock at once; rejecting it on review puts stock and cost back", async () => {
      const before = await balance();
      const cogsBefore = await accountBalance("cogs");
      const direct = await request(staff, "DIRECT", [
        { inventoryItemId: "item-rice", quantityMicro: 1 * KG },
      ]);
      expect(direct).toMatchObject({ status: "PENDING_REVIEW", totalCostMinor: 20_000 });
      expect((await balance())?.quantity_minor).toBe(before!.quantity_minor - KG);
      expect(await accountBalance("cogs")).toBe(cogsBefore + 20_000);

      await manager.rejectStoreIssue(direct.id, { reason: "Not taken", businessDate: today });
      expect(await balance()).toMatchObject({
        quantity_minor: before!.quantity_minor,
        total_value_minor: before!.total_value_minor,
        average_unit_cost_minor: before!.average_unit_cost_minor,
      });
      expect(await accountBalance("cogs")).toBe(cogsBefore);

      const confirmed = await request(staff, "DIRECT", [
        { inventoryItemId: "item-rice", quantityMicro: 1 * KG },
      ]);
      expect(await manager.reviewStoreIssue(confirmed.id, "Checked")).toMatchObject({
        status: "REVIEWED",
      });
      await expect(
        manager.rejectStoreIssue(confirmed.id, { reason: "Late", businessDate: today }),
      ).rejects.toThrow(/cannot transition/);
    });

    it("feeds usage into par forecasts and the consumption period", async () => {
      await manager.recalculateTenant("branch-a");
      const forecast = await db
        .prepare(
          `SELECT inputs_json FROM inventory_forecasts
            WHERE tenant_id=? AND inventory_item_id='item-rice' ORDER BY generated_at DESC LIMIT 1`,
        )
        .bind(tenantId)
        .first<{ inputs_json: string }>();
      const samples = JSON.parse(forecast!.inputs_json).samples as { quantity: number }[];
      // 2 kg issued + 1 kg direct (the rejected 1 kg nets to zero).
      expect(samples.reduce((sum, row) => sum + Number(row.quantity), 0)).toBe(3 * KG);
      const period = await db
        .prepare(
          `SELECT actual_quantity_minor FROM inventory_consumption_periods
            WHERE tenant_id=? AND inventory_item_id='item-rice' ORDER BY period_end DESC LIMIT 1`,
        )
        .bind(tenantId)
        .first<{ actual_quantity_minor: number }>();
      expect(Number(period?.actual_quantity_minor)).toBe(3 * KG);
    });

    it("enforces request, approve and view permissions and requester-only visibility", async () => {
      const mine = await request(staff, "REQUEST", [
        { inventoryItemId: "item-oil", quantityMicro: KG },
      ]);
      await expect(staff.approveStoreIssue(mine.id, { reason: "self" })).rejects.toThrow(
        /inventory.issue.approve/,
      );
      await expect(staff.issueStoreIssue(mine.id, { businessDate: today })).rejects.toThrow(
        /inventory.issue.approve/,
      );
      await expect(
        request(viewer, "REQUEST", [{ inventoryItemId: "item-oil", quantityMicro: KG }]),
      ).rejects.toThrow(/inventory.issue.request/);
      const noAccess = new InventoryIntelligenceService(
        db,
        as("nobody", [permissions.inventoryView]),
      );
      await expect(noAccess.listStoreIssues("branch-a")).rejects.toThrow(/permission/);

      const staffList = await staff.listStoreIssues("branch-a");
      expect(staffList.length).toBeGreaterThan(0);
      expect(staffList.every((row) => row.requested_by === "staff-1")).toBe(true);
      expect(await otherStaff.listStoreIssues("branch-a")).toEqual([]);
      const all = await viewer.listStoreIssues("branch-a");
      expect(all.some((row) => row.requested_by === "manager-1")).toBe(true);

      await expect(otherStaff.cancelStoreIssue(mine.id, "not mine")).rejects.toThrow(
        /Only the requester/,
      );
      expect(await staff.cancelStoreIssue(mine.id, "Changed plan")).toMatchObject({
        status: "CANCELLED",
      });
      expect((await balance("item-oil"))?.quantity_minor).toBe(4 * KG);
    });

    it("is tenant- and branch-scoped and idempotent", async () => {
      const foreign = new InventoryIntelligenceService(db, {
        ...baseActor,
        id: "outsider",
        tenantId: "another-tenant",
      });
      const [any] = await manager.listStoreIssues("branch-a");
      await expect(foreign.approveStoreIssue(String(any!.id), { reason: "x" })).rejects.toThrow(
        /not found/,
      );
      const branchOnly = new InventoryIntelligenceService(db, {
        ...as("b-staff", [permissions.inventoryIssueRequest, permissions.inventoryIssueApprove]),
        assignedBranchIds: ["branch-b"],
        assignedBranches: [{ id: "branch-b", name: "Branch B" }],
        branchScope: { type: "BRANCH", branchId: "branch-b" },
        branchId: "branch-b",
      });
      await expect(branchOnly.listStoreIssues("branch-a")).rejects.toThrow();
      await expect(
        branchOnly.approveStoreIssue(String(any!.id), { reason: "x" }),
      ).rejects.toThrow();

      const idempotencyKey = key();
      const input = {
        branchId: "branch-a",
        warehouseId: "store-main",
        kind: "DIRECT" as const,
        issueNumber: number(),
        departmentCode: "BAR",
        reason: "Event",
        idempotencyKey,
        businessDate: today,
        lines: [{ inventoryItemId: "item-oil", quantityMicro: KG }],
      };
      const before = (await balance("item-oil"))!.quantity_minor;
      const first = await staff.createStoreIssue(input);
      const second = await staff.createStoreIssue({ ...input, issueNumber: number() });
      expect(second).toMatchObject({ id: first.id, duplicate: true });
      expect((await balance("item-oil"))!.quantity_minor).toBe(before - KG);
    });

    it("rejects invalid input", async () => {
      await expect(
        request(staff, "REQUEST", [
          { inventoryItemId: "item-rice", quantityMicro: KG },
          { inventoryItemId: "item-rice", quantityMicro: KG },
        ]),
      ).rejects.toThrow(/only once/);
      await expect(
        request(staff, "REQUEST", [{ inventoryItemId: "missing", quantityMicro: KG }]),
      ).rejects.toThrow(/active inventory item/);
      await expect(
        request(staff, "REQUEST", [{ inventoryItemId: "item-rice", quantityMicro: 0 }]),
      ).rejects.toThrow(/positive/);
      await expect(
        request(staff, "REQUEST", [{ inventoryItemId: "item-rice", quantityMicro: KG }], {
          departmentCode: undefined,
        }),
      ).rejects.toThrow(/department/);
    });

    it("serves the HTTP routes with numbering, the branch business date and permission checks", async () => {
      const call = async (as: ServerActor, path: string, body?: unknown) => {
        const identity = vi.spyOn(auth, "authenticateSerametRequest").mockResolvedValue(as);
        try {
          const response = await handleInventoryApi(
            new Request(
              `http://localhost/api/seramet/inventory/${path}`,
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
          return (await response!.json()) as HttpBody;
        } finally {
          identity.mockRestore();
        }
      };
      const staffActor = as("staff-http", [permissions.inventoryIssueRequest]);
      const workspace = await call(staffActor, "store-issues/workspace?branchId=branch-a");
      expect(workspace.workspace).toMatchObject({ canApprove: false, canViewAll: false });
      expect(workspace.workspace.departments).toEqual([
        expect.objectContaining({ id: "dept-hk", name: "Housekeeping" }),
      ]);
      const created = await call(staffActor, "store-issues", {
        branchId: "branch-a",
        warehouseId: "store-main",
        kind: "REQUEST",
        departmentCode: "KITCHEN",
        departmentName: "Kitchen",
        reason: "Dinner",
        idempotencyKey: key(),
        lines: [{ inventoryItemId: "item-rice", quantityMicro: KG }],
      });
      expect(created.issue.issueNumber).toMatch(/^SIV-A-/);
      await expect(call(staffActor, `store-issues/${created.issue.id}/issue`, {})).rejects.toThrow(
        /inventory.issue.approve/,
      );
      await expect(
        call(as("viewer-http", [permissions.inventoryIssueView]), "store-issues", {
          branchId: "branch-a",
          warehouseId: "store-main",
          kind: "DIRECT",
          departmentCode: "BAR",
          reason: "x",
          idempotencyKey: key(),
          lines: [{ inventoryItemId: "item-rice", quantityMicro: KG }],
        }),
      ).rejects.toThrow(/inventory.issue.request/);
      const issued = await call(baseActor, `store-issues/${created.issue.id}/issue`, {});
      expect(issued.issue).toMatchObject({ status: "ISSUED" });
      const listed = await call(staffActor, "store-issues?branchId=branch-a");
      const row = listed.issues.find((entry) => entry.id === created.issue.id);
      expect(row).toMatchObject({ status: "ISSUED", department_name: "Kitchen" });
      expect(row?.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
}
