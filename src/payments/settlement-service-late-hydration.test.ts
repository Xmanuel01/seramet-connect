import { afterEach, describe, expect, it } from "vitest";
import { SettlementService } from "@/payments/settlement-service";
import { createEmptyPlatformState } from "@/platform/empty-platform-state";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const emptyRepository = () => new ConfigurationRepository(createEmptyPlatformState());

afterEach(() => {
  setConfigurationRepositoryForTests(emptyRepository());
});

describe("SettlementService authoritative configuration hydration", () => {
  it("uses payment methods hydrated after the server creates its singleton", () => {
    setConfigurationRepositoryForTests(emptyRepository());
    const service = new SettlementService();
    expect(service.listMethods(DEMO_TENANT_ID)).toEqual([]);

    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    expect(service.listMethods(DEMO_TENANT_ID).length).toBeGreaterThan(0);
    expect(service.listMethods(DEMO_TENANT_ID).some((method) => method.category === "CASH")).toBe(true);
  });

  it("preserves explicitly injected configuration for isolated callers", () => {
    const injected = new ConfigurationRepository(createDefaultDemoPlatformState());
    const service = new SettlementService(injected);
    setConfigurationRepositoryForTests(emptyRepository());
    expect(service.listMethods(DEMO_TENANT_ID).length).toBeGreaterThan(0);
  });
});
