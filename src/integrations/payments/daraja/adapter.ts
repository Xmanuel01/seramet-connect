import {
  createPaymentAdapterRuntime,
  type PaymentAdapterRuntime,
} from "@/integrations/payments/adapter-runtime";
import { normalizeIntegrationError } from "@/integrations/runtime/integration-errors";
import type {
  NormalizedPaymentProviderStatus,
  ParsedProviderEvent,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderOperationResult,
  ProviderWebhookRequest,
} from "@/integrations/types";
import type { PaymentIntent } from "@/lib/transaction-engine";
import type { SerametEnv } from "@/lib/seramet-auth";
import { majorFromMinor, parseMajorAmount } from "@/payments/money";
import type { PaymentIntentRecord } from "@/payments/types";
import type { IntegrationConnection, ProviderDefinition } from "@/platform/types";

const baseUrls = {
  SANDBOX: "https://sandbox.safaricom.co.ke",
  PRODUCTION: "https://api.safaricom.co.ke",
} as const;

export const darajaDefinition: ProviderDefinition = {
  id: "provider-daraja",
  code: "DARAJA",
  displayName: "M-Pesa Daraja",
  category: "PAYMENT",
  version: "Daraja 3.0",
  supportedCountries: ["KE"],
  capabilities: [
    "CREATE_PAYMENT_INTENT",
    "PAYMENT_PROMPT",
    "STK_PUSH",
    "QR_PAYMENT",
    "WEBHOOK_CONFIRMATION",
    "QUERY_TRANSACTION",
  ],
  configurationSchema: {
    shortcode: { type: "string" },
    callbackUrl: { type: "string" },
    transactionType: { type: "string" },
    qrCpi: { type: "string" },
    qrMerchantName: { type: "string" },
  },
  secretFields: ["consumerKey", "consumerSecret", "passkey", "webhookSecret"],
  enabled: true,
};

