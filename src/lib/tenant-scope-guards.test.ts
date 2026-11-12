import { afterEach, describe, expect, it } from "vitest";
import { isDevelopmentAuthRequest } from "@/lib/seramet-auth";
import { exportMenuToCsv } from "@/lib/menu-import-export";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

afterEach(() => setConfigurationRepositoryForTests(undefined));

const devAuth = (url: string) =>
  new Request(url, { method: "POST", headers: { "x-seramet-dev-auth": "enabled" } });

describe("development-only tenant fallbacks", () => {
  it("accepts the development header only on a local development server with dev auth on", () => {
    const development = { SERAMET_ENVIRONMENT: "development", SERAMET_ENABLE_DEV_AUTH: "true" };
    expect(isDevelopmentAuthRequest(devAuth("http://127.0.0.1/api/x"), development)).toBe(true);
    // Production, staging, a public host or dev auth switched off never take the fallback.
    expect(
      isDevelopmentAuthRequest(devAuth("https://pos.example.test/api/x"), {
        SERAMET_ENVIRONMENT: "production",
      }),
    ).toBe(false);
    expect(
      isDevelopmentAuthRequest(devAuth("https://staging.example.test/api/x"), {
        SERAMET_ENVIRONMENT: "staging",
        SERAMET_ENABLE_DEV_AUTH: "true",
      }),
    ).toBe(false);
    expect(
      isDevelopmentAuthRequest(devAuth("https://public.example.test/api/x"), development),
    ).toBe(false);
    expect(
      isDevelopmentAuthRequest(devAuth("http://127.0.0.1/api/x"), {
        SERAMET_ENVIRONMENT: "development",
      }),
    ).toBe(false);
    expect(isDevelopmentAuthRequest(new Request("http://127.0.0.1/api/x"), development)).toBe(
      false,
    );
  });
});

describe("menu export branch columns", () => {
  const branchColumns = (csv: string) =>
    csv
      .split("\n")[0]!
      .split(",")
      .filter((column) => column.endsWith("Price") && column !== "price");

  it("uses the branches of the one restaurant held", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    expect(branchColumns(exportMenuToCsv([])).length).toBeGreaterThan(0);
  });

  it("never picks one of several restaurants a server holds", () => {
    const demo = createDefaultDemoPlatformState();
    const tenant = demo.tenants[0]!;
    const other = { ...tenant, id: "another-restaurant", slug: "another-restaurant" };
    const otherBranch = { ...demo.branches[0]!, id: "another-branch", tenantId: other.id };
    setConfigurationRepositoryForTests(
      new ConfigurationRepository({
        ...demo,
        tenants: [other, ...demo.tenants],
        branches: [otherBranch, ...demo.branches],
      }),
    );
    expect(branchColumns(exportMenuToCsv([]))).toEqual([]);
  });
});
