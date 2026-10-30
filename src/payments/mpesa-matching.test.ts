import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentAdapterRuntime } from "@/integrations/payments/adapter-runtime";
import { createDarajaAdapter } from "@/integrations/payments/daraja/adapter";
import { ProviderRegistry } from "@/integrations/provider-registry";
import { StaticCredentialResolver } from "@/integrations/runtime/credential-resolver";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import {
  createIntegrationRepository,
  resetIntegrationMemoryForTests,
} from "@/integrations/runtime/integration-repository";
import { ProviderTokenService } from "@/integrations/runtime/token-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { applyServerMutation } from "@/lib/seramet-repository";
import type {
  IdempotencyRecord,
  ProviderWebhookEvent,
  TransactionRepository,
} from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  normalizeTransactionState,
  type BillingRecord,
  type TransactionState,
} from "@/lib/transaction-engine";
import {
  billNamedByReference,
  normalizedCode,
  unmatchedDirectPayments,
} from "@/payments/mpesa-matching";
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

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const connectionId = "connection-demo-daraja-wst";
const orchestrator = new PaymentOrchestrator();

beforeEach(() => {
  resetIntegrationMemoryForTests();
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

afterEach(() => setConfigurationRepositoryForTests(undefined));

describe("applying money already received to a bill", () => {
  it("pays the bill without posting the money a second time", () => {
    const received = directPayment(withBills(bill("INV-A", 1_500)), "RKA1", 1_500);
    const journalsBefore = received.paymentOperations!.journals.length;
    const next = orchestrator.applyUnallocatedCollection(received, {
      tenantId,
      transactionId: paymentId(received, "RKA1"),
      allocations: [{ invoiceId: "INV-A", amountMinor: 150_000 }],
      actor: "Cashier",
      matchedBy: "RECEIPT_CODE",
    });
    expect(next.bills[0]).toMatchObject({ paid: 1_500, paymentStatus: "PAID" });
    expect(next.receipts).toHaveLength(1);
    const payment = transaction(next, "RKA1");
    expect(payment).toMatchObject({
      unallocatedAmountMinor: 0,
      metadata: { matchedBy: "RECEIPT_CODE", directPayment: true },
    });
    expect(next.paymentOperations!.allocations).toMatchObject([
      { paymentTransactionId: payment.id, invoiceId: "INV-A", amountMinor: 150_000 },
    ]);
    expect(next.paymentOperations!.journals).toHaveLength(journalsBefore);
    expect(next.paymentOperations!.transactions).toHaveLength(1);
  });

  it("can split one payment across bills and refuses to apply more than is left", () => {
    let state = directPayment(withBills(bill("INV-A", 600), bill("INV-B", 900)), "RKA2", 1_500);
    const id = paymentId(state, "RKA2");
    state = orchestrator.applyUnallocatedCollection(state, {
      tenantId,
      transactionId: id,
      allocations: [{ invoiceId: "INV-A", amountMinor: 60_000 }],
      actor: "Cashier",
      matchedBy: "CASHIER_CONFIRMED",
    });
    expect(transaction(state, "RKA2").unallocatedAmountMinor).toBe(90_000);
    expect(() =>
      orchestrator.applyUnallocatedCollection(state, {
        tenantId,
        transactionId: id,
        allocations: [{ invoiceId: "INV-B", amountMinor: 95_000 }],
        actor: "Cashier",
        matchedBy: "CASHIER_CONFIRMED",
      }),
    ).toThrow(/less left/);
    state = orchestrator.applyUnallocatedCollection(state, {
      tenantId,
      transactionId: id,
      allocations: [{ invoiceId: "INV-B", amountMinor: 90_000 }],
      actor: "Cashier",
      matchedBy: "CASHIER_CONFIRMED",
    });
    expect(state.bills.every((item) => item.paymentStatus === "PAID")).toBe(true);
    expect(state.paymentOperations!.allocations.map((item) => item.id).sort()).toEqual([
      `${id}-ALLOC-1`,
      `${id}-ALLOC-2`,
    ]);
  });
});

describe("matching rules", () => {
  it("names a bill only by reference plus the exact balance, and only when unambiguous", () => {
    const state = directPayment(
      withBills(bill("INV-KE-000123", 2_000), bill("INV-KE-000999", 2_000)),
      "RKB1",
      2_000,
      "INVKE000123",
    );
    expect(billNamedByReference(state, transaction(state, "RKB1"))?.id).toBe("INV-KE-000123");
    const wrongAmount = directPayment(
      withBills(bill("INV-KE-000123", 2_100)),
      "RKB2",
      2_000,
      "INVKE000123",
    );
    expect(billNamedByReference(wrongAmount, transaction(wrongAmount, "RKB2"))).toBeUndefined();
    const vague = directPayment(withBills(bill("INV-1", 50), bill("INV-11", 50)), "RKB3", 50, "1");
    expect(billNamedByReference(vague, transaction(vague, "RKB3"))).toBeUndefined();
  });

  it("suggests open bills of the same balance billed around the time of payment, closest first", () => {
    const paidAt = "2026-10-30T12:00:00.000Z";
    const state = directPayment(
      withBills(
        bill("INV-EARLY", 800, "2026-10-30T09:00:00.000Z"),
        bill("INV-NEAR", 800, "2026-10-30T11:50:00.000Z"),
        bill("INV-SOONER", 800, "2026-10-30T11:20:00.000Z"),
        bill("INV-OTHER", 750, "2026-10-30T11:58:00.000Z"),
      ),
      "RKC1",
      800,
      undefined,
      paidAt,
    );
    const [payment] = unmatchedDirectPayments(state, tenantId, branchId);
    expect(payment!.suggestions.map((item) => item.invoiceId)).toEqual(["INV-NEAR", "INV-SOONER"]);
    expect(payment!.suggestions[0]).toMatchObject({ minutesApart: 10, balanceMinor: 80_000 });
  });

  it("compares receipt codes without spaces or case", () => {
    expect(normalizedCode(" rk-a1 b2 ")).toBe("RKA1B2");
  });
});

describe("cashier types the M-Pesa code at the POS", () => {
  it("applies a receipt that already reached the till instead of recording it again", () => {
    const state = directPayment(withBills(bill("INV-A", 1_500)), "RKD1", 1_500);
    const next = applyServerMutation(
      state,
      "applyConfiguredPayment",
      posPayment("rkd1", 150_000),
      cashier(),
    );
    expect(next.paymentOperations!.transactions).toHaveLength(1);
    expect(transaction(next, "RKD1")).toMatchObject({
      unallocatedAmountMinor: 0,
      metadata: { matchedBy: "RECEIPT_CODE" },
    });
    expect(next.bills[0]!.paymentStatus).toBe("PAID");
    expect(() =>
      applyServerMutation(
        { ...next, bills: [...next.bills, bill("INV-B", 1_500)] },
        "applyConfiguredPayment",
        { ...posPayment("RKD1", 150_000), invoiceId: "INV-B" },
        cashier(),
      ),
    ).toThrow();
  });

  it("refuses a code whose payment was smaller than the amount entered", () => {
    const state = directPayment(withBills(bill("INV-A", 1_500)), "RKD2", 1_000);
    expect(() =>
      applyServerMutation(state, "applyConfiguredPayment", posPayment("RKD2", 150_000), cashier()),
    ).toThrow(/left; record the rest separately/);
  });

  it("holds a code that has not arrived yet as unverified, as before", () => {
    const next = applyServerMutation(
      withBills(bill("INV-A", 1_500)),
      "applyConfiguredPayment",
      posPayment("RKD3", 150_000),
      cashier(),
    );
    expect(next.paymentOperations!.transactions[0]).toMatchObject({
      status: "UNVERIFIED",
      customerReference: "RKD3",
    });
  });

  it("lets a person apply a suggested payment to a bill in their branch", () => {
    const state = directPayment(withBills(bill("INV-A", 1_500)), "RKD4", 1_500);
    const next = applyServerMutation(
      state,
      "applyUnallocatedPayment",
      { transactionId: paymentId(state, "RKD4"), invoiceId: "INV-A" },
      cashier(),
    );
    expect(transaction(next, "RKD4").metadata["matchedBy"]).toBe("CASHIER_CONFIRMED");
    expect(() =>
      applyServerMutation(
        state,
        "applyUnallocatedPayment",
        { transactionId: paymentId(state, "RKD4"), invoiceId: "INV-A" },
        { ...cashier(), branchId: "another-branch" },
      ),
    ).toThrow(/branch/);
  });
});

describe("M-Pesa notifications", () => {
  it("verify a code the cashier typed earlier instead of recording a second payment", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = applyServerMutation(
      withBills(bill("INV-A", 1_500)),
      "applyConfiguredPayment",
      posPayment("RKE1", 150_000),
      cashier(),
    );
    const result = await runtime.handleWebhook(envelope(c2b("RKE1", "1500", "")));
    expect(result.result).toMatchObject({ status: "VERIFIED_TYPED_CODE" });
    const payments = transactions.state.paymentOperations!.transactions;
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ status: "CONFIRMED", providerTransactionId: "RKE1" });
    expect(transactions.state.bills[0]!.paymentStatus).toBe("PAID");
  });

  it("flag a typed code whose payment amount differs", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = applyServerMutation(
      withBills(bill("INV-A", 1_500)),
      "applyConfiguredPayment",
      posPayment("RKE2", 150_000),
      cashier(),
    );
    const result = await runtime.handleWebhook(envelope(c2b("RKE2", "1000", "")));
    expect(result.result).toMatchObject({ status: "AMOUNT_MISMATCH" });
    expect(transactions.state.bills[0]!.paymentStatus).not.toBe("PAID");
  });

  it("apply a Paybill payment whose account number names a bill with the exact balance", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = withBills(bill("INV-KE-000555", 2_000));
    const result = await runtime.handleWebhook(envelope(c2b("RKE3", "2000", "INVKE000555")));
    expect(result.result).toMatchObject({
      status: "APPLIED_BY_ACCOUNT_REFERENCE",
      invoiceId: "INV-KE-000555",
    });
    expect(transactions.state.bills[0]!.paymentStatus).toBe("PAID");
    expect(transaction(transactions.state, "RKE3").metadata["matchedBy"]).toBe("ACCOUNT_REFERENCE");
  });
});

