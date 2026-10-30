import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountReference,
  createDarajaAdapter,
  darajaTimestamp,
} from "@/integrations/payments/daraja/adapter";
import type { PaymentAdapterRuntime } from "@/integrations/payments/adapter-runtime";
import { ProviderRegistry } from "@/integrations/provider-registry";
import { StaticCredentialResolver } from "@/integrations/runtime/credential-resolver";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import {
  createIntegrationRepository,
  resetIntegrationMemoryForTests,
} from "@/integrations/runtime/integration-repository";
import { ProviderTokenService } from "@/integrations/runtime/token-service";
import type { ProviderExecutionContext } from "@/integrations/types";
import type { ServerActor } from "@/lib/seramet-auth";
import type {
  IdempotencyRecord,
  ProviderWebhookEvent,
  TransactionRepository,
} from "@/lib/seramet-repository";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { PaymentOrchestrator } from "@/payments/payment-orchestrator";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import type { IntegrationConnection } from "@/platform/types";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;
const callbackBase = "https://pos.example.test";
const credentials = {
  consumerKey: "key",
  consumerSecret: "secret",
  passkey: "passkey",
  webhookSecret: "hook-key-123",
};

beforeEach(() => {
  resetIntegrationMemoryForTests();
  setConfigurationRepositoryForTests(undefined);
});

