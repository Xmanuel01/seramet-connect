import type { EnterpriseNodeType } from "@/enterprise/types";
import { SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import {
  buildModuleAccessProfile,
  moduleAccessRegistry,
  type ModuleAccessProfile,
  type ModuleKey,
  type ModulePolicyDecision,
} from "@/platform/module-access-registry";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { PermissionCode } from "@/platform/types";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

type Row = Record<string, unknown>;

export async function resolveServerModuleAccess(
  db: D1Database,
  actor: ServerActor,
  at = new Date().toISOString(),
): Promise<ModuleAccessProfile> {
  const [scope, commercial, featureFlags, revision] = await Promise.all([
    resolveActorScope(db, actor, at),
    resolveCommercialAccess(db, actor.tenantId),
    resolveFeatureFlags(db, actor.tenantId),
    db
      .prepare("SELECT revision FROM access_control_revisions WHERE tenant_id=?")
      .bind(actor.tenantId)
      .first<{ revision: number }>(),
  ]);
  const policies = await resolveModulePolicies(db, actor.tenantId, scope.anchorNodeIds, at);
  return buildModuleAccessProfile(
    {
      permissions: actor.permissions,
      organizationalScopes: scope.types,
      entitlements: commercial.entitlements,
      entitlementsEnforced: commercial.enforced,
      featureFlags,
      policies,
    },
    Number(revision?.revision ?? 0),
    at,
  );
}

export async function replaceRolePermissions(input: {
  db: D1Database;
  actor: ServerActor;
  roleId: string;
  permissionCodes: PermissionCode[];
  reason: string;
}) {
  if (
    !input.actor.permissions.includes(permissions.settingsRoleManage) &&
    !input.actor.permissions.includes(permissions.enterpriseAccessManage)
  ) {
    throw new SerametHttpError(403, "Role permission management is not authorized");
  }
  const allowedCodes = new Set<PermissionCode>(allPermissionCodes);
  const next = [...new Set(input.permissionCodes)];
  if (next.some((code) => !allowedCodes.has(code))) {
    throw new SerametHttpError(400, "Role permission list contains an unknown permission");
  }
  if (input.reason.trim().length < 3 || input.reason.trim().length > 500) {
    throw new SerametHttpError(
      400,
      "A permission-change reason between 3 and 500 characters is required",
    );
  }
  const role = await input.db
    .prepare("SELECT id,name FROM roles WHERE tenant_id=? AND id=? AND active=1")
    .bind(input.actor.tenantId, input.roleId)
    .first<{ id: string; name: string }>();
  if (!role) throw new SerametHttpError(404, "Role not found");
  const currentRows = await input.db
    .prepare("SELECT permission_code FROM role_permissions WHERE tenant_id=? AND role_id=?")
    .bind(input.actor.tenantId, input.roleId)
    .all<{ permission_code: PermissionCode }>();
  const current = new Set((currentRows.results ?? []).map((row) => row.permission_code));
  const added = next.filter((code) => !current.has(code));
  const removed = [...current].filter((code) => !next.includes(code));
  const changed = [...added, ...removed];
  const hasEnterpriseAuthority = input.actor.permissions.includes(
    permissions.enterpriseAccessManage,
  );
  const undelegable = hasEnterpriseAuthority
    ? []
    : changed.filter((code) => !input.actor.permissions.includes(code));
  if (undelegable.length) {
    throw new SerametHttpError(
      403,
      "Grantor cannot add or remove permissions outside their delegated authority",
    );
  }
  if (!added.length && !removed.length) {
    const revision = await accessRevision(input.db, input.actor.tenantId);
    return { roleId: input.roleId, permissions: next, accessRevision: revision, unchanged: true };
  }

  const stamp = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    input.db
      .prepare("DELETE FROM role_permissions WHERE tenant_id=? AND role_id=?")
      .bind(input.actor.tenantId, input.roleId),
  ];
  for (const code of next) {
    statements.push(
      input.db
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .bind(input.actor.tenantId, input.roleId, code),
    );
  }
  statements.push(
    input.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,'ROLE_PERMISSIONS_CHANGED','ROLE',?,?,?,?,?,?)`,
      )
      .bind(
        input.actor.tenantId,
        crypto.randomUUID(),
        input.actor.branchId ?? null,
        input.actor.id,
        input.actor.deviceId ?? null,
        input.roleId,
        input.reason.trim(),
        crypto.randomUUID(),
        input.actor.sessionId ?? null,
        JSON.stringify({ roleName: role.name, added, removed }),
        stamp,
      ),
  );
  await input.db.batch(statements);
  return {
    roleId: input.roleId,
    permissions: next,
    accessRevision: await accessRevision(input.db, input.actor.tenantId),
    unchanged: false,
  };
}

async function resolveActorScope(db: D1Database, actor: ServerActor, at: string) {
  if (actor.permissions.includes(permissions.tenantScopeAllBranches)) {
    const rows = await db
      .prepare(
        "SELECT id,node_type,branch_id FROM enterprise_nodes WHERE tenant_id=? AND status<>'CLOSED'",
      )
      .bind(actor.tenantId)
      .all<{ id: string; node_type: EnterpriseNodeType; branch_id: string | null }>();
    const values = rows.results ?? [];
    return {
      types: values.length
        ? unique(values.map((row) => row.node_type))
        : ([
            "GROUP",
            "LEGAL_ENTITY",
            "BRAND",
            "REGION",
            "AREA",
            "BRANCH",
            "WAREHOUSE",
            "COMMISSARY",
          ] as EnterpriseNodeType[]),
      anchorNodeIds: unique([
        ...values
          .filter((row) =>
            ["GROUP", "LEGAL_ENTITY", "BRAND", "REGION", "AREA"].includes(row.node_type),
          )
          .map((row) => row.id),
        ...values
          .filter(
            (row) =>
              row.node_type === "BRANCH" &&
              (row.branch_id === actor.branchId ||
                actor.assignedBranchIds.includes(row.branch_id ?? "")),
          )
          .map((row) => row.id),
      ]).slice(0, 250),
    };
  }

  const assignmentRows = await db
    .prepare(
      `SELECT a.scope_node_id,a.descend_to_children,a.effect,s.node_type scope_type,
              c.descendant_id,d.node_type descendant_type
       FROM enterprise_role_assignments a
       JOIN enterprise_nodes s ON s.tenant_id=a.tenant_id AND s.id=a.scope_node_id
       LEFT JOIN enterprise_node_closure c
         ON c.tenant_id=a.tenant_id AND c.ancestor_id=a.scope_node_id
       LEFT JOIN enterprise_nodes d ON d.tenant_id=a.tenant_id AND d.id=c.descendant_id
       WHERE a.tenant_id=? AND a.user_id=? AND a.revoked_at IS NULL AND a.valid_from<=?
         AND (a.valid_until IS NULL OR a.valid_until>?)`,
    )
    .bind(actor.tenantId, actor.id, at, at)
    .all<Row>();
  const branchRows = actor.assignedBranchIds.length
    ? await db
        .prepare(
          `SELECT id,node_type FROM enterprise_nodes WHERE tenant_id=? AND branch_id IN (${actor.assignedBranchIds.map(() => "?").join(",")})`,
        )
        .bind(actor.tenantId, ...actor.assignedBranchIds)
        .all<{ id: string; node_type: EnterpriseNodeType }>()
    : { results: [] as Array<{ id: string; node_type: EnterpriseNodeType }> };
  const allowed = new Map<string, EnterpriseNodeType>();
  const denied = new Set<string>();
  const anchors: string[] = [];
  for (const row of assignmentRows.results ?? []) {
    const descend = Number(row["descend_to_children"]) === 1;
    const id = String(descend ? (row["descendant_id"] ?? "") : (row["scope_node_id"] ?? ""));
    const type = String(
      descend ? (row["descendant_type"] ?? "") : (row["scope_type"] ?? ""),
    ) as EnterpriseNodeType;
    if (!id || !type) continue;
    if (String(row["effect"]) === "DENY") denied.add(id);
    else {
      allowed.set(id, type);
      anchors.push(String(row["scope_node_id"]));
    }
  }
  for (const row of branchRows.results ?? []) allowed.set(row.id, row.node_type);
  denied.forEach((id) => allowed.delete(id));
  const types = unique([...allowed.values()]);
  return {
    types: types.length ? types : (["BRANCH"] as EnterpriseNodeType[]),
    anchorNodeIds: unique([...anchors, ...(branchRows.results ?? []).map((row) => row.id)]).slice(
      0,
      250,
    ),
  };
}

async function resolveCommercialAccess(db: D1Database, tenantId: string) {
  const subscriptions = await db
    .prepare(
      "SELECT id FROM tenant_subscriptions WHERE tenant_id=? AND status IN ('TRIAL','ACTIVE') LIMIT 100",
    )
    .bind(tenantId)
    .all<{ id: string }>();
  if (!subscriptions.results?.length) return { enforced: false, entitlements: [] as string[] };
  const rows = await db
    .prepare(
      `SELECT DISTINCT e.feature_key FROM feature_entitlements e
       JOIN tenant_subscriptions s ON s.tenant_id=e.tenant_id AND s.id=e.subscription_id
       WHERE e.tenant_id=? AND e.enabled=1 AND s.status IN ('TRIAL','ACTIVE')`,
    )
    .bind(tenantId)
    .all<{ feature_key: string }>();
  return { enforced: true, entitlements: (rows.results ?? []).map((row) => row.feature_key) };
}

async function resolveFeatureFlags(db: D1Database, tenantId: string) {
  const rows = await db
    .prepare("SELECT key,enabled FROM feature_flags WHERE tenant_id=? LIMIT 1000")
    .bind(tenantId)
    .all<{ key: string; enabled: number }>();
  return Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.enabled === 1]));
}

async function resolveModulePolicies(
  db: D1Database,
  tenantId: string,
  anchorNodeIds: string[],
  at: string,
): Promise<Partial<Record<ModuleKey, ModulePolicyDecision>>> {
  if (!anchorNodeIds.length) return {};
  const result = await db
    .prepare(
      `SELECT d.code,a.state,a.value_json,a.version,c.descendant_id,c.depth
       FROM enterprise_policy_definitions d
       JOIN enterprise_policy_assignments a ON a.tenant_id=d.tenant_id AND a.policy_id=d.id
       JOIN enterprise_node_closure c ON c.tenant_id=a.tenant_id AND c.ancestor_id=a.scope_node_id
       WHERE d.tenant_id=? AND d.active=1 AND d.code LIKE 'MODULE_ACCESS.%'
         AND c.descendant_id IN (${anchorNodeIds.map(() => "?").join(",")})
         AND a.effective_from<=? AND (a.effective_to IS NULL OR a.effective_to>?)
       ORDER BY d.code,c.descendant_id,c.depth ASC,a.version DESC`,
    )
    .bind(tenantId, ...anchorNodeIds, at, at)
    .all<Row>();
  const nearest = new Map<string, Row>();
  for (const row of result.results ?? []) {
    const key = `${String(row["code"])}:${String(row["descendant_id"])}`;
    if (!nearest.has(key)) nearest.set(key, row);
  }
  const decisions: Partial<Record<ModuleKey, ModulePolicyDecision>> = {};
  for (const definition of moduleAccessRegistry) {
    const rows = anchorNodeIds.map((anchor) => nearest.get(`${definition.policyCode}:${anchor}`));
    if (!rows.some(Boolean)) continue;
    decisions[definition.key] = rows.some((row) => !row || policyAllows(row)) ? "ALLOW" : "DENY";
  }
  return decisions;
}

function policyAllows(row: Row) {
  if (String(row["state"]) === "NOT_APPLICABLE") return false;
  try {
    const value = JSON.parse(String(row["value_json"] ?? "null")) as unknown;
    if (value === false) return false;
    if (value && typeof value === "object" && "enabled" in value) {
      return (value as { enabled?: unknown }).enabled !== false;
    }
  } catch {
    return false;
  }
  return true;
}

async function accessRevision(db: D1Database, tenantId: string) {
  return Number(
    (
      await db
        .prepare("SELECT revision FROM access_control_revisions WHERE tenant_id=?")
        .bind(tenantId)
        .first<{ revision: number }>()
    )?.revision ?? 0,
  );
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
