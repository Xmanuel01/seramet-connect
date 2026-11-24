/**
 * Linking a restaurant's Uber Eats store to Seramet.
 *
 * Seramet is one Uber developer app for every restaurant: the app's client credentials are
 * platform secrets, and each restaurant only signs in to Uber once to let Seramet manage its
 * store (Uber's `eats.pos_provisioning` authorization-code grant). Uber then sends every
 * store's webhooks to the app's single webhook URL, signed with the app's client secret, and
 * Seramet routes them to the restaurant whose connection maps that Uber store id.
 */

export type UberEnvironment = "SANDBOX" | "PRODUCTION";

export type UberPlatformEnv = {
  SERAMET_UBER_CLIENT_ID?: string;
  SERAMET_UBER_CLIENT_SECRET?: string;
  SERAMET_UBER_SANDBOX_CLIENT_ID?: string;
  SERAMET_UBER_SANDBOX_CLIENT_SECRET?: string;
};

export const uberLoginBaseUrls: Record<UberEnvironment, string> = {
  SANDBOX: "https://sandbox-login.uber.com",
  PRODUCTION: "https://auth.uber.com",
};
export const uberApiBaseUrls: Record<UberEnvironment, string> = {
  SANDBOX: "https://test-api.uber.com",
  PRODUCTION: "https://api.uber.com",
};

export const uberProvisioningScope = "eats.pos_provisioning";
export const uberWebhookPath = "/api/seramet/integrations/webhooks/UBER_EATS";
export const uberCallbackPath = "/api/seramet/integrations/uber-eats/callback";
/** The browser lands here after Uber sign-in; the sealed ticket travels in the URL fragment. */
export const uberLinkReturnPath = "/seramet-setup";
const linkLifetimeMs = 15 * 60_000;

/** Connections linked through the platform app read its credentials, never a restaurant secret. */
export function uberPlatformSecretReference(environment: UberEnvironment) {
  return `platform://uber-eats/${environment.toLowerCase()}`;
}

export function uberPlatformCredentials(env: UberPlatformEnv, environment: UberEnvironment) {
  const clientId =
    environment === "SANDBOX" ? env.SERAMET_UBER_SANDBOX_CLIENT_ID : env.SERAMET_UBER_CLIENT_ID;
  const clientSecret =
    environment === "SANDBOX"
      ? env.SERAMET_UBER_SANDBOX_CLIENT_SECRET
      : env.SERAMET_UBER_CLIENT_SECRET;
  return clientId?.trim() && clientSecret?.trim()
    ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
    : undefined;
}

export function uberAuthorizeUrl(input: {
  environment: UberEnvironment;
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const url = new URL("/oauth/v2/authorize", uberLoginBaseUrls[input.environment]);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", uberProvisioningScope);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type UberLinkState = {
  tenantId: string;
  branchId: string;
  actorId: string;
  environment: UberEnvironment;
  orderChannelId?: string;
  expiresAt: number;
};

export type UberStoreChoice = { storeId: string; name: string; address?: string };

export type UberLinkTicket = UberLinkState & {
  merchantAccessToken: string;
  stores: UberStoreChoice[];
};

/** A short-lived, signed state so Uber's redirect can only finish a link Seramet started. */
export async function signUberLinkState(
  state: Omit<UberLinkState, "expiresAt">,
  secret: string,
  now = Date.now(),
) {
  const body = toBase64Url(
    new TextEncoder().encode(JSON.stringify({ ...state, expiresAt: now + linkLifetimeMs })),
  );
  return `${body}.${toBase64Url(await hmac(secret, `uber-link-state:${body}`))}`;
}

export async function verifyUberLinkState(token: string, secret: string, now = Date.now()) {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return undefined;
  const expected = toBase64Url(await hmac(secret, `uber-link-state:${body}`));
  if (!constantTimeEqual(expected, signature)) return undefined;
  const state = parseJson<UberLinkState>(new TextDecoder().decode(fromBase64Url(body)));
  if (!state || !isLinkState(state) || state.expiresAt < now) return undefined;
  return state;
}

/**
 * Seals the merchant's Uber token and store list for the store-choice step. The ticket travels
 * only in the URL fragment, which browsers never send to a server, and expires with the state.
 */
export async function sealUberLinkTicket(ticket: UberLinkTicket, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await ticketKey(secret),
      new TextEncoder().encode(JSON.stringify(ticket)),
    ),
  );
  const joined = new Uint8Array(iv.length + sealed.length);
  joined.set(iv);
  joined.set(sealed, iv.length);
  return toBase64Url(joined);
}

