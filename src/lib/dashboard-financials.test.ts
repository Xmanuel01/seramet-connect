import { describe, expect, it } from "vitest";
import { buildDashboardFinancials } from "@/lib/dashboard-financials";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import type { Branch } from "@/platform/types";

const tenantId = "dashboard-tenant";
const branch: Branch = {
  id: "dashboard-branch",
  tenantId,
  code: "NBO",
  name: "Nairobi",
  address: "",
  phone: "",
  email: "",
  timezone: "Africa/Nairobi",
  currency: "KES",
  active: true,
  metadata: { businessDayCutoffMinutes: 240 },
};

function addSale(
  state: TransactionState,
  input: { id: string; timestamp: string; subtotal: number; tax: number; businessDate?: string },
) {
  const total = input.subtotal + input.tax;
  state.orders.push({
    id: `order-${input.id}`,
    tenantId,
    branchId: branch.id,
    branch: branch.name,
    customer: "Guest",
    channel: "DINE_IN",
    cashier: "Cashier",
    status: "PAID",
    paymentStatus: "PAID",
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
    lines: [],
    subtotal: input.subtotal,
    tax: input.tax,
    total,
  });
  state.bills.push({
    id: `invoice-${input.id}`,
    tenantId,
    branchId: branch.id,
    orderIds: [`order-${input.id}`],
    branch: branch.name,
    customer: "Guest",
    status: "PAID",
    paymentStatus: "PAID",
    issuedAt: input.timestamp,
    dueAt: input.timestamp,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
    lines: [],
    subtotal: input.subtotal,
    tax: input.tax,
    total,
    paid: total,
  });
  state.payments.push({
    id: `payment-${input.id}`,
    tenantId,
    branchId: branch.id,
    invoiceId: `invoice-${input.id}`,
    orderId: `order-${input.id}`,
    branch: branch.name,
    method: "CASH",
    provider: "Cash",
    amount: total,
    currency: "KES",
    reference: `cash-${input.id}`,
    cashier: "Cashier",
    terminal: "POS",
    timestamp: input.timestamp,
    ...(input.businessDate ? { businessDate: input.businessDate } : {}),
    reconciliationStatus: "RECONCILED",
    settlementStatus: "NOT_REQUIRED",
  });
}

describe("dashboard canonical financial periods", () => {
  it("uses branch cutoff dates and canonical settled revenue for every period", () => {
    const state = createEmptyTransactionState(tenantId);
    addSale(state, {
      id: "before-cutoff",
      timestamp: "2026-09-30T00:30:00.000Z",
      subtotal: 100,
      tax: 16,
    });
    addSale(state, {
      id: "after-cutoff",
      timestamp: "2026-09-30T04:30:00.000Z",
      subtotal: 200,
      tax: 32,
    });
    state.orders.push({
      ...state.orders[0]!,
      id: "order-unsettled",
      status: "SERVED",
      paymentStatus: "UNPAID",
      subtotal: 500,
      tax: 80,
      total: 580,
    });

    const today = buildDashboardFinancials({
      state,
      tenantId,
      branches: [branch],
      period: "Today",
      now: new Date("2026-09-30T00:45:00.000Z"),
      currency: "KES",
      fallbackTimeZone: "UTC",
      locale: "en-KE",
    });
    expect(today).toMatchObject({ netSales: 100, collected: 116 });
    expect(today.orders).toHaveLength(2);
    expect(today.branches[0]).toMatchObject({ sales: 100, orders: 2 });

    const month = buildDashboardFinancials({
      state,
      tenantId,
      branches: [branch],
      period: "Month",
      now: new Date("2026-09-30T08:00:00.000Z"),
      currency: "KES",
      fallbackTimeZone: "UTC",
      locale: "en-KE",
    });
    expect(month.netSales).toBe(300);
    expect(month.collected).toBe(348);
  });
});
