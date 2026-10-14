import { beforeEach, describe, expect, it } from "vitest";
import { financialCloseReadiness, projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { ReconciliationEngine } from "@/payments/reconciliation-engine";
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
const businessDate = "2026-09-26";

beforeEach(() => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

describe("canonical financial lifecycle projection", () => {
  it("reports one sale consistently from order through receipt using integer minor units", () => {
    const state = settledState();
    const projection = projectFinancialLifecycle(state, {
      tenantId,
      branchId,
      businessDate,
      currency: "KES",
      calculatedAt: "2026-09-26T12:00:00.000Z",
    });

    expect(projection).toMatchObject({
      orderedMinor: 11_600,
      invoicedMinor: 11_600,
      settledMinor: 11_600,
      collectedMinor: 11_600,
      netRevenueMinor: 10_000,
      taxMinor: 1_600,
      orderCount: 1,
      invoiceCount: 1,
      settledInvoiceCount: 1,
      receiptCount: 1,
    });
    expect(projection.tenders).toEqual([{ method: "CASH", amountMinor: 11_600 }]);
    expect(projection.journal).toEqual([
      { account: "Cash", debitMinor: 11_600, creditMinor: 0 },
      { account: "Receivable", debitMinor: 0, creditMinor: 11_600 },
    ]);
    expect(financialCloseReadiness(state, { tenantId, branchId, businessDate })).toEqual([]);
  });

  it("blocks close on comprehensive operational and financial readiness failures", () => {
    const state = settledState();
    state.orders[0]!.status = "SERVED";
    state.orders[0]!.paymentStatus = "UNPAID";
    state.bills[0]!.status = "OPEN";
    state.bills[0]!.paymentStatus = "UNPAID";
    state.paymentOperations!.drawerSessions.push({
      id: "drawer-open",
      tenantId,
      branchId,
      employeeId: "employee",
      baseCurrency: "KES",
      openedAt: "2026-09-26T08:00:00.000Z",
      openingFloatMinor: 1_000,
      expectedCashMinor: 1_000,
      status: "OPEN",
      currencyBalances: { KES: { openingFloatMinor: 1_000, expectedCashMinor: 1_000 } },
      createdAt: "2026-09-26T08:00:00.000Z",
      updatedAt: "2026-09-26T08:00:00.000Z",
    });

    expect(
      financialCloseReadiness(state, { tenantId, branchId, businessDate }).map((item) => item.code),
    ).toEqual(["OPEN_CASH_DRAWER", "OPEN_ORDER", "UNSETTLED_INVOICE"]);
  });

  it("attributes legacy and spanning-midnight drawers to the branch business date", () => {
    const state = createEmptyTransactionState(tenantId);
    state.paymentOperations!.drawerSessions.push({
      id: "drawer-before-cutoff",
      tenantId,
      branchId,
      employeeId: "employee",
      baseCurrency: "KES",
      openedAt: "2026-09-30T00:30:00.000Z",
      openingFloatMinor: 1_000,
      expectedCashMinor: 1_000,
      status: "OPEN",
      currencyBalances: { KES: { openingFloatMinor: 1_000, expectedCashMinor: 1_000 } },
      createdAt: "2026-09-30T00:30:00.000Z",
      updatedAt: "2026-09-30T00:30:00.000Z",
    });

    const context = { timeZone: "Africa/Nairobi", businessDayCutoffMinutes: 240 };
    expect(
      financialCloseReadiness(state, {
        tenantId,
        branchId,
        businessDate: "2026-09-29",
        ...context,
      }).map((item) => item.code),
    ).toEqual(["OPEN_CASH_DRAWER"]);
    expect(
      financialCloseReadiness(state, {
        tenantId,
        branchId,
        businessDate: "2026-09-30",
        ...context,
      }),
    ).toEqual([]);

    state.paymentOperations!.drawerSessions[0]!.businessDate = "2026-09-29";
    state.paymentOperations!.drawerSessions[0]!.status = "CLOSED";
    state.paymentOperations!.drawerSessions[0]!.closedAt = "2026-09-30T03:30:00.000Z";
    state.paymentOperations!.drawerSessions[0]!.varianceMinor = 250;
    expect(
      projectFinancialLifecycle(state, {
        tenantId,
        branchId,
        businessDate: "2026-09-29",
        currency: "KES",
        ...context,
      }).cashVarianceMinor,
    ).toBe(250);
  });

  it("blocks EOD for an unposted settlement on the branch accounting date", () => {
    const state = createEmptyTransactionState(tenantId);
    state.paymentOperations!.settlementBatches.push({
      id: "settlement-before-cutoff",
      tenantId,
      branchId,
      connectionId: "marketplace",
      externalSettlementId: "provider-settlement",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-30T00:30:00.000Z",
      settledAt: "2026-09-30T00:30:00.000Z",
      currency: "KES",
      grossSalesMinor: 10_000,
      commissionsMinor: 0,
      serviceFeesMinor: 0,
      deliveryAdjustmentsMinor: 0,
      promotionsMinor: 0,
      refundsMinor: 0,
      taxAdjustmentsMinor: 0,
      otherAdjustmentsMinor: 0,
      netExpectedMinor: 10_000,
      netSettledMinor: 0,
      status: "IMPORTED",
      importedBy: "manager",
      importedAt: "2026-09-30T00:30:00.000Z",
      updatedAt: "2026-09-30T00:30:00.000Z",
    });

    expect(
      financialCloseReadiness(state, {
        tenantId,
        branchId,
        businessDate: "2026-09-29",
        timeZone: "Africa/Nairobi",
        businessDayCutoffMinutes: 240,
      }).map((item) => item.code),
    ).toEqual(["UNPOSTED_SETTLEMENT"]);
  });

  it("stores immutable revisioned close snapshots and recalculates blockers at close", () => {
    const engine = new ReconciliationEngine();
    let state = engine.prepareDayClose(settledState(), {
      tenantId,
      branchId,
      businessDate,
      actor: "manager",
      currency: "KES",
    });
    const closeId = state.paymentOperations!.dayCloses[0]!.id;
    state = engine.closeDay(state, {
      tenantId,
      dayCloseId: closeId,
      actor: "manager",
      hasOverridePermission: false,
    });
    const first = state.paymentOperations!.dayCloses[0]!;
    expect(first.snapshot).toMatchObject({ revision: 1, settledMinor: 11_600 });
    expect(first.snapshots).toHaveLength(1);
    const immutableFirst = structuredClone(first.snapshot);

    state = engine.reopenDay(state, {
      tenantId,
      dayCloseId: closeId,
      actor: "manager",
      reason: "Approved correction",
    });
    state = engine.closeDay(state, {
      tenantId,
      dayCloseId: closeId,
      actor: "manager",
      hasOverridePermission: false,
    });
    const second = state.paymentOperations!.dayCloses[0]!;
    expect(second.snapshot?.revision).toBe(2);
    expect(second.snapshots).toHaveLength(2);
    expect(second.snapshots[0]).toEqual(immutableFirst);
  });
});

function settledState(): TransactionState {
  const state = createEmptyTransactionState(tenantId);
  state.orders.push({
    id: "order-1",
    tenantId,
    branchId,
    branch: "Branch",
    customer: "Guest",
    channel: "DINE_IN",
    cashier: "cashier",
    status: "PAID",
    paymentStatus: "PAID",
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-26T10:10:00.000Z",
    businessDate,
    lines: [{ id: "line-1", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }],
    subtotal: 100,
    tax: 16,
    total: 116,
  });
  state.bills.push({
    id: "invoice-1",
    tenantId,
    branchId,
    orderIds: ["order-1"],
    branch: "Branch",
    customer: "Guest",
    status: "PAID",
    paymentStatus: "PAID",
    issuedAt: "2026-09-26T10:05:00.000Z",
    dueAt: "2026-09-26T12:05:00.000Z",
    businessDate,
    lines: [{ id: "line-1", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }],
    subtotal: 100,
    tax: 16,
    total: 116,
    paid: 116,
  });
  state.payments.push({
    id: "payment-1",
    tenantId,
    branchId,
    invoiceId: "invoice-1",
    orderId: "order-1",
    branch: "Branch",
    method: "CASH",
    provider: "Configured cash",
    amount: 116,
    currency: "KES",
    reference: "CASH-1",
    cashier: "cashier",
    terminal: "terminal",
    timestamp: "2026-09-26T10:10:00.000Z",
    businessDate,
    reconciliationStatus: "RECONCILED",
    settlementStatus: "NOT_REQUIRED",
  });
  state.receipts.push({
    id: "receipt-1",
    tenantId,
    branchId,
    orderId: "order-1",
    invoiceId: "invoice-1",
    branch: "Branch",
    cashier: "cashier",
    customer: "Guest",
    issuedAt: "2026-09-26T10:10:00.000Z",
    businessDate,
    total: 116,
    paidAmount: 116,
    change: 0,
    paymentBreakdown: [{ method: "CASH", amount: 116, reference: "CASH-1" }],
    reprints: [],
  });
  state.journalEntries.push({
    id: "journal-1",
    tenantId,
    branchId,
    branch: "Branch",
    sourceType: "Payment",
    sourceId: "payment-1",
    status: "POSTED",
    postedAt: "2026-09-26T10:10:00.000Z",
    businessDate,
    lines: [
      { account: "Cash", debit: 116, credit: 0, costCentre: "Branch" },
      { account: "Receivable", debit: 0, credit: 116, costCentre: "Branch" },
    ],
  });
  return state;
}
