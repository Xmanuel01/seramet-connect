import { expect, it } from "vitest";
import { getVisibleNavGroups, movedPaths, roleCanAccessPath } from "@/components/app/nav";
import { allPermissionCodes, permissions } from "@/platform/permissions";

const systemItems = (granted: readonly string[]) =>
  getVisibleNavGroups("Owner", undefined, [...granted] as typeof allPermissionCodes)
    .find((group) => group.group === "System")
    ?.items.map((item) => [item.label, item.to]);

it("lists restaurant administration in System, most used first, without the UI kit", () => {
  expect(systemItems(allPermissionCodes)).toEqual([
    ["Settings", "/settings"],
    ["Setup Centre", "/seramet-setup"],
    ["Menu Import", "/menu-import"],
    ["Printers & Devices", "/seramet-printers"],
    ["Integrations", "/integrations"],
    ["System Health", "/system-health"],
  ]);
});

it("shows each System entry only to people allowed to open it", () => {
  const withoutHardware = allPermissionCodes.filter(
    (code) => code !== permissions.settingsHardwareView,
  );
  expect(systemItems(withoutHardware)?.map(([label]) => label)).not.toContain("Printers & Devices");
});

it("keeps shortcuts to pages that became tabs, for people who can open the new page", () => {
  for (const [path, target] of Object.entries(movedPaths)) {
    expect(roleCanAccessPath("Owner", path, undefined, [...allPermissionCodes])).toBe(true);
    expect(roleCanAccessPath("Owner", target, undefined, [...allPermissionCodes])).toBe(true);
  }
  // Without inventory access the moved inventory pages stay hidden.
  const noInventory = allPermissionCodes.filter((code) => code !== permissions.inventoryView);
  expect(roleCanAccessPath("Owner", "/wastage", undefined, [...noInventory])).toBe(false);
});
