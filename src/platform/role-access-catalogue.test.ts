import { describe, expect, it } from "vitest";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  advancedOnlyPermissions,
  allAccessAreas,
  allRiskyActions,
  areaLevel,
  areaPermissions,
  roleAccessSummary,
  simpleEditorPermissions,
  withAreaLevel,
  withRiskyAction,
} from "@/platform/role-access-catalogue";
import { applyRoleTemplate, roleTemplates } from "@/platform/role-templates";
import { staffRolePresets } from "@/platform/staff-role-presets";

describe("simple role editor catalogue", () => {
  it("places every permission exactly once, so the simple editor never drops one", () => {
    const placed = [
      ...allAccessAreas.flatMap((area) => areaPermissions(area, "MANAGE")),
      ...allRiskyActions.flatMap((action) => action.permissions),
      ...advancedOnlyPermissions,
    ];
    const counts = new Map<string, number>();
    for (const code of placed) counts.set(code, (counts.get(code) ?? 0) + 1);
    expect([...counts].filter(([, count]) => count > 1)).toEqual([]);
    expect(allPermissionCodes.filter((code) => !counts.has(code))).toEqual([]);
    expect(
      [...counts.keys()].filter((code) => !allPermissionCodes.includes(code as never)),
    ).toEqual([]);
  });

  it("each level includes the one before it", () => {
    const pos = allAccessAreas.find((area) => area.key === "pos")!;
    expect(areaPermissions(pos, "USE")).toEqual(
      expect.arrayContaining(areaPermissions(pos, "VIEW")),
    );
    expect(areaLevel(pos, areaPermissions(pos, "USE"))).toBe("USE");
    expect(areaLevel(pos, [])).toBe("NONE");
    // Use without View fits no single level.
    expect(areaLevel(pos, [permissions.ordersCreate])).toBe("CUSTOM");
  });

  it("changing one area or switch leaves everything else on the role untouched", () => {
    const start = [...staffRolePresets.cashier!.permissions, permissions.ownershipTransfer];
    const pos = allAccessAreas.find((area) => area.key === "pos")!;
    const next = withAreaLevel(start, pos, "VIEW");
    expect(next).toContain(permissions.posAccess);
    expect(next).not.toContain(permissions.ordersCreate);
    expect(next.filter((code) => !areaPermissions(pos, "MANAGE").includes(code)).sort()).toEqual(
      start.filter((code) => !areaPermissions(pos, "MANAGE").includes(code)).sort(),
    );
    const refunds = allRiskyActions.find((action) => action.key === "refunds")!;
    expect(withRiskyAction(start, refunds, true)).toContain(permissions.paymentsRefundApprove);
    expect(withRiskyAction(withRiskyAction(start, refunds, true), refunds, false).sort()).toEqual(
      [...start].sort(),
    );
  });

  it("every template shows clean levels, with no area left as custom", () => {
    for (const template of roleTemplates) {
      const custom = allAccessAreas
        .filter((area) => areaLevel(area, template.permissions) === "CUSTOM")
        .map((area) => area.label);
      expect({ template: template.label, custom }).toEqual({
        template: template.label,
        custom: [],
      });
    }
  });

  it("keeps the existing staff templates exactly as they were", () => {
    for (const [key, preset] of Object.entries(staffRolePresets))
      expect(roleTemplates.find((template) => template.key === key)?.permissions).toEqual(
        preset.permissions,
      );
  });

  it("gives ordinary staff templates no money approvals or role changes", () => {
    for (const key of ["waiter", "storekeeper", "rider"]) {
      const template = roleTemplates.find((row) => row.key === key)!;
      expect(template.permissions).toContain(permissions.attendanceUse);
      for (const code of [
        permissions.paymentsRefundApprove,
        permissions.settingsRoleManage,
        permissions.cashAdjust,
        permissions.dayCloseReopen,
      ])
        expect(template.permissions).not.toContain(code);
    }
    expect(simpleEditorPermissions.has(permissions.platformTenantsProvision)).toBe(false);
  });
});

describe("role editor review fixes", () => {
  it("never adds advanced-only permissions when the Owner template is applied", () => {
    const owner = roleTemplates.find((template) => template.key === "owner")!;
    expect(owner.permissions).toContain(permissions.ownershipTransfer);
    const applied = applyRoleTemplate([permissions.posAccess], owner);
    expect(applied).not.toContain(permissions.ownershipTransfer);
    expect(applied).not.toContain(permissions.setupEntitlementsManage);
    expect(applied).toContain(permissions.paymentsRefundApprove);
    // Advanced permissions a role already has are kept.
    expect(applyRoleTemplate([permissions.ownershipTransfer], owner)).toContain(
      permissions.ownershipTransfer,
    );
  });

  it("lists a partly held risky action in the summary", () => {
    expect(roleAccessSummary([permissions.invoicesReprint]).risky).toEqual([
      "reprint invoices and receipts (partly)",
    ]);
    expect(
      roleAccessSummary([permissions.invoicesReprint, permissions.receiptsReprint]).risky,
    ).toEqual(["reprint invoices and receipts"]);
  });

  it("switching a partly held risky action off removes only what is held", () => {
    const reprint = allRiskyActions.find((action) => action.key === "reprint")!;
    expect(withRiskyAction([permissions.invoicesReprint], reprint, false)).toEqual([]);
  });
});