export async function openUberLinkTicket(sealed: string, secret: string, now = Date.now()) {
  try {
    const bytes = fromBase64Url(sealed);
    if (bytes.length < 29) return undefined;
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await ticketKey(secret),
      bytes.slice(12),
    );
    const ticket = parseJson<UberLinkTicket>(new TextDecoder().decode(plain));
    if (
      !ticket ||
      !isLinkState(ticket) ||
      ticket.expiresAt < now ||
      typeof ticket.merchantAccessToken !== "string" ||
      !Array.isArray(ticket.stores)
    )
      return undefined;
    return ticket;
  } catch {
    return undefined;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function exchangeUberAuthorizationCode(input: {
  fetch: FetchLike;
  environment: UberEnvironment;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}) {
  const response = await input.fetch(`${uberLoginBaseUrls[input.environment]}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      code: input.code,
    }).toString(),
  });
  const body = parseJson<{ access_token?: string; scope?: string }>(await response.text());
  if (!response.ok || !body?.access_token)
    throw new UberLinkError(`Uber sign-in could not be completed (HTTP ${response.status})`);
  return body.access_token;
}

export async function listUberStores(input: {
  fetch: FetchLike;
  environment: UberEnvironment;
  accessToken: string;
}): Promise<UberStoreChoice[]> {
  const response = await input.fetch(`${uberApiBaseUrls[input.environment]}/v1/eats/stores`, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
  });
  const body = parseJson<{ stores?: unknown[] }>(await response.text());
  if (!response.ok)
    throw new UberLinkError(
      `Uber did not list the stores for this account (HTTP ${response.status})`,
    );
  return (body?.stores ?? []).flatMap((entry) => {
    const store = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const storeId = typeof store["store_id"] === "string" ? store["store_id"] : undefined;
    if (!storeId) return [];
    const location =
      store["location"] && typeof store["location"] === "object"
        ? (store["location"] as Record<string, unknown>)
        : {};
    const address = [location["address"], location["city"]]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .join(", ");
    return [
      {
        storeId,
        name: typeof store["name"] === "string" && store["name"] ? store["name"] : storeId,
        ...(address ? { address } : {}),
      },
    ];
  });
}

/** Makes Seramet the store's order manager so Uber sends its orders to the webhook. */
export async function provisionUberStore(input: {
  fetch: FetchLike;
  environment: UberEnvironment;
  accessToken: string;
  storeId: string;
  integratorStoreId: string;
  integratorBrandId: string;
}) {
  const response = await input.fetch(
    `${uberApiBaseUrls[input.environment]}/v1/eats/stores/${encodeURIComponent(input.storeId)}/pos_data`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        integrator_store_id: input.integratorStoreId,
        integrator_brand_id: input.integratorBrandId,
        is_order_manager: true,
        require_manual_acceptance: false,
        integration_enabled: true,
        webhooks_config: { webhooks_version: "1.0.0" },
      }),
    },
  );
  if (!response.ok) {
    const detail = parseJson<{ message?: string }>(await response.text())?.message;
    throw new UberLinkError(
      `Uber did not activate the store for Seramet (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
}

/** Uber signs each webhook with the app's client secret: lowercase hex HMAC-SHA256 of the body. */
export async function verifyUberSignature(rawBody: Uint8Array, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, rawBody.slice().buffer as ArrayBuffer),
  );
  return constantTimeEqual(
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    signature.toLowerCase(),
  );
}

/** Uber marks each delivery `sandbox` or `production`; anything else is treated as production. */
export function uberDeliveryEnvironment(header: string | null | undefined): UberEnvironment {
  return header?.trim().toLowerCase() === "sandbox" ? "SANDBOX" : "PRODUCTION";
}

export class UberLinkError extends Error {}

function isLinkState(value: UberLinkState) {
  return (
    typeof value.tenantId === "string" &&
    typeof value.branchId === "string" &&
    typeof value.actorId === "string" &&
    (value.environment === "SANDBOX" || value.environment === "PRODUCTION") &&
    typeof value.expiresAt === "number"
  );
}

async function hmac(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function ticketKey(secret: string) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`uber-link-ticket:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
