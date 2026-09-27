import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moduleDefinitionsForPath } from "@/platform/module-access-registry";
import { settingsGroups, settingsRouteItems } from "@/platform/settings-navigation";

describe("Settings navigation", () => {
  it("links every routed setting to a registered staff route", () => {
    const missingRouteFiles = settingsRouteItems
      .map((item) => item.to)
      .filter((path) => !existsSync(`src/routes/${path.slice(1)}.tsx`));
    const unprotectedRoutes = settingsRouteItems
      .map((item) => item.to)
      .filter((path) => moduleDefinitionsForPath(path).length === 0);

    expect(missingRouteFiles).toEqual([]);
    expect(unprotectedRoutes).toEqual([]);
    expect(moduleDefinitionsForPath("/seramet-setup").map((module) => module.key)).toContain(
      "setup",
    );
  });

  it("does not reuse the old generic setting labels as fake configuration controls", () => {
    const items = settingsGroups.flatMap((group) => group.items);
    const inlineLabels = items.filter((item) => item.kind === "inline").map((item) => item.label);

    expect(inlineLabels).toEqual([
      "Users",
      "Roles",
      "Permissions",
      "Order types",
      "Payment methods",
    ]);
    expect(items.every((item) => item.description.trim().length > 0)).toBe(true);
  });
});
