import { z } from "zod";
import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type ServerActor,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { businessDateForTimestamp } from "@/lib/business-date";
import { evaluateAttendanceGeofence } from "@/lib/attendance-geofence";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

const key = z.string().uuid();
const location = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().min(0).max(100000),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const punchSchema = z
  .object({
    action: z.enum(["IN", "OUT"]),
    branchId: z.string().min(1).max(120),
    idempotencyKey: key,
    location,
  })
  .strict();
const supervisorSchema = z
  .object({
    action: z.enum(["IN", "OUT", "CORRECT_IN", "CORRECT_OUT"]),
    branchId: z.string().min(1).max(120),
    employeeId: z.string().min(1).max(120),
    idempotencyKey: key,
    reason: z.string().trim().min(8).max(500),
    occurredAt: z.string().datetime({ offset: true }).optional(),
    expectedVersion: z.number().int().positive().optional(),
    sessionId: z.string().uuid().optional(),
  })
  .strict();
const configSchema = z
  .object({
    branchId: z.string().min(1).max(120),
    enabled: z.boolean(),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusMeters: z.number().finite().min(10).max(500),
    maxAccuracyMeters: z.number().finite().min(1).max(100),
    maxFixAgeSeconds: z.number().int().min(5).max(120),
    graceMinutes: z.number().int().min(0).max(120),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();
const scheduleSchema = z
  .object({
    branchId: z.string().min(1).max(120),
    employeeId: z.string().min(1).max(120),
    scheduledStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

type BranchRow = {
  id: string;
  timezone: string;
  business_day_cutoff_minutes: number;
  active: number;
};
type FenceRow = {
  enabled: number;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  max_accuracy_m: number;
  max_fix_age_seconds: number;
  grace_minutes: number;
  version: number;
};
type SessionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  branch_id: string;
  business_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_key: string;
  clock_out_key: string | null;
  minutes_late: number | null;
  clock_in_source: string;
  clock_out_source: string | null;
  version: number;
};
type PunchActor = { actor: ServerActor; db: D1Database; branch: BranchRow };

function deny(status: number, message: string): never {
  throw new SerametHttpError(status, message);
}
function manager(actor: ServerActor) {
  return actor.permissions.includes(permissions.staffManage);
}
function authorizeManager(actor: ServerActor) {
  if (!manager(actor)) deny(403, "Staff management permission is required");
}
function noStore(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) return deny(400, "Invalid attendance request");
  return result.data;
}
function sameOrigin(request: Request, env: SerametEnv) {
  const origin = request.headers.get("origin");
  const hostOrigin = new URL(request.url).origin;
  const configured = env.SERAMET_PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (origin && origin !== hostOrigin && origin !== configured)
    deny(403, "Cross-origin attendance request denied");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    deny(403, "Cross-site attendance request denied");
}
async function context(
  actor: ServerActor,
  db: D1Database,
  branchId: string,
  managed = false,
): Promise<PunchActor> {
  if (managed) {
    authorizeManager(actor);
    authorizeBranchRead(actor, actor.tenantId, branchId);
  } else if (
    !actor.permissions.includes(permissions.attendanceUse) ||
    !actor.assignedBranchIds.includes(branchId)
  ) {
    deny(403, "Attendance or assigned-branch permission denied");
  }
  const branch = await db
    .prepare(
      "SELECT id,timezone,business_day_cutoff_minutes,active FROM branches WHERE tenant_id=? AND id=?",
    )
    .bind(actor.tenantId, branchId)
    .first<BranchRow>();
  if (!branch || branch.active !== 1) deny(404, "Active branch not found");
  return { actor, db, branch };
}
async function ensureEmployee(
  db: D1Database,
  actor: ServerActor,
  userId: string,
  branchId: string,
) {
  const found = await db
    .prepare(
      "SELECT u.id FROM users u JOIN user_branches ub ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=? WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND u.employment_status='ACTIVE'",
    )
    .bind(branchId, actor.tenantId, userId)
    .first();
  if (!found) deny(403, "Employee is not active or assigned to the branch");
}
async function fenceFor(db: D1Database, actor: ServerActor, branchId: string) {
  return db
    .prepare(
      "SELECT enabled,latitude,longitude,radius_m,max_accuracy_m,max_fix_age_seconds,grace_minutes,version FROM attendance_geofences WHERE tenant_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, branchId)
    .first<FenceRow>();
}
async function readSession(db: D1Database, actor: ServerActor, userId: string, date: string) {
  return db
    .prepare(
      "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND business_date=?",
    )
    .bind(actor.tenantId, userId, date)
    .first<SessionRow>();
}
async function readOpen(db: D1Database, actor: ServerActor, userId: string) {
  return db
    .prepare(
      "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1",
    )
    .bind(actor.tenantId, userId)
    .first<SessionRow>();
}
function localParts(timestamp: string, timezone: string) {
  const items = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => items.find((entry) => entry.type === type)?.value ?? "";
  return {
    date: part("year") + "-" + part("month") + "-" + part("day"),
    minutes: Number(part("hour")) * 60 + Number(part("minute")),
  };
}
async function lateMinutes(
  db: D1Database,
  actor: ServerActor,
  branch: BranchRow,
  userId: string,
  occurredAt: string,
  date: string,
) {
  const row = await db
    .prepare(
      "SELECT scheduled_start FROM attendance_shift_assignments WHERE tenant_id=? AND user_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, userId, branch.id)
    .first<{ scheduled_start: string | null }>();
  if (!row?.scheduled_start) return null; // Never invent schedules or payroll deductions.
  const fence = await fenceFor(db, actor, branch.id);
  const scheduled =
    Number(row.scheduled_start.slice(0, 2)) * 60 + Number(row.scheduled_start.slice(3, 5));
  const clock = localParts(occurredAt, branch.timezone);
  const elapsed = clock.minutes + (clock.date > date ? 1440 : 0);
  return Math.max(0, elapsed - scheduled - (fence?.grace_minutes ?? 0));
}
function publicSession(row: SessionRow) {
  return {
    id: row.id,
    employeeId: row.user_id,
    branchId: row.branch_id,
    businessDate: row.business_date,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    minutesLate: row.minutes_late,
    clockInSource: row.clock_in_source,
    clockOutSource: row.clock_out_source,
    version: row.version,
  };
}
async function report(db: D1Database, actor: ServerActor, branch: BranchRow) {
  const today = businessDateForTimestamp(
    new Date(),
    branch.timezone,
    branch.business_day_cutoff_minutes,
  );
  const own =
    (await readSession(db, actor, actor.id, today)) ?? (await readOpen(db, actor, actor.id));
  const fence = await fenceFor(db, actor, branch.id);
  const canManage = manager(actor);
  const records = canManage
    ? ((
        await db
          .prepare(
            "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND branch_id=? AND business_date=? ORDER BY clock_in_at DESC LIMIT 500",
          )
          .bind(actor.tenantId, branch.id, today)
          .all<SessionRow>()
      ).results ?? [])
    : [];
  const staff = canManage
    ? ((
        await db
          .prepare(
            "SELECT u.id,u.name,u.employee_code,s.scheduled_start,s.version AS schedule_version FROM users u JOIN user_branches ub ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=? LEFT JOIN attendance_shift_assignments s ON s.tenant_id=u.tenant_id AND s.user_id=u.id AND s.branch_id=? WHERE u.tenant_id=? AND u.active=1 AND u.employment_status='ACTIVE' ORDER BY u.name LIMIT 500",
          )
          .bind(branch.id, branch.id, actor.tenantId)
          .all()
      ).results ?? [])
    : [];
  return {
    ok: true,
    businessDate: today,
    branchId: branch.id,
    branchTimezone: branch.timezone,
    me: own ? publicSession(own) : null,
    canManage,
    geofence: {
      enabled: fence?.enabled === 1,
      radiusMeters: fence?.radius_m ?? 10,
      maxAccuracyMeters: fence?.max_accuracy_m ?? 8,
      maxFixAgeSeconds: fence?.max_fix_age_seconds ?? 30,
      graceMinutes: fence?.grace_minutes ?? 0,
      version: fence?.version ?? 0,
      ...(canManage
        ? { latitude: fence?.latitude ?? null, longitude: fence?.longitude ?? null }
        : {}),
    },
    records: records.map(publicSession),
    employees: staff,
  };
}
async function recordPunch(
  ctx: PunchActor,
  userId: string,
  action: "IN" | "OUT",
  requestKey: string,
  source: "GEOFENCE" | "SUPERVISOR",
  reason?: string,
  evidence?: { accuracy: number; distance: number },
) {
  const { actor, db, branch } = ctx;
  await ensureEmployee(db, actor, userId, branch.id);
  const instant = new Date().toISOString(); // Never trust client time.
  const date = businessDateForTimestamp(
    instant,
    branch.timezone,
    branch.business_day_cutoff_minutes,
  );
  const eventId = crypto.randomUUID();
  const eventType = (source === "SUPERVISOR" ? "SUPERVISOR_CLOCK_" : "CLOCK_") + action;
  if (action === "IN") {
    const existingOpen = await readOpen(db, actor, userId);
    if (existingOpen) {
      if (existingOpen.clock_in_key === requestKey)
        return { session: publicSession(existingOpen), repeated: true };
      deny(409, "Employee has an open attendance session. Clock out first");
    }
    const previous = await readSession(db, actor, userId, date);
    if (previous) {
      if (previous.clock_in_key === requestKey)
        return { session: publicSession(previous), repeated: true };
      deny(409, "Employee already clocked in on this business date");
    }
    const id = crypto.randomUUID();
    const late = await lateMinutes(db, actor, branch, userId, instant, date);
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_in_key,minutes_late,clock_in_source,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(
          actor.tenantId,
          id,
          userId,
          branch.id,
          date,
          instant,
          requestKey,
          late,
          source,
          instant,
          instant,
        ),
      db
        .prepare(
          "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,reason,at,accuracy_m,distance_m) SELECT ?,?,s.id,?,?,?,?,?,?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.user_id=? AND s.business_date=? AND s.clock_in_key=?",
        )
        .bind(
          actor.tenantId,
          eventId,
          actor.id,
          eventType,
          requestKey,
          reason ?? null,
          instant,
          evidence?.accuracy ?? null,
          evidence?.distance ?? null,
          actor.tenantId,
          userId,
          date,
          requestKey,
        ),
    ]);
    const current = await readSession(db, actor, userId, date);
    if (!current || current.clock_in_key !== requestKey)
      deny(409, "Clock-in conflicted with another terminal");
    if (results[0]?.meta?.changes !== 1 && !results[1]?.meta?.changes)
      return { session: publicSession(current), repeated: true };
    return { session: publicSession(current), repeated: false };
  }
  const open = await readOpen(db, actor, userId);
  if (!open) {
    const old = await db
      .prepare(
        "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND clock_out_key=?",
      )
      .bind(actor.tenantId, userId, requestKey)
      .first<SessionRow>();
    if (old) return { session: publicSession(old), repeated: true };
    deny(409, "No open attendance session to clock out");
  }
  if (open.branch_id !== branch.id)
    deny(409, "Clock out from the same branch where attendance started");
  const result = await db.batch([
    db
      .prepare(
        "UPDATE employee_attendance_sessions SET clock_out_at=?,clock_out_key=?,clock_out_source=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND user_id=? AND clock_out_at IS NULL",
      )
      .bind(instant, requestKey, source, instant, actor.tenantId, open.id, userId),
    db
      .prepare(
        "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,reason,at,accuracy_m,distance_m) SELECT ?,?,s.id,?,?,?,?,?,?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.id=? AND s.clock_out_key=?",
      )
      .bind(
        actor.tenantId,
        eventId,
        actor.id,
        eventType,
        requestKey,
        reason ?? null,
        instant,
        evidence?.accuracy ?? null,
        evidence?.distance ?? null,
        actor.tenantId,
        open.id,
        requestKey,
      ),
  ]);
  const current = await db
    .prepare("SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=?")
    .bind(actor.tenantId, open.id)
    .first<SessionRow>();
  if (!current || current.clock_out_key !== requestKey)
    deny(409, "Clock-out conflicted with another terminal");
  return { session: publicSession(current), repeated: result[0]?.meta?.changes !== 1 };
}
async function correctPunch(ctx: PunchActor, input: z.infer<typeof supervisorSchema>) {
  const { actor, db, branch } = ctx;
  await ensureEmployee(db, actor, input.employeeId, branch.id);
  if (!input.expectedVersion) deny(400, "Expected record version is required for corrections");
  if (!input.occurredAt) deny(400, "Correction timestamp is required");
  const instant = new Date(input.occurredAt).toISOString();
  if (Date.parse(instant) > Date.now() + 60_000)
    deny(400, "Future punch corrections are not allowed");
  if (!input.sessionId) deny(400, "Attendance session ID is required for corrections");
  const record = await db
    .prepare(
      "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=? AND user_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, input.sessionId, input.employeeId, branch.id)
    .first<SessionRow>();
  if (!record) deny(404, "Attendance record not found for correction");
  const pastEvent = await db
    .prepare(
      "SELECT session_id FROM employee_attendance_events WHERE tenant_id=? AND actor_id=? AND request_key=?",
    )
    .bind(actor.tenantId, actor.id, input.idempotencyKey)
    .first<{ session_id: string }>();
  if (pastEvent) {
    if (pastEvent.session_id !== record.id)
      deny(409, "Idempotency key was used for another attendance record");
    return { session: publicSession(record), repeated: true };
  }
  if (record.version !== input.expectedVersion)
    deny(409, "Attendance changed; refresh before correcting");
  if (input.action === "CORRECT_IN" && record.clock_out_at && instant > record.clock_out_at)
    deny(400, "Clock-in cannot follow clock-out");
  if (input.action === "CORRECT_OUT" && instant < record.clock_in_at)
    deny(400, "Clock-out cannot precede clock-in");
  const correctingIn = input.action === "CORRECT_IN";
  const late = correctingIn
    ? await lateMinutes(db, actor, branch, input.employeeId, instant, record.business_date)
    : null;
  if (
    correctingIn &&
    businessDateForTimestamp(instant, branch.timezone, branch.business_day_cutoff_minutes) !==
      record.business_date
  )
    deny(400, "Corrected clock-in must remain on the original business date");
  const previous = correctingIn ? record.clock_in_at : record.clock_out_at;
  const result = await db.batch([
    db
      .prepare(
        correctingIn
          ? "UPDATE employee_attendance_sessions SET clock_in_at=?,minutes_late=?,clock_in_source='SUPERVISOR',version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND version=?"
          : "UPDATE employee_attendance_sessions SET clock_out_at=?,clock_out_source='SUPERVISOR',version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND version=?",
      )
      .bind(
        ...(correctingIn
          ? [instant, late, new Date().toISOString(), actor.tenantId, record.id, record.version]
          : [instant, new Date().toISOString(), actor.tenantId, record.id, record.version]),
      ),
    db
      .prepare(
        "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,reason,at,before_json,after_json) SELECT ?,?,?,?,?,?,?,?, ?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.id=? AND s.version=?",
      )
      .bind(
        actor.tenantId,
        crypto.randomUUID(),
        record.id,
        actor.id,
        input.action,
        input.idempotencyKey,
        input.reason,
        new Date().toISOString(),
        JSON.stringify({ at: previous }),
        JSON.stringify({ at: instant }),
        actor.tenantId,
        record.id,
        record.version + 1,
      ),
  ]);
  if (result[0]?.meta?.changes !== 1) deny(409, "Attendance changed; refresh before correcting");
  const latest = await db
    .prepare("SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=?")
    .bind(actor.tenantId, record.id)
    .first<SessionRow>();
  return { session: publicSession(latest!), repeated: false };
}
export async function handleAttendanceApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/seramet/attendance")) return null;
  if (!env.SERAMET_DB)
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative attendance database unavailable",
    );
  const actor = await authenticateSerametRequest(request, env);
  const db = env.SERAMET_DB;
  if (request.method !== "GET") sameOrigin(request, env);
  if (url.pathname === "/api/seramet/attendance" && request.method === "GET") {
    const branchId = url.searchParams.get("branchId") || actor.branchId;
    const ctx = await context(actor, db, branchId, manager(actor));
    if (!manager(actor) && !actor.permissions.includes(permissions.attendanceUse))
      deny(403, "Attendance permission is required");
    return noStore(await report(db, actor, ctx.branch));
  }
  if (url.pathname === "/api/seramet/attendance/punch" && request.method === "POST") {
    const body = parse(punchSchema, await request.json().catch(() => null));
    const ctx = await context(actor, db, body.branchId);
    const fence = await fenceFor(db, actor, body.branchId);
    if (!fence || fence.enabled !== 1 || fence.latitude === null || fence.longitude === null)
      deny(409, "Attendance geofence is not configured for this branch. Ask a supervisor");
    const decision = evaluateAttendanceGeofence(body.location, {
      latitude: fence.latitude,
      longitude: fence.longitude,
      radiusMeters: fence.radius_m,
      maximumAccuracyMeters: fence.max_accuracy_m,
      maximumFixAgeSeconds: fence.max_fix_age_seconds,
    });
    if (!decision.allowed) deny(422, "Location verification failed: " + decision.reason);
    return noStore({
      ok: true,
      ...(await recordPunch(
        ctx,
        actor.id,
        body.action,
        body.idempotencyKey,
        "GEOFENCE",
        undefined,
        { accuracy: decision.accuracyMeters, distance: decision.distanceMeters },
      )),
    });
  }
  if (url.pathname === "/api/seramet/attendance/supervisor" && request.method === "POST") {
    const body = parse(supervisorSchema, await request.json().catch(() => null));
    const ctx = await context(actor, db, body.branchId, true);
    if (body.action === "CORRECT_IN" || body.action === "CORRECT_OUT")
      return noStore({ ok: true, ...(await correctPunch(ctx, body)) });
    if (body.occurredAt)
      deny(
        400,
        "Manual punches use the authoritative server time; use a correction for prior times",
      );
    return noStore({
      ok: true,
      ...(await recordPunch(
        ctx,
        body.employeeId,
        body.action,
        body.idempotencyKey,
        "SUPERVISOR",
        body.reason,
      )),
    });
  }
  if (url.pathname === "/api/seramet/attendance/geofence" && request.method === "PUT") {
    const body = parse(configSchema, await request.json().catch(() => null));
    await context(actor, db, body.branchId, true);
    if (actor.authLevel === "POS_PIN")
      deny(403, "Full administrator authentication is required for location policy changes");
    if (!actor.permissions.includes(permissions.settingsBranchManage))
      deny(403, "Branch settings permission is required");
    const old = await fenceFor(db, actor, body.branchId);
    if ((old?.version ?? 0) !== body.expectedVersion)
      deny(409, "Geofence changed; refresh before saving");
    const now = new Date().toISOString();
    const change = old
      ? db
          .prepare(
            "UPDATE attendance_geofences SET enabled=?,latitude=?,longitude=?,radius_m=?,max_accuracy_m=?,max_fix_age_seconds=?,grace_minutes=?,version=version+1,updated_by=?,updated_at=? WHERE tenant_id=? AND branch_id=? AND version=?",
          )
          .bind(
            body.enabled ? 1 : 0,
            body.latitude,
            body.longitude,
            body.radiusMeters,
            body.maxAccuracyMeters,
            body.maxFixAgeSeconds,
            body.graceMinutes,
            actor.id,
            now,
            actor.tenantId,
            body.branchId,
            body.expectedVersion,
          )
      : db
          .prepare(
            "INSERT INTO attendance_geofences(tenant_id,branch_id,enabled,latitude,longitude,radius_m,max_accuracy_m,max_fix_age_seconds,grace_minutes,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(
            actor.tenantId,
            body.branchId,
            body.enabled ? 1 : 0,
            body.latitude,
            body.longitude,
            body.radiusMeters,
            body.maxAccuracyMeters,
            body.maxFixAgeSeconds,
            body.graceMinutes,
            actor.id,
            now,
          );
    const previous = old
      ? {
          enabled: old.enabled === 1,
          latitude: old.latitude,
          longitude: old.longitude,
          radiusMeters: old.radius_m,
          maxAccuracyMeters: old.max_accuracy_m,
          maxFixAgeSeconds: old.max_fix_age_seconds,
          graceMinutes: old.grace_minutes,
        }
      : null;
    const results = await db.batch([
      change,
      db
        .prepare(
          "INSERT INTO attendance_management_events(tenant_id,id,branch_id,actor_id,event_type,at,before_json,after_json) SELECT ?,?,?,?,'GEOFENCE_POLICY',?,?,? WHERE EXISTS(SELECT 1 FROM attendance_geofences WHERE tenant_id=? AND branch_id=? AND version=? AND updated_by=? AND updated_at=?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          body.branchId,
          actor.id,
          now,
          JSON.stringify(previous),
          JSON.stringify(body),
          actor.tenantId,
          body.branchId,
          body.expectedVersion + 1,
          actor.id,
          now,
        ),
    ]);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1)
      deny(409, "Concurrent geofence update; refresh and retry");
    return noStore({ ok: true });
  }
  if (url.pathname === "/api/seramet/attendance/schedule" && request.method === "PUT") {
    const body = parse(scheduleSchema, await request.json().catch(() => null));
    await context(actor, db, body.branchId, true);
    await ensureEmployee(db, actor, body.employeeId, body.branchId);
    const previous = await db
      .prepare(
        "SELECT scheduled_start,version FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=?",
      )
      .bind(actor.tenantId, body.branchId, body.employeeId)
      .first<{ scheduled_start: string | null; version: number }>();
    if ((previous?.version ?? 0) !== body.expectedVersion)
      deny(409, "Schedule changed; refresh before saving");
    const stamp = new Date().toISOString();
    const change = previous
      ? db
          .prepare(
            "UPDATE attendance_shift_assignments SET scheduled_start=?,version=version+1,updated_at=?,updated_by=? WHERE tenant_id=? AND branch_id=? AND user_id=? AND version=?",
          )
          .bind(
            body.scheduledStart,
            stamp,
            actor.id,
            actor.tenantId,
            body.branchId,
            body.employeeId,
            body.expectedVersion,
          )
      : db
          .prepare(
            "INSERT INTO attendance_shift_assignments(tenant_id,branch_id,user_id,scheduled_start,updated_at,updated_by,version) VALUES(?,?,?,?,?,?,1) ON CONFLICT DO NOTHING",
          )
          .bind(
            actor.tenantId,
            body.branchId,
            body.employeeId,
            body.scheduledStart,
            stamp,
            actor.id,
          );
    const results = await db.batch([
      change,
      db
        .prepare(
          "INSERT INTO attendance_management_events(tenant_id,id,branch_id,actor_id,subject_user_id,event_type,at,before_json,after_json) SELECT ?,?,?,?,?,'SCHEDULE_ASSIGNMENT',?,?,? WHERE EXISTS(SELECT 1 FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=? AND version=? AND updated_by=? AND updated_at=?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          body.branchId,
          actor.id,
          body.employeeId,
          stamp,
          JSON.stringify(previous?.scheduled_start ?? null),
          JSON.stringify(body.scheduledStart),
          actor.tenantId,
          body.branchId,
          body.employeeId,
          body.expectedVersion + 1,
          actor.id,
          stamp,
        ),
    ]);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1)
      deny(409, "Schedule changed; refresh and retry");
    return noStore({ ok: true });
  }
  return noStore({ ok: false, message: "Unsupported attendance endpoint" }, 405);
}