export function createDarajaAdapter(
  env: SerametEnv,
  runtime: PaymentAdapterRuntime = createPaymentAdapterRuntime(),
): ProviderAdapter {
  return {
    definition: darajaDefinition,
    healthCheck: async (connection, context) => {
      const configured = Boolean(
        connection.secretReference &&
        (context?.credentials["consumerKey"] || env.SERAMET_MPESA_CONSUMER_KEY) &&
        (context?.credentials["consumerSecret"] || env.SERAMET_MPESA_CONSUMER_SECRET) &&
        (context?.credentials["passkey"] || env.SERAMET_MPESA_PASSKEY) &&
        (connection.configuration["shortcode"] || env.SERAMET_MPESA_SHORTCODE),
      );
      return {
        status: configured ? "HEALTHY" : "CONFIG_REQUIRED",
        checkedAt: new Date().toISOString(),
        message: configured
          ? "Daraja credentials are referenced server-side"
          : "Daraja consumer credentials, passkey and shortcode are required",
      };
    },
    verifyWebhook: (request) => verifyGatewayBoundary(request, env),
    parseWebhook: async (request) => parseDarajaWebhook(request),
    createPaymentPrompt: async (input, connection, context) => {
      if (!context) return failure("VALIDATION", "Server payment execution context is required");
      try {
        const request = input as {
          intent: PaymentIntent | PaymentIntentRecord;
          customerPhone: string;
        };
        const token = await darajaToken(context, runtime);
        const config = darajaConfig(connection, context, env);
        const details = intentDetails(request.intent);
        const timestamp = darajaTimestamp();
        const response = await runtime.http.request<{
          MerchantRequestID?: string;
          CheckoutRequestID?: string;
          ResponseCode?: string;
          ResponseDescription?: string;
          CustomerMessage?: string;
          errorMessage?: string;
        }>({
          ...requestBase(context, "stk-push"),
          baseUrls,
          path: "/mpesa/stkpush/v1/processrequest",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            BusinessShortCode: config.shortcode,
            Password: base64(`${config.shortcode}${config.passkey}${timestamp}`),
            Timestamp: timestamp,
            TransactionType: config.transactionType,
            Amount: Math.round(details.amountMajor),
            PartyA: normalizePhone(request.customerPhone),
            PartyB: config.shortcode,
            PhoneNumber: normalizePhone(request.customerPhone),
            CallBackURL: config.callbackUrl,
            AccountReference: details.merchantReference,
            TransactionDesc: `Seramet ${details.merchantReference}`,
          },
        });
        if (!response.data.CheckoutRequestID || response.data.ResponseCode !== "0") {
          return failure(
            "PROVIDER_ERROR",
            response.data.errorMessage ??
              response.data.ResponseDescription ??
              "Daraja rejected the STK request",
          );
        }
        return {
          ok: true,
          value: response.data,
          providerReference: response.data.CheckoutRequestID,
          responseMetadata: { customerMessage: response.data.CustomerMessage },
        };
      } catch (error) {
        return providerFailure(error);
      }
    },
    createPaymentQr: async (input, connection, context) => {
      if (!context) return failure("VALIDATION", "Server payment execution context is required");
      try {
        const token = await darajaToken(context, runtime);
        const config = darajaConfig(connection, context, env);
        const details = intentDetails(
          (input as { intent: PaymentIntent | PaymentIntentRecord }).intent,
        );
        if (!config.qrCpi || !config.qrMerchantName) {
          return failure("NOT_CONFIGURED", "Daraja QR CPI and merchant name are required");
        }
        const response = await runtime.http.request<{
          QRCode?: string;
          ResponseDescription?: string;
        }>({
          ...requestBase(context, "generate-qr"),
          baseUrls,
          path: "/mpesa/qrcode/v1/generate",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            MerchantName: config.qrMerchantName,
            RefNo: details.merchantReference,
            Amount: Math.round(details.amountMajor),
            TrxCode: "BG",
            CPI: config.qrCpi,
            Size: "300",
          },
        });
        if (!response.data.QRCode) {
          return failure(
            "PROVIDER_ERROR",
            response.data.ResponseDescription ?? "Daraja did not return a QR code",
          );
        }
        return { ok: true, value: response.data, providerReference: details.intentId };
      } catch (error) {
        return providerFailure(error);
      }
    },
    queryPayment: async (providerReference, context) => {
      try {
        const token = await darajaToken(context, runtime);
        const config = darajaConfig(context.connection, context, env);
        const timestamp = darajaTimestamp();
        const response = await runtime.http.request<{
          ResultCode?: string | number;
          ResultDesc?: string;
          CheckoutRequestID?: string;
          MerchantRequestID?: string;
        }>({
          ...requestBase(context, "stk-query"),
          baseUrls,
          path: "/mpesa/stkpushquery/v1/query",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            BusinessShortCode: config.shortcode,
            Password: base64(`${config.shortcode}${config.passkey}${timestamp}`),
            Timestamp: timestamp,
            CheckoutRequestID: providerReference,
          },
        });
        const code = String(response.data.ResultCode ?? "");
        const status: NormalizedPaymentProviderStatus["status"] =
          code === "0" ? "CONFIRMED" : code ? "FAILED" : "PENDING";
        return {
          ok: true,
          value: {
            providerTransactionId: providerReference,
            merchantReference: response.data.MerchantRequestID ?? providerReference,
            status,
            amountMinor: 0,
            currency: "KES",
            raw: response.data,
          },
        };
      } catch (error) {
        return providerFailure(error);
      }
    },
  };
}

async function darajaToken(context: ProviderExecutionContext, runtime: PaymentAdapterRuntime) {
  const consumerKey = context.credentials["consumerKey"];
  const consumerSecret = context.credentials["consumerSecret"];
  if (!consumerKey || !consumerSecret) throw new Error("Daraja consumer credentials are required");
  const token = await runtime.tokens.getValidToken(context.connection.id, async () => {
    const response = await runtime.http.request<{
      access_token?: string;
      expires_in?: string;
      errorMessage?: string;
    }>({
      ...requestBase(context, "oauth"),
      baseUrls,
      path: "/oauth/v1/generate?grant_type=client_credentials",
      headers: { Authorization: `Basic ${base64(`${consumerKey}:${consumerSecret}`)}` },
    });
    if (!response.data.access_token) {
      throw new Error(response.data.errorMessage ?? "Daraja token response is invalid");
    }
    return {
      connectionId: context.connection.id,
      accessToken: response.data.access_token,
      expiresAt: new Date(
        Date.now() + Math.max(60, Number(response.data.expires_in ?? 3600)) * 1000,
      ).toISOString(),
      tokenType: "Bearer",
    };
  });
  return token.accessToken;
}

