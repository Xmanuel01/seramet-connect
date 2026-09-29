import { afterEach, describe, expect, it } from "vitest";
import { SettlementService } from "@/payments/settlement-service";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

afterEach(() => {
  setConfigurationRepositoryForTests(undefined);
});

describe("SettlementService configuration hydration", () => {
  it("uses the latest authoritative configuration when a long-lived service was created earlier", () => {
    setConfigurationRepositoryForTests(undefined);
    const service = new SettlementService();

    const platform = createDefaultDemoPlatformState();
    setConfigurationRepositoryForTests(new ConfigurationRepository(platform));

    const tenantId = platform.tenants[0]!.id;
    expect(service.listMethods(tenantId).some((method) => method.code === "CASH")).toBe(true);
  });
});