describe("Daraja requests for a restaurant's own till or Paybill", () => {
  it("pays a till directly, authorised by its store number", async () => {
    const { adapter, request } = adapterWith(stkAccepted());
    await prompt(
      adapter,
      connection({ accountType: "TILL", shortcode: "7654321", tillNumber: "123456" }),
    );
    const body = request.mock.calls[1]![0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      BusinessShortCode: "7654321",
      PartyB: "123456",
      TransactionType: "CustomerBuyGoodsOnline",
      CallBackURL: `${callbackBase}/api/seramet/integrations/webhooks/DARAJA/connection-mpesa/hook-key-123`,
    });
    const timestamp = String(body["Timestamp"]);
    expect(Buffer.from(String(body["Password"]), "base64").toString()).toBe(
      `7654321passkey${timestamp}`,
    );
    expect(String(body["AccountReference"]).length).toBeLessThanOrEqual(12);
    expect(String(body["TransactionDesc"]).length).toBeLessThanOrEqual(13);
  });

  it("pays a Paybill with the bill as the account reference", async () => {
    const { adapter, request } = adapterWith(stkAccepted());
    await prompt(adapter, connection({ accountType: "PAYBILL", shortcode: "600100" }));
    expect(request.mock.calls[1]![0].body).toMatchObject({
      BusinessShortCode: "600100",
      PartyB: "600100",
      TransactionType: "CustomerPayBillOnline",
      AccountReference: "INVKE000123",
    });
  });

  it("builds QR codes for the right kind of account", async () => {
    for (const [config, trxCode, cpi] of [
      [{ accountType: "TILL", shortcode: "7654321", tillNumber: "123456" }, "BG", "123456"],
      [{ accountType: "PAYBILL", shortcode: "600100" }, "PB", "600100"],
    ] as const) {
      const { adapter, request } = adapterWith({ QRCode: "base64-qr" });
      const target = connection({ ...config, qrMerchantName: "Kitchen" });
      const result = await adapter.createPaymentQr!({ intent: intent() }, target, context(target));
      expect(result.ok).toBe(true);
      expect(request.mock.calls[1]![0].body).toMatchObject({ TrxCode: trxCode, CPI: cpi });
    }
  });

  it("never uses platform-wide M-Pesa settings for a live restaurant connection", async () => {
    const env = {
      SERAMET_CALLBACK_BASE_URL: callbackBase,
      SERAMET_MPESA_PASSKEY: "platform-passkey",
      SERAMET_MPESA_SHORTCODE: "999999",
    };
    const live = connection({ accountType: "PAYBILL" }, "PRODUCTION");
    const request = vi.fn().mockResolvedValueOnce(http({ access_token: "t", expires_in: "3599" }));
    const adapter = createDarajaAdapter(env, runtimeWith(request));
    const result = await adapter.createPaymentPrompt!(
      { intent: intent(), customerPhone: "0712345678" },
      live,
      {
        ...context(live),
        credentials: { consumerKey: "k", consumerSecret: "s", webhookSecret: "x" },
      },
    );
    expect(result).toMatchObject({ ok: false });
    expect(request).toHaveBeenCalledTimes(1);
    const health = await adapter.healthCheck!(live, { ...context(live), credentials: {} });
    expect(health.status).toBe("CONFIG_REQUIRED");
  });

  it("registers payment notifications with a keyed confirmation address", async () => {
    const { adapter, request } = adapterWith({ ResponseCode: "0", ResponseDescription: "Success" });
    const target = connection({ accountType: "TILL", shortcode: "7654321", tillNumber: "123456" });
    const result = await adapter.registerPaymentNotification!({}, context(target));
    expect(result).toMatchObject({ ok: true, value: { shortcode: "7654321" } });
    const call = request.mock.calls[1]![0];
    expect(call.path).toBe("/mpesa/c2b/v1/registerurl");
    expect(call.body).toMatchObject({
      ShortCode: "7654321",
      ResponseType: "Completed",
      ConfirmationURL: `${callbackBase}/api/seramet/integrations/webhooks/DARAJA/connection-mpesa/hook-key-123`,
      ValidationURL: `${callbackBase}/api/seramet/integrations/webhooks/DARAJA/connection-mpesa/hook-key-123/validate`,
    });
    expect(JSON.stringify(result)).not.toContain("hook-key-123");
  });

  it("stamps requests in Kenya time and keeps references within Daraja's limit", () => {
    expect(darajaTimestamp(new Date(Date.UTC(2026, 0, 1, 22, 30, 5)))).toBe("20260102013005");
    expect(accountReference("INV-KE-000123")).toBe("INVKE000123");
    expect(accountReference("TABLE-12-INVOICE-2026-0001")).toBe("INVOICE20260001".slice(-12));
    expect(accountReference("---")).toBe("Seramet");
  });

  it("reads a till payment as a direct payment with its payer and Kenya time", async () => {
    const adapter = createDarajaAdapter({});
    const parsed = await adapter.parseWebhook!(webhook(c2b("RKT1ABC2DE", "1500", "")));
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        eventType: "PAYMENT_CONFIRMED",
        providerTransactionId: "RKT1ABC2DE",
        amountMinor: 150_000,
        occurredAt: "2026-10-30T09:15:00.000Z",
        directPayment: { customerReference: "2547XXXX678", payerName: "Jane W" },
      },
    });
  });

  it("accepts a callback only with the connection's key", async () => {
    const adapter = createDarajaAdapter({});
    expect(await adapter.verifyWebhook!(webhook(c2b("R1", "10", ""), "hook-key-123"))).toBe(true);
    expect(await adapter.verifyWebhook!(webhook(c2b("R1", "10", ""), "wrong-key-123"))).toBe(false);
    expect(await adapter.verifyWebhook!(webhook(c2b("R1", "10", "")))).toBe(false);
  });
});

