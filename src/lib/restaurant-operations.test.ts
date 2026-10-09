import { describe, expect, it } from "vitest";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { deriveBranchOperations } from "@/lib/restaurant-operations";

describe("restaurant operations branch isolation", () => {
  it("excludes records with missing branch identity from branch summaries", () => {
    const state = createEmptyTransactionState("tenant-branch-isolation");
    state.orders = [
      { branch: undefined, status: "OPEN", createdAt: new Date().toISOString() },
      { branch: "Branch A", status: "OPEN", createdAt: new Date().toISOString() },
    ] as unknown as TransactionState["orders"];
    state.payments = [
      { branch: undefined, reconciliationStatus: "UNMATCHED" },
    ] as unknown as TransactionState["payments"];
    state.refunds = [
      { branch: undefined, status: "REQUESTED", amount: 500 },
    ] as unknown as TransactionState["refunds"];
    state.cashDrawers = [
      { branch: undefined, status: "VARIANCE_REVIEW", variance: 500 },
    ] as unknown as TransactionState["cashDrawers"];
    state.attendanceRecords = [
      { branch: undefined, status: "ABSENT", employeeName: "Unscoped employee" },
    ] as unknown as TransactionState["attendanceRecords"];

    const branch = deriveBranchOperations(state, "Branch A");
    expect(branch.openOrders).toBe(1);
    expect(branch.unreadablePayments).toBe(0);
    expect(branch.actions.map((action) => action.id)).not.toEqual(
      expect.arrayContaining([
        "payment-reconciliation",
        "refund-approval",
        "cash-variance",
        "people-exceptions",
      ]),
    );

    const allBranches = deriveBranchOperations(state, "All Branches");
    expect(allBranches.openOrders).toBe(1);
    expect(allBranches.unreadablePayments).toBe(0);

    const paddedBranch = deriveBranchOperations(state, " Branch A ");
    expect(paddedBranch.openOrders).toBe(1);
  });
});
