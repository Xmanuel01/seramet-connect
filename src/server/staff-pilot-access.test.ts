import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { createEmptyTransactionState, type TransactionOrder } from "@/lib/transaction-engine";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { staffRolePresets } from "@/platform/staff-role-presets";
import { applyStaffDevicePolicy } from "@/server/staff-device-policy";
import { authorizeSerametMutation, type ServerActor } from "@/lib/seramet-auth";
let actor: ServerActor;
vi.mock("@/lib/seramet-auth", async (original) => ({
  ...(await original<typeof import("@/lib/seramet-auth")>()),
  authenticateSerametRequest: vi.fn(async () => actor),
}));
import { handleSerametApiRequest, filterStateForActor } from "@/lib/seramet-api";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
describe("staff role/device HTTP boundaries", () => {
  let db: SqliteD1TestDatabase, order: TransactionOrder;
  const tenant = "tenant-demo-mona",
    branch = "branch-demo-westlands";
  beforeEach(async () => {
    db = createDemoFixtureDatabase();
    const user = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? LIMIT 1")
      .get(tenant) as { id: string };
    actor = {
      id: user.id,
      name: "Disposable",
      tenantId: tenant,
      branchId: branch,
      branch: "Westlands",
      authLevel: "FULL",
      role: "Not a hardcoded role",
      roleIds: [],
      permissions: allPermissionCodes,
      assignedBranches: [{ id: branch, name: "Westlands" }],
      assignedBranchIds: [branch],
      branchScope: { type: "BRANCH", branchId: branch },
      salesTerminal: true,
    };
    await hydrateAuthoritativeConfiguration(db, {}, true);
    const stamp = new Date().toISOString();
    const station = db.sqlite
      .prepare("SELECT code FROM stations WHERE tenant_id=? AND branch_id=? LIMIT 1")
      .get(tenant, branch) as { code: string };
    order = {
      id: crypto.randomUUID(),
      tenantId: tenant,
      branchId: branch,
      branch: "Westlands",
      customer: "Disposable guest",
      channel: "DINE_IN",
      cashier: "Disposable",
      status: "SENT_TO_KITCHEN",
      paymentStatus: "UNPAID",
      createdAt: stamp,
      updatedAt: stamp,
      lines: [
        {
          id: crypto.randomUUID(),
          name: "Disposable food",
          category: "FOOD",
          quantity: 1,
          unitPrice: 100,
          productionStation: station.code,
          productionStatus: "NEW",
        },
      ],
      subtotal: 100,
      tax: 0,
      total: 100,
    };
    const state = createEmptyTransactionState(tenant);
    state.orders = [order];
    await new D1AuthoritativeTransactionRepository(db).saveState(
      state,
      actor,
      "Disposable access fixture",
    );
  });
  afterEach(() => {
    db.close();
    setConfigurationRepositoryForTests();
  });
  async function mutation(action: string, payload: unknown) {
    const revision = await new D1AuthoritativeTransactionRepository(db).revision(tenant);
    return handleSerametApiRequest(
      new Request("http://localhost/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          payload,
          idempotencyKey: crypto.randomUUID(),
          expectedRevision: revision,
        }),
      }),
      { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" },
    );
  }
  it("rejects every sales-write family on a phone even when a stale role contains the permission", async () => {
    actor = { ...actor, salesTerminal: false };
    for (const action of [
      "createOrder",
      "holdOrder",
      "sendToKitchen",
      "prepareInvoiceForPayment",
      "recordCashPayment",
      "applyConfiguredPayment",
      "requestKitchenReprint",
      "replaceState",
    ]) {
      const result = await mutation(action, { orderId: order.id, branch });
      expect(result.status, action).toBe(action === "replaceState" ? 405 : 403);
    }
    expect(
      (await new D1AuthoritativeTransactionRepository(db).loadState(tenant)).orders,
    ).toHaveLength(1);
  });
  it("prevents a station operator mutating another station or another branch", async () => {
    actor = {
      ...actor,
      salesTerminal: false,
      kitchenStationIds: [],
      permissions: staffRolePresets.chef!.permissions,
    };
    const result = await mutation("setProductionStationStatus", {
      orderId: order.id,
      station: "KITCHEN",
      status: "PREPARING",
    });
    expect(result.status).toBe(403);
    const station = db.sqlite
      .prepare("SELECT id,code FROM stations WHERE tenant_id=? AND branch_id=? LIMIT 1")
      .get(tenant, branch) as { id: string; code: string };
    actor = { ...actor, kitchenStationIds: [station.id] };
    const wrong = await mutation("setProductionStationStatus", {
      orderId: order.id,
      station: "UNASSIGNED",
      status: "PREPARING",
    });
    expect(wrong.status).toBe(403);
    const allowed = await mutation("setProductionStationStatus", {
      orderId: order.id,
      station: station.code,
      status: "PREPARING",
    });
    expect(allowed.status).toBe(200);
    const persisted = await new D1AuthoritativeTransactionRepository(db).loadState(tenant);
    expect(persisted.orders.find((row) => row.id === order.id)?.lines[0]?.productionStatus).toBe(
      "PREPARING",
    );
  });
  it("projects phone cashier reads without invoices, payments, journals, other employees or other branches", async () => {
    actor = await applyStaffDevicePolicy(
      { ...actor, permissions: staffRolePresets.cashier!.permissions },
      db,
    );
    const state = createEmptyTransactionState(tenant);
    state.orders = [order, { ...order, id: "another-order", branchId: "another-branch" }];
    state.employees = [
      {
        id: "private-employee",
        tenantId: tenant,
        branchId: branch,
        name: "Private payroll",
        role: "Employee",
        department: "Kitchen",
        branch: "Westlands",
        shift: "Day",
        netMonthlyPay: 30000,
        monthlyWorkDays: 26,
        standardDailyHours: 8,
        active: true,
      },
    ];
    state.cashDrawers = [
      {
        id: "private-drawer",
        tenantId: tenant,
        branchId: branch,
        branch: "Westlands",
        cashier: "Other cashier",
        openedAt: order.createdAt,
        openingCash: 500,
        cashSales: 100,
        cashIn: 0,
        cashRefunds: 0,
        cashOut: 0,
        expectedDrawer: 600,
        status: "OPEN",
      },
    ];
    const projected = filterStateForActor(state, actor);
    expect(projected.orders.map((row) => row.id)).toEqual([order.id]);
    for (const key of ["bills", "payments", "journalEntries", "employees", "cashDrawers"] as const)
      expect(projected[key]).toEqual([]);
    expect(actor.permissions).not.toContain(permissions.posAccess);
    const attendanceSupervisor = filterStateForActor(state, {
      ...actor,
      permissions: staffRolePresets.supervisor!.permissions,
      salesTerminal: false,
    });
    expect(attendanceSupervisor.employees).toEqual([]);
    expect(attendanceSupervisor.cashDrawers).toEqual([]);
  });
  it("does not let a multi-branch terminal submit sales commands to another active branch", () => {
    const other = (
      db.sqlite
        .prepare("SELECT id FROM branches WHERE tenant_id=? AND id<>? LIMIT 1")
        .get(tenant, branch) as { id: string }
    ).id;
    actor = {
      ...actor,
      permissions: [...allPermissionCodes],
      assignedBranchIds: [branch, other],
      assignedBranches: [
        { id: branch, name: "Westlands" },
        { id: other, name: "Kilimani" },
      ],
    };
    expect(() => authorizeSerametMutation(actor, "createOrder", tenant, other)).toThrow();
  });
  it("keeps unchanged-revision POS reads cheap while rechecking phone and station projections", async () => {
    const revision = await new D1AuthoritativeTransactionRepository(db).revision(tenant);
    const read = () =>
      handleSerametApiRequest(
        new Request(
          `http://localhost/api/seramet/transactions?branchId=${branch}&knownRevision=${revision}`,
        ),
        { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" },
      );
    const terminal = await read();
    expect(terminal.status).toBe(200);
    expect(await terminal.json()).toMatchObject({ unchanged: true, revision });
    actor = {
      ...actor,
      salesTerminal: false,
      permissions: staffRolePresets.chef!.permissions,
      kitchenStationIds: [],
    };
    const station = await read();
    expect(station.status).toBe(200);
    const filtered = await station.json();
    expect(filtered.unchanged).toBeUndefined();
    expect(filtered.state.orders).toEqual([]);
    actor = { ...actor, permissions: staffRolePresets.cashier!.permissions };
    const phone = await read();
    expect(phone.status).toBe(200);
    const readonly = await phone.json();
    expect(readonly.unchanged).toBeUndefined();
    expect(readonly.state.cashDrawers).toEqual([]);
  });
});
