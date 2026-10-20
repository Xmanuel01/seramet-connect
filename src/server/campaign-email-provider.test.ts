import { describe, expect, it, vi } from "vitest";
import type { CampaignMessage } from "@/crm/types";
import {
  campaignEmailKey,
  campaignUnsubscribeUrl,
  createCampaignEmailRegistry,
  verifyCampaignUnsubscribe,
} from "./campaign-email-provider";
import type { SerametEnv } from "@/lib/seramet-auth";

const env: SerametEnv = {
  SERAMET_PUBLIC_ORIGIN: "https://disposable.invalid",
  SERAMET_CAMPAIGN_EMAIL_CONFIG: JSON.stringify({
    "test-tenant": {
      apiKey: "disposable-provider-key-not-live",
      from: "Restaurant <marketing@example.invalid>",
      unsubscribeSecret: "disposable-unsubscribe-secret-at-least-32-characters",
    },
  }),
};
const message: CampaignMessage = {
  tenantId: "test-tenant",
  customerId: "test-customer",
  deliveryId: "delivery-1",
  channel: "EMAIL",
  destination: "guest@example.invalid",
  subject: "Test campaign",
  body: "Consent verified",
  idempotencyKey: "delivery:1",
};
const acceptedId = "<disposable-94b12da7@smtp-relay.test.invalid>";
describe("server-only tenant-scoped campaign email", () => {
  it("fails closed without a protected tenant configuration and never uses closing-email credentials", async () => {
    const fetcher = vi.fn();
    const adapter = createCampaignEmailRegistry(
      { SERAMET_CLOSING_EMAIL_API_KEY: "unrelated" },
      "test-tenant",
      fetcher,
    ).get(campaignEmailKey);
    expect(await adapter.health()).toBe("UNKNOWN");
    expect(await adapter.send(message)).toMatchObject({ status: "FAILED", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the Brevo HTTPS contract, bounded timeout and signed unsubscribe headers", async () => {
    const fetcher = vi.fn(async () => Response.json({ messageId: acceptedId }));
    const adapter = createCampaignEmailRegistry(env, "test-tenant", fetcher).get(campaignEmailKey);
    expect(await adapter.send(message)).toEqual({ status: "SENT", providerMessageId: acceptedId });
    expect(await adapter.send(message)).toEqual({ status: "SENT", providerMessageId: acceptedId });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).has("api-key")).toBe(true);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual([{ email: message.destination }]);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.textContent).not.toContain("disposable-provider-key");
    expect(body.htmlContent).toBeUndefined();
  });
  it.each([
    { tenantId: "other-tenant" },
    { destination: "bad\r\nBcc: another@example.invalid" },
    { channel: "SMS" as const },
    { subject: "Header\r\ninjection" },
    { customerId: undefined },
  ])("does not send unauthorized or malformed messages: %j", async (change) => {
    const fetcher = vi.fn();
    expect(
      await createCampaignEmailRegistry(env, "test-tenant", fetcher)
        .get(campaignEmailKey)
        .send({ ...message, ...change }),
    ).toMatchObject({ status: "FAILED", retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([429, 400, 401, 403, 409, 500])(
    "classifies HTTP %i without leaking provider errors",
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response("secret provider diagnostic guest@example.invalid", { status }),
      );
      const result = await createCampaignEmailRegistry(env, "test-tenant", fetcher)
        .get(campaignEmailKey)
        .send(message);
      expect(JSON.stringify(result)).not.toMatch(/secret|guest@example/);
      expect(result.status).toBe(status >= 500 || status === 409 ? "UNKNOWN" : "FAILED");
      if (status === 429) expect(result.retryable).toBe(true);
      if ([400, 401, 403].includes(status)) expect(result.retryable).toBe(false);
    },
  );
  it("quarantines timeout and malformed success outcomes", async () => {
    for (const fetcher of [
      vi.fn(async () => {
        throw new Error("private details");
      }),
      vi.fn(async () => Response.json({ unexpected: acceptedId })),
    ]) {
      expect(
        await createCampaignEmailRegistry(env, "test-tenant", fetcher)
          .get(campaignEmailKey)
          .send(message),
      ).toMatchObject({ status: "UNKNOWN" });
    }
  });
  it("authenticates unsubscribe identity and rejects tenant substitution and tampering", async () => {
    const url = new URL(await campaignUnsubscribeUrl(env, "test-tenant", "test-customer"));
    expect(await verifyCampaignUnsubscribe(env, url)).toEqual({
      tenantId: "test-tenant",
      customerId: "test-customer",
    });
    url.searchParams.set(
      "token",
      btoa(JSON.stringify(["other-tenant", "test-customer"])).replace(/=+$/, ""),
    );
    expect(await verifyCampaignUnsubscribe(env, url)).toBeNull();
    const altered = new URL(await campaignUnsubscribeUrl(env, "test-tenant", "test-customer"));
    altered.searchParams.set("signature", "0".repeat(64));
    expect(await verifyCampaignUnsubscribe(env, altered)).toBeNull();
  });
});
