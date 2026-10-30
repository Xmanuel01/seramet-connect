import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import {
  createEmptyTransactionState,
  normalizeTransactionState,
  type BillingRecord,
  type TransactionState,
} from "@/lib/transaction-engine";
import { closeBusinessDay } from "@/payments/daily-closing";
import { mpesaDaySummary } from "@/payments/mpesa-day-summary";
import { PaymentOrchestrator } from "@/payments/payment-orchestrator";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { allPermissionCodes } from "@/platform/permissions";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { closingReportSections } from "@/server/daily-closing-report";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const orchestrator = new PaymentOrchestrator();
const actor: ServerActor = {
  id: "close-manager",
  name: "Manager",
  tenantId,
  branchId,
  branch: "Westlands",
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "Westlands" }],
  roleIds: [],
  permissions: [...allPermissionCodes],
  role: "Manager",
  branchScope: { type: "BRANCH", branchId },
};
const scope = {
  tenantId,
  branchId,
  businessDate: "2026-10-15",
  timeZone: "Africa/Nairobi",
  businessDayCutoffMinutes: 0,
  currency: "KES",
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T19:00:00Z"));
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

afterEach(() => {
  vi.useRealTimers();
  setConfigurationRepositoryForTests(undefined);
});

describe("the day's M-Pesa summary", () => {
  it("splits money by how it arrived and shows what is on bills", () => {
    let state = withBills(bill("INV-1", 1_000), bill("INV-2", 500));
    state = promptPaid(state, "INV-1", 1_000, "RKP1");
    state = direct(state, "RKD1", 500, "2026-10-15T08:00:00.000Z");
    state = orchestrator.applyUnallocatedCollection(state, {
      tenantId,
      transactionId: id(state, "RKD1"),
      allocations: [{ invoiceId: "INV-2", amountMinor: 50_000 }],
      actor: "Cashier",
      matchedBy: "RECEIPT_CODE",
    });
    state = direct(state, "RKD2", 300, "2026-10-15T09:00:00.000Z");
    const summary = mpesaDaySummary(state, scope)!;
    expect(summary).toMatchObject({
      receivedMinor: 180_000,
      count: 3,
      onBillsMinor: 150_000,
      stillToMatchMinor: 30_000,
    });
    expect(summary.channels).toEqual([
      { channel: "PROMPT", count: 1, amountMinor: 100_000 },
      { channel: "DIRECT", count: 2, amountMinor: 80_000 },
    ]);
  });

  it("carries unmatched payments from earlier days and lists failed prompts with reasons", () => {
    let state = direct(withBills(), "RKOLD", 700, "2026-10-14T10:00:00.000Z");
    const created = orchestrator.createIntent(state, {
      tenantId,
      branchId,
      invoiceIds: [],
      paymentMethodId: "payment-demo-mpesa-prompt",
      amountRequestedMinor: 40_000,
      currency: "KES",
      createdBy: "Cashier",
      idempotencyKey: "failed-prompt",
    } as Parameters<PaymentOrchestrator["createIntent"]>[1]);
    state = orchestrator.failIntent(created.state, {
      tenantId,
      intentId: created.intent.id,
      actor: "Status check",
      reason: "The customer cancelled the payment prompt",
    });
    const summary = mpesaDaySummary(state, scope)!;
    expect(summary.receivedMinor).toBe(0);
    expect(summary.stillToMatch).toMatchObject([{ receipt: "RKOLD", businessDate: "2026-10-14" }]);
    expect(summary.failedPrompts).toMatchObject([
      { amountMinor: 40_000, reason: "The customer cancelled the payment prompt" },
    ]);
  });

  it("is absent when the day had no M-Pesa activity", () => {
    expect(mpesaDaySummary(withBills(), scope)).toBeUndefined();
  });
});

describe("closing the day with M-Pesa not on a bill", () => {
  it("asks why, then closes and keeps the reason and the list in the report", () => {
    const state = direct(withBills(bill("INV-1", 250)), "RKX1", 250, "2026-10-15T10:00:00.000Z");
    expect(() =>
      closeBusinessDay(state, actor, {
        businessDate: "2026-10-15",
        drawerCounts: [],
        confirmed: true,
      }),
    ).toThrow(/1 M-Pesa payment\(s\) totalling .* are not on a bill yet/);
    const closed = closeBusinessDay(state, actor, {
      businessDate: "2026-10-15",
      drawerCounts: [],
      confirmed: true,
      mpesaCarryOverReason: "Customer left before we could confirm the table",
    });
    const report = closed.paymentOperations!.dayCloses[0]!.snapshot!.dailyReport!;
    expect(report.mpesaCarryOverReason).toBe("Customer left before we could confirm the table");
    expect(report.mpesa).toMatchObject({ stillToMatchMinor: 25_000 });
    // The payment is still unmatched, ready to be applied later.
    expect(closed.paymentOperations!.transactions[0]!.unallocatedAmountMinor).toBe(25_000);
    const sections = closingReportSections(closed.paymentOperations!.dayCloses[0]!.snapshot!);
    expect(sections.find((s) => s.title === "M-Pesa")!.rows).toContainEqual([
      "Carried over because",
      "Customer left before we could confirm the table",
    ]);
  });

  it("closes without a reason when every M-Pesa payment is on a bill", () => {
    let state = direct(withBills(bill("INV-1", 250)), "RKX2", 250, "2026-10-15T10:00:00.000Z");
    state = orchestrator.applyUnallocatedCollection(state, {
      tenantId,
      transactionId: id(state, "RKX2"),
      allocations: [{ invoiceId: "INV-1", amountMinor: 25_000 }],
      actor: "Cashier",
      matchedBy: "CASHIER_CONFIRMED",
    });
    const closed = closeBusinessDay(state, actor, {
      businessDate: "2026-10-15",
      drawerCounts: [],
      confirmed: true,
    });
    const report = closed.paymentOperations!.dayCloses[0]!.snapshot!.dailyReport!;
    expect(report.mpesa).toMatchObject({ receivedMinor: 25_000, onBillsMinor: 25_000 });
    expect(report.mpesaCarryOverReason).toBeUndefined();
  });
});

function bill(invoiceId: string, total: number): BillingRecord {
  return {
    id: invoiceId,
    tenantId,
    branchId,
    orderIds: [],
    branch: "Westlands",
    customer: "Walk-in Customer",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt: "2026-10-15T07:00:00.000Z",
    businessDate: "2026-10-15",
    dueAt: "2026-10-15T07:00:00.000Z",
    lines: [
      { id: `${invoiceId}-L`, name: "Meal", category: "Main", quantity: 1, unitPrice: total },
    ],
    subtotal: total,
    tax: 0,
    total,
    paid: 0,
  };
}

function withBills(...bills: BillingRecord[]) {
  const state = createEmptyTransactionState(tenantId);
  state.bills = bills;
  return normalizeTransactionState(state);
}

function direct(state: TransactionState, receipt: string, amountMajor: number, occurredAt: string) {
  return orchestrator.confirmProviderCollection(state, {
    tenantId,
    branchId,
    paymentMethodId: "payment-demo-mpesa-till",
    providerConnectionId: "connection-demo-daraja-wst",
    providerTransactionId: receipt,
    merchantReference: receipt,
    amountMinor: amountMajor * 100,
    currency: "KES",
    allocations: [],
    actor: "M-Pesa notification",
    occurredAt,
    metadata: { directPayment: true },
  });
}

function promptPaid(
  state: TransactionState,
  invoiceId: string,
  amountMajor: number,
  receipt: string,
) {
  const created = orchestrator.createIntent(state, {
    tenantId,
    branchId,
    invoiceIds: [invoiceId],
    paymentMethodId: "payment-demo-mpesa-prompt",
    amountRequestedMinor: amountMajor * 100,
    currency: "KES",
    createdBy: "Cashier",
    idempotencyKey: `prompt-${receipt}`,
  } as Parameters<PaymentOrchestrator["createIntent"]>[1]);
  return orchestrator.confirmProviderCollection(created.state, {
    tenantId,
    branchId,
    intentId: created.intent.id,
    paymentMethodId: "payment-demo-mpesa-prompt",
    providerConnectionId: "connection-demo-daraja-wst",
    providerTransactionId: receipt,
    merchantReference: invoiceId,
    amountMinor: amountMajor * 100,
    currency: "KES",
    allocations: [{ invoiceId, amountMinor: amountMajor * 100 }],
    actor: "M-Pesa callback",
    occurredAt: "2026-10-15T07:30:00.000Z",
  });
}

function id(state: TransactionState, receipt: string) {
  return state.paymentOperations!.transactions.find(
    (item) => item.providerTransactionId === receipt,
  )!.id;
}