describe("checking prompts the customer has not answered", () => {
  it("marks cancelled prompts failed with a plain reason and leaves waiting ones", async () => {
    const answers: Record<string, string> = { ws_CO_1: "1032", ws_CO_2: "4999", ws_CO_3: "0" };
    const request = vi.fn(async (call: { path: string; body?: Record<string, unknown> }) =>
      call.path.includes("oauth")
        ? http({ access_token: "t", expires_in: "3599" })
        : http({ ResultCode: answers[String(call.body?.["CheckoutRequestID"])] }),
    );
    const { runtime, transactions } = runtimeFixture(request);
    let state = withBills(bill("INV-A", 100), bill("INV-B", 200), bill("INV-C", 300));
    state = openPrompt(state, "INV-A", 100, "ws_CO_1");
    state = openPrompt(state, "INV-B", 200, "ws_CO_2");
    state = openPrompt(state, "INV-C", 300, "ws_CO_3");
    transactions.state = state;
    const report = await runtime.checkPendingPrompts(tenantId, { olderThanMs: 0 });
    const intents = transactions.state.paymentOperations!.intents;
    const byRef = (ref: string) => intents.find((item) => item.providerReference === ref)!;
    const outcome = (ref: string) =>
      report.results.find((item) => item.intentId === byRef(ref).id)?.outcome;
    expect([outcome("ws_CO_1"), outcome("ws_CO_2"), outcome("ws_CO_3")]).toEqual([
      "FAILED",
      "WAITING",
      "PAID_AWAITING_RECEIPT",
    ]);
    expect(byRef("ws_CO_1")).toMatchObject({
      status: "FAILED",
      metadata: { failureReason: "The customer cancelled the payment prompt" },
    });
    expect(byRef("ws_CO_2").status).not.toBe("FAILED");
    // "Paid" without a receipt is noted, never counted as money.
    expect(byRef("ws_CO_3")).toMatchObject({ metadata: { providerReportsPaid: true } });
    expect(transactions.state.paymentOperations!.transactions).toHaveLength(0);
  });

  it("does not check prompts that were just sent", async () => {
    const request = vi.fn();
    const { runtime, transactions } = runtimeFixture(request);
    transactions.state = openPrompt(withBills(bill("INV-A", 100)), "INV-A", 100, "ws_CO_9");
    expect(await runtime.checkPendingPrompts(tenantId)).toMatchObject({ checked: 0 });
    expect(request).not.toHaveBeenCalled();
  });

  it("reads a failed prompt result with the same plain reason", async () => {
    const parsed = await createDarajaAdapter({}).parseWebhook!({
      rawBody: new Uint8Array(),
      headers: {},
      connection: createDefaultDemoPlatformState().connections[0]!,
      credentials: {},
      payload: {
        Body: {
          stkCallback: {
            CheckoutRequestID: "ws_CO_5",
            ResultCode: 2001,
            ResultDesc: "The initiator information is invalid.",
          },
        },
      },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        eventType: "PAYMENT_FAILED",
        failureReason: "The customer entered the wrong M-Pesa PIN",
      },
    });
  });
});

