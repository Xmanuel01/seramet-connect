import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { SettlementService } from "@/payments/settlement-service";
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

beforeEach(() => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

/** An open KES 116 invoice and an open cash drawer, as at the counter. */
function openInvoice(): TransactionState {
  const state = createEmptyTransactionState(tenantId);
  const stamp = "2026-11-10T10:00:00.000Z";
  const lines = [{ id: "line-1", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }];
  state.orders.push({
    id: "order-1",
    tenantId,
    branchId,
    branch: "Branch",
    customer: "Guest",
    channel: "DINE_IN",
    cashier: "cashier",
    status: "BILL_REQUESTED",
    paymentStatus: "UNPAID",
    createdAt: stamp,
    updatedAt: stamp,
    businessDate: "2026-11-10",
    lines,
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
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: stamp,
    dueAt: stamp,
    businessDate: "2026-11-10",
    lines,
    subtotal: 100,
    tax: 16,
    total: 116,
    paid: 0,
  });
  state.paymentOperations!.drawerSessions.push({
    id: "drawer-1",
    tenantId,
    branchId,
    employeeId: "cashier",
    baseCurrency: "KES",
    openedAt: stamp,
    openingFloatMinor: 0,
    expectedCashMinor: 0,
    status: "OPEN",
    currencyBalances: { KES: { openingFloatMinor: 0, expectedCashMinor: 0 } },
    createdAt: stamp,
    updatedAt: stamp,
  });
  return state;
}

describe("split payment: one bill, several methods", () => {
  it("pays part in cash and the rest by card, then issues one receipt", () => {
    const service = new SettlementService();
    const methods = service.listMethods(tenantId);
    const cash = methods.find((method) => method.category === "CASH")!;
    const card = methods.find((method) => method.category === "CARD")!;
    expect(cash && card).toBeTruthy();

    let state = openInvoice();
    state = service.settle(state, {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: cash.id,
      amount: 60,
      reference: "",
      cashier: "cashier",
    });
    let bill = state.bills.find((item) => item.id === "invoice-1")!;
    expect(bill.status).toBe("PARTIAL");
    expect(bill.paid).toBe(60);
    expect(state.receipts.filter((receipt) => receipt.invoiceId === "invoice-1")).toHaveLength(0);

    state = service.settle(state, {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: card.id,
      amount: 56,
      reference: "CARD-APPROVAL-1",
      cashier: "cashier",
    });
    bill = state.bills.find((item) => item.id === "invoice-1")!;
    expect(bill.status).toBe("PAID");
    expect(bill.paid).toBe(116);
    const payments = state.payments.filter((payment) => payment.invoiceId === "invoice-1");
    expect(payments.map((payment) => payment.amount).sort((a, b) => a - b)).toEqual([56, 60]);
    expect(state.receipts.filter((receipt) => receipt.invoiceId === "invoice-1")).toHaveLength(1);
  });

  it("never takes more than is owed when the parts add up to too much", () => {
    const service = new SettlementService();
    const card = service.listMethods(tenantId).find((method) => method.category === "CARD")!;
    let state = openInvoice();
    state = service.settle(state, {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: card.id,
      amount: 100,
      reference: "CARD-A",
      cashier: "cashier",
    });
    state = service.settle(state, {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: card.id,
      amount: 100,
      reference: "CARD-B",
      cashier: "cashier",
    });
    const bill = state.bills.find((item) => item.id === "invoice-1")!;
    expect(bill.paid).toBe(116);
    expect(bill.status).toBe("PAID");
  });
});

describe("payments confirmed by reference, without a provider integration", () => {
  const manual = (category: string) =>
    new SettlementService()
      .listMethods(tenantId)
      .find((method) => method.category === category && !method.metadata["providerOperation"])!;

  it("marks the bill paid when an M-Pesa code is entered, and refuses the same code twice", () => {
    const service = new SettlementService();
    const mpesa = manual("DIGITAL_WALLET");
    expect(service.disposition(mpesa)).toBe("CONFIRMED");
    let state = service.settle(openInvoice(), {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: mpesa.id,
      amount: 116,
      reference: "SKL4QWERTY",
      cashier: "cashier",
    });
    expect(state.bills[0]!.status).toBe("PAID");
    expect(state.payments.find((payment) => payment.invoiceId === "invoice-1")?.reference).toBe(
      "SKL4QWERTY",
    );
    // A second bill can't be paid with the code already used.
    state.bills.push({ ...state.bills[0]!, id: "invoice-2", status: "OPEN", paid: 0 });
    expect(() =>
      service.settle(state, {
        tenantId,
        invoiceId: "invoice-2",
        paymentMethodId: mpesa.id,
        amount: 116,
        reference: "SKL4QWERTY",
        cashier: "cashier",
      }),
    ).toThrow();
    state = service.settle(state, {
      tenantId,
      invoiceId: "invoice-2",
      paymentMethodId: mpesa.id,
      amount: 116,
      reference: "SKL4ANOTHER",
      cashier: "cashier",
    });
    expect(state.bills.find((bill) => bill.id === "invoice-2")?.status).toBe("PAID");
  });

  it("marks the bill paid by bank transfer reference, and by card without one", () => {
    const service = new SettlementService();
    const bank = manual("BANK_TRANSFER");
    const paidByBank = service.settle(openInvoice(), {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: bank.id,
      amount: 116,
      reference: "FT2611100001",
      cashier: "cashier",
    });
    expect(paidByBank.bills[0]!.status).toBe("PAID");
    expect(() =>
      service.settle(openInvoice(), {
        tenantId,
        invoiceId: "invoice-1",
        paymentMethodId: bank.id,
        amount: 116,
        reference: "",
        cashier: "cashier",
      }),
    ).toThrow(/reference/);
    const card = manual("CARD");
    const paidByCard = service.settle(openInvoice(), {
      tenantId,
      invoiceId: "invoice-1",
      paymentMethodId: card.id,
      amount: 116,
      reference: "",
      cashier: "cashier",
    });
    expect(paidByCard.bills[0]!.status).toBe("PAID");
  });
});
