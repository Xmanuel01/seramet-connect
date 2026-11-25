import { describe, expect, it } from "vitest";
import { handleSerametApiRequest, receiveUberPlatformWebhook } from "@/lib/seramet-api";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

const webhookUrl = "http://localhost:3000/api/seramet/integrations/webhooks/UBER_EATS";
const body = JSON.stringify({
  event_id: "event-1",
  event_type: "orders.notification",
  event_time: 1_764_000_000_000,
  meta: { resource_id: "order-1", user_id: "store-nobody-linked" },
});

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function post(headers: Record<string, string>) {
  return new Request(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const env = {
  SERAMET_UBER_SANDBOX_CLIENT_ID: "test-id",
  SERAMET_UBER_SANDBOX_CLIENT_SECRET: "test-secret",
};

describe("Uber Eats platform webhook", () => {
  it("refuses a delivery whose signature is not from Seramet's Uber app", async () => {
    const response = await handleSerametApiRequest(
      post({ "x-environment": "sandbox", "x-uber-signature": await sign("other", body) }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("does not accept live deliveries with only testing credentials configured", async () => {
    const response = await handleSerametApiRequest(
      post({ "x-environment": "production", "x-uber-signature": await sign("test-secret", body) }),
      env,
    );
    expect(response.status).toBe(503);
  });

  it("acknowledges a signed event for a store no restaurant has linked", async () => {
    // A database with no store mappings, recording which Uber store the router looked up.
    const lookups: unknown[][] = [];
    const statement = (query: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...next) => statement(query, next),
      first: async () => null,
      all: async () => {
        if (query.includes("FROM provider_mappings")) lookups.push(values);
        return { results: [] };
      },
      run: async () => ({ success: true }),
    });
    const db: D1Database = {
      prepare: (query) => statement(query),
      batch: async <T>(statements: D1PreparedStatement[]) =>
        Promise.all(statements.map((item) => item.run<T>())),
    };
    const response = await receiveUberPlatformWebhook(
      post({ "x-environment": "sandbox", "x-uber-signature": await sign("test-secret", body) }),
      { ...env, SERAMET_DB: db },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(lookups).toEqual([["provider-delivery-uber-eats", "store-nobody-linked", "SANDBOX"]]);
  });

  it("refuses a body over 1 MiB even when Content-Length is missing", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(700_000));
        controller.close();
      },
    });
    const response = await handleSerametApiRequest(
      new Request(webhookUrl, {
        method: "POST",
        headers: { "x-environment": "sandbox", "x-uber-signature": "0".repeat(64) },
        body: oversized,
        // @ts-expect-error Node's fetch needs duplex for a streamed request body.
        duplex: "half",
      }),
      env,
    );
    expect(response.status).toBe(413);
  });
});