function bill(id: string, total: number, issuedAt = "2026-10-30T11:55:00.000Z"): BillingRecord {
  return {
    id,
    tenantId,
    branchId,
    orderIds: [`ORD-${id}`],
    branch: "Westlands",
    customer: "Walk-in Customer",
    status: "OPEN",
    paymentStatus: "UNPAID",
    issuedAt,
    dueAt: issuedAt,
    lines: [{ id: `${id}-L`, name: "Meal", category: "Main", quantity: 1, unitPrice: total }],
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

function directPayment(
  state: TransactionState,
  receipt: string,
  amountMajor: number,
  accountReference?: string,
  occurredAt = "2026-10-30T12:00:00.000Z",
) {
  return orchestrator.confirmProviderCollection(state, {
    tenantId,
    branchId,
    paymentMethodId: "payment-demo-mpesa-till",
    providerConnectionId: connectionId,
    providerTransactionId: receipt,
    merchantReference: accountReference ?? receipt,
    amountMinor: amountMajor * 100,
    currency: "KES",
    allocations: [],
    actor: "M-Pesa notification",
    occurredAt,
    metadata: { directPayment: true },
  });
}

function openPrompt(state: TransactionState, invoiceId: string, amountMajor: number, ref: string) {
  const created = orchestrator.createIntent(state, {
    tenantId,
    branchId,
    invoiceIds: [invoiceId],
    paymentMethodId: "payment-demo-mpesa-prompt",
    amountRequestedMinor: amountMajor * 100,
    currency: "KES",
    createdBy: "Cashier",
    idempotencyKey: `prompt-${ref}`,
  } as Parameters<PaymentOrchestrator["createIntent"]>[1]);
  return orchestrator.markIntentInitiated(created.state, {
    tenantId,
    intentId: created.intent.id,
    providerReference: ref,
    actor: "Cashier",
  } as Parameters<PaymentOrchestrator["markIntentInitiated"]>[1]);
}

function transaction(state: TransactionState, receipt: string) {
  return state.paymentOperations!.transactions.find(
    (item) => item.providerTransactionId === receipt,
  )!;
}

function paymentId(state: TransactionState, receipt: string) {
  return transaction(state, receipt).id;
}

function posPayment(reference: string, amountMinor: number) {
  return {
    invoiceId: "INV-A",
    paymentMethodId: "payment-demo-mpesa-till",
    amountMinor,
    reference,
  };
}

function cashier(): ServerActor {
  return {
    id: "user-demo-amina",
    name: "Amina",
    tenantId,
    roleIds: ["cashier"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Westlands" }],
    branchScope: { type: "BRANCH" },
    branchId,
    branch: "Westlands",
    role: "Cashier",
  } as ServerActor;
}

function c2b(receipt: string, amount: string, billReference: string) {
  return {
    TransactionType: "Pay Bill",
    TransID: receipt,
    TransTime: "20261030150000",
    TransAmount: amount,
    BusinessShortCode: "4235484",
    BillRefNumber: billReference,
    MSISDN: "2547XXXX678",
  };
}

function envelope(payload: unknown) {
  return {
    tenantId,
    providerCode: "DARAJA",
    connectionId,
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    headers: { "x-seramet-webhook-secret": "demo-hook-key" },
  };
}

function http<T>(data: T) {
  return { status: 200, data, headers: {}, durationMs: 1 };
}

class MemoryTransactions implements TransactionRepository {
  readonly authoritative = false;
  state = createEmptyTransactionState(tenantId);
  idempotency = new Map<string, IdempotencyRecord>();
  async migrate() {}
  async revision() {
    return 0;
  }
  async commitMutation(): Promise<never> {
    throw new Error("Typed transaction commands are not used here");
  }
  async loadState(requested: string) {
    return requested === this.state.tenantId
      ? structuredClone(this.state)
      : createEmptyTransactionState(requested);
  }
  async saveState(state: TransactionState, actor: ServerActor) {
    if (state.tenantId !== actor.tenantId) throw new Error("Cross tenant");
    this.state = structuredClone(state);
  }
  async getIdempotency(requested: string, key: string) {
    return this.idempotency.get(`${requested}:${key}`) ?? null;
  }
  async saveIdempotency(record: IdempotencyRecord) {
    this.idempotency.set(`${record.tenantId}:${record.key}`, record);
  }
  async appendProviderEvent(_event: ProviderWebhookEvent) {}
}

function runtimeFixture(request: ReturnType<typeof vi.fn> = vi.fn()) {
  const platform = createDefaultDemoPlatformState();
  const configuration = new ConfigurationRepository(platform);
  setConfigurationRepositoryForTests(configuration);
  const transactions = new MemoryTransactions();
  const adapterRuntime: PaymentAdapterRuntime = {
    http: { request } as unknown as PaymentAdapterRuntime["http"],
    tokens: new ProviderTokenService(),
  };
  const runtime = createIntegrationRuntime(
    { SERAMET_CALLBACK_BASE_URL: "https://pos.example.test" },
    {
      configuration,
      registry: new ProviderRegistry().register(
        createDarajaAdapter(
          { SERAMET_CALLBACK_BASE_URL: "https://pos.example.test" },
          adapterRuntime,
        ),
      ),
      repository: createIntegrationRepository(),
      transactions,
      credentials: new StaticCredentialResolver({
        "secret://seramet/demo/daraja/westlands": {
          consumerKey: "key",
          consumerSecret: "secret",
          passkey: "passkey",
          webhookSecret: "demo-hook-key",
        },
      }),
    },
  );
  return { runtime, transactions };
}
