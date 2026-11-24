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
    ["Imports", "/menu-import"],
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

const pathsFor = (granted: readonly string[]) =>
  getVisibleNavGroups("Owner", undefined, [...granted] as typeof allPermissionCodes).flatMap(
    (group) => group.items.map((item) => ({ group: group.group, to: item.to, label: item.label })),
  );

it("lists no placeholder pages, and their old addresses lead to the real page", () => {
  const visible = pathsFor(allPermissionCodes).map((item) => item.to);
  for (const path of [
    "/decisions",
    "/tasks",
    "/notifications",
    "/audit-trail",
    "/leave",
    "/recruitment",
    "/returns",
  ]) {
    expect(visible).not.toContain(path);
    expect(visible).toContain(movedPaths[path]);
  }
});

it("shows every page once, Stock Requests where the person's other work is", () => {
  const owner = pathsFor(allPermissionCodes).map((item) => item.to);
  expect(owner.length).toBe(new Set(owner).size);
  // A head chef (kitchen, no buying) finds it under Kitchen.
  const headChef = pathsFor([
    permissions.kitchenView,
    permissions.kitchenOperate,
    permissions.productionView,
    permissions.cookbookView,
    permissions.procurementRequisitionCreate,
  ]).filter((item) => item.to === "/requisitions");
  expect(headChef.map((item) => item.group)).toEqual(["Kitchen"]);
  // A buyer (procurement, no kitchen screen) finds it under Procurement.
  const buyer = pathsFor([
    permissions.procurementView,
    permissions.procurementRequisitionCreate,
    permissions.procurementApprove,
  ]).filter((item) => item.to === "/requisitions");
  expect(buyer.map((item) => item.group)).toEqual(["Procurement"]);
});

it("names the two attendance pages for what they do", () => {
  const workforce = pathsFor(allPermissionCodes).filter((item) => item.group === "Workforce");
  expect(workforce.find((item) => item.to === "/attendance")?.label).toBe("Clock In/Out");
  expect(workforce.find((item) => item.to === "/schedule")?.label).toBe("Team Timecards");
});
