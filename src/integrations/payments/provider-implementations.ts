import type { PaymentIntent } from "@/lib/transaction-engine";
import type { SerametEnv } from "@/lib/seramet-auth";

export type ProviderResult =
  | { ok: true; providerReference: string; raw: unknown; qrCode?: string; customerMessage?: string }
  | {
      ok: false;
      code: "MISSING_CONFIG" | "PROVIDER_ERROR" | "UNSUPPORTED";
      message: string;
      raw?: unknown;
    };

export type PaymentProvider = {
  createPrompt: (intent: PaymentIntent, customerPhone: string) => Promise<ProviderResult>;
  createQr: (intent: PaymentIntent) => Promise<ProviderResult>;
  parseWebhook: (payload: unknown) => ProviderWebhookResult;
};

export type ProviderWebhookResult =
  | {
      ok: true;
      provider: string;
      eventType: string;
      reference: string;
      intentReference?: string;
      status: "SUCCEEDED" | "FAILED" | "PENDING";
      amount?: number;
      raw: unknown;
    }
  | { ok: false; message: string; raw?: unknown };

type DarajaTokenResponse = { access_token?: string; errorMessage?: string };
type MpesaStkResponse = {
  CheckoutRequestID?: string;
  MerchantRequestID?: string;
  ResponseDescription?: string;
  errorMessage?: string;
};
type MpesaQrResponse = { QRCode?: string; ResponseDescription?: string; errorMessage?: string };

export class DarajaMpesaProvider implements PaymentProvider {
  constructor(private env: SerametEnv) {}

