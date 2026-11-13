import { describe, expect, it } from "vitest";
import {
  accessAreas,
  areaForPermission,
  areaLevelId,
  changedPermissions,
  CUSTOM_ACCESS,
  NO_ACCESS,
  permissionLabel,
  permissionLabels,
  platformOnlyPermissions,
  withAreaLevel,
  withPermission,
  withTemplate,
} from "@/platform/access-areas";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { accountOwnerPermissions, standardRoles } from "@/platform/standard-roles";
import { staffRolePresets } from "@/platform/staff-role-presets";

const sorted = (codes: readonly string[]) => [...codes].sort();
const area = (id: string) => accessAreas.find((item) => item.id === id)!;
const levelOf = (areaId: string, rolePermissions: readonly string[]) =>
  areaLevelId(area(areaId), rolePermissions);

describe("access areas cover the permission catalogue", () => {
  it("places every permission in exactly one area, or keeps it platform-only", () => {
    const placed = accessAreas.flatMap((item) => item.codes);
    const unplaced = allPermissionCodes.filter(
      (code) => !placed.includes(code) && !platformOnlyPermissions.includes(code),
    );
    // A new permission code must be added to a level of one area in access-areas.ts.
    expect(unplaced).toEqual([]);
    expect(placed.filter((code, index) => placed.indexOf(code) !== index)).toEqual([]);
    const known: readonly string[] = allPermissionCodes;
    expect(placed.filter((code) => !known.includes(code))).toEqual([]);
  });

  it("never offers platform-only permissions to a restaurant's roles", () => {
    expect(sorted(platformOnlyPermissions)).toEqual(
      sorted([
        permissions.platformTenantsProvision,
        permissions.platformEmailView,
        permissions.setupDemoReset,
      ]),
    );
    for (const code of platformOnlyPermissions) expect(areaForPermission(code)).toBeUndefined();
  });

  it("offers exactly what an account owner holds", () => {
    expect(sorted(accessAreas.flatMap((item) => item.codes))).toEqual(
      sorted(accountOwnerPermissions),
    );
  });

  it("gives every permission everyday wording without its code", () => {
    for (const code of allPermissionCodes) {
      const label = permissionLabel(code);
      expect(label, code).not.toBe(code);
      expect(label, code).not.toMatch(/[._]/);
      expect(label.length, code).toBeGreaterThan(5);
    }
    expect(sorted(Object.keys(permissionLabels))).toEqual(sorted(allPermissionCodes));
    const labels = accessAreas.flatMap((item) => item.codes.map(permissionLabel));
    expect(labels.filter((label, index) => labels.indexOf(label) !== index)).toEqual([]);
  });

  it("keeps the screen to a handful of choices", () => {
    expect(accessAreas.length).toBeGreaterThanOrEqual(8);
    expect(accessAreas.length).toBeLessThanOrEqual(15);
    for (const item of accessAreas) {
      expect(item.levels.length, item.id).toBeGreaterThanOrEqual(2);
      expect(item.levels.length, item.id).toBeLessThanOrEqual(4);
    }
  });
});

