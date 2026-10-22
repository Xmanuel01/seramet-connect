import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  splitInvoiceComponents,
  verifyInvoiceComponents,
  type InvoiceComponents,
} from "./invoice-components";

const parts: InvoiceComponents = {
  version: 1,
  currency: "KES",
  grossSalesMinor: 10000,
  discountsMinor: 1000,
  netSalesMinor: 9000,
  serviceChargeMinor: 500,
  taxMinor: 1440,
  totalMinor: 10940,
};
const amounts = { subtotal: 95, tax: 14.4, total: 109.4, financialComponents: parts };
const draft: OrderDraft = {
  tenantId: DEMO_TENANT_ID,
  branchId: DEMO_WESTLANDS_BRANCH_ID,
  branch: DEMO_WESTLANDS_BRANCH_ID,
  customer: "Test",
  cashier: "Cashier",
  channel: "Dine In",
  lines: [{ id: "line", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }],
};
beforeEach(() =>
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState())),
);
afterEach(() => setConfigurationRepositoryForTests());

describe("immutable invoice economic component capture", () => {
  it("rejects invented, fractional, mismatched and cross-currency breakdowns", () => {
    expect(verifyInvoiceComponents(parts, amounts, "KES")).toEqual(parts);
    for (const changed of [
      { discountsMinor: 0 },
      { taxMinor: 1440.1 },
      { totalMinor: 1 },
      { currency: "USD" },
      { netSalesMinor: -1 },
    ]) {
      expect(() => verifyInvoiceComponents({ ...parts, ...changed }, amounts, "KES")).toThrow();
    }
  });
  it("records new known POS zeros explicitly but does not fabricate historical or provider components", () => {
    let state = TransactionEngine.createOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    expect(state.bills[0]!.financialComponents).toMatchObject({
      grossSalesMinor: 10000,
      discountsMinor: 0,
      serviceChargeMinor: 0,
      totalMinor: 10000,
    });
    state = TransactionEngine.createOrder(state, {
      ...draft,
      financialOverride: { subtotal: 95, tax: 14.4, total: 109.4 },
    });
    state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    expect(state.bills[0]!.financialComponents).toBeUndefined();
  });
  it("freezes known pricing, preserves split/merge amounts and leaves historical components unavailable", () => {
    let state = TransactionEngine.createOrder(createEmptyTransactionState(DEMO_TENANT_ID), {
      ...draft,
      financialOverride: amounts,
    });
    state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
    const invoice = state.bills[0]!;
    expect(invoice.financialComponents).toEqual(parts);
    state.orders[0]!.financialComponents!.grossSalesMinor = 1;
    expect(invoice.financialComponents!.grossSalesMinor).toBe(10000);
    state = TransactionEngine.splitBill(
      state,
      invoice.id,
      [
        { label: "One", amount: 50 },
        { label: "Two", amount: 59.4 },
      ],
      "Cashier",
    );
    const children = state.bills.filter((bill) => bill.splitFromBillId === invoice.id);
    for (const child of children)
      expect(verifyInvoiceComponents(child.financialComponents!, child, "KES")).toEqual(
        child.financialComponents,
      );
    state = TransactionEngine.mergeBills(
      state,
      children.map((bill) => bill.id),
      "Manager",
      "Recombine",
    );
    expect(state.bills[0]).toMatchObject({
      subtotal: 95,
      tax: 14.4,
      total: 109.4,
      financialComponents: parts,
    });
  });
  it("conserves every minor unit even for penny-sized split allocations", () => {
    const tiny = {
      ...parts,
      grossSalesMinor: 1,
      discountsMinor: 1,
      netSalesMinor: 0,
      serviceChargeMinor: 1,
      taxMinor: 1,
      totalMinor: 2,
    };
    const children = splitInvoiceComponents(tiny, [1, 1]);
    for (const child of children) expect(child.netSalesMinor).toBeGreaterThanOrEqual(0);
    for (const field of [
      "grossSalesMinor",
      "discountsMinor",
      "netSalesMinor",
      "serviceChargeMinor",
      "taxMinor",
      "totalMinor",
    ] as const)
      expect(children.reduce((sum, child) => sum + child[field], 0)).toBe(tiny[field]);
  });
});
