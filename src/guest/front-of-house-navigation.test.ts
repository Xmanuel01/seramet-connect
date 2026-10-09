import { describe, expect, it } from "vitest";
import { navGroups } from "@/components/app/nav";
import { moduleDefinitionsForPath } from "@/platform/module-access-registry";

describe("Front of House navigation", () => {
  it("shows only one guest-operations destination in the sidebar", () => {
    const destinations = navGroups.flatMap((group) => group.items);
    const frontOfHouse = destinations.filter((item) => item.to === "/host");
    expect(frontOfHouse).toHaveLength(1);
    expect(frontOfHouse[0]?.label).toBe("Front of House");
    expect(destinations.some((item) => item.to === "/reservations")).toBe(false);
    expect(destinations.some((item) => item.to === "/waitlist")).toBe(false);
    expect(destinations.some((item) => item.to === "/guest-service")).toBe(false);
  });

  it("keeps legacy deep links registered for each dedicated workspace view", () => {
    for (const path of ["/host", "/reservations", "/waitlist", "/guest-service"]) {
      expect(
        moduleDefinitionsForPath(path).some((module) => module.key === "guest-operations"),
      ).toBe(true);
    }
  });
});

describe("Pilot navigation", () => {
  it("does not advertise finance modules without authoritative write models", () => {
    const destinations = navGroups.flatMap((group) => group.items.map((item) => item.to));

    for (const unsupported of ["/budgets", "/cost-centres", "/credit-notes", "/depreciation"]) {
      expect(destinations).not.toContain(unsupported);
    }
  });
});
