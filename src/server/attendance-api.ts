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
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { requireFullAuthentication } from "@/server/pos-auth-service";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { attendanceRecords, attendanceCsv } from "@/server/attendance-reporting";
import { attendanceTiming } from "@/lib/attendance-timing";
import { handleAttendanceDelays } from "@/server/attendance-delay-api";

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
    sessionId: z.string().uuid().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();
const supervisorSchema = z
  .object({
    action: z.enum(["IN", "OUT", "CORRECT_IN", "CORRECT_OUT", "EXPLAIN"]),
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
    scheduledEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
    restDay: z.boolean().optional(),
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
  updated_by: string;
  updated_at: string;
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
  scheduled_start: string | null;
  scheduled_end: string | null;
  rest_day: number | null;
  grace_minutes: number | null;
  schedule_timezone: string | null;
  schedule_cutoff_minutes: number | null;
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
type PunchActor = {
  actor: ServerActor;
  db: D1Database;
  branch: BranchRow;
  guard?: { userId: string; version: number; eventId: string };
};

function uniqueAttendanceConflict(error: unknown) {
  return (
    (error as { code?: string } | null)?.code === "23505" ||
    (error instanceof Error &&
      /UNIQUE constraint failed: (employee_attendance_sessions|employee_attendance_events|attendance_management_events|attendance_mutation_claims)|UNIQUE constraint failed: index 'uq_attendance_management_revision'/.test(
        error.message,
      ))
  );
}
async function managementBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (uniqueAttendanceConflict(error))
      deny(409, "Attendance settings changed; refresh and retry");
    throw error;
  }
}

async function executeAttendance(
  ctx: PunchActor,
  requestKey: string,
  command: Record<string, unknown>,
  perform: (
    hash: string,
  ) => Promise<{ session: ReturnType<typeof publicSession>; repeated: boolean }>,
) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(command)),
  );
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  const replay = async () => {
    const event = await ctx.db
      .prepare(
        "SELECT session_id,request_hash FROM employee_attendance_events WHERE tenant_id=? AND actor_id=? AND request_key=?",
      )
      .bind(ctx.actor.tenantId, ctx.actor.id, requestKey)
      .first<{ session_id: string; request_hash: string }>();
    if (!event) return null;
    if (event.request_hash !== hash)
      deny(409, "Idempotency key was used for a different attendance request");
    const row = await ctx.db
      .prepare(
        "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=? AND branch_id=?",
      )
      .bind(ctx.actor.tenantId, event.session_id, ctx.branch.id)
      .first<SessionRow>();
    if (!row) deny(409, "Attendance replay record unavailable");
    return { session: publicSession(row), repeated: true };
  };
  const existing = await replay();
  if (existing) return existing;
  const userId = String(command.employeeId);
  await ensureEmployee(ctx.db, ctx.actor, userId, ctx.branch.id);
  await ctx.db
    .prepare(
      "INSERT INTO attendance_employee_versions(tenant_id,user_id,version) VALUES(?,?,0) ON CONFLICT DO NOTHING",
    )
    .bind(ctx.actor.tenantId, userId)
    .run();
  const revision = await ctx.db
    .prepare("SELECT version FROM attendance_employee_versions WHERE tenant_id=? AND user_id=?")
    .bind(ctx.actor.tenantId, userId)
    .first<{ version: number }>();
  ctx.guard = { userId, version: revision!.version, eventId: crypto.randomUUID() };
  try {
    return await perform(hash);
  } catch (error) {
    if (!uniqueAttendanceConflict(error)) throw error;
    const completed = await replay();
    if (completed) return completed;
    deny(409, "Attendance changed on another terminal; refresh and retry");
  }
}

