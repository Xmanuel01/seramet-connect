import { describe, expect, it } from "vitest";
import {
  listUberStores,
  openUberLinkTicket,
  provisionUberStore,
  sealUberLinkTicket,
  signUberLinkState,
  uberAuthorizeUrl,
  uberDeliveryEnvironment,
  uberPlatformCredentials,
  uberPlatformSecretReference,
  verifyUberLinkState,
  verifyUberSignature,
} from "./store-link";

const secret = "a-test-signing-secret-that-is-long-enough-for-hmac";
const state = {
  tenantId: "tenant-a",
  branchId: "branch-a",
  actorId: "user-a",
  environment: "SANDBOX" as const,
};

async function hexHmac(key: string, body: Uint8Array) {
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", imported, body.slice().buffer as ArrayBuffer),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Uber Eats store link", () => {
  it("reads sandbox and live platform credentials separately", () => {
    const env = {
      SERAMET_UBER_CLIENT_ID: "live-id",
      SERAMET_UBER_CLIENT_SECRET: "live-secret",
      SERAMET_UBER_SANDBOX_CLIENT_ID: "test-id",
      SERAMET_UBER_SANDBOX_CLIENT_SECRET: "test-secret",
      SERAMET_UBER_SANDBOX_WEBHOOK_SIGNING_SECRET: "test-signing-key",
    };
    expect(uberPlatformCredentials(env, "SANDBOX")).toEqual({
      clientId: "test-id",
      clientSecret: "test-secret",
      webhookSigningSecret: "test-signing-key",
    });
    // Without a dashboard signing key, Uber signs webhooks with the client secret.
    expect(uberPlatformCredentials(env, "PRODUCTION")).toEqual({
      clientId: "live-id",
      clientSecret: "live-secret",
      webhookSigningSecret: "live-secret",
    });
    expect(uberPlatformCredentials({ SERAMET_UBER_CLIENT_ID: "only-id" }, "PRODUCTION")).toBe(
      undefined,
    );
    expect(uberPlatformSecretReference("SANDBOX")).not.toBe(
      uberPlatformSecretReference("PRODUCTION"),
    );
  });

  it("sends the restaurant to the matching Uber sign-in with the provisioning scope", () => {
    const url = new URL(
      uberAuthorizeUrl({
        environment: "SANDBOX",
        clientId: "test-id",
        redirectUri: "https://pos.example.test/api/seramet/integrations/uber-eats/callback",
        state: "signed-state",
      }),
    );
    expect(url.origin).toBe("https://sandbox-login.uber.com");
    expect(url.pathname).toBe("/oauth/v2/authorize");
    expect(url.searchParams.get("scope")).toBe("eats.pos_provisioning");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  it("accepts only its own unexpired sign-in state", async () => {
    const now = Date.UTC(2026, 10, 24, 9);
    const token = await signUberLinkState(state, secret, now);
    await expect(verifyUberLinkState(token, secret, now + 60_000)).resolves.toMatchObject(state);
    await expect(
      verifyUberLinkState(token, "another-secret-entirely-xxxxxxxxx", now),
    ).resolves.toBe(undefined);
    await expect(verifyUberLinkState(token, secret, now + 16 * 60_000)).resolves.toBe(undefined);
    const [body, signature] = token.split(".");
    const forged = `${body!.slice(0, -2)}AA.${signature}`;
    await expect(verifyUberLinkState(forged, secret, now)).resolves.toBe(undefined);
  });

  it("seals the merchant token so only this server can open it before it expires", async () => {
    const now = Date.now();
    const ticket = {
      ...state,
      expiresAt: now + 60_000,
      merchantAccessToken: "merchant-token",
      stores: [{ storeId: "store-1", name: "Test store" }],
    };
    const sealed = await sealUberLinkTicket(ticket, secret);
    expect(sealed).not.toContain("merchant-token");
    await expect(openUberLinkTicket(sealed, secret, now)).resolves.toEqual(ticket);
    await expect(
      openUberLinkTicket(sealed, "another-secret-entirely-xxxxxxxxx", now),
    ).resolves.toBe(undefined);
    await expect(openUberLinkTicket(sealed, secret, now + 120_000)).resolves.toBe(undefined);
    await expect(openUberLinkTicket("not-a-ticket", secret, now)).resolves.toBe(undefined);
  });

  it("verifies Uber's webhook signature over the raw body", async () => {
    const body = new TextEncoder().encode('{"event_type":"orders.notification"}');
    const signature = await hexHmac("client-secret", body);
    await expect(verifyUberSignature(body, signature, "client-secret")).resolves.toBe(true);
    await expect(verifyUberSignature(body, signature.toUpperCase(), "client-secret")).resolves.toBe(
      true,
    );
    await expect(verifyUberSignature(body, signature, "wrong-secret")).resolves.toBe(false);
    await expect(
      verifyUberSignature(new TextEncoder().encode("{}"), signature, "client-secret"),
    ).resolves.toBe(false);
    await expect(verifyUberSignature(body, "not-hex", "client-secret")).resolves.toBe(false);
  });

  it("treats only Uber's sandbox marker as a test delivery", () => {
    expect(uberDeliveryEnvironment("sandbox")).toBe("SANDBOX");
    expect(uberDeliveryEnvironment("production")).toBe("PRODUCTION");
    expect(uberDeliveryEnvironment(null)).toBe("PRODUCTION");
  });

  it("lists the account's stores and activates the chosen one as order manager", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return url.endsWith("/v1/eats/stores")
        ? new Response(
            JSON.stringify({
              stores: [
                {
                  store_id: "store-1",
                  name: "Test store",
                  location: { address: "1 Road", city: "Nairobi" },
                },
                { name: "No id" },
              ],
            }),
          )
        : new Response(null, { status: 204 });
    };
    await expect(
      listUberStores({ fetch, environment: "SANDBOX", accessToken: "merchant" }),
    ).resolves.toEqual([{ storeId: "store-1", name: "Test store", address: "1 Road, Nairobi" }]);
    expect(calls[0]!.url).toBe("https://test-api.uber.com/v1/eats/stores");

    await provisionUberStore({
      fetch,
      environment: "SANDBOX",
      accessToken: "merchant",
      storeId: "store-1",
      integratorStoreId: "branch-a",
      integratorBrandId: "tenant-a",
    });
    expect(calls[1]!.url).toBe("https://test-api.uber.com/v1/eats/stores/store-1/pos_data");
    expect(calls[1]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]!.init?.body))).toMatchObject({
      integrator_store_id: "branch-a",
      is_order_manager: true,
      require_manual_acceptance: false,
    });
    // Minimal activation: no optional settings that could need extra app permissions.
    const sent = JSON.parse(String(calls[1]!.init?.body)) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "integrator_brand_id",
      "integrator_store_id",
      "is_order_manager",
      "require_manual_acceptance",
    ]);
  });

  it("reads store lists keyed as data[].id and treats an empty list as empty", async () => {
    const reply = (body: unknown) => async () => new Response(JSON.stringify(body));
    await expect(
      listUberStores({
        fetch: reply({
          data: [{ id: "store-2", name: "Second", location: { street_address: "2 Road" } }],
        }),
        environment: "SANDBOX",
        accessToken: "merchant",
      }),
    ).resolves.toEqual([{ storeId: "store-2", name: "Second", address: "2 Road" }]);
    await expect(
      listUberStores({
        fetch: reply({ stores: [] }),
        environment: "SANDBOX",
        accessToken: "merchant",
      }),
    ).resolves.toEqual([]);
    // An empty `stores` list must not hide stores Uber listed under `data`.
    await expect(
      listUberStores({
        fetch: reply({ stores: [], data: [{ id: "store-3", name: "Third" }] }),
        environment: "SANDBOX",
        accessToken: "merchant",
      }),
    ).resolves.toEqual([{ storeId: "store-3", name: "Third" }]);
  });

  it("reports Uber's refusal to activate a store", async () => {
    const fetch = async () =>
      new Response(JSON.stringify({ message: "store not found" }), { status: 404 });
    await expect(
      provisionUberStore({
        fetch,
        environment: "SANDBOX",
        accessToken: "merchant",
        storeId: "missing",
        integratorStoreId: "branch-a",
        integratorBrandId: "tenant-a",
      }),
    ).rejects.toThrow(/HTTP 404.*store not found/);
  });
});
