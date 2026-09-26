import { describe, expect, it } from "vitest";
import { providerSetupSchema } from "@/onboarding/schemas";

describe("restaurant integration configuration boundary", () => {
  const restaurantConfiguration = {
    providerId: "provider-payment",
    branchId: "branch-1",
    environment: "SANDBOX" as const,
    configuration: { merchantId: "merchant-123", enabled: true },
    enabled: true,
  };

  it("accepts restaurant-specific provider configuration", () => {
    expect(providerSetupSchema.parse(restaurantConfiguration)).toEqual(restaurantConfiguration);
  });

  it.each([
    { credentials: { consumerSecret: "must-not-enter-browser" } },
    { secretReference: "managed://internal/provider-secret" },
  ])("rejects browser-supplied secret material: $credentials$secretReference", (unsafe) => {
    expect(() => providerSetupSchema.parse({ ...restaurantConfiguration, ...unsafe })).toThrow();
  });
});
