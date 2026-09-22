import { describe, expect, it } from "vitest";
import { createEmptyTransactionState, type BillingRecord } from "@/lib/transaction-engine";
import { currentMonthJournalStatus, currentMonthSettledSales } from "@/lib/financial-reporting";

const bill = (overrides: Partial<BillingRecord> = {}): BillingRecord => ({
  id: "BILL-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  orderIds: ["ORD-1"],
  branch: "Westlands",
  customer: "Guest",
  status: "PAID",
  paymentStatus: "PAID",
  issuedAt: "2026-09-22T10:00:00.000Z",
  dueAt: "2026-09-22T12:00:00.000Z",
  lines: [{ id: "L-1", name: "Pilau", category: "Main", quantity: 2, unitPrice: 500 }],
  subtotal: 1000,
  tax: 160,
  total: 1160,
  paid: 1160,
  ...overrides,
});

describe("financial reporting", () => {
  it("reports only settled sales in the selected branch and month", () => {
    const state = createEmptyTransactionState("tenant-1");
    state.bills = [
      bill(),
      bill({
        id: "BILL-OPEN",
        status: "OPEN",
        paymentStatus: "UNPAID",
        paid: 0,
      }),
      bill({
        id: "BILL-OTHER",
        branchId: "branch-2",
        branch: "Ngong",
      }),
      bill({
        id: "BILL-OLD",
        issuedAt: "2026-08-31T10:00:00.000Z",
      }),
    ];

    const result = currentMonthSettledSales(
      state,
      (branch) => branch === "branch-1" || branch === "Westlands",
      new Date("2026-09-22T12:00:00.000Z"),
    );

    expect(result.grossSales).toBe(1160);
    expect(result.netSales).toBe(1000);
    expect(result.taxCollected).toBe(160);
    expect(result.settledInvoices).toBe(1);
    expect(result.revenueByCategory).toEqual([{ category: "Main", revenue: 1000 }]);
  });

  it("calculates out-of-balance and draft voucher counts from scoped journals", () => {
    const state = createEmptyTransactionState("tenant-1");
    state.journalEntries = [
      {
        id: "JE-1",
        tenantId: "tenant-1",
        branchId: "branch-1",
        branch: "Westlands",
        sourceType: "Payment",
        sourceId: "PAY-1",
        status: "POSTED",
        postedAt: "2026-09-22T10:00:00.000Z",
        lines: [
          { account: "Cash", debit: 1000, credit: 0, costCentre: "Westlands" },
          { account: "Receivable", debit: 0, credit: 900, costCentre: "Westlands" },
        ],
      },
      {
        id: "JE-2",
        tenantId: "tenant-1",
        branchId: "branch-1",
        branch: "Westlands",
        sourceType: "Manual",
        sourceId: "DRAFT-1",
        status: "DRAFT",
        lines: [],
      },
    ];

    const result = currentMonthJournalStatus(
      state,
      (branch) => branch === "branch-1" || branch === "Westlands",
      new Date("2026-09-22T12:00:00.000Z"),
    );

    expect(result.outOfBalance).toBe(100);
    expect(result.unpostedVouchers).toBe(1);
  });
});
