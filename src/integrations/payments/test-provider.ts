import type {
  NormalizedPaymentProviderStatus,
  ProviderAdapter,
  ProviderOperationResult,
} from "@/integrations/types";
import type { ProviderDefinition } from "@/platform/types";

export type TestPaymentScenario =
  "SUCCESS" | "FAILED" | "DELAYED" | "DUPLICATE" | "RATE_LIMIT" | "TIMEOUT";

export const testPaymentProviderDefinition: ProviderDefinition = {
  id: "provider-test-payment",
  code: "TEST_PAYMENT",
  displayName: "Test Payment Provider (non-production)",
  category: "PAYMENT",
  version: "test-v1",
  capabilities: [
    "CREATE_PAYMENT_INTENT",
    "PAYMENT_PROMPT",
    "QR_PAYMENT",
    "WEBHOOK_CONFIRMATION",
    "QUERY_TRANSACTION",
    "REFUND",
    "PARTIAL_REFUND",
    "REVERSAL",
    "FETCH_SETTLEMENTS",
  ],
  configurationSchema: { scenario: { type: "string" } },
  secretFields: ["webhookSecret"],
  enabled: true,
};

export function createTestPaymentProvider(): ProviderAdapter {
  const statuses = new Map<string, NormalizedPaymentProviderStatus>();
  let sequence = 0;
  const createPrompt: NonNullable<ProviderAdapter["createPaymentPrompt"]> = async (
    input,
    connection,
  ) => {
    if (connection.environment === "PRODUCTION") return unsupportedProduction();
    const scenario = String(
      connection.configuration["scenario"] ?? "SUCCESS",
    ) as TestPaymentScenario;
    if (scenario === "RATE_LIMIT") {
      return {
        ok: false,
        code: "RATE_LIMITED",
        message: "Test rate limit",
        retryable: true,
        retryAfterMs: 1000,
      };
    }
    if (scenario === "TIMEOUT") {
      return { ok: false, code: "TIMEOUT", message: "Test timeout", retryable: true };
    }
    sequence += 1;
    const reference = `TEST-PAY-${sequence}`;
    const request = input as {
      intent: { id: string; amountRequestedMinor: number; currency: string };
    };
    statuses.set(reference, {
      providerTransactionId: `TEST-TX-${sequence}`,
      merchantReference: request.intent.id,
      status: scenario === "FAILED" ? "FAILED" : scenario === "DELAYED" ? "PENDING" : "CONFIRMED",
      amountMinor: request.intent.amountRequestedMinor,
      currency: request.intent.currency,
      raw: { scenario },
    });
    return { ok: true, value: { scenario }, providerReference: reference };
  };
  return {
    definition: testPaymentProviderDefinition,
    healthCheck: async (connection) => ({
      status: connection.environment === "PRODUCTION" ? "CONFIG_REQUIRED" : "HEALTHY",
      checkedAt: new Date().toISOString(),
      message:
        connection.environment === "PRODUCTION"
          ? "The test provider is prohibited in production"
          : "Test provider is ready",
    }),
    verifyWebhook: (request) =>
      request.connection.environment !== "PRODUCTION" &&
      request.headers["x-test-signature"] === request.credentials["webhookSecret"],
    parseWebhook: async (request) => {
      const payload = JSON.parse(new TextDecoder().decode(request.rawBody)) as {
        id: string;
        reference: string;
        status: string;
        amountMinor: number;
        currency: string;
      };
      return {
        ok: true,
        value: {
          providerEventId: payload.id,
          eventType: payload.status === "CONFIRMED" ? "PAYMENT_CONFIRMED" : "PAYMENT_FAILED",
          externalResourceId: payload.reference,
          providerTransactionId: payload.id,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
          payload,
        },
      };
    },
    createPaymentPrompt: createPrompt,
    createPaymentQr: createPrompt,
    queryPayment: async (reference, context) => {
      if (context.connection.environment === "PRODUCTION") return unsupportedProduction();
      const status = statuses.get(reference);
      return status
        ? { ok: true, value: status }
        : { ok: false, code: "VALIDATION", message: "Unknown test payment", retryable: false };
    },
    requestPaymentRefund: async (input, context) =>
      context.connection.environment === "PRODUCTION"
        ? unsupportedProduction()
        : { ok: true, value: { ...asObject(input), status: "PROCESSING" } },
    requestPaymentReversal: async (input, context) =>
      context.connection.environment === "PRODUCTION"
        ? unsupportedProduction()
        : { ok: true, value: { ...asObject(input), status: "CONFIRMED" } },
    fetchSettlements: async (input, context) =>
      context.connection.environment === "PRODUCTION"
        ? unsupportedProduction()
        : {
            ok: true,
            value: {
              ...asObject(input),
              lines: [
                { type: "GROSS_SALE", amountMinor: 100_000, reference: "TEST-ORDER" },
                { type: "COMMISSION", amountMinor: 25_000, reference: "TEST-FEE" },
              ],
              netAmountMinor: 75_000,
            },
          },
  };
}

function unsupportedProduction(): ProviderOperationResult<never> {
  return {
    ok: false,
    code: "UNSUPPORTED",
    message: "TestPaymentProvider cannot run against a production connection",
    retryable: false,
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
