import {
  CampaignProviderRegistry,
  type CampaignProviderAdapter,
} from "@/crm/campaign-provider-registry";
import type { CampaignMessage, CampaignProviderResult } from "@/crm/types";
import type { SerametEnv } from "@/lib/seramet-auth";

export const campaignEmailKey = "BREVO_EMAIL";
type Configuration = { apiKey: string; from: string; unsubscribeSecret: string };
const mailbox = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function configuration(env: SerametEnv, tenantId: string): Configuration | null {
  try {
    const values: unknown = JSON.parse(env.SERAMET_CAMPAIGN_EMAIL_CONFIG ?? "{}");
    if (!values || typeof values !== "object" || !Object.hasOwn(values, tenantId)) return null;
    const candidate = (values as Record<string, unknown>)[tenantId] as Configuration;
    if (
      !candidate ||
      typeof candidate.apiKey !== "string" ||
      candidate.apiKey.length < 16 ||
      typeof candidate.from !== "string" ||
      /[\r\n]/.test(candidate.from) ||
      !mailbox.test(candidate.from.match(/<([^<>]+)>$/)?.[1] ?? candidate.from) ||
      typeof candidate.unsubscribeSecret !== "string" ||
      candidate.unsubscribeSecret.length < 32
    )
      return null;
    const origin = new URL(env.SERAMET_PUBLIC_ORIGIN ?? "");
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      return null;
    return candidate;
  } catch {
    return null;
  }
}

async function signature(secret: string, text: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function campaignUnsubscribeUrl(
  env: SerametEnv,
  tenantId: string,
  customerId: string,
) {
  const config = configuration(env, tenantId);
  if (!config) throw new Error("CAMPAIGN_EMAIL_CONFIGURATION_REQUIRED");
  const encoded = new TextEncoder().encode(JSON.stringify([tenantId, customerId]));
  const token = btoa(String.fromCharCode(...encoded))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const url = new URL("/api/seramet/crm/campaigns/unsubscribe", env.SERAMET_PUBLIC_ORIGIN);
  url.searchParams.set("token", token);
  url.searchParams.set("signature", await signature(config.unsubscribeSecret, token));
  return url.toString();
}

export async function verifyCampaignUnsubscribe(env: SerametEnv, url: URL) {
  try {
    const token = url.searchParams.get("token") ?? "";
    const supplied = url.searchParams.get("signature") ?? "";
    if (!/^[\w-]{1,2048}$/.test(token) || !/^[a-f0-9]{64}$/.test(supplied)) return null;
    const decoded: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(token.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 2 ||
      !decoded.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)
    )
      return null;
    const [tenantId, customerId] = decoded as [string, string];
    const config = configuration(env, tenantId);
    if (!config) return null;
    const expected = await signature(config.unsubscribeSecret, token);
    let difference = 0;
    for (let index = 0; index < expected.length; index++)
      difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
    return difference === 0 ? { tenantId, customerId } : null;
  } catch {
    return null;
  }
}

class BrevoCampaignProvider implements CampaignProviderAdapter {
  readonly key = campaignEmailKey;
  readonly displayName = "Campaign email";
  readonly capabilities = new Set(["SEND_EMAIL"] as const);
  constructor(
    private env: SerametEnv,
    private tenantId: string,
    private transport: typeof fetch,
  ) {}
  async health() {
    return configuration(this.env, this.tenantId) ? ("CONFIGURED" as const) : ("UNKNOWN" as const);
  }
  async send(message: CampaignMessage): Promise<CampaignProviderResult> {
    const config = configuration(this.env, this.tenantId);
    if (
      !config ||
      message.tenantId !== this.tenantId ||
      message.channel !== "EMAIL" ||
      !message.customerId ||
      !mailbox.test(message.destination) ||
      !message.subject ||
      /[\r\n]/.test(message.subject) ||
      message.subject.length > 998 ||
      !message.body ||
      message.body.length > 200_000 ||
      !/^[\w:.-]{1,200}$/.test(message.idempotencyKey)
    )
      return {
        status: "FAILED",
        errorCode: "EMAIL_CONFIGURATION_OR_MESSAGE_INVALID",
        retryable: false,
      };
    const unsubscribe = await campaignUnsubscribeUrl(this.env, this.tenantId, message.customerId);
    let response: Response;
    try {
      response = await this.transport("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          "api-key": config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            email: config.from.match(/<([^<>]+)>$/)?.[1] ?? config.from,
            ...(config.from.includes("<")
              ? { name: config.from.slice(0, config.from.lastIndexOf("<")).trim() }
              : {}),
          },
          to: [{ email: message.destination }],
          subject: message.subject,
          textContent: `${message.body}\n\nUnsubscribe from marketing: ${unsubscribe}`,
          headers: {
            "List-Unsubscribe": `<${unsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
    } catch {
      return { status: "UNKNOWN", errorCode: "EMAIL_OUTCOME_UNKNOWN" };
    }
    // 5xx/malformed success can occur after acceptance. Never blindly retry them.
    if (response.status === 429)
      return { status: "FAILED", errorCode: "EMAIL_RATE_LIMITED", retryable: true };
    if (!response.ok)
      return response.status >= 500 || response.status === 409
        ? { status: "UNKNOWN", errorCode: "EMAIL_OUTCOME_UNKNOWN" }
        : { status: "FAILED", errorCode: "EMAIL_PROVIDER_REJECTED", retryable: false };
    const body = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
    if (typeof body?.messageId !== "string" || !/^<[^\s<>]{1,250}>$/.test(body.messageId))
      return { status: "UNKNOWN", errorCode: "EMAIL_RESPONSE_UNVERIFIED" };
    // SENT is the existing provider-accepted state, not evidence of inbox delivery.
    return { status: "SENT", providerMessageId: body.messageId };
  }
}

export function createCampaignEmailRegistry(
  env: SerametEnv,
  tenantId: string,
  transport: typeof fetch = fetch,
) {
  return new CampaignProviderRegistry().register(
    new BrevoCampaignProvider(env, tenantId, transport),
  );
}
