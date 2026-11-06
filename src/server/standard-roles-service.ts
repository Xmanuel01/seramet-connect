import { standardRoles } from "@/platform/standard-roles";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

export const standardRoleId = (code: string) => `role-standard-${code.toLowerCase()}`;

/**
 * Inserts the standard staff roles a tenant does not have yet, matched by code, so a role the
 * restaurant already made (or edited) is never changed. Each insert also tolerates a concurrent
 * one, and a role's permissions are added only when that role row is the one just written.
 */
export function standardRoleStatements(
  db: D1Database,
  tenantId: string,
  existingCodes: ReadonlySet<string> = new Set(),
): D1PreparedStatement[] {
  return standardRoles
    .filter((role) => !existingCodes.has(role.code))
    .flatMap((role) => {
      const id = standardRoleId(role.code);
      const placeholders = role.permissions.map(() => "?").join(",");
      return [
        db
          .prepare(
            `INSERT INTO roles (tenant_id,id,code,name,active,payload_json)
             VALUES (?,?,?,?,1,?) ON CONFLICT DO NOTHING`,
          )
          .bind(
            tenantId,
            id,
            role.code,
            role.name,
            JSON.stringify({ template: role.code, operationalRole: true }),
          ),
        db
          .prepare(
            `INSERT INTO role_permissions (tenant_id,role_id,permission_code)
             SELECT ?,?,code FROM permissions
             WHERE code IN (${placeholders})
               AND EXISTS (SELECT 1 FROM roles WHERE tenant_id=? AND id=? AND code=?)
             ON CONFLICT DO NOTHING`,
          )
          .bind(tenantId, id, ...role.permissions, tenantId, id, role.code),
      ];
    });
}

/** Codes of the roles a tenant already has, active or not. */
export async function existingRoleCodes(db: D1Database, tenantId: string) {
  const rows = await db
    .prepare("SELECT code FROM roles WHERE tenant_id=?")
    .bind(tenantId)
    .all<{ code: string }>();
  return new Set((rows.results ?? []).map((row) => row.code));
}
