import { afterEach, describe, expect, it } from "vitest";
import { cloudflareBindings } from "@/server/cloudflare-bindings";

type TestCloudflareGlobal = typeof globalThis & {
  __env__?: unknown;
};

describe("Cloudflare binding resolution", () => {
  afterEach(() => {
    delete (globalThis as TestCloudflareGlobal).__env__;
  });

  it("reads bindings exposed by the Nitro Cloudflare module adapter", () => {
    (globalThis as TestCloudflareGlobal).__env__ = {
      SERAMET_ENVIRONMENT: "production",
      SERAMET_SUPABASE_URL: "https://example.supabase.co",
    };

    expect(cloudflareBindings(new Request("https://app.example.test"))).toMatchObject({
      SERAMET_ENVIRONMENT: "production",
      SERAMET_SUPABASE_URL: "https://example.supabase.co",
    });
  });

  it("prefers request-scoped bindings over global and fallback values", () => {
    (globalThis as TestCloudflareGlobal).__env__ = { SERAMET_ENVIRONMENT: "development" };
    const request = new Request("https://app.example.test") as Request & {
      runtime?: { cloudflare?: { env?: unknown } };
    };
    request.runtime = { cloudflare: { env: { SERAMET_ENVIRONMENT: "production" } } };

    expect(
      cloudflareBindings(request, { SERAMET_ENVIRONMENT: "staging" }),
    ).toMatchObject({ SERAMET_ENVIRONMENT: "production" });
  });
});