describe("payments that reach the till without a Seramet prompt", () => {
  it("keeps a till payment as one unallocated M-Pesa collection, even if notified twice", async () => {
    const { runtime, transactions } = runtimeFixture();
    const first = await runtime.handleWebhook(envelope(c2b("RKT1ABC2DE", "1500", "")));
    expect(first.result).toMatchObject({ status: "UNALLOCATED" });
    // A second delivery with a new event id but the same receipt is not recorded again.
    await runtime.handleWebhook(envelope({ ...c2b("RKT1ABC2DE", "1500", ""), retry: 1 }));
    const recorded = transactions.state.paymentOperations!.transactions.filter(
      (item) => item.providerTransactionId === "RKT1ABC2DE",
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      amountMinor: 150_000,
      unallocatedAmountMinor: 150_000,
      paymentMethodId: "payment-demo-mpesa-till",
      customerReference: "2547XXXX678",
      metadata: { directPayment: true, payerName: "Jane W" },
    });
    expect(transactions.state.paymentOperations!.allocations).toHaveLength(0);
  });

  it("links a Paybill payment to the bill it names when the amount also matches", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = withOpenIntent(transactions.state, "INV-KE-000123", 2_000);
    const result = await runtime.handleWebhook(envelope(c2b("RKP9XYZ", "2000", "INVKE000123")));
    expect(result.result).toMatchObject({ status: "CONFIRMED" });
    const intent = transactions.state.paymentOperations!.intents[0]!;
    expect(intent.status).toBe("CONFIRMED");
    expect(transactions.state.paymentOperations!.transactions[0]).toMatchObject({
      intentId: intent.id,
      providerTransactionId: "RKP9XYZ",
      unallocatedAmountMinor: 0,
    });
  });

  it("does not link a payment whose amount differs from the bill it names", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = withOpenIntent(transactions.state, "INV-KE-000123", 2_000);
    const result = await runtime.handleWebhook(envelope(c2b("RKP9XYZ", "1999", "INVKE000123")));
    expect(result.result).toMatchObject({ status: "UNALLOCATED" });
    expect(transactions.state.paymentOperations!.intents[0]!.status).not.toBe("CONFIRMED");
  });

  it("records a prompted payment once when M-Pesa also sends a till notification", async () => {
    const { runtime, transactions } = runtimeFixture();
    transactions.state = withOpenIntent(transactions.state, "INV-KE-000123", 2_000, "CHECKOUT-9");
    await runtime.handleWebhook(envelope(stkCallback("CHECKOUT-9", "RKS5RECEIPT", 2000)));
    await runtime.handleWebhook(envelope(c2b("RKS5RECEIPT", "2000", "")));
    expect(
      transactions.state.paymentOperations!.transactions.filter(
        (item) => item.providerTransactionId === "RKS5RECEIPT",
      ),
    ).toHaveLength(1);
  });
});

function connection(
  configuration: Record<string, unknown>,
  environment: IntegrationConnection["environment"] = "SANDBOX",
): IntegrationConnection {
  return {
    id: "connection-mpesa",
    tenantId,
    branchId,
    providerId: "provider-daraja",
    environment,
    status: "CONFIGURED",
    displayName: "M-Pesa",
    configuration,
    secretReference: "managed://seramet/tenant/connection-mpesa",
    metadata: {},
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function context(target: IntegrationConnection): ProviderExecutionContext {
  return { connection: target, credentials, correlationId: "correlation-test" };
}

function intent() {
  return {
    id: "PI4-001",
    tenantId,
    branchId,
    invoiceIds: ["INV-KE-000123"],
    paymentMethodId: "payment-demo-mpesa-prompt",
    currency: "KES",
    amountRequestedMinor: 200_000,
    amountAuthorizedMinor: 0,
    amountCollectedMinor: 0,
    status: "PENDING" as const,
    idempotencyKey: "daraja-test",
    createdBy: "tester",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  };
}

async function prompt(
  adapter: ReturnType<typeof createDarajaAdapter>,
  target: IntegrationConnection,
) {
  const result = await adapter.createPaymentPrompt!(
    { intent: intent(), customerPhone: "0712345678" },
    target,
    context(target),
  );
  expect(result).toMatchObject({ ok: true });
}

function adapterWith(response: Record<string, unknown>) {
  const request = vi
    .fn()
    .mockResolvedValueOnce(http({ access_token: "token", expires_in: "3599" }))
    .mockResolvedValueOnce(http(response));
  return {
    adapter: createDarajaAdapter({ SERAMET_CALLBACK_BASE_URL: callbackBase }, runtimeWith(request)),
    request,
  };
}

function stkAccepted() {
  return { MerchantRequestID: "M-1", CheckoutRequestID: "CHECKOUT-1", ResponseCode: "0" };
}

function runtimeWith(request: ReturnType<typeof vi.fn>): PaymentAdapterRuntime {
  return {
    http: { request } as unknown as PaymentAdapterRuntime["http"],
    tokens: new ProviderTokenService(),
  };
}

function http<T>(data: T) {
  return { status: 200, data, headers: {}, durationMs: 1 };
}

function c2b(receipt: string, amount: string, billReference: string) {
  return {
    TransactionType: "Pay Bill",
    TransID: receipt,
    TransTime: "20261030121500",
    TransAmount: amount,
    BusinessShortCode: "600100",
    BillRefNumber: billReference,
    MSISDN: "2547XXXX678",
    FirstName: "Jane",
    LastName: "W",
  };
}

function stkCallback(checkoutId: string, receipt: string, amount: number) {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: "M-9",
        CheckoutRequestID: checkoutId,
        ResultCode: 0,
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: amount },
            { Name: "MpesaReceiptNumber", Value: receipt },
          ],
        },
      },
    },
  };
}

