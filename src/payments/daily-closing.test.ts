import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import {
  closeBusinessDay,
  closeCashierShift,
  closingPolicy,
  configureClosing,
  type DrawerCount,
} from "./daily-closing";
import { paymentOrchestrator } from "./payment-orchestrator";
import { ReconciliationEngine } from "./reconciliation-engine";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const date = "2026-10-15";
const supervisor: ServerActor = {
  id: "supervisor",
  name: "Supervisor",
  tenantId,
  branchId,
  branch: branchId,
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: branchId }],
  role: "Manager",
  roleIds: [],
  permissions: [...allPermissionCodes],
  branchScope: { type: "BRANCH", branchId },
};
const cashier = { ...supervisor, id: "cashier", permissions: [permissions.cashClose] };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T19:00:00Z"));
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});
afterEach(() => {
  vi.useRealTimers();
  setConfigurationRepositoryForTests();
});

function opened(employeeId = "cashier", initial = createEmptyTransactionState(tenantId)) {
  return paymentOrchestrator.openDrawer(initial, {
    tenantId,
    branchId,
    employeeId,
    openingFloatMinor: 10000,
    currency: "KES",
    actor: employeeId,
  });
}
function count(state: TransactionState, amount = 10000, reason?: string) {
  return {
    drawerSessionId: state.paymentOperations!.drawerSessions[0]!.id,
    countedByCurrency: { KES: amount },
    varianceReason: reason,
  };
}
function close(state: TransactionState, counts: DrawerCount[] = [count(state)], actor = supervisor) {
  return closeBusinessDay(state, actor, {
    businessDate: date,
    drawerCounts: counts,
    confirmed: true,
  });
}
function multi(initial = createEmptyTransactionState(tenantId)) {
  return configureClosing(initial, supervisor, {
    branchId,
    mode: "MULTI_CASHIER_SHIFTS",
    materialVarianceMinor: 50000,
    recipientUserIds: [],
  });
}

