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
export async function applyStaffDevicePolicy(
  actor: ServerActor,
  db: D1Database,
): Promise<ServerActor> {
  const device = actor.deviceId
    ? await db
        .prepare(
          `SELECT id,branch_id,device_type FROM hardware_devices
    WHERE tenant_id=? AND id=? AND trust_status='ACTIVE' AND lifecycle_state='ACTIVE' AND revoked_at IS NULL`,
        )
        .bind(actor.tenantId, actor.deviceId)
        .first<{ id: string; branch_id: string; device_type: string }>()
    : null;
  const salesTerminal =
    !!device && device.branch_id === actor.branchId && device.device_type === "POS_TERMINAL";
  const policy = await db
    .prepare(
      "SELECT station_ids_json FROM employee_station_access WHERE tenant_id=? AND user_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, actor.id, actor.branchId)
    .first<{ station_ids_json: string }>();
  const stationIds = policy ? (JSON.parse(policy.station_ids_json) as string[]) : [];
  const active = await db
    .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? AND active=1")
    .bind(actor.tenantId, actor.branchId)
    .all<{ id: string }>();
  const kitchenStationIds = actor.permissions.includes(permissions.settingsBranchManage)
    ? (active.results ?? []).map((s) => s.id)
    : stationIds.filter((id) => active.results?.some((s) => s.id === id));
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
