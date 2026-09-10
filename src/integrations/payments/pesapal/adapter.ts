import {
  createPaymentAdapterRuntime,
  type PaymentAdapterRuntime,
} from "@/integrations/payments/adapter-runtime";
import { normalizeIntegrationError } from "@/integrations/runtime/integration-errors";
import type {
  NormalizedPaymentProviderStatus,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderOperationResult,
  ProviderWebhookRequest,
} from "@/integrations/types";
import type { PaymentIntent } from "@/lib/transaction-engine";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import type { PaymentIntentRecord } from "@/payments/types";
import type { ProviderDefinition } from "@/platform/types";

const baseUrls = {
  SANDBOX: "https://cybqa.pesapal.com/pesapalv3",
  PRODUCTION: "https://pay.pesapal.com/v3",
} as const;

export const pesapalDefinition: ProviderDefinition = {
  id: "provider-pesapal",
  code: "PESAPAL",
  displayName: "Pesapal",
  category: "PAYMENT",
  version: "API 3.0",
  supportedCountries: ["KE"],
  capabilities: [
    "CREATE_PAYMENT_INTENT",
    "CARD_NOT_PRESENT",
    "PAYMENT_LINK",
    "WEBHOOK_CONFIRMATION",
    "QUERY_TRANSACTION",
    "REFUND",
    "PARTIAL_REFUND",
  ],
  configurationSchema: {
    callbackUrl: { type: "string" },
    ipnUrl: { type: "string" },
    notificationId: { type: "string" },
  },
  secretFields: ["consumerKey", "consumerSecret"],
  enabled: true,
};

