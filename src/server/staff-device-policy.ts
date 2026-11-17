import type { ServerActor } from "@/lib/seramet-auth";
import type { D1Database } from "@/server/database/d1";
import { permissions } from "@/platform/permissions";

export const terminalPermissions = new Set<string>([
  permissions.posAccess,
  permissions.ordersCreate,
  permissions.ordersUpdate,
  permissions.ordersCancel,
  permissions.ordersServe,
  permissions.invoicesCreate,
  permissions.invoicesManage,
  permissions.paymentsRecord,
  permissions.paymentsCollect,
  permissions.paymentsConfirm,
  permissions.paymentsManualConfirm,
  permissions.paymentsRefundRequest,
  permissions.paymentsRefundApprove,
  permissions.guestOrderAccept,
  permissions.cashOpen,
  permissions.cashClose,
]);
/** Everything the per-request identity and device policy needs, read in one query. */
export type ActorFacts = {
  roles: Array<{ id: string; name: string }>;
  permissionCodes: string[];
  /** Active assigned branches, primary first, then by name. */
  branches: Array<{ id: string; name: string; is_primary: number }>;
  /** The token's device when it is trusted and not revoked; `active` adds lifecycle ACTIVE. */
  device: { branch_id: string; device_type: string; active: boolean } | null;
  accountOwner: boolean;
  stationAccess: Map<string, string[]>;
  activeStations: Array<{ id: string; branch_id: string }>;
};

/**
 * Reads the actor's roles, permissions, branches, device, ownership and station access as one
 * statement: each was its own database round trip on every request. `branchId` adds that
 * branch's stations to those of the user's assigned branches.
 */
