import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetIntegrationMemoryForTests } from "@/integrations/runtime/integration-repository";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

// The demo Westlands till is a sandbox connection, so the platform test key applies to it.
const env = {
  SERAMET_ENVIRONMENT: "development",
  SERAMET_ENABLE_DEV_AUTH: "true",
  SERAMET_MPESA_WEBHOOK_SECRET: "route-key-123",
};
const base = "http://127.0.0.1/api/seramet/integrations/webhooks/DARAJA/connection-demo-daraja-wst";

beforeEach(() => {
  resetIntegrationMemoryForTests();
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

afterEach(() => setConfigurationRepositoryForTests(undefined));

describe("M-Pesa callback addresses", () => {
  it("accepts a notification only when the address carries the connection's key", async () => {
    const accepted = await handleSerametApiRequest(post(`${base}/route-key-123`, c2b("RKR1")), env);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, result: { status: "UNALLOCATED" } });

    const wrongKey = await handleSerametApiRequest(post(`${base}/not-the-key`, c2b("RKR2")), env);
    expect(wrongKey.status).toBeGreaterThanOrEqual(400);
    const noKey = await handleSerametApiRequest(post(base, c2b("RKR3")), env);
    expect(noKey.status).toBeGreaterThanOrEqual(400);
  });

  it("answers M-Pesa's validation check without recording a payment", async () => {
    const response = await handleSerametApiRequest(
      post(`${base}/route-key-123/validate`, c2b("RKR4")),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
  });
});

function post(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function c2b(receipt: string) {
  return {
    TransactionType: "Buy Goods",
    TransID: receipt,
    TransTime: "20261030121500",
    TransAmount: "250",
    BusinessShortCode: "4235484",
    BillRefNumber: "",
    MSISDN: "2547XXXX678",
    FirstName: "Jane",
  };
}
