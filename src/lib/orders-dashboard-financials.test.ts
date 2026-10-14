import { describe, expect, it } from "vitest";
import { ordersDashboardFinancials } from "@/lib/orders-dashboard-financials";
import {
  createEmptyTransactionState,
  type BillingRecord,
  type TransactionOrder,
} from "@/lib/transaction-engine";

const at = "2026-09-29T22:30:00.000Z"; // Nairobi: 30 September
const activeBranch = (value?: string) => value === "westlands" || value === "Westlands";

const order = (overrides: Partial<TransactionOrder> = {}): TransactionOrder => ({
  id: "ORD-1",
  tenantId: "tenant",
  branchId: "westlands",
  branch: "Westlands",
  customer: "Guest",
  channel: "DINE_IN",
  cashier: "Cashier",
  status: "HELD",
  paymentStatus: "UNPAID",
  createdAt: at,
  updatedAt: at,
  lines: [],
  subtotal: 900,
  tax: 100,
  total: 1000,
  ...overrides,
});

const bill = (overrides: Partial<BillingRecord> = {}): BillingRecord => ({
  id: "INV-1",
  tenantId: "tenant",
  branchId: "westlands",
  orderIds: ["ORD-1"],
  branch: "Westlands",
  customer: "Guest",
  status: "OPEN",
  paymentStatus: "UNPAID",
  issuedAt: at,
  dueAt: at,
  lines: [],
  subtotal: 900,
  tax: 100,
  total: 1000,
  paid: 0,
  ...overrides,
});

describe("Orders dashboard financial populations", () => {
  it("keeps held orders out of invoice balances and paid invoice sales", () => {
    const state = createEmptyTransactionState("tenant");
    state.orders = [order()];
    const report = ordersDashboardFinancials(
      state,
      activeBranch,
      "2026-09-30",
      "Africa/Nairobi",
      "KES",
    );
    expect(report).toMatchObject({
      activeOrderValue: 1000,
      invoiceOutstanding: 0,
      paidInvoiceSales: 0,
      providerReceivables: 0,
      completedRefunds: 0,
    });
  });

  it("uses authoritative partial invoice balances without counting cancelled or void orders", () => {
    const state = createEmptyTransactionState("tenant");
    state.orders = [
      order({ id: "open", status: "SENT_TO_KITCHEN", total: 300 }),
      order({ id: "cancelled", status: "CANCELLED", total: 4000 }),
      order({ id: "refunded", status: "REFUNDED", total: 900 }),
      order({ id: "paid", status: "PAID", total: 1000 }),
      order({ id: "other-branch", branchId: "ngong", branch: "Ngong", total: 3000 }),
    ];
    state.bills = [
      bill({ id: "partial", status: "PARTIAL", paymentStatus: "PARTIAL", paid: 350 }),
      bill({ id: "paid", status: "PAID", paymentStatus: "PAID", total: 1250, paid: 1250 }),
      bill({ id: "void", status: "VOID", total: 9000 }),
      bill({ id: "merged", status: "MERGED", total: 5000 }),
      bill({ id: "split", status: "SPLIT", total: 5000 }),
      bill({ id: "draft", status: "DRAFT_BILL", total: 5000 }),
      bill({ id: "another", branchId: "ngong", branch: "Ngong", total: 5000 }),
    ];
    const report = ordersDashboardFinancials(
      state,
      activeBranch,
      "2026-09-30",
      "Africa/Nairobi",
      "KES",
    );
    expect(report.activeOrderValue).toBe(300);
    expect(report.invoiceOutstanding).toBe(650);
    expect(report.paidInvoiceSales).toBe(1250);
  });

  it("isolates business dates and settlement-ledger provider receivables", () => {
    const state = createEmptyTransactionState("tenant");
    state.orders = [order(), order({ id: "yesterday", businessDate: "2026-09-29" })];
    state.bills = [
      bill({ id: "external", status: "PROVIDER_RECEIVABLE", paymentStatus: "PROVIDER_RECEIVABLE" }),
      bill({ id: "old", businessDate: "2026-09-29", status: "PAID", paymentStatus: "PAID" }),
    ];
    state.marketplaceReceivables = [
      {
        id: "receivable-1",
        tenantId: "tenant",
        branchId: "westlands",
        branch: "Westlands",
        orderId: "ORD-1",
        invoiceId: "external",
        connectionId: "marketplace-1",
        providerId: "provider",
        externalOrderId: "ext-1",
        currency: "KES",
        grossAmount: 1000,
        externallyCollectedAmount: 1000,
        settledAmount: 250,
        outstandingAmount: 750,
        status: "PARTIALLY_SETTLED",
        receivableAccount: "Marketplace Receivables",
        metadata: {},
        createdAt: at,
        updatedAt: at,
      },
    ];
    const report = ordersDashboardFinancials(
      state,
      activeBranch,
      "2026-09-30",
      "Africa/Nairobi",
      "KES",
    );
    expect(report.activeOrderValue).toBe(1000);
    expect(report.providerReceivables).toBe(750);
    expect(report.paidInvoiceSales).toBe(0);
    expect(report.invoiceOutstanding).toBe(0);
  });

  it("counts completed refunds on completion day, separately from paid invoice sales", () => {
    const state = createEmptyTransactionState("tenant");
    state.bills = [bill({ status: "PAID", paymentStatus: "PAID", paid: 1000 })];
    state.refunds = [
      {
        id: "refund-1",
        tenantId: "tenant",
        branchId: "westlands",
        branch: "Westlands",
        orderId: "ORD-1",
        invoiceId: "INV-1",
        amount: 100,
        method: "CASH",
        reason: "Correction",
        requestedBy: "Manager",
        status: "COMPLETED",
        createdAt: "2026-09-29T10:00:00.000Z",
        completedAt: at,
      },
      {
        id: "refund-pending",
        tenantId: "tenant",
        branchId: "westlands",
        branch: "Westlands",
        orderId: "ORD-1",
        invoiceId: "INV-1",
        amount: 1000,
        method: "CASH",
        reason: "Unapproved",
        requestedBy: "Manager",
        status: "REQUESTED",
        createdAt: at,
      },
    ];
    const report = ordersDashboardFinancials(
      state,
      activeBranch,
      "2026-09-30",
      "Africa/Nairobi",
      "KES",
    );
    expect(report.paidInvoiceSales).toBe(1000);
    expect(report.completedRefunds).toBe(100);
  });

  it("uses the configured cutoff for legacy records without a persisted business date", () => {
    const state = createEmptyTransactionState("tenant");
    state.orders = [order({ createdAt: "2026-09-30T00:30:00.000Z" })];
    const report = ordersDashboardFinancials(
      state,
      activeBranch,
      "2026-09-29",
      "Africa/Nairobi",
      "KES",
      240,
    );
    expect(report.activeOrderValue).toBe(1000);
  });
});
