import { z } from "zod";
import {
  authorizeBranchRead,
  SerametHttpError,
  type ServerActor,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { requireFullAuthentication } from "@/server/pos-auth-service";
export async function staffStationAccess(
  request: Request,
  env: SerametEnv,
  actor: ServerActor,
  userId: string,
) {
  requireFullAuthentication(actor);
  if (
    !actor.permissions.includes(permissions.usersManage) ||
    !actor.permissions.includes(permissions.employeeCredentialsManage)
  )
    throw new SerametHttpError(403, "Employee access administration is required.");
  const url = new URL(request.url),
    db = env.SERAMET_DB!;
  const raw =
    request.method === "GET"
      ? { branchId: url.searchParams.get("branchId") }
      : await request.json().catch(() => null);
  const writeSchema = z
    .object({
      branchId: z.string().min(1).max(120),
      stationIds: z.array(z.string().min(1).max(120)).max(100),
      expectedVersion: z.number().int().nonnegative(),
    })
    .strict();
  const schema =
    request.method === "GET"
      ? z.object({ branchId: z.string().min(1).max(120) }).strict()
      : writeSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SerametHttpError(400, "Invalid station assignment.");
  const scopeBody = parsed.data;
  authorizeBranchRead(actor, actor.tenantId, scopeBody.branchId);
  const employee = await db
    .prepare(
      "SELECT u.id FROM users u JOIN user_branches b ON b.tenant_id=u.tenant_id AND b.user_id=u.id WHERE u.tenant_id=? AND u.id=? AND b.branch_id=? AND u.active=1 AND u.employment_status='ACTIVE'",
    )
    .bind(actor.tenantId, userId, scopeBody.branchId)
    .first();
  if (!employee) throw new SerametHttpError(404, "Active assigned employee not found.");
  const previous = await db
    .prepare(
      "SELECT station_ids_json,version FROM employee_station_access WHERE tenant_id=? AND user_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, userId, scopeBody.branchId)
    .first<{ station_ids_json: string; version: number }>();
  if (request.method === "GET")
    return Response.json(
      {
        ok: true,
        stationIds: previous ? JSON.parse(previous.station_ids_json) : [],
        version: previous?.version ?? 0,
      },
      { headers: { "cache-control": "no-store" } },
    );
  const body = writeSchema.parse(raw);
  const stationIds = [...new Set(body.stationIds)].sort();
  const stations = await db
    .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? AND active=1")
    .bind(actor.tenantId, body.branchId)
    .all<{ id: string }>();
  if (stationIds.some((id) => !stations.results?.some((s) => s.id === id)))
    throw new SerametHttpError(403, "Station is not active in this branch.");
  if ((previous?.version ?? 0) !== body.expectedVersion)
    throw new SerametHttpError(409, "Station assignment changed. Refresh before saving.");
  const stamp = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO staff_access_events(tenant_id,id,entity_type,entity_id,version,actor_id,branch_id,event_type,at,details_json) VALUES(?,?,'STATION_ACCESS',?,?,?,?,?,?,?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          JSON.stringify([userId, body.branchId]),
          body.expectedVersion + 1,
          actor.id,
          body.branchId,
          "STATION_ACCESS_UPDATED",
          stamp,
          JSON.stringify({
            stationIds,
            previous: previous ? JSON.parse(previous.station_ids_json) : [],
          }),
        ),
      previous
        ? db
            .prepare(
              "UPDATE employee_station_access SET station_ids_json=?,version=version+1,updated_by=?,updated_at=? WHERE tenant_id=? AND user_id=? AND branch_id=? AND version=?",
            )
            .bind(
              JSON.stringify(stationIds),
              actor.id,
              stamp,
              actor.tenantId,
              userId,
              body.branchId,
              body.expectedVersion,
            )
        : db
            .prepare(
              "INSERT INTO employee_station_access(tenant_id,user_id,branch_id,station_ids_json,version,updated_by,updated_at) VALUES(?,?,?,?,1,?,?)",
            )
            .bind(
              actor.tenantId,
              userId,
              body.branchId,
              JSON.stringify(stationIds),
              actor.id,
              stamp,
            ),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE|unique constraint/.test(error.message))
      throw new SerametHttpError(409, "Concurrent station update. Refresh before retrying.");
    throw error;
  }
  return Response.json(
    { ok: true, stationIds, version: body.expectedVersion + 1 },
    { headers: { "cache-control": "no-store" } },
  );
}
