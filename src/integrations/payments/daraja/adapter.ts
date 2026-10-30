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
    // PAYBILL collects to a Paybill number; TILL (Buy Goods) to a till under a store number.
    accountType: { type: "string" },
    // Paybill number, or the store (head office) number that owns the till.
    shortcode: { type: "string" },
    tillNumber: { type: "string" },
    // Shortcode registered for payment notifications, when it differs from `shortcode`.
    c2bShortcode: { type: "string" },
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
      const platform = sandboxFallback(connection, env);
      const configured = Boolean(
        connection.secretReference &&
        (context?.credentials["consumerKey"] || platform.consumerKey) &&
        (context?.credentials["consumerSecret"] || platform.consumerSecret) &&
        (context?.credentials["passkey"] || platform.passkey) &&
        (connection.configuration["shortcode"] || platform.shortcode) &&
        (accountType(connection) === "PAYBILL" || connection.configuration["tillNumber"]),
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
            // A till is paid directly; its store number authorises the request.
            PartyB: config.partyB,
            PhoneNumber: normalizePhone(request.customerPhone),
            CallBackURL: config.callbackUrl,
            AccountReference: accountReference(details.merchantReference),
            TransactionDesc: "Payment",
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
          responseMetadata: {
            customerMessage: response.data.CustomerMessage,
            accountReference: accountReference(details.merchantReference),
          },
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
          return failure("NOT_CONFIGURED", "M-Pesa QR needs the business name shown to customers");
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
            RefNo: accountReference(details.merchantReference),
            Amount: Math.round(details.amountMajor),
            // BG pays a till (Buy Goods); PB pays a Paybill with RefNo as the account number.
            TrxCode: config.accountType === "TILL" ? "BG" : "PB",
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
    registerPaymentNotification: async (_input, context) => {
      try {
        const token = await darajaToken(context, runtime);
        const config = darajaConfig(context.connection, context, env);
        const response = await runtime.http.request<{
          ResponseCode?: string;
          ResponseDescription?: string;
          errorMessage?: string;
        }>({
          ...requestBase(context, "c2b-register"),
          baseUrls,
          path: "/mpesa/c2b/v1/registerurl",
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: {
            ShortCode: config.c2bShortcode,
            // Completed: if Seramet cannot answer validation in time, M-Pesa still completes.
            ResponseType: "Completed",
            ConfirmationURL: config.callbackUrl,
            ValidationURL: `${config.callbackUrl}/validate`,
          },
        });
        const accepted =
          response.data.ResponseCode === "0" ||
          /success/i.test(response.data.ResponseDescription ?? "");
        if (!accepted) {
          return failure(
            "PROVIDER_ERROR",
            response.data.errorMessage ??
              response.data.ResponseDescription ??
              "M-Pesa did not accept the notification addresses",
          );
        }
        return {
          ok: true,
          value: { shortcode: config.c2bShortcode, confirmationUrl: redactKey(config.callbackUrl) },
        };
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
        // 4999: Safaricom is still processing the prompt.
        const status: NormalizedPaymentProviderStatus["status"] =
          code === "0" ? "CONFIRMED" : !code || code === "4999" ? "PENDING" : "FAILED";
        return {
          ok: true,
          value: {
            providerTransactionId: providerReference,
            merchantReference: response.data.MerchantRequestID ?? providerReference,
            status,
            amountMinor: 0,
            currency: "KES",
            ...(status === "FAILED"
              ? { failureReason: promptFailureReason(code, response.data.ResultDesc) }
              : {}),
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
    TransTime?: string;
    BillRefNumber?: string;
    MSISDN?: string;
    FirstName?: string;
    LastName?: string;
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
        ...(resultCode === 0
          ? {}
          : {
              failureReason: promptFailureReason(
                String(resultCode),
                typeof callback["ResultDesc"] === "string" ? callback["ResultDesc"] : undefined,
              ),
            }),
        externalResourceId: checkoutId,
        providerTransactionId: receipt,
        ...(amount === undefined ? {} : { amountMinor: parseMajorAmount(String(amount), "KES") }),
        currency: "KES",
        payload,
      },
    };
  }
  if (root.TransID && root.TransAmount) {
    // Till, Paybill and QR payments: the customer paid without an STK prompt.
    const billReference = root.BillRefNumber?.trim();
    const payerName = [root.FirstName, root.LastName].filter(Boolean).join(" ").trim();
    const occurredAt = darajaTime(root.TransTime);
    return {
      ok: true,
      value: {
        providerEventId: root.TransID,
        eventType: "PAYMENT_CONFIRMED",
        externalResourceId: billReference || root.TransID,
        providerTransactionId: root.TransID,
        ...(billReference ? { merchantReference: billReference } : {}),
        amountMinor: parseMajorAmount(String(root.TransAmount), "KES"),
        currency: "KES",
        ...(occurredAt ? { occurredAt } : {}),
        directPayment: {
          ...(root.MSISDN ? { customerReference: String(root.MSISDN) } : {}),
          ...(payerName ? { payerName } : {}),
        },
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
  const platform = sandboxFallback(connection, env);
  const type = accountType(connection);
  const shortcode = String(
    connection.configuration["shortcode"] ??
      context.credentials["shortcode"] ??
      platform.shortcode ??
      "",
  ).trim();
  const tillNumber = String(connection.configuration["tillNumber"] ?? "").trim();
  const passkey = context.credentials["passkey"] ?? platform.passkey ?? "";
  const callbackUrl = darajaCallbackUrl(connection, context, env);
  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error("M-Pesa shortcode, passkey and callback address are required");
  }
  if (type === "TILL" && !tillNumber) throw new Error("M-Pesa till number is required");
  return {
    accountType: type,
    shortcode,
    partyB: type === "TILL" ? tillNumber : shortcode,
    c2bShortcode: String(connection.configuration["c2bShortcode"] ?? "").trim() || shortcode,
    passkey,
    callbackUrl,
    transactionType: type === "TILL" ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
    qrCpi: String(connection.configuration["qrCpi"] ?? (type === "TILL" ? tillNumber : shortcode)),
    qrMerchantName: String(
      connection.configuration["qrMerchantName"] ?? platform.qrMerchantName ?? "",
    ),
  };
}

function accountType(connection: IntegrationConnection): "PAYBILL" | "TILL" {
  const configured = String(connection.configuration["accountType"] ?? "").toUpperCase();
  if (configured === "TILL" || configured === "BUY_GOODS") return "TILL";
  if (connection.configuration["transactionType"] === "CustomerBuyGoodsOnline") return "TILL";
  return "PAYBILL";
}

/**
 * Platform-wide M-Pesa settings exist for sandbox testing only. A production connection must use
 * the restaurant's own credentials and numbers, or one restaurant could collect another's sales.
 */
function sandboxFallback(
  connection: IntegrationConnection,
  env: SerametEnv,
): Partial<
  Record<"consumerKey" | "consumerSecret" | "passkey" | "shortcode" | "qrMerchantName", string>
> {
  if (connection.environment !== "SANDBOX") return {};
  return {
    consumerKey: env.SERAMET_MPESA_CONSUMER_KEY,
    consumerSecret: env.SERAMET_MPESA_CONSUMER_SECRET,
    passkey: env.SERAMET_MPESA_PASSKEY,
    shortcode: env.SERAMET_MPESA_SHORTCODE,
    qrMerchantName: env.SERAMET_MPESA_QR_MERCHANT_NAME,
  };
}

/**
 * Safaricom cannot send custom headers, so the callback address carries the connection's random
 * webhook key as its last path segment; the route turns it back into the verified header.
 */
export function darajaCallbackUrl(
  connection: IntegrationConnection,
  context: Pick<ProviderExecutionContext, "credentials">,
  env: SerametEnv,
) {
  const explicit = connection.configuration["callbackUrl"];
  if (typeof explicit === "string" && explicit) return explicit;
  const base = env.SERAMET_CALLBACK_BASE_URL?.replace(/\/$/, "");
  const key = context.credentials["webhookSecret"];
  if (!base || !key) return "";
  return `${base}/api/seramet/integrations/webhooks/DARAJA/${encodeURIComponent(connection.id)}/${encodeURIComponent(key)}`;
}

function redactKey(url: string) {
  return url.replace(/\/[^/]+$/, "/…");
}

// Daraja accepts at most 12 characters; the full reference stays on the payment intent.
export function accountReference(reference: string) {
  return reference.replace(/[^A-Za-z0-9]/g, "").slice(-12) || "Seramet";
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

const promptFailures: Record<string, string> = {
  "1": "The customer's M-Pesa balance was not enough",
  "1001": "The customer has another M-Pesa payment in progress; try again shortly",
  "1019": "The payment prompt expired before the customer answered",
  "1025": "M-Pesa could not send the prompt; try again",
  "1032": "The customer cancelled the payment prompt",
  "1037": "The customer's phone could not be reached",
  "2001": "The customer entered the wrong M-Pesa PIN",
};

export function promptFailureReason(code: string, description?: string) {
  return promptFailures[code] ?? description ?? "M-Pesa did not complete the payment";
}

// M-Pesa reports TransTime as YYYYMMDDHHmmss in East Africa Time.
function darajaTime(value: string | undefined) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  return new Date(Date.UTC(year!, month! - 1, day!, hour! - 3, minute!, second!)).toISOString();
}

// Daraja timestamps are East Africa Time (UTC+3, no daylight saving); servers run on UTC.
export function darajaTimestamp(now = new Date()) {
  const date = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
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
