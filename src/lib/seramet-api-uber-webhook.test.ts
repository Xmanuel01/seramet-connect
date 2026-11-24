import { describe, expect, it } from "vitest";
import { handleSerametApiRequest } from "@/lib/seramet-api";

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
    const response = await handleSerametApiRequest(
      post({ "x-environment": "sandbox", "x-uber-signature": await sign("test-secret", body) }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