function webhook(payload: unknown, key?: string) {
  return {
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    headers: (key ? { "x-seramet-webhook-secret": key } : {}) as Record<string, string>,
    connection: connection({ accountType: "PAYBILL", shortcode: "600100" }),
    credentials,
    payload,
  };
}

function envelope(payload: unknown) {
  return {
    tenantId,
    providerCode: "DARAJA",
    connectionId: "connection-demo-daraja-wst",
    rawBody: new TextEncoder().encode(JSON.stringify(payload)),
    headers: { "x-seramet-webhook-secret": "demo-hook-key" },
  };
}

function withOpenIntent(
  state: TransactionState,
  invoiceId: string,
  amountMajor: number,
  providerReference?: string,
) {
  const next = structuredClone(state);
  next.bills.push({
    id: invoiceId,
    tenantId,
    branchId,
    orderIds: [],
    status: "OPEN",
    subtotal: amountMajor,
    tax: 0,
    total: amountMajor,
    paid: 0,
    currency: "KES",
    createdAt: new Date().toISOString(),
  } as unknown as TransactionState["bills"][number]);
  const created = new PaymentOrchestrator().createIntent(next, {
    tenantId,
    branchId,
    invoiceIds: [invoiceId],
    paymentMethodId: "payment-demo-mpesa-prompt",
    amountRequestedMinor: amountMajor * 100,
    currency: "KES",
    createdBy: "tester",
    idempotencyKey: `intent-${invoiceId}-${providerReference ?? "qr"}`,
    metadata: { merchantReference: invoiceId },
  } as Parameters<PaymentOrchestrator["createIntent"]>[1]);
  const intentRecord = created.state.paymentOperations!.intents.find(
    (item) => item.id === created.intent.id,
  )!;
  intentRecord.providerConnectionId = "connection-demo-daraja-wst";
  if (providerReference) intentRecord.providerReference = providerReference;
  return created.state;
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

function runtimeFixture() {
  const platform = createDefaultDemoPlatformState();
  const configuration = new ConfigurationRepository(platform);
  setConfigurationRepositoryForTests(configuration);
  const transactions = new MemoryTransactions();
  const runtime = createIntegrationRuntime(
    {},
    {
      configuration,
      registry: new ProviderRegistry().register(createDarajaAdapter({})),
      repository: createIntegrationRepository(),
      transactions,
      credentials: new StaticCredentialResolver({
        "secret://seramet/demo/daraja/westlands": { webhookSecret: "demo-hook-key" },
      }),
    },
  );
  return { runtime, transactions };
}
