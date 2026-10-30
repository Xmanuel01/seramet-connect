import { expect, it } from "vitest";
import { getVisibleNavGroups } from "@/components/app/nav";
import { allPermissionCodes, permissions } from "@/platform/permissions";

const systemItems = (granted: readonly string[]) =>
  getVisibleNavGroups("Owner", undefined, [...granted] as typeof allPermissionCodes)
    .find((group) => group.group === "System")
    ?.items.map((item) => [item.label, item.to]);

it("lists restaurant administration in System, most used first, without the UI kit", () => {
  expect(systemItems(allPermissionCodes)).toEqual([
    ["Settings", "/settings"],
    ["Setup Centre", "/seramet-setup"],
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