async function punchBatch(ctx: PunchActor, statements: D1PreparedStatement[]) {
  if (!ctx.guard) throw new Error("Attendance mutation guard missing");
  const { userId, version, eventId } = ctx.guard;
  // The unique revision claim stops a CAS loser before any session write. Its
  // deferred event FK also aborts commit if the corresponding audit is missing.
  const results = await ctx.db.batch([
    ctx.db
      .prepare(
        "UPDATE attendance_employee_versions SET version=version+1 WHERE tenant_id=? AND user_id=? AND version=?",
      )
      .bind(ctx.actor.tenantId, userId, version),
    ctx.db
      .prepare(
        "INSERT INTO attendance_mutation_claims(tenant_id,user_id,version,event_id) VALUES(?,?,?,?)",
      )
      .bind(ctx.actor.tenantId, userId, version + 1, eventId),
    ...statements,
  ]);
  return results.slice(2);
}

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
      "SELECT u.id FROM users u JOIN user_branches ub ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=? WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND u.employment_status='ACTIVE' AND (u.effective_from IS NULL OR u.effective_from<=?) AND (u.effective_until IS NULL OR u.effective_until>?)",
    )
    .bind(branchId, actor.tenantId, userId, new Date().toISOString(), new Date().toISOString())
    .first();
  if (!found) deny(403, "Employee is not active or assigned to the branch");
}
async function fenceFor(db: D1Database, actor: ServerActor, branchId: string) {
  return db
    .prepare(
      "SELECT enabled,latitude,longitude,radius_m,max_accuracy_m,max_fix_age_seconds,grace_minutes,version,updated_by,updated_at FROM attendance_geofences WHERE tenant_id=? AND branch_id=?",
    )
    .bind(actor.tenantId, branchId)
    .first<FenceRow>();
}
async function readSession(
  db: D1Database,
  actor: ServerActor,
  userId: string,
  date: string,
  branchId: string,
) {
  return db
    .prepare(
      "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND business_date=? AND branch_id=? ORDER BY clock_in_at DESC,opened_revision DESC,id DESC LIMIT 1",
    )
    .bind(actor.tenantId, userId, date, branchId)
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
  snapshot?: Pick<SessionRow, "scheduled_start" | "rest_day" | "grace_minutes">,
) {
  const row =
    snapshot ??
    (await db
      .prepare(
        "SELECT scheduled_start,rest_day FROM attendance_shift_assignments WHERE tenant_id=? AND user_id=? AND branch_id=?",
      )
      .bind(actor.tenantId, userId, branch.id)
      .first<{ scheduled_start: string | null; rest_day: number }>());
  if (!row?.scheduled_start || row.rest_day === 1) return null; // Never invent schedules or payroll deductions.
  const fence = await fenceFor(db, actor, branch.id);
  const scheduledMinutes =
    Number(row.scheduled_start.slice(0, 2)) * 60 + Number(row.scheduled_start.slice(3, 5));
  const scheduled =
    scheduledMinutes + (scheduledMinutes < branch.business_day_cutoff_minutes ? 1440 : 0);
  const clock = localParts(occurredAt, branch.timezone);
  const elapsed = clock.minutes + (clock.date > date ? 1440 : 0);
  return Math.max(
    0,
    elapsed - scheduled - (snapshot ? (snapshot.grace_minutes ?? 0) : (fence?.grace_minutes ?? 0)),
  );
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
    ...attendanceTiming(row),
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    restDay: row.rest_day === null ? null : row.rest_day === 1,
  };
}
async function report(db: D1Database, actor: ServerActor, branch: BranchRow) {
  const today = businessDateForTimestamp(
    new Date(),
    branch.timezone,
    branch.business_day_cutoff_minutes,
  );
  const open = await readOpen(db, actor, actor.id);
  const own =
    open?.branch_id === branch.id ? open : await readSession(db, actor, actor.id, today, branch.id);
  const fence = await fenceFor(db, actor, branch.id);
  const canManage = manager(actor);
  const records = canManage
    ? ((
        await db
          .prepare(
            "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND branch_id=? AND (business_date=? OR clock_out_at IS NULL) ORDER BY clock_in_at DESC,opened_revision DESC,id DESC LIMIT 500",
          )
          .bind(actor.tenantId, branch.id, today)
          .all<SessionRow>()
      ).results ?? [])
    : [];
  const staff = canManage
    ? ((
        await db
          .prepare(
            "SELECT u.id,u.name,u.employee_code,s.scheduled_start,s.scheduled_end,s.rest_day,s.version AS schedule_version FROM users u JOIN user_branches ub ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=? LEFT JOIN attendance_shift_assignments s ON s.tenant_id=u.tenant_id AND s.user_id=u.id AND s.branch_id=? WHERE u.tenant_id=? AND u.active=1 AND u.employment_status='ACTIVE' ORDER BY u.name LIMIT 500",
          )
          .bind(branch.id, branch.id, actor.tenantId)
          .all()
      ).results ?? [])
    : [];
  const mySchedule = await db
    .prepare(
      "SELECT scheduled_start,scheduled_end,rest_day,version FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=?",
    )
    .bind(actor.tenantId, branch.id, actor.id)
    .first();
  const summary = canManage
    ? await db
        .prepare(
          "SELECT COUNT(DISTINCT CASE WHEN business_date=? THEN user_id END) recorded,COUNT(DISTINCT CASE WHEN clock_out_at IS NULL THEN user_id END) working,COUNT(DISTINCT CASE WHEN business_date=? AND clock_out_at IS NOT NULL THEN user_id END) completed,COUNT(DISTINCT CASE WHEN business_date=? AND minutes_late>0 THEN user_id END) late,COUNT(DISTINCT CASE WHEN business_date=? AND (clock_in_source='SUPERVISOR' OR clock_out_source='SUPERVISOR') THEN user_id END) exceptions FROM employee_attendance_sessions WHERE tenant_id=? AND branch_id=? AND (business_date=? OR clock_out_at IS NULL)",
        )
        .bind(today, today, today, today, actor.tenantId, branch.id, today)
        .first()
    : null;
  const workforce = canManage
    ? await db
        .prepare(
          "SELECT COUNT(*) total,COUNT(CASE WHEN NOT EXISTS(SELECT 1 FROM employee_attendance_sessions s WHERE s.tenant_id=u.tenant_id AND s.user_id=u.id AND s.branch_id=? AND (s.business_date=? OR s.clock_out_at IS NULL)) THEN 1 END) not_recorded FROM users u JOIN user_branches ub ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id WHERE u.tenant_id=? AND ub.branch_id=? AND u.active=1 AND u.employment_status='ACTIVE'",
        )
        .bind(branch.id, today, actor.tenantId, branch.id)
        .first()
    : null;
  return {
    ok: true,
    serverNow: new Date().toISOString(),
    businessDate: today,
    branchId: branch.id,
    branchTimezone: branch.timezone,
    me: own ? publicSession(own) : null,
    openElsewhere: Boolean(open && open.branch_id !== branch.id),
    canManage,
    canConfigure:
      actor.authLevel === "FULL" &&
      actor.permissions.includes(permissions.staffManage) &&
      actor.permissions.includes(permissions.settingsBranchManage),
    mySchedule,
    summary: summary && workforce ? { ...summary, ...workforce } : null,
    geofence: {
      enabled: fence?.enabled === 1,
      radiusMeters: fence?.radius_m ?? 10,
      maxAccuracyMeters: fence?.max_accuracy_m ?? 8,
      maxFixAgeSeconds: fence?.max_fix_age_seconds ?? 30,
      graceMinutes: fence?.grace_minutes ?? 0,
      version: fence?.version ?? 0,
      ...(canManage
        ? {
            latitude: fence?.latitude ?? null,
            longitude: fence?.longitude ?? null,
            updatedBy: fence?.updated_by ?? null,
            updatedAt: fence?.updated_at ?? null,
          }
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
  requestHash: string,
  reason?: string,
  evidence?: { accuracy: number; distance: number },
  expected?: { sessionId?: string; expectedVersion?: number },
) {
  const { actor, db, branch } = ctx;
  await ensureEmployee(db, actor, userId, branch.id);
  const instant = new Date().toISOString(); // Never trust client time.
  const date = businessDateForTimestamp(
    instant,
    branch.timezone,
    branch.business_day_cutoff_minutes,
  );
  const eventId = ctx.guard!.eventId;
  const eventType = (source === "SUPERVISOR" ? "SUPERVISOR_CLOCK_" : "CLOCK_") + action;
  if (action === "IN") {
    const existingOpen = await readOpen(db, actor, userId);
    if (existingOpen) {
      if (existingOpen.clock_in_key === requestKey)
        return { session: publicSession(existingOpen), repeated: true };
      deny(409, "Employee has an open attendance session. Clock out first");
    }
    const previous = await readSession(db, actor, userId, date, branch.id);
    if (previous) {
      if (previous.clock_in_key === requestKey)
        return { session: publicSession(previous), repeated: true };
      if (!previous.clock_out_at || previous.clock_out_at > instant)
        deny(409, "Previous attendance must end before returning to work");
    }
    const id = crypto.randomUUID();
    const schedule = await db
      .prepare(
        "SELECT scheduled_start,scheduled_end,rest_day FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=?",
      )
      .bind(actor.tenantId, branch.id, userId)
      .first<{ scheduled_start: string | null; scheduled_end: string | null; rest_day: number }>();
    const policy = await fenceFor(db, actor, branch.id);
    const late = previous ? null : await lateMinutes(db, actor, branch, userId, instant, date);
    const results = await punchBatch(ctx, [
      db
        .prepare(
          "INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_in_key,minutes_late,clock_in_source,version,created_at,updated_at,opened_revision,scheduled_start,scheduled_end,rest_day,grace_minutes,schedule_timezone,schedule_cutoff_minutes) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
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
          ctx.guard!.version + 1,
          schedule?.scheduled_start ?? null,
          schedule?.scheduled_end ?? null,
          schedule?.rest_day ?? null,
          schedule ? (policy?.grace_minutes ?? 0) : null,
          branch.timezone,
          branch.business_day_cutoff_minutes,
        ),
      db
        .prepare(
          "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at,accuracy_m,distance_m) SELECT ?,?,s.id,?,?,?,?,s.version,?,?,?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.user_id=? AND s.business_date=? AND s.clock_in_key=?",
        )
        .bind(
          actor.tenantId,
          eventId,
          actor.id,
          eventType,
          requestKey,
          requestHash,
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
    const current = await db
      .prepare("SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=?")
      .bind(actor.tenantId, id)
      .first<SessionRow>();
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
  if (!expected?.sessionId || !expected.expectedVersion)
    deny(400, "Clock-out requires the selected session and version");
  if (open.id !== expected.sessionId || open.version !== expected.expectedVersion)
    deny(409, "Attendance session changed; refresh before clocking out");
  if (instant < open.clock_in_at)
    deny(409, "Recorded clock-in is later than server time; ask a supervisor to correct it");
  const result = await punchBatch(ctx, [
    db
      .prepare(
        "UPDATE employee_attendance_sessions SET clock_out_at=?,clock_out_key=?,clock_out_source=?,version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND user_id=? AND clock_out_at IS NULL",
      )
      .bind(instant, requestKey, source, instant, actor.tenantId, open.id, userId),
    db
      .prepare(
        "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at,accuracy_m,distance_m) SELECT ?,?,s.id,?,?,?,?,s.version,?,?,?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.id=? AND s.clock_out_key=?",
      )
      .bind(
        actor.tenantId,
        eventId,
        actor.id,
        eventType,
        requestKey,
        requestHash,
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
async function correctPunch(
  ctx: PunchActor,
  input: z.infer<typeof supervisorSchema>,
  requestHash: string,
) {
  const { actor, db, branch } = ctx;
  await ensureEmployee(db, actor, input.employeeId, branch.id);
  if (!input.expectedVersion) deny(400, "Expected record version is required for corrections");
  if (!input.occurredAt && input.action !== "EXPLAIN")
    deny(400, "Correction timestamp is required");
  const instant = input.occurredAt
    ? new Date(input.occurredAt).toISOString()
    : new Date().toISOString();
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
  const proposedStart = input.action === "CORRECT_IN" ? instant : record.clock_in_at;
  const proposedEnd = input.action === "CORRECT_OUT" ? instant : record.clock_out_at;
  const overlap = await db
    .prepare(
      "SELECT id FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND id<>? AND (clock_out_at IS NULL OR clock_out_at>?) AND (CAST(? AS TEXT) IS NULL OR clock_in_at<?) LIMIT 1",
    )
    .bind(actor.tenantId, input.employeeId, record.id, proposedStart, proposedEnd, proposedEnd)
    .first();
  if (overlap) deny(409, "Correction overlaps another attendance session");
  const correctingIn = input.action === "CORRECT_IN";
  const historicalBranch = {
    ...branch,
    timezone: record.schedule_timezone ?? branch.timezone,
    business_day_cutoff_minutes:
      record.schedule_cutoff_minutes ?? branch.business_day_cutoff_minutes,
  };
  const earlier = await db
    .prepare(
      "SELECT id FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND business_date=? AND id<>? AND clock_in_at<? LIMIT 1",
    )
    .bind(actor.tenantId, input.employeeId, record.business_date, record.id, proposedStart)
    .first();
  const late =
    correctingIn && !earlier
      ? await lateMinutes(
          db,
          actor,
          historicalBranch,
          input.employeeId,
          instant,
          record.business_date,
          record,
        )
      : null;
  if (
    correctingIn &&
    businessDateForTimestamp(
      instant,
      historicalBranch.timezone,
      historicalBranch.business_day_cutoff_minutes,
    ) !== record.business_date
  )
    deny(400, "Corrected clock-in must remain on the original business date");
  const previous = correctingIn ? record.clock_in_at : record.clock_out_at;
  const result = await punchBatch(ctx, [
    db
      .prepare(
        input.action === "EXPLAIN"
          ? "UPDATE employee_attendance_sessions SET version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND version=?"
          : correctingIn
            ? "UPDATE employee_attendance_sessions SET clock_in_at=?,minutes_late=?,clock_in_source='SUPERVISOR',version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND version=?"
            : "UPDATE employee_attendance_sessions SET clock_out_at=?,clock_out_source='SUPERVISOR',version=version+1,updated_at=? WHERE tenant_id=? AND id=? AND version=?",
      )
      .bind(
        ...(input.action === "EXPLAIN"
          ? [new Date().toISOString(), actor.tenantId, record.id, record.version]
          : correctingIn
            ? [instant, late, new Date().toISOString(), actor.tenantId, record.id, record.version]
            : [instant, new Date().toISOString(), actor.tenantId, record.id, record.version]),
      ),
    db
      .prepare(
        "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at,before_json,after_json) SELECT ?,?,?,?,?,?,?,s.version,?,?,?,? FROM employee_attendance_sessions s WHERE s.tenant_id=? AND s.id=? AND s.version=?",
      )
      .bind(
        actor.tenantId,
        ctx.guard!.eventId,
        record.id,
        actor.id,
        input.action,
        input.idempotencyKey,
        requestHash,
        input.reason,
        new Date().toISOString(),
        JSON.stringify({ ...publicSession(record), at: previous }),
        JSON.stringify({
          ...publicSession(record),
          at: input.action === "EXPLAIN" ? previous : instant,
          clockInAt: correctingIn ? instant : record.clock_in_at,
          clockOutAt: input.action === "CORRECT_OUT" ? instant : record.clock_out_at,
          minutesLate: correctingIn ? late : record.minutes_late,
          version: record.version + 1,
        }),
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
  if (request.method !== "GET")
    await new DatabaseRateLimiter(db).consume(`attendance:${actor.tenantId}:${actor.id}`, {
      bucket: "attendance-write",
      limit: 40,
      windowSeconds: 60,
    });
  if (url.pathname.startsWith("/api/seramet/attendance/delays")) {
    return handleAttendanceDelays(
      request,
      actor,
      db,
      async (branchId, managed) => {
        const ctx = await context(actor, db, branchId, managed);
        await ensureEmployee(db, actor, actor.id, branchId);
        return ctx;
      },
      manager(actor),
    );
  }
  if (
    request.method === "GET" &&
    ["/api/seramet/attendance/records", "/api/seramet/attendance/export"].includes(url.pathname)
  ) {
    const ctx = await context(
      actor,
      db,
      url.searchParams.get("branchId") || actor.branchId,
      manager(actor),
    );
    const today = businessDateForTimestamp(
      new Date(),
      ctx.branch.timezone,
      ctx.branch.business_day_cutoff_minutes,
    );
    if (url.pathname.endsWith("/export")) {
      sameOrigin(request, env);
      await new DatabaseRateLimiter(db).consume(`attendance-export:${actor.tenantId}:${actor.id}`, {
        bucket: "attendance-export",
        limit: 10,
        windowSeconds: 60,
      });
      return attendanceCsv(db, actor, ctx.branch.id, ctx.branch.timezone, today, url);
    }
    return noStore({
      ok: true,
      ...(await attendanceRecords(db, actor, ctx.branch.id, today, url)),
    });
  }
  const lookup = /^\/api\/seramet\/attendance\/requests\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (request.method === "GET" && lookup) {
    const ctx = await context(
      actor,
      db,
      url.searchParams.get("branchId") || actor.branchId,
      manager(actor),
    );
    const row = await db
      .prepare(
        "SELECT s.* FROM employee_attendance_events e JOIN employee_attendance_sessions s ON s.tenant_id=e.tenant_id AND s.id=e.session_id WHERE e.tenant_id=? AND e.actor_id=? AND e.request_key=? AND s.branch_id=?",
      )
      .bind(actor.tenantId, actor.id, lookup[1], ctx.branch.id)
      .first<SessionRow>();
    if (row && !manager(actor) && row.user_id !== actor.id)
      return noStore({ ok: true, found: false, session: null });
    return noStore({ ok: true, found: Boolean(row), session: row ? publicSession(row) : null });
  }
  const history = /^\/api\/seramet\/attendance\/sessions\/([0-9a-f-]{36})\/history$/.exec(
    url.pathname,
  );
  if (request.method === "GET" && history) {
    const ctx = await context(
      actor,
      db,
      url.searchParams.get("branchId") || actor.branchId,
      manager(actor),
    );
    const session = await db
      .prepare(
        "SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND id=? AND branch_id=?",
      )
      .bind(actor.tenantId, history[1], ctx.branch.id)
      .first<SessionRow>();
    if (!session || (!manager(actor) && session.user_id !== actor.id))
      deny(404, "Attendance session not found");
    const events = await db
      .prepare(
        "SELECT e.id,e.session_version version,e.event_type type,e.reason,e.at,e.before_json,e.after_json,u.name actor FROM employee_attendance_events e JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.actor_id WHERE e.tenant_id=? AND e.session_id=? ORDER BY e.session_version LIMIT 500",
      )
      .bind(actor.tenantId, session.id)
      .all();
    return noStore({ ok: true, session: publicSession(session), events: events.results ?? [] });
  }
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
    if (!decision.allowed) {
      const message =
        decision.reason === "OUTSIDE_GEOFENCE"
          ? `Unable to check in or out. You must be within ${fence.radius_m} metres of your workplace. Move closer and try again, or contact your supervisor.`
          : decision.reason === "LOW_ACCURACY"
            ? "Your location is not accurate enough to verify attendance. Enable precise location, try outdoors, or contact your supervisor."
            : "Your location could not be verified. Request a fresh precise location and try again, or contact your supervisor.";
      deny(422, message);
    }
    return noStore({
      ok: true,
      ...(await executeAttendance(
        ctx,
        body.idempotencyKey,
        {
          action: body.action,
          branchId: body.branchId,
          employeeId: actor.id,
          source: "GEOFENCE",
          sessionId: body.sessionId,
          expectedVersion: body.expectedVersion,
        },
        (hash) =>
          recordPunch(
            ctx,
            actor.id,
            body.action,
            body.idempotencyKey,
            "GEOFENCE",
            hash,
            undefined,
            { accuracy: decision.accuracyMeters, distance: decision.distanceMeters },
            body,
          ),
      )),
    });
  }
  if (url.pathname === "/api/seramet/attendance/supervisor" && request.method === "POST") {
    const body = parse(supervisorSchema, await request.json().catch(() => null));
    const ctx = await context(actor, db, body.branchId, true);
    if (body.action === "CORRECT_IN" || body.action === "CORRECT_OUT" || body.action === "EXPLAIN")
      return noStore({
        ok: true,
        ...(await executeAttendance(ctx, body.idempotencyKey, body, (hash) =>
          correctPunch(ctx, body, hash),
        )),
      });
    if (body.occurredAt)
      deny(
        400,
        "Manual punches use the authoritative server time; use a correction for prior times",
      );
    const action = body.action;
    return noStore({
      ok: true,
      ...(await executeAttendance(ctx, body.idempotencyKey, body, (hash) =>
        recordPunch(
          ctx,
          body.employeeId,
          action,
          body.idempotencyKey,
          "SUPERVISOR",
          hash,
          body.reason,
          undefined,
          body,
        ),
      )),
    });
  }
  if (url.pathname === "/api/seramet/attendance/geofence" && request.method === "PUT") {
    const body = parse(configSchema, await request.json().catch(() => null));
    await context(actor, db, body.branchId, true);
    requireFullAuthentication(actor);
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
    const results = await managementBatch(db, [
      change,
      db
        .prepare(
          "INSERT INTO attendance_management_events(tenant_id,id,branch_id,actor_id,event_type,entity_version,at,before_json,after_json) SELECT ?,?,?,?,'GEOFENCE_POLICY',?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_geofences WHERE tenant_id=? AND branch_id=? AND version=? AND updated_by=? AND updated_at=?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          body.branchId,
          actor.id,
          body.expectedVersion + 1,
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
        "SELECT scheduled_start,scheduled_end,rest_day,version FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=?",
      )
      .bind(actor.tenantId, body.branchId, body.employeeId)
      .first<{
        scheduled_start: string | null;
        scheduled_end: string | null;
        rest_day: number;
        version: number;
      }>();
    if ((previous?.version ?? 0) !== body.expectedVersion)
      deny(409, "Schedule changed; refresh before saving");
    const scheduledEnd =
      body.scheduledEnd === undefined ? (previous?.scheduled_end ?? null) : body.scheduledEnd;
    const restDay = body.restDay === undefined ? previous?.rest_day === 1 : body.restDay;
    if (restDay && (body.scheduledStart || scheduledEnd))
      deny(400, "OFF schedules cannot contain work times");
    if (scheduledEnd && (!body.scheduledStart || scheduledEnd === body.scheduledStart))
      deny(400, "Scheduled end needs a distinct scheduled start");
    const stamp = new Date().toISOString();
    const change = previous
      ? db
          .prepare(
            "UPDATE attendance_shift_assignments SET scheduled_start=?,scheduled_end=?,rest_day=?,version=version+1,updated_at=?,updated_by=? WHERE tenant_id=? AND branch_id=? AND user_id=? AND version=?",
          )
          .bind(
            body.scheduledStart,
            scheduledEnd,
            restDay ? 1 : 0,
            stamp,
            actor.id,
            actor.tenantId,
            body.branchId,
            body.employeeId,
            body.expectedVersion,
          )
      : db
          .prepare(
            "INSERT INTO attendance_shift_assignments(tenant_id,branch_id,user_id,scheduled_start,scheduled_end,rest_day,updated_at,updated_by,version) VALUES(?,?,?,?,?,?,?,?,1) ON CONFLICT DO NOTHING",
          )
          .bind(
            actor.tenantId,
            body.branchId,
            body.employeeId,
            body.scheduledStart,
            scheduledEnd,
            restDay ? 1 : 0,
            stamp,
            actor.id,
          );
    const results = await managementBatch(db, [
      change,
      db
        .prepare(
          "INSERT INTO attendance_management_events(tenant_id,id,branch_id,actor_id,subject_user_id,event_type,entity_version,at,before_json,after_json) SELECT ?,?,?,?,?,'SCHEDULE_ASSIGNMENT',?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_shift_assignments WHERE tenant_id=? AND branch_id=? AND user_id=? AND version=? AND updated_by=? AND updated_at=?)",
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          body.branchId,
          actor.id,
          body.employeeId,
          body.expectedVersion + 1,
          stamp,
          JSON.stringify(previous ?? null),
          JSON.stringify({
            scheduledStart: body.scheduledStart,
            scheduledEnd,
            restDay,
            version: body.expectedVersion + 1,
          }),
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