describe("unified daily closing", () => {
  it("defaults to supervisor-led closing without an additional cashier close", () => {
    const state = opened();
    expect(closingPolicy(state, tenantId, branchId).mode).toBe("SUPERVISOR_DAILY_CLOSE");
    const closed = close(state);
    expect(state.paymentOperations!.drawerSessions[0]!.status).toBe("OPEN");
    expect(closed.paymentOperations!.drawerSessions[0]).toMatchObject({
      status: "CLOSED",
      countedCashMinor: 10000,
      closedBy: supervisor.id,
    });
    const day = closed.paymentOperations!.dayCloses[0]!;
    expect(day).toMatchObject({
      status: "CLOSED",
      snapshot: { revision: 1, cashVarianceMinor: 0 },
    });
    expect(day.snapshot!.dailyReport!.drawers).toHaveLength(1);
    expect(() => closeCashierShift(state, cashier, count(state))).toThrow(/supervisor-led/);
  });
  it("requires explicit confirmation and rejects future dates", () => {
    const state = opened();
    expect(() =>
      closeBusinessDay(state, supervisor, {
        businessDate: date,
        drawerCounts: [count(state)],
        confirmed: false,
      }),
    ).toThrow(/confirmation/);
    expect(() =>
      closeBusinessDay(state, supervisor, {
        businessDate: "2030-01-01",
        drawerCounts: [],
        confirmed: true,
      }),
    ).toThrow(/future/);
  });
  it.each(["cashier", "foreign-tenant", "foreign-branch"])(
    "rejects unauthorized %s closure",
    (variant) => {
      const actor =
        variant === "cashier"
          ? cashier
          : { ...supervisor, [variant === "foreign-tenant" ? "tenantId" : "branchId"]: "other" };
      expect(() => close(opened(), undefined, actor)).toThrow();
    },
  );
  it("requires an exact, complete currency count and preserves state on failure", () => {
    const state = opened();
    const before = structuredClone(state);
    for (const counts of [
      [],
      [count(state), count(state)],
      [{ ...count(state), countedByCurrency: {} }],
      [count(state, -1)],
      [count(state, 0.5)],
    ]) {
      expect(() => close(state, counts)).toThrow();
      expect(state).toEqual(before);
    }
  });
  it("requires explanation for every variance and stronger permission for material variance", () => {
    const state = opened();
    expect(() => close(state, [count(state, 9999)])).toThrow(/explanation/);
    const closed = close(state, [count(state, 9999, "One cent shortage")]);
    expect(closed.paymentOperations!.dayCloses[0]!.snapshot!.cashVarianceMinor).toBe(-1);
    const withoutApproval = { ...supervisor, permissions: [permissions.reconciliationApprove] };
    expect(() =>
      close(state, [count(state, 60000, "Material discrepancy")], withoutApproval),
    ).toThrow(/approval/);
    expect(
      close(state, [count(state, 60000, "Approved discrepancy")]).paymentOperations!
        .drawerSessions[0]!.status,
    ).toBe("APPROVED");
  });
  it("never overwrites a closed day during review or repeated confirmation", () => {
    const closed = close(opened());
    expect(close(closed)).toEqual(closed);
    expect(() => close(closed, [count(closed, 12345)])).toThrow(/immutable/);
    expect(
      new ReconciliationEngine().prepareDayClose(closed, {
        tenantId,
        branchId,
        businessDate: date,
        actor: supervisor.id,
      }),
    ).toEqual(closed);
    expect(closed.paymentOperations!.dayCloses[0]!.snapshots).toHaveLength(1);
  });
  it("retains report counts independently of subsequent mutable state", () => {
    const closed = close(opened());
    closed.paymentOperations!.drawerSessions[0]!.expectedCashMinor = 123;
    expect(
      closed.paymentOperations!.dayCloses[0]!.snapshot!.dailyReport!.drawers[0]!.expectedCashMinor,
    ).toBe(10000);
    expect(
      closed.paymentOperations!.dayCloses[0]!.snapshots[0]!.dailyReport!.drawers[0]!
        .expectedCashMinor,
    ).toBe(10000);
  });
  it("prevents changing mode while any cashier reconciliation is active", () => {
    expect(() => multi(opened())).toThrow(/active drawer/);
    expect(() =>
      configureClosing(opened(), cashier, {
        branchId,
        mode: "MULTI_CASHIER_SHIFTS",
        materialVarianceMinor: 50000,
        recipientUserIds: [],
      }),
    ).toThrow(/Permission/);
  });
  it("allows cashier shifts independently then consolidates without recounting or cash movements", () => {
    let state = opened("cashier", multi());
    state = closeCashierShift(state, cashier, count(state));
    expect(state.paymentOperations!.dayCloses).toHaveLength(0);
    state = opened("other-cashier", state);
    expect(() => closeCashierShift(state, cashier, count(state))).toThrow(/another cashier/);
    expect(() => close(state, [])).toThrow(/individual cashier/);
    state = closeCashierShift(state, supervisor, count(state));
    const movements = structuredClone(state.paymentOperations!.cashMovements);
    const closed = close(state, []);
    expect(closed.paymentOperations!.dayCloses[0]!.snapshot!.dailyReport!.drawers).toHaveLength(2);
    expect(closed.paymentOperations!.cashMovements).toEqual(movements);
    expect(() => closeCashierShift(closed, supervisor, count(closed))).toThrow(/finalized/);
  });
  it("retains a legitimate unpaid invoice without silently settling it", () => {
    const state = opened();
    state.bills.push({
      id: "unpaid",
      tenantId,
      branchId,
      branch: branchId,
      orderIds: [],
      customer: "Account customer",
      status: "OPEN",
      paymentStatus: "UNPAID",
      issuedAt: "2026-10-15T08:00:00Z",
      businessDate: date,
      dueAt: "2026-10-20T08:00:00Z",
      lines: [],
      subtotal: 100,
      tax: 16,
      total: 116,
      paid: 0,
    });
    const closed = close(state);
    expect(closed.bills[0]!.paymentStatus).toBe("UNPAID");
    expect(
      closed.paymentOperations!.dayCloses[0]!.snapshot!.dailyReport!.outstandingInvoices,
    ).toEqual([{ id: "unpaid", balanceMinor: 11600 }]);
  });
  it("rolls back draft drawer finalization when financial readiness fails", () => {
    const state = opened();
    state.paymentOperations!.journals.push({
      id: "unbalanced",
      tenantId,
      branchId,
      sourceType: "CASH_MOVEMENT",
      sourceId: "source",
      businessDate: date,
      description: "Unbalanced fixture",
      status: "POSTED",
      lines: [{ accountId: "cash", debitMinor: 10, creditMinor: 0, currency: "KES", metadata: {} }],
      createdAt: "2026-10-15T08:00:00Z",
    });
    const before = structuredClone(state);
    expect(() => close(state)).toThrow(/UNBALANCED_JOURNAL/);
    expect(state).toEqual(before);
  });
  it("attributes an overnight shift to its persisted business day", () => {
    vi.setSystemTime(new Date("2026-10-16T00:30:00Z"));
    const state = opened();
    state.paymentOperations!.drawerSessions[0]!.businessDate = date;
    expect(close(state).paymentOperations!.dayCloses[0]!.businessDate).toBe(date);
  });
});
