import {
  allAccessAreas,
  allRiskyActions,
  areaPermissions,
  simpleEditorPermissions,
  type AccessLevel,
} from "@/platform/role-access-catalogue";
import { staffRolePresets } from "@/platform/staff-role-presets";
import { accountOwnerPermissions } from "@/platform/standard-roles";
import type { PermissionCode } from "@/platform/types";

export type RoleTemplate = { key: string; label: string; permissions: PermissionCode[] };

/**
 * A role's permissions with a template applied: everything the simple editor sets comes from
 * the template; anything else on the role, including advanced-only permissions such as
 * ownership transfer, is left exactly as it was.
 */
export function applyRoleTemplate(held: readonly PermissionCode[], template: RoleTemplate) {
  return [
    ...new Set([
      ...held.filter((code) => !simpleEditorPermissions.has(code)),
      ...template.permissions.filter((code) => simpleEditorPermissions.has(code)),
    ]),
  ];
}

/** A role made of area levels and risky-action switches. */
function fromLevels(levels: Record<string, AccessLevel>, risky: string[] = []): PermissionCode[] {
  const codes = Object.entries(levels).flatMap(([key, level]) => {
    const area = allAccessAreas.find((row) => row.key === key);
    if (!area) throw new Error(`Unknown access area ${key}`);
    return areaPermissions(area, level);
  });
  for (const key of risky) {
    const action = allRiskyActions.find((row) => row.key === key);
    if (!action) throw new Error(`Unknown risky action ${key}`);
    codes.push(...action.permissions);
  }
  return [...new Set(codes)];
}

/**
 * Starting points in the role editor. The staff templates are the ones every restaurant's
 * standard roles and onboarding already use, unchanged; the rest are new starting points.
 */
export const roleTemplates: readonly RoleTemplate[] = [
  { key: "owner", label: "Owner (everything)", permissions: accountOwnerPermissions },
  {
    key: "manager",
    label: "Manager",
    permissions: fromLevels(
      {
        pos: "USE",
        orders: "VIEW",
        invoices: "USE",
        receipts: "VIEW",
        payments: "MANAGE",
        guests: "MANAGE",
        delivery: "MANAGE",
        "kitchen-screen": "USE",
        recipes: "MANAGE",
        production: "MANAGE",
        stock: "MANAGE",
        "store-issues": "MANAGE",
        "stock-requests": "MANAGE",
        "purchase-orders": "MANAGE",
        "cost-control": "USE",
        finance: "VIEW",
        reconciliation: "USE",
        dashboard: "VIEW",
        reports: "VIEW",
        management: "MANAGE",
        "ask-seramet": "USE",
        "clock-in": "USE",
        staff: "USE",
        users: "VIEW",
        customers: "USE",
        loyalty: "MANAGE",
        marketing: "USE",
        "business-setup": "VIEW",
        devices: "USE",
        integrations: "USE",
        branches: "USE",
      },
      ["cancel-orders", "cancel-invoices", "reprint", "refunds", "approve-adjustments"],
    ),
  },
  ...Object.entries(staffRolePresets).map(([key, preset]) => ({
    key,
    label: preset.label,
    permissions: preset.permissions,
  })),
  {
    key: "waiter",
    label: "Waiter",
    permissions: fromLevels({
      "clock-in": "USE",
      pos: "USE",
      orders: "VIEW",
      guests: "USE",
      loyalty: "USE",
    }),
  },
  {
    key: "storekeeper",
    label: "Storekeeper",
    permissions: fromLevels({
      "clock-in": "USE",
      recipes: "VIEW",
      stock: "USE",
      "store-issues": "MANAGE",
      "stock-requests": "USE",
      "purchase-orders": "USE",
    }),
  },
  {
    key: "accountant",
    label: "Accountant",
    permissions: fromLevels(
      {
        "clock-in": "USE",
        invoices: "VIEW",
        receipts: "VIEW",
        payments: "VIEW",
        "purchase-orders": "VIEW",
        finance: "MANAGE",
        reconciliation: "MANAGE",
        dashboard: "VIEW",
        reports: "VIEW",
      },
      ["supplier-invoices"],
    ),
  },
  {
    key: "rider",
    label: "Rider",
    permissions: fromLevels({ "clock-in": "USE", delivery: "USE" }),
  },
];
