import { allPermissionCodes, permissions } from "@/platform/permissions";
import { staffRolePresets } from "@/platform/staff-role-presets";
import type { PermissionCode } from "@/platform/types";

/** Everything an account owner holds: all permissions except platform administration. */
export const accountOwnerPermissions: PermissionCode[] = allPermissionCodes.filter(
  (code) => code !== permissions.platformTenantsProvision && code !== permissions.setupDemoReset,
);

export type StandardRole = { code: string; name: string; permissions: PermissionCode[] };

/** The same code Settings and onboarding give a role created under this name. */
export const roleCodeForName = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

/**
 * The staff roles every restaurant starts with: the staff presets onboarding offers, so a role
 * already made there is recognised by its code. Each is capped to what an account owner holds,
 * so the owner can assign all of them when creating employees.
 */
export const standardRoles: readonly StandardRole[] = Object.values(staffRolePresets).map(
  (preset) => ({
    code: roleCodeForName(preset.label),
    name: preset.label,
    permissions: preset.permissions.filter((code) => accountOwnerPermissions.includes(code)),
  }),
);
