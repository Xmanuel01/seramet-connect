import { describe, expect, it, vi } from "vitest";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import type { SerametEnv } from "@/lib/seramet-auth";

describe("public deployment readiness", () => {
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

  it.each(["localhost", "127.0.0.1"])("preserves loopback development on %s", async (host) => {
    const response = await handleSerametApiRequest(
      new Request(`http://${host}/api/seramet/health/ready`),
      { SERAMET_ENVIRONMENT: "development" },
    );
    expect(response.status).toBe(200);
  });

  it("retains cheap liveness without claiming operational readiness", async () => {
    const response = await handleSerametApiRequest(
      new Request("https://restaurant.example/api/seramet/health/live"),
      {},
    );
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty("schemaVersion");
  });
});
