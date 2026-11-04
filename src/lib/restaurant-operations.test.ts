import { describe, expect, it, vi } from "vitest";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { deriveBranchOperations } from "@/lib/restaurant-operations";

describe("restaurant operations branch isolation", () => {
  it("counts paid unfinished kitchen work but excludes served lines and uses dispatch age", () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-04T12:00:00Z"));
    try {
      const state = createEmptyTransactionState("tenant-branch-isolation");
      state.orders = [
        {
          id: "paid-pending",
          branch: "Branch A",
          status: "PAID",
          createdAt: "2026-11-04T10:00:00Z",
          lines: [
            {
              productionStation: "HOT",
              productionStatus: "PREPARING",
              sentAt: "2026-11-04T11:00:00Z",
            },
          ],
        },
        {
          id: "served",
          branch: "Branch A",
          status: "IN_PROGRESS",
          createdAt: "2026-11-04T10:00:00Z",
          lines: [{ productionStation: "HOT", productionStatus: "SERVED" }],
        },
        {
          id: "recently-sent",
          branch: "Branch A",
          status: "SENT_TO_KITCHEN",
          createdAt: "2026-11-04T10:00:00Z",
          lines: [
            { productionStation: "HOT", productionStatus: "NEW", sentAt: "2026-11-04T11:59:00Z" },
          ],
        },
      ] as unknown as TransactionState["orders"];
      expect(deriveBranchOperations(state, "Branch A").lateKitchenTickets).toBe(1);
      expect(state.orders).toHaveLength(3);
      expect(state.orders[0]!.status).toBe("PAID");
    } finally {
      clock.mockRestore();
    }
  });
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