  async createPrompt(intent: PaymentIntent, customerPhone: string): Promise<ProviderResult> {
    const config = this.config();
    if (!config.ok) return config;
    const token = await this.token(config.baseUrl);
    if (!token.ok) return token;
    const timestamp = darajaTimestamp();
    const password = base64(`${config.shortcode}${config.passkey}${timestamp}`);
    const response = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: Math.round(intent.amount),
        PartyA: normalizePhone(customerPhone),
        PartyB: config.shortcode,
        PhoneNumber: normalizePhone(customerPhone),
        CallBackURL: config.callbackUrl,
        AccountReference: intent.invoiceId,
        TransactionDesc: `Seramet ${intent.invoiceId}`,
      }),
    });
    const raw = (await response.json()) as MpesaStkResponse;
    if (!response.ok || raw.errorMessage) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: raw.errorMessage ?? "M-Pesa STK request failed",
        raw,
      };
    }
    return {
      ok: true,
      providerReference: raw.CheckoutRequestID ?? raw.MerchantRequestID ?? intent.id,
      ...(raw.ResponseDescription ? { customerMessage: raw.ResponseDescription } : {}),
      raw,
    };
  }

  async createQr(intent: PaymentIntent): Promise<ProviderResult> {
    const config = this.config();
    if (!config.ok) return config;
    if (!this.env.SERAMET_MPESA_QR_CPI || !this.env.SERAMET_MPESA_QR_MERCHANT_NAME) {
      return {
        ok: false,
        code: "MISSING_CONFIG",
        message: "M-Pesa QR CPI and merchant name are required",
      };
    }
    const token = await this.token(config.baseUrl);
    if (!token.ok) return token;
    const response = await fetch(`${config.baseUrl}/mpesa/qrcode/v1/generate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        MerchantName: this.env.SERAMET_MPESA_QR_MERCHANT_NAME,
        RefNo: intent.invoiceId,
        Amount: Math.round(intent.amount),
        TrxCode: "BG",
        CPI: this.env.SERAMET_MPESA_QR_CPI,
        Size: "300",
      }),
    });
    const raw = (await response.json()) as MpesaQrResponse;
    if (!response.ok || raw.errorMessage || !raw.QRCode) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: raw.errorMessage ?? "M-Pesa QR generation failed",
        raw,
      };
    }
    return { ok: true, providerReference: intent.id, qrCode: raw.QRCode, raw };
  }

  parseWebhook(payload: unknown): ProviderWebhookResult {
    const root = payload as { Body?: { stkCallback?: Record<string, unknown> } };
    const callback = root.Body?.stkCallback;
    if (!callback)
      return { ok: false, message: "Invalid M-Pesa STK callback payload", raw: payload };
    const resultCode = Number(callback["ResultCode"]);
    const metadata = callback["CallbackMetadata"] as
      { Item?: { Name?: string; Value?: string | number }[] } | undefined;
    const receipt = metadata?.Item?.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
    const amount = metadata?.Item?.find((item) => item.Name === "Amount")?.Value;
    const checkoutReference = callback["CheckoutRequestID"] ?? callback["MerchantRequestID"];
    return {
      ok: true,
      provider: "M-Pesa",
      eventType: "STK_CALLBACK",
      reference: String(receipt ?? checkoutReference),
      intentReference: String(checkoutReference ?? receipt),
      status: resultCode === 0 ? "SUCCEEDED" : "FAILED",
      ...(amount === undefined ? {} : { amount: Number(amount) }),
      raw: payload,
    };
  }

  private config():
    | { ok: true; baseUrl: string; shortcode: string; passkey: string; callbackUrl: string }
    | { ok: false; code: "MISSING_CONFIG"; message: string } {
    const required = [
      this.env.SERAMET_MPESA_CONSUMER_KEY,
      this.env.SERAMET_MPESA_CONSUMER_SECRET,
      this.env.SERAMET_MPESA_SHORTCODE,
      this.env.SERAMET_MPESA_PASSKEY,
      this.env.SERAMET_MPESA_CALLBACK_URL,
    ];
    if (required.some((value) => !value)) {
      return {
        ok: false,
        code: "MISSING_CONFIG",
        message: "M-Pesa Daraja credentials and callback URL are required",
      };
    }
    return {
      ok: true,
      baseUrl:
        this.env.SERAMET_MPESA_ENV === "production"
          ? "https://api.safaricom.co.ke"
          : "https://sandbox.safaricom.co.ke",
      shortcode: this.env.SERAMET_MPESA_SHORTCODE!,
      passkey: this.env.SERAMET_MPESA_PASSKEY!,
      callbackUrl: this.env.SERAMET_MPESA_CALLBACK_URL!,
    };
  }

  private async token(
    baseUrl: string,
  ): Promise<
    | { ok: true; accessToken: string }
    | { ok: false; code: "PROVIDER_ERROR" | "MISSING_CONFIG"; message: string; raw?: unknown }
  > {
    if (!this.env.SERAMET_MPESA_CONSUMER_KEY || !this.env.SERAMET_MPESA_CONSUMER_SECRET) {
      return {
        ok: false,
        code: "MISSING_CONFIG",
        message: "M-Pesa consumer key and secret are required",
      };
    }
    const credentials = base64(
      `${this.env.SERAMET_MPESA_CONSUMER_KEY}:${this.env.SERAMET_MPESA_CONSUMER_SECRET}`,
    );
    const response = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    const raw = (await response.json()) as DarajaTokenResponse;
    if (!response.ok || !raw.access_token) {
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: raw.errorMessage ?? "M-Pesa token request failed",
        raw,
      };
    }
    return { ok: true, accessToken: raw.access_token };
  }
}

export class TendePayProvider {
  constructor(private env: SerametEnv) {}

  async fetchTransactions(): Promise<ProviderResult> {
    if (!this.env.SERAMET_TENDEPAY_BASE_URL || !this.env.SERAMET_TENDEPAY_API_KEY) {
      return {
        ok: false,
        code: "MISSING_CONFIG",
        message: "TendePay base URL and API key are required before live sync",
      };
    }
    const response = await fetch(
      `${this.env.SERAMET_TENDEPAY_BASE_URL.replace(/\/$/, "")}/transactions`,
      {
        headers: {
          Authorization: `Bearer ${this.env.SERAMET_TENDEPAY_API_KEY}`,
          Accept: "application/json",
        },
      },
    );
    const raw = await response.json();
    if (!response.ok)
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: "TendePay transaction sync failed",
        raw,
      };
    return { ok: true, providerReference: "tendepay-feed", raw };
  }

  parseWebhook(payload: unknown): ProviderWebhookResult {
    const item = payload as { id?: string; reference?: string; status?: string; amount?: number };
    if (!item.id && !item.reference)
      return { ok: false, message: "Invalid TendePay webhook payload", raw: payload };
    return {
      ok: true,
      provider: "TendePay",
      eventType: "TRANSACTION",
      reference: String(item.reference ?? item.id),
      status:
        item.status === "success" || item.status === "paid"
          ? "SUCCEEDED"
          : item.status === "failed"
            ? "FAILED"
            : "PENDING",
      ...(item.amount === undefined ? {} : { amount: item.amount }),
      raw: payload,
    };
  }
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
