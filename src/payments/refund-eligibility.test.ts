import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TransactionEngine, createEmptyTransactionState } from "@/lib/transaction-engine";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { refundableReceiptMinor } from "./refund-eligibility";
beforeEach(() =>
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState())),
);
afterEach(() => setConfigurationRepositoryForTests());
function paid() {
  let state = TransactionEngine.createOrder(createEmptyTransactionState(DEMO_TENANT_ID), {
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    branch: DEMO_WESTLANDS_BRANCH_ID,
    cashier: "Cashier",
    customer: "Customer",
    channel: "Dine In",
    lines: [{ id: "meal", name: "Meal", category: "Food", quantity: 1, unitPrice: 100 }],
  });
  state = TransactionEngine.createOpenBill(state, state.orders[0]!.id);
  state = TransactionEngine.recordCashPayment(state, state.bills[0]!.id, {
    received: 100,
    cashier: "Cashier",
    terminal: "Fixture",
  });
  const receipt = state.receipts[0]!;
  expect(receipt).toBeTruthy();
  return {
    state,
    receipt,
    input: {
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: receipt.branch,
      receiptId: receipt.id,
      invoiceId: receipt.invoiceId,
      orderId: receipt.orderId,
      amount: 20,
      method: receipt.paymentBreakdown[0]!.method,
      reason: "Wrong item received",
      requestedBy: "Cashier",
      requestedById: "verified-cashier",
      requestKey: "single-intent",
    },
  };
}
describe("selected-source refund reservations", () => {
  it("reserves exact collected amounts and deduplicates retries without duplicate audit entries", () => {
    const { state, receipt, input } = paid();
    const next = TransactionEngine.requestRefund(state, input);
    expect(refundableReceiptMinor(next, receipt, input.method, "KES")).toBe(8000);
    expect(TransactionEngine.requestRefund(next, input)).toEqual(next);
    expect(() => TransactionEngine.requestRefund(next, { ...input, amount: 30 })).toThrow(
      /identity/,
    );
    expect(() =>
      TransactionEngine.requestRefund(next, { ...input, requestKey: "second", amount: 81 }),
    ).toThrow(/remaining/);
    const approved = TransactionEngine.approveRefund(next, next.refunds[0]!.id, "Verified manager");
    expect(approved.refunds[0]!.status).toBe("APPROVED");
    expect(
      TransactionEngine.approveRefund(approved, approved.refunds[0]!.id, "Verified manager"),
    ).toEqual(approved);
    expect(state.refunds).toHaveLength(0);
  });
  it("rejects forged sources, wrong methods, invalid amounts and absent reasons", () => {
    const { state, input } = paid();
    for (const changed of [
      { receiptId: "missing" },
      { invoiceId: "other" },
      { orderId: "other" },
      { branchId: "other" },
      { tenantId: "other" },
      { method: "UNCONFIRMED" },
      { amount: 0 },
      { amount: -1 },
      { amount: 100.001 },
      { reason: " " },
      { requestKey: "" },
    ])
      expect(() => TransactionEngine.requestRefund(state, { ...input, ...changed })).toThrow();
    expect(state.refunds).toEqual([]);
  });
  it("ignores injected state, identity and approver fields and never treats pending funds as collected", () => {
    const { state, receipt, input } = paid();
    const injected = { ...input, status: "COMPLETED", id: "forged", approvedBy: "forged" };
    const next = TransactionEngine.requestRefund(state, injected);
    expect(next.refunds[0]).toMatchObject({ status: "REQUESTED" });
    expect(next.refunds[0]!.id).not.toBe("forged");
    expect(next.refunds[0]!.approvedBy).toBeUndefined();
    state.payments[0]!.settlementStatus = "PENDING";
    expect(refundableReceiptMinor(state, receipt, input.method, "KES")).toBe(0);
    expect(() => TransactionEngine.requestRefund(state, input)).toThrow(/remaining/);
  });
  it("does not increase refundable funds through negative legacy reservations", () => {
    const { state, receipt, input } = paid();
    const next = TransactionEngine.requestRefund(state, input);
    next.refunds[0]!.amount = -20;
    expect(refundableReceiptMinor(next, receipt, input.method, "KES")).toBe(10000);
    expect(() => TransactionEngine.approveRefund(next, next.refunds[0]!.id, "Manager")).toThrow();
  });
  it("rejects only the exact pending request with a reason, releases its reservation and deduplicates rejection", () => {
    const { state, receipt, input } = paid();
    const requested = TransactionEngine.requestRefund(state, input);
    const key = requested.refunds[0]!.id;
    expect(() => TransactionEngine.rejectRefund(requested, key, "Manager", " ")).toThrow();
    const rejected = TransactionEngine.rejectRefund(
      requested,
      key,
      "Manager",
      "Not eligible after review",
    );
    expect(rejected.refunds[0]).toMatchObject({
      status: "REJECTED",
      rejectedBy: "Manager",
      rejectionReason: "Not eligible after review",
    });
    expect(refundableReceiptMinor(rejected, receipt, input.method, "KES")).toBe(10000);
    expect(
      TransactionEngine.rejectRefund(rejected, key, "Manager", "Not eligible after review"),
    ).toEqual(rejected);
    expect(() => TransactionEngine.approveRefund(rejected, key, "Manager")).toThrow();
    const approved = TransactionEngine.approveRefund(requested, key, "Manager");
    expect(() => TransactionEngine.rejectRefund(approved, key, "Manager", "Too late")).toThrow();
  });
});