describe("levels map to fixed bundles of permissions", () => {
  it("builds each level on the one before it and ends with the whole area", () => {
    for (const item of accessAreas) {
      item.levels.forEach((level, index) => {
        const previous = item.levels[index - 1]?.codes ?? [];
        expect(level.codes.length, `${item.id}.${level.id}`).toBeGreaterThan(previous.length);
        expect(level.codes.slice(0, previous.length)).toEqual(previous);
        expect(level.description).not.toMatch(/[a-z]\.[a-z]/);
      });
      expect(item.levels.at(-1)!.codes).toEqual(item.codes);
      expect(new Set(item.levels.map((level) => level.id)).size).toBe(item.levels.length);
    }
  });

  it("pins the bundles staff rely on", () => {
    expect(area("sales").levels.find((level) => level.id === "work")!.codes).toEqual([
      permissions.ordersView,
      permissions.invoicesView,
      permissions.paymentsView,
      permissions.posAccess,
      permissions.ordersCreate,
      permissions.ordersUpdate,
      permissions.ordersServe,
      permissions.invoicesCreate,
      permissions.invoicesManage,
      permissions.paymentsRecord,
      permissions.paymentsCollect,
      permissions.cashOpen,
      permissions.cashClose,
    ]);
    expect(area("kitchen").levels.find((level) => level.id === "work")!.codes).toEqual([
      permissions.kitchenView,
      permissions.cookbookView,
      permissions.kitchenOperate,
    ]);
    expect(area("inventory").levels[0]!.codes).toEqual([permissions.inventoryIssueRequest]);
    expect(area("staff").levels[0]!.codes).toEqual([permissions.attendanceUse]);
    // Sensitive permissions sit only in the top level of their area.
    for (const [areaId, code] of [
      ["sales", permissions.paymentsRefundApprove],
      ["finance", permissions.dayCloseReopen],
      ["staff", permissions.settingsRoleManage],
      ["staff", permissions.payrollManage],
      ["settings", permissions.ownershipTransfer],
      ["branches", permissions.enterpriseAccessManage],
    ] as const) {
      const holders = area(areaId).levels.filter((level) => level.codes.includes(code));
      expect(
        holders.map((level) => level.id),
        code,
      ).toEqual(["full"]);
    }
  });

  it("reads the standard roles as levels", () => {
    const role = (key: keyof typeof staffRolePresets) => staffRolePresets[key]!.permissions;
    expect(levelOf("sales", role("cashier"))).toBe("work");
    expect(levelOf("staff", role("cashier"))).toBe("self");
    expect(levelOf("kitchen", role("cashier"))).toBe(NO_ACCESS);
    expect(levelOf("kitchen", role("chef"))).toBe("work");
    expect(levelOf("inventory", role("chef"))).toBe("request");
    expect(levelOf("kitchen", role("headChef"))).toBe("manage");
    expect(levelOf("purchasing", role("headChef"))).toBe("request");
    expect(levelOf("purchasing", role("supervisor"))).toBe("view");
    expect(levelOf("staff", role("supervisor"))).toBe("work");
    // Recipes without batch preparation is not one of the kitchen levels.
    expect(levelOf("kitchen", role("supervisor"))).toBe(CUSTOM_ACCESS);
    for (const item of accessAreas) {
      expect(areaLevelId(item, accountOwnerPermissions), item.id).toBe("full");
      expect(areaLevelId(item, []), item.id).toBe(NO_ACCESS);
    }
  });

  it("setting a level changes that area only", () => {
    const before = [...staffRolePresets.cashier!.permissions];
    const after = withAreaLevel(before, area("kitchen"), "work");
    expect(levelOf("kitchen", after)).toBe("work");
    expect(sorted(changedPermissions(before, after))).toEqual(
      sorted([permissions.kitchenView, permissions.cookbookView, permissions.kitchenOperate]),
    );
    const lowered = withAreaLevel(after, area("sales"), "view");
    expect(levelOf("sales", lowered)).toBe("view");
    expect(levelOf("kitchen", lowered)).toBe("work");
    expect(withAreaLevel(lowered, area("sales"), NO_ACCESS)).not.toContain(permissions.ordersView);
    // An unknown level is ignored rather than clearing the area.
    expect(withAreaLevel(before, area("sales"), "nope")).toEqual(before);
  });

  it("every level can be chosen and read back, from any starting point", () => {
    for (const start of [[], accountOwnerPermissions, staffRolePresets.supervisor!.permissions]) {
      for (const item of accessAreas) {
        for (const level of item.levels) {
          const next = withAreaLevel(start, item, level.id);
          expect(areaLevelId(item, next), `${item.id}.${level.id}`).toBe(level.id);
          expect(sorted(next.filter((code) => item.codes.includes(code)))).toEqual(
            sorted(level.codes),
          );
          expect(sorted(next.filter((code) => !item.codes.includes(code)))).toEqual(
            sorted(start.filter((code) => !item.codes.includes(code))),
          );
        }
        expect(areaLevelId(item, withAreaLevel(start, item, NO_ACCESS))).toBe(NO_ACCESS);
      }
    }
  });
});

describe("custom access survives the editor", () => {
  // Sales without taking payment, one stray approval, a platform code and a code from the future.
  const custom = [
    permissions.posAccess,
    permissions.ordersView,
    permissions.ordersCreate,
    permissions.inventoryCountApprove,
    permissions.platformEmailView,
    "future.permission.code",
    permissions.attendanceUse,
  ];

  it("shows a mix that matches no level as Custom", () => {
    expect(levelOf("sales", custom)).toBe(CUSTOM_ACCESS);
    expect(levelOf("inventory", custom)).toBe(CUSTOM_ACCESS);
    expect(levelOf("staff", custom)).toBe("self");
    expect(levelOf("finance", custom)).toBe(NO_ACCESS);
  });

  it("opened and saved untouched, a role keeps exactly its permissions", () => {
    // The editor's draft is the saved list; with no choice made, that list is what is sent.
    const roles = [custom, accountOwnerPermissions, ...standardRoles.map((r) => r.permissions)];
    for (const rolePermissions of roles) {
      let draft = [...rolePermissions];
      // Re-choosing the level each area already shows changes nothing either.
      for (const item of accessAreas) {
        const current = areaLevelId(item, draft);
        if (current !== CUSTOM_ACCESS) draft = withAreaLevel(draft, item, current);
      }
      expect(changedPermissions(rolePermissions, draft)).toEqual([]);
      expect(sorted(draft)).toEqual(sorted(rolePermissions));
    }
  });

  it("changing another area leaves a custom area, platform and unknown codes alone", () => {
    const next = withAreaLevel(custom, area("kitchen"), "view");
    expect(levelOf("sales", next)).toBe(CUSTOM_ACCESS);
    for (const code of custom) expect(next).toContain(code);
    expect(sorted(changedPermissions(custom, next))).toEqual(
      sorted([permissions.kitchenView, permissions.cookbookView]),
    );
  });

  it("switching one permission moves an area between a level and Custom", () => {
    const cashier = staffRolePresets.cashier!.permissions;
    const plusCancel = withPermission(cashier, permissions.ordersCancel, true);
    expect(levelOf("sales", plusCancel)).toBe(CUSTOM_ACCESS);
    expect(changedPermissions(cashier, plusCancel)).toEqual([permissions.ordersCancel]);
    const back = withPermission(plusCancel, permissions.ordersCancel, false);
    expect(levelOf("sales", back)).toBe("work");
    expect(withPermission(cashier, permissions.posAccess, true)).toEqual(cashier);
  });

  it("a template replaces what the editor offers and nothing else", () => {
    const next = withTemplate(custom, staffRolePresets.chef!.permissions);
    expect(sorted(next)).toEqual(
      sorted([
        ...staffRolePresets.chef!.permissions,
        permissions.platformEmailView,
        "future.permission.code",
      ]),
    );
    expect(withTemplate([], [permissions.platformTenantsProvision])).toEqual([]);
  });
});