export function createPesapalAdapter(
  runtime: PaymentAdapterRuntime = createPaymentAdapterRuntime(),
): ProviderAdapter {
  return {
    definition: pesapalDefinition,
    healthCheck: async (connection, context) => ({
      status:
        connection.secretReference &&
        context?.credentials["consumerKey"] &&
        context.credentials["consumerSecret"]
          ? "HEALTHY"
          : "CONFIG_REQUIRED",
      checkedAt: new Date().toISOString(),
      message: connection.secretReference
        ? "Pesapal API 3.0 credentials are referenced server-side"
        : "Pesapal consumer credentials are required",
    }),
    verifyWebhook: (request) => Boolean(parseIpnPayload(request)),
    parseWebhook: async (request) => {
      const payload = parseIpnPayload(request);
      if (!payload) return failure("VALIDATION", "Invalid Pesapal API 3.0 IPN payload");
      return {
        ok: true,
        value: {
          providerEventId: `${payload.orderTrackingId}:${payload.notificationType}`,
          eventType: "PAYMENT_CONFIRMED",
          externalResourceId: payload.orderTrackingId,
          merchantReference: payload.merchantReference,
          requiresPaymentFetch: true,
          payload: request.payload ?? {},
        },
      };
    },
    registerPaymentNotification: async (input, context) => {
      try {
        const token = await pesapalToken(context, runtime);
        const request = input as { url: string; notificationType?: "GET" | "POST" };
        const response = await runtime.http.request<{
          ipn_id?: string;
          error?: { message?: string };
        }>({
          ...requestBase(context, "register-ipn"),
          baseUrls,
          path: "/api/URLSetup/RegisterIPN",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            url: request.url,
            ipn_notification_type: request.notificationType ?? "POST",
          },
        });
        if (!response.data.ipn_id) {
          return failure(
            "PROVIDER_ERROR",
            response.data.error?.message ?? "Pesapal did not return an IPN ID",
          );
        }
        return { ok: true, value: response.data, providerReference: response.data.ipn_id };
      } catch (error) {
        return providerFailure(error);
      }
    },
    createPaymentPrompt: async (input, connection, context) => {
      if (!context) return failure("VALIDATION", "Server payment execution context is required");
      try {
        const token = await pesapalToken(context, runtime);
        const request = input as {
          intent: PaymentIntent | PaymentIntentRecord;
          customer?: {
            emailAddress?: string;
            phoneNumber?: string;
            countryCode?: string;
            firstName?: string;
            middleName?: string;
            lastName?: string;
            line1?: string;
            line2?: string;
            city?: string;
            state?: string;
            postalCode?: string;
            zipCode?: string;
          };
        };
        const details = intentDetails(request.intent);
        const callbackUrl = String(connection.configuration["callbackUrl"] ?? "");
        const notificationId = String(connection.configuration["notificationId"] ?? "");
        if (!callbackUrl || !notificationId) {
          return failure(
            "NOT_CONFIGURED",
            "Pesapal callback URL and registered notification ID are required",
          );
        }
        const customer = request.customer ?? {};
        const response = await runtime.http.request<{
          order_tracking_id?: string;
          redirect_url?: string;
          error?: { message?: string };
        }>({
          ...requestBase(context, "submit-order"),
          baseUrls,
          path: "/api/Transactions/SubmitOrderRequest",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            id: details.merchantReference,
            currency: details.currency,
            amount: details.amountMajor,
            description: `Seramet ${details.merchantReference}`,
            callback_url: callbackUrl,
            notification_id: notificationId,
            billing_address: {
              email_address: customer.emailAddress ?? "",
              phone_number: customer.phoneNumber ?? "",
              country_code: customer.countryCode ?? "KE",
              first_name: customer.firstName ?? "",
              middle_name: customer.middleName ?? "",
              last_name: customer.lastName ?? "",
              line_1: customer.line1 ?? "",
              line_2: customer.line2 ?? "",
              city: customer.city ?? "",
              state: customer.state ?? "",
              postal_code: customer.postalCode ?? "",
              zip_code: customer.zipCode ?? "",
            },
          },
        });
        if (!response.data.order_tracking_id || !response.data.redirect_url) {
          return failure(
            "PROVIDER_ERROR",
            response.data.error?.message ?? "Pesapal order submission failed",
          );
        }
        return {
          ok: true,
          value: response.data,
          providerReference: response.data.order_tracking_id,
          responseMetadata: { redirectUrl: response.data.redirect_url },
        };
      } catch (error) {
        return providerFailure(error);
      }
    },
    queryPayment: (reference, context) => queryPesapalPayment(reference, context, runtime),
    requestPaymentRefund: async (input, context) => {
      try {
        const token = await pesapalToken(context, runtime);
        const request = input as {
          confirmationCode: string;
          amountMajor: number;
          username: string;
          remarks?: string;
        };
        const response = await runtime.http.request<{
          message?: string;
          error?: { message?: string };
        }>({
          ...requestBase(context, "refund-request"),
          baseUrls,
          path: "/api/Transactions/RefundRequest",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            confirmation_code: request.confirmationCode,
            amount: request.amountMajor,
            username: request.username,
            remarks: request.remarks ?? "Seramet approved refund",
          },
        });
        if (response.data.error) {
          return failure(
            "PROVIDER_ERROR",
            response.data.error.message ?? "Pesapal refund request failed",
          );
        }
        return { ok: true, value: { ...response.data, lifecycleStatus: "PROCESSING" } };
      } catch (error) {
        return providerFailure(error);
      }
    },
  };
}

