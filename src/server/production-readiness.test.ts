import { describe, expect, it, vi } from "vitest";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import type { SerametEnv } from "@/lib/seramet-auth";

describe("public deployment readiness", () => {
  it.each([
    ["GET", "/api/seramet/public/auth/config"],
    ["POST", "/api/seramet/public/auth/login"],
    ["POST", "/api/seramet/public/auth/signup"],
    ["GET", "/api/seramet/public/device/startup"],
    ["GET", "/api/seramet/health"],
    ["GET", "/api/seramet/transactions"],
    ["PUT", "/api/seramet/transactions"],
    ["POST", "/api/seramet/transactions/mutate"],
    ["POST", "/api/seramet/offline/sync"],
    ["POST", "/api/seramet/printing/jobs"],
    ["POST", "/api/seramet/internal/file-scanner/claim"],
    ["POST", "/api/seramet/internal/file-scanner/verdict"],
    ["POST", "/api/seramet/payments/mpesa/stk"],
    ["OPTIONS", "/api/seramet/transactions"],
  ])("rejects public development %s %s before side effects", async (method, path) => {
    const prepare = vi.fn(() => {
      throw new Error("Database must not be touched");
    });
    const request = new Request(`https://restaurant.example${path}`, {
      method,
      ...(method === "POST" || method === "PUT" ? { body: "malformed JSON" } : {}),
      headers: {
        host: "localhost",
        "x-forwarded-host": "localhost",
        "x-forwarded-for": "127.0.0.1",
        authorization: "Bearer unrelated-token",
      },
    });
    const response = await handleSerametApiRequest(request, {
      SERAMET_ENVIRONMENT: "development",
      SERAMET_ENABLE_DEV_AUTH: "true",
      SERAMET_DB: { prepare },
    } as unknown as SerametEnv);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "PUBLIC_DEVELOPMENT_RUNTIME" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(prepare).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it("blocks ordinary public requests when runtime configuration is missing", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://restaurant.example/api/seramet/public/auth/config"),
      {},
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "PUBLIC_DEVELOPMENT_RUNTIME" });
  });

  it.each(["ready", "operational"])(
    "rejects a public development runtime at %s",
    async (endpoint) => {
      const prepare = vi.fn(() => {
        throw new Error("Database must not be touched");
      });
      const response = await handleSerametApiRequest(
        new Request(`https://restaurant.example/api/seramet/health/${endpoint}`),
        {
          SERAMET_ENVIRONMENT: "development",
          SERAMET_DB: { prepare },
          SERAMET_BUILD_ID: "release-test",
        } as unknown as SerametEnv,
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        ok: false,
        environment: "development",
        buildId: "release-test",
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "PUBLIC_DEVELOPMENT_RUNTIME" }),
        ]),
      });
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("cannot report public readiness when environment configuration is missing", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://restaurant.example/api/seramet/health/ready"),
      {},
    );
    expect(response.status).toBe(503);
  });

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "preserves loopback development on %s",
    async (host) => {
      const response = await handleSerametApiRequest(
        new Request(`http://${host}/api/seramet/health/ready`),
        { SERAMET_ENVIRONMENT: "development" },
      );
      expect(response.status).toBe(200);
      const auth = await handleSerametApiRequest(
        new Request(`http://${host}/api/seramet/public/auth/config`),
        { SERAMET_ENVIRONMENT: "development" },
      );
      expect(auth.status).toBe(200);
    },
  );

  it.each(["localhost.example", "127.0.0.1.example", "restaurant.example"])(
    "does not treat %s as loopback",
    async (host) => {
      const response = await handleSerametApiRequest(
        new Request(`https://${host}/api/seramet/public/auth/config`),
        { SERAMET_ENVIRONMENT: "development" },
      );
      expect(response.status).toBe(503);
    },
  );

  it("does not expose public test-mode operations either", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://restaurant.example/api/seramet/public/auth/config"),
      { SERAMET_ENVIRONMENT: "test" },
    );
    expect(response.status).toBe(503);
  });

  it.each(["staging", "production"])(
    "preserves existing public auth bootstrap handling in %s",
    async (environment) => {
      const response = await handleSerametApiRequest(
        new Request("https://restaurant.example/api/seramet/public/auth/config"),
        { SERAMET_ENVIRONMENT: environment },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).not.toHaveProperty("code", "PUBLIC_DEVELOPMENT_RUNTIME");
    },
  );

  it("retains cheap liveness without claiming operational readiness", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://restaurant.example/api/seramet/health/live"),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("schemaVersion");
  });
});