function parseDarajaWebhook(
  request: ProviderWebhookRequest,
): ProviderOperationResult<ParsedProviderEvent> {
  let payload: unknown;
  try {
    payload = request.payload ?? JSON.parse(new TextDecoder().decode(request.rawBody));
  } catch {
    return failure("VALIDATION", "Invalid Daraja callback JSON");
  }
  const root = payload as {
    Body?: { stkCallback?: Record<string, unknown> };
    TransID?: string;
    TransAmount?: string | number;
    BillRefNumber?: string;
  };
  const callback = root.Body?.stkCallback;
  if (callback) {
    const metadata = callback["CallbackMetadata"] as
      { Item?: Array<{ Name?: string; Value?: string | number }> } | undefined;
    const metadataValue = (name: string) =>
      metadata?.Item?.find((item) => item.Name === name)?.Value;
    const checkoutId = String(callback["CheckoutRequestID"] ?? callback["MerchantRequestID"] ?? "");
    const resultCode = Number(callback["ResultCode"]);
    const receipt = String(metadataValue("MpesaReceiptNumber") ?? checkoutId);
    const amount = metadataValue("Amount");
    return {
      ok: true,
      value: {
        providerEventId: `${checkoutId}:${resultCode}`,
        eventType: resultCode === 0 ? "PAYMENT_CONFIRMED" : "PAYMENT_FAILED",
        externalResourceId: checkoutId,
        providerTransactionId: receipt,
        ...(amount === undefined ? {} : { amountMinor: parseMajorAmount(String(amount), "KES") }),
        currency: "KES",
        payload,
      },
    };
  }
  if (root.TransID && root.TransAmount) {
    return {
      ok: true,
      value: {
        providerEventId: root.TransID,
        eventType: "PAYMENT_CONFIRMED",
        externalResourceId: root.BillRefNumber ?? root.TransID,
        providerTransactionId: root.TransID,
        ...(root.BillRefNumber ? { merchantReference: root.BillRefNumber } : {}),
        amountMinor: parseMajorAmount(String(root.TransAmount), "KES"),
        currency: "KES",
        payload,
      },
    };
  }
  return failure("VALIDATION", "Unsupported Daraja callback shape");
}

function darajaConfig(
  connection: IntegrationConnection,
  context: ProviderExecutionContext,
  env: SerametEnv,
) {
  const shortcode = String(
    connection.configuration["shortcode"] ??
      context.credentials["shortcode"] ??
      env.SERAMET_MPESA_SHORTCODE ??
      "",
  );
  const passkey = context.credentials["passkey"] ?? env.SERAMET_MPESA_PASSKEY ?? "";
  const callbackUrl = String(
    connection.configuration["callbackUrl"] ?? env.SERAMET_MPESA_CALLBACK_URL ?? "",
  );
  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error("Daraja shortcode, passkey and callback URL are required");
  }
  return {
    shortcode,
    passkey,
    callbackUrl,
    transactionType: String(connection.configuration["transactionType"] ?? "CustomerPayBillOnline"),
    qrCpi: String(connection.configuration["qrCpi"] ?? env.SERAMET_MPESA_QR_CPI ?? ""),
    qrMerchantName: String(
      connection.configuration["qrMerchantName"] ?? env.SERAMET_MPESA_QR_MERCHANT_NAME ?? "",
    ),
  };
}

function intentDetails(intent: PaymentIntent | PaymentIntentRecord) {
  if ("amountRequestedMinor" in intent) {
    return {
      intentId: intent.id,
      amountMajor: majorFromMinor(intent.amountRequestedMinor, intent.currency),
      merchantReference: intent.invoiceIds[0] ?? intent.id,
    };
  }
  return { intentId: intent.id, amountMajor: intent.amount, merchantReference: intent.invoiceId };
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

function verifyGatewayBoundary(request: ProviderWebhookRequest, env: SerametEnv) {
  const expected = request.credentials["webhookSecret"] ?? env.SERAMET_MPESA_WEBHOOK_SECRET;
  if (expected) {
    return safeEqual(request.headers["x-seramet-webhook-secret"] ?? "", expected);
  }
  return (
    request.connection.environment === "SANDBOX" &&
    request.connection.configuration["allowUnsignedSandboxCallbacks"] === true
  );
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

function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64(value: string) {
  if (typeof btoa === "function") return btoa(value);
  return Buffer.from(value, "utf8").toString("base64");
}

function darajaTimestamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return `254${digits.slice(1)}`;
  return digits;
}

export function darajaConnectionIsConfigured(connection: IntegrationConnection) {
  return connection.providerId === darajaDefinition.id && Boolean(connection.secretReference);
}