async function queryPesapalPayment(
  providerReference: string,
  context: ProviderExecutionContext,
  runtime: PaymentAdapterRuntime,
): Promise<ProviderOperationResult<NormalizedPaymentProviderStatus>> {
  try {
    const token = await pesapalToken(context, runtime);
    const response = await runtime.http.request<{
      payment_status_description?: string;
      payment_method?: string;
      amount?: number;
      currency?: string;
      confirmation_code?: string;
      merchant_reference?: string;
      created_date?: string;
      error?: { message?: string };
    }>({
      ...requestBase(context, "transaction-status"),
      baseUrls,
      path: `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(providerReference)}`,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.data.error) {
      return failure(
        "PROVIDER_ERROR",
        response.data.error.message ?? "Pesapal transaction status failed",
      );
    }
    const description = String(response.data.payment_status_description ?? "INVALID").toUpperCase();
    const status: NormalizedPaymentProviderStatus["status"] =
      description === "COMPLETED"
        ? "CONFIRMED"
        : description === "FAILED"
          ? "FAILED"
          : description === "REVERSED"
            ? "REVERSED"
            : description === "INVALID"
              ? "INVALID"
              : "PENDING";
    const currency = String(response.data.currency ?? "KES").toUpperCase();
    return {
      ok: true,
      value: {
        providerTransactionId: response.data.confirmation_code ?? providerReference,
        merchantReference: response.data.merchant_reference ?? providerReference,
        status,
        amountMinor: parseMajorAmount(String(response.data.amount ?? 0), currency),
        currency,
        ...(response.data.payment_method
          ? { paymentMethodDescription: response.data.payment_method }
          : {}),
        ...(response.data.confirmation_code
          ? { confirmationCode: response.data.confirmation_code }
          : {}),
        ...(response.data.created_date ? { occurredAt: response.data.created_date } : {}),
        raw: response.data,
      },
    };
  } catch (error) {
    return providerFailure(error);
  }
}

async function pesapalToken(context: ProviderExecutionContext, runtime: PaymentAdapterRuntime) {
  const consumerKey = context.credentials["consumerKey"];
  const consumerSecret = context.credentials["consumerSecret"];
  if (!consumerKey || !consumerSecret) {
    throw new Error("Pesapal consumer credentials are required");
  }
  const token = await runtime.tokens.getValidToken(
    context.connection.id,
    async () => {
      const response = await runtime.http.request<{
        token?: string;
        expiryDate?: string;
        error?: { message?: string };
      }>({
        ...requestBase(context, "authentication"),
        baseUrls,
        path: "/api/Auth/RequestToken",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { consumer_key: consumerKey, consumer_secret: consumerSecret },
      });
      if (!response.data.token) {
        throw new Error(response.data.error?.message ?? "Pesapal token response is invalid");
      }
      return {
        connectionId: context.connection.id,
        accessToken: response.data.token,
        expiresAt: response.data.expiryDate ?? new Date(Date.now() + 4 * 60 * 1000).toISOString(),
        tokenType: "Bearer",
      };
    },
    15_000,
  );
  return token.accessToken;
}

function parseIpnPayload(request: ProviderWebhookRequest) {
  let payload: unknown = request.payload;
  if (!payload) {
    try {
      payload = JSON.parse(new TextDecoder().decode(request.rawBody) || "{}");
    } catch {
      return undefined;
    }
  }
  const item = payload as Record<string, unknown>;
  const orderTrackingId = String(
    item["OrderTrackingId"] ?? item["orderTrackingId"] ?? item["order_tracking_id"] ?? "",
  );
  const merchantReference = String(
    item["OrderMerchantReference"] ??
      item["orderMerchantReference"] ??
      item["merchant_reference"] ??
      "",
  );
  const notificationType = String(
    item["OrderNotificationType"] ??
      item["orderNotificationType"] ??
      item["order_notification_type"] ??
      "",
  );
  if (!orderTrackingId || !notificationType) return undefined;
  return { orderTrackingId, merchantReference, notificationType };
}

function intentDetails(intent: PaymentIntent | PaymentIntentRecord) {
  if ("amountRequestedMinor" in intent) {
    return {
      amountMajor: majorFromMinor(intent.amountRequestedMinor, intent.currency),
      currency: intent.currency,
      merchantReference: intent.invoiceIds[0] ?? intent.id,
    };
  }
  return {
    amountMajor: intent.amount,
    currency: intent.currency,
    merchantReference: intent.invoiceId,
  };
}

function requestBase(context: ProviderExecutionContext, operation: string) {
  return {
    tenantId: context.connection.tenantId,
    ...(context.connection.branchId ? { branchId: context.connection.branchId } : {}),
    connectionId: context.connection.id,
    providerId: context.connection.providerId,
    environment: context.connection.environment,
    operation,
    correlationId: context.correlationId,
  };
}

function providerFailure(error: unknown): ProviderOperationResult<never> {
  const normalized = normalizeIntegrationError(error);
  const allowed = [
    "AUTHENTICATION",
    "AUTHORIZATION",
    "RATE_LIMITED",
    "TIMEOUT",
    "PROVIDER_UNAVAILABLE",
  ] as const;
  const code = allowed.includes(normalized.code as (typeof allowed)[number])
    ? (normalized.code as (typeof allowed)[number])
    : "PROVIDER_ERROR";
  return {
    ok: false,
    code,
    message: normalized.message,
    retryable: normalized.retryable,
    ...(normalized.retryAfterMs ? { retryAfterMs: normalized.retryAfterMs } : {}),
  };
}

function failure(
  code: "NOT_CONFIGURED" | "VALIDATION" | "PROVIDER_ERROR",
  message: string,
): ProviderOperationResult<never> {
  return { ok: false, code, message, retryable: false };
}