export async function loadActorFacts(
  db: D1Database,
  input: { tenantId: string; userId: string; deviceId?: string; branchId?: string },
): Promise<ActorFacts> {
  const text = "CAST(NULL AS TEXT)";
  const integer = "CAST(NULL AS INTEGER)";
  const { tenantId, userId } = input;
  const rows = await db
    .prepare(
      `SELECT CAST('role' AS TEXT) AS kind, r.id AS a, r.name AS b, ${text} AS c, ${integer} AS n
       FROM user_roles ur
       JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
       WHERE ur.tenant_id = ? AND ur.user_id = ? AND r.active = 1
       UNION ALL
       SELECT DISTINCT CAST('permission' AS TEXT), rp.permission_code, ${text}, ${text}, ${integer}
       FROM user_roles ur
       JOIN roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id AND r.active = 1
       JOIN role_permissions rp ON rp.tenant_id = ur.tenant_id AND rp.role_id = ur.role_id
       WHERE ur.tenant_id = ? AND ur.user_id = ?
       UNION ALL
       SELECT CAST('branch' AS TEXT), b.id, b.name, ${text},
              CASE WHEN pb.branch_id = b.id THEN 1 ELSE 0 END
       FROM user_branches ub
       JOIN branches b ON b.tenant_id = ub.tenant_id AND b.id = ub.branch_id
       LEFT JOIN user_primary_branches pb
         ON pb.tenant_id = ub.tenant_id AND pb.user_id = ub.user_id
       WHERE ub.tenant_id = ? AND ub.user_id = ? AND b.active = 1
       UNION ALL
       SELECT CAST('device' AS TEXT), hd.branch_id, hd.device_type, hd.lifecycle_state, ${integer}
       FROM hardware_devices hd
       WHERE hd.tenant_id = ? AND hd.id = ? AND hd.trust_status = 'ACTIVE' AND hd.revoked_at IS NULL
       UNION ALL
       SELECT CAST('owner' AS TEXT), ${text}, ${text}, ${text}, 1
       FROM account_owners ao
       WHERE ao.tenant_id = ? AND ao.user_id = ? AND ao.status = 'ACTIVE'
       UNION ALL
       SELECT CAST('station_access' AS TEXT), esa.branch_id, esa.station_ids_json, ${text}, ${integer}
       FROM employee_station_access esa
       WHERE esa.tenant_id = ? AND esa.user_id = ?
       UNION ALL
       SELECT CAST('station' AS TEXT), s.branch_id, s.id, ${text}, ${integer}
       FROM stations s
       WHERE s.tenant_id = ? AND s.active = 1
         AND (s.branch_id = ? OR s.branch_id IN (
           SELECT ub2.branch_id FROM user_branches ub2
           WHERE ub2.tenant_id = s.tenant_id AND ub2.user_id = ?))`,
    )
    .bind(
      tenantId,
      userId,
      tenantId,
      userId,
      tenantId,
      userId,
      tenantId,
      input.deviceId ?? null,
      tenantId,
      userId,
      tenantId,
      userId,
      tenantId,
      input.branchId ?? null,
      userId,
    )
    .all<{
      kind: string;
      a: string | null;
      b: string | null;
      c: string | null;
      n: number | null;
    }>();
  const facts: ActorFacts = {
    roles: [],
    permissionCodes: [],
    branches: [],
    device: null,
    accountOwner: false,
    stationAccess: new Map(),
    activeStations: [],
  };
  const permissionCodes = new Set<string>();
  for (const row of rows.results ?? []) {
    if (row.kind === "role") facts.roles.push({ id: row.a!, name: row.b! });
    else if (row.kind === "permission") permissionCodes.add(row.a!);
    else if (row.kind === "branch")
      facts.branches.push({ id: row.a!, name: row.b!, is_primary: Number(row.n) });
    else if (row.kind === "device")
      facts.device = { branch_id: row.a!, device_type: row.b!, active: row.c === "ACTIVE" };
    else if (row.kind === "owner") facts.accountOwner = true;
    else if (row.kind === "station_access")
      facts.stationAccess.set(row.a!, JSON.parse(row.b ?? "[]") as string[]);
    else if (row.kind === "station") facts.activeStations.push({ id: row.b!, branch_id: row.a! });
  }
  facts.permissionCodes = [...permissionCodes];
  facts.branches.sort(
    (left, right) =>
      right.is_primary - left.is_primary ||
      compare(left.name, right.name) ||
      compare(left.id, right.id),
  );
  return facts;
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function applyStaffDevicePolicy(
  actor: ServerActor,
  db: D1Database,
  loaded?: ActorFacts,
): Promise<ServerActor> {
  const facts =
    loaded ??
    (await loadActorFacts(db, {
      tenantId: actor.tenantId,
      userId: actor.id,
      ...(actor.deviceId ? { deviceId: actor.deviceId } : {}),
      branchId: actor.branchId,
    }));
  // Only a trusted, unrevoked and lifecycle-active device enrolled at this branch is a terminal.
  const device = actor.deviceId && facts.device?.active ? facts.device : null;
  const enrolledTerminal =
    !!device && device.branch_id === actor.branchId && device.device_type === "POS_TERMINAL";
  // The active account owner may sell from any signed-in browser (owner decision, 30 Oct 2026).
  // Ownership is read from the authoritative record, never from role names or permissions,
  // so email-invited staff (e.g. cashier phones) still need an enrolled terminal.
  const accountOwner = enrolledTerminal ? false : facts.accountOwner;
  const salesTerminal = enrolledTerminal || accountOwner;
  const stationIds = facts.stationAccess.get(actor.branchId) ?? [];
  const active = facts.activeStations.filter((station) => station.branch_id === actor.branchId);
  const kitchenStationIds = actor.permissions.includes(permissions.settingsBranchManage)
    ? active.map((s) => s.id)
    : stationIds.filter((id) => active.some((s) => s.id === id));
  const management = actor.permissions.includes(permissions.reconciliationView);
  return {
    ...actor,
    salesTerminal,
    kitchenStationIds,
    permissions: salesTerminal
      ? actor.permissions
      : actor.permissions.filter(
          (p) =>
            !terminalPermissions.has(p) &&
            (management ||
              ![permissions.invoicesView, permissions.paymentsView].includes(
                p as typeof permissions.invoicesView,
              )),
        ),
  };
}
