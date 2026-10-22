import { z } from "zod";
import { SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { businessDateForTimestamp } from "@/lib/business-date";
import type { D1Database } from "@/server/database/d1";

const submission = z
  .object({
    branchId: z.string().min(1).max(120),
    idempotencyKey: z.string().uuid(),
    expectedArrivalAt: z.string().datetime({ offset: true }),
    reason: z.string().trim().min(8).max(500),
  })
  .strict();
const decision = z
  .object({
    branchId: z.string().min(1).max(120),
    idempotencyKey: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    status: z.enum(["APPROVED", "REJECTED"]),
    note: z.string().trim().min(3).max(500),
  })
  .strict();
type Context = {
  actor: ServerActor;
  db: D1Database;
  branch: { id: string; timezone: string; business_day_cutoff_minutes: number };
};
type DelayRow = {
  id: string;
  user_id: string;
  status: string;
  version: number;
  request_hash: string;
};
function fail(status: number, message: string): never {
  throw new SerametHttpError(status, message);
}
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
async function hash(body: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(body)),
  );
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function handleAttendanceDelays(
  request: Request,
  actor: ServerActor,
  db: D1Database,
  getContext: (branchId: string, managed: boolean) => Promise<Context>,
  canManage: boolean,
): Promise<Response | null> {
  const url = new URL(request.url);
  const base = "/api/seramet/attendance/delays";
  if (!url.pathname.startsWith(base)) return null;
  if (url.pathname === base && request.method === "GET") {
    const ctx = await getContext(url.searchParams.get("branchId") || actor.branchId, canManage);
    const rows = await db
      .prepare(
        `SELECT d.id,d.user_id employeeId,u.name employee,d.business_date businessDate,
      d.expected_arrival_at expectedArrivalAt,d.reason,d.status,d.version,d.created_at createdAt,
      d.decided_at decidedAt,d.decision_note decisionNote,decider.name decidedBy,
      CASE WHEN r.user_id IS NULL THEN 1 ELSE 0 END unread
      FROM attendance_delay_requests d JOIN users u ON u.tenant_id=d.tenant_id AND u.id=d.user_id
      LEFT JOIN users decider ON decider.tenant_id=d.tenant_id AND decider.id=d.decided_by
      LEFT JOIN attendance_delay_reads r ON r.tenant_id=d.tenant_id AND r.request_id=d.id AND r.user_id=?
      WHERE d.tenant_id=? AND d.branch_id=? AND (?=1 OR d.user_id=?)
      ORDER BY CASE WHEN d.status='PENDING' THEN 0 ELSE 1 END,d.created_at DESC LIMIT 50`,
      )
      .bind(actor.id, actor.tenantId, ctx.branch.id, canManage ? 1 : 0, actor.id)
      .all();
    const unread = canManage
      ? await db
          .prepare(
            `SELECT COUNT(*) total FROM attendance_delay_requests d
      WHERE d.tenant_id=? AND d.branch_id=? AND d.status='PENDING' AND NOT EXISTS
      (SELECT 1 FROM attendance_delay_reads r WHERE r.tenant_id=d.tenant_id AND r.request_id=d.id AND r.user_id=?)`,
          )
          .bind(actor.tenantId, ctx.branch.id, actor.id)
          .first<{ total: number }>()
      : null;
    return json({
      ok: true,
      requests: rows.results ?? [],
      unread: Number(unread?.total ?? 0),
      canManage,
      serverNow: new Date().toISOString(),
      timeZone: ctx.branch.timezone,
    });
  }
  if (url.pathname === base && request.method === "POST") {
    const parsed = submission.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      fail(400, "Enter an expected arrival time and a reason of 8 to 500 characters.");
    const body = parsed.data;
    const ctx = await getContext(body.branchId, false);
    const fingerprint = await hash(body);
    const previous = await db
      .prepare(
        "SELECT id,request_hash FROM attendance_delay_requests WHERE tenant_id=? AND user_id=? AND request_key=?",
      )
      .bind(actor.tenantId, actor.id, body.idempotencyKey)
      .first<{ id: string; request_hash: string }>();
    if (previous) {
      if (previous.request_hash !== fingerprint)
        fail(409, "This request key was already used with different details.");
      return json({ ok: true, id: previous.id, repeated: true });
    }
    const now = new Date();
    const arrival = new Date(body.expectedArrivalAt);
    if (arrival.getTime() <= now.getTime() || arrival.getTime() > now.getTime() + 86400000)
      fail(422, "Expected arrival must be in the next 24 hours.");
    const open = await db
      .prepare(
        "SELECT id FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND clock_out_at IS NULL",
      )
      .bind(actor.tenantId, actor.id)
      .first();
    if (open)
      fail(409, "You are already clocked in. Contact your supervisor about a different absence.");
    const id = crypto.randomUUID();
    const stamp = now.toISOString();
    const businessDate = businessDateForTimestamp(
      arrival,
      ctx.branch.timezone,
      ctx.branch.business_day_cutoff_minutes,
    );
    try {
      await db.batch([
        db
          .prepare(
            "INSERT INTO attendance_delay_requests(tenant_id,id,branch_id,user_id,business_date,expected_arrival_at,reason,status,version,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?,?,'PENDING',1,?,?,?)",
          )
          .bind(
            actor.tenantId,
            id,
            ctx.branch.id,
            actor.id,
            businessDate,
            arrival.toISOString(),
            body.reason,
            body.idempotencyKey,
            fingerprint,
            stamp,
          ),
        db
          .prepare(
            "INSERT INTO attendance_delay_events(tenant_id,id,request_id,actor_id,event_type,version,request_key,request_hash,note,at) VALUES(?,?,?,?,'SUBMITTED',1,?,?,?,?)",
          )
          .bind(
            actor.tenantId,
            crypto.randomUUID(),
            id,
            actor.id,
            body.idempotencyKey,
            fingerprint,
            body.reason,
            stamp,
          ),
      ]);
    } catch (error) {
      if (isConflict(error)) {
        const replay = await db
          .prepare(
            "SELECT id,request_hash FROM attendance_delay_requests WHERE tenant_id=? AND user_id=? AND request_key=?",
          )
          .bind(actor.tenantId, actor.id, body.idempotencyKey)
          .first<{ id: string; request_hash: string }>();
        if (replay?.request_hash === fingerprint)
          return json({ ok: true, id: replay.id, repeated: true });
        fail(
          409,
          "A pending delay request already exists for this business day. Refresh to review it.",
        );
      }
      throw error;
    }
    return json({ ok: true, id, repeated: false }, 201);
  }
  const route = /^\/api\/seramet\/attendance\/delays\/([^/]+)\/(decision|read)$/.exec(url.pathname);
  if (route && request.method === "POST") {
    if (!canManage) fail(403, "Supervisor permission is required.");
    const raw = await request.json().catch(() => null);
    const read = z.object({ branchId: z.string().min(1).max(120) }).strict();
    const parsed = (route[2] === "read" ? read : decision).safeParse(raw);
    if (!parsed.success) fail(400, "Invalid delay review request.");
    const body = parsed.data;
    const ctx = await getContext(body.branchId, true);
    const row = await db
      .prepare(
        "SELECT id,user_id,status,version,request_hash FROM attendance_delay_requests WHERE tenant_id=? AND branch_id=? AND id=?",
      )
      .bind(actor.tenantId, ctx.branch.id, route[1])
      .first<DelayRow>();
    if (!row) fail(404, "Delay request not found.");
    if (route[2] === "read") {
      await db
        .prepare(
          "INSERT INTO attendance_delay_reads(tenant_id,request_id,user_id,read_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(actor.tenantId, row.id, actor.id, new Date().toISOString())
        .run();
      return json({ ok: true });
    }
    const command = decision.parse(raw);
    if (row.user_id === actor.id) fail(403, "You cannot decide your own delay request.");
    const fingerprint = await hash({ id: row.id, ...command });
    const previous = await db
      .prepare(
        "SELECT request_hash FROM attendance_delay_events WHERE tenant_id=? AND actor_id=? AND request_key=?",
      )
      .bind(actor.tenantId, actor.id, command.idempotencyKey)
      .first<{ request_hash: string }>();
    if (previous) {
      if (previous.request_hash !== fingerprint)
        fail(409, "This decision key was used with different details.");
      return json({ ok: true, repeated: true });
    }
    if (row.status !== "PENDING" || row.version !== command.expectedVersion)
      fail(409, "The request changed. Refresh before deciding.");
    const stamp = new Date().toISOString();
    try {
      const result = await db.batch([
        db
          .prepare(
            `INSERT INTO attendance_delay_events(tenant_id,id,request_id,actor_id,event_type,version,request_key,request_hash,note,at)
          SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM attendance_delay_requests WHERE tenant_id=? AND id=? AND status='PENDING' AND version=?)`,
          )
          .bind(
            actor.tenantId,
            crypto.randomUUID(),
            row.id,
            actor.id,
            command.status,
            row.version + 1,
            command.idempotencyKey,
            fingerprint,
            command.note,
            stamp,
            actor.tenantId,
            row.id,
            row.version,
          ),
        db
          .prepare(
            "UPDATE attendance_delay_requests SET status=?,version=version+1,decided_at=?,decided_by=?,decision_note=? WHERE tenant_id=? AND id=? AND status='PENDING' AND version=?",
          )
          .bind(command.status, stamp, actor.id, command.note, actor.tenantId, row.id, row.version),
      ]);
      if (result[1]?.meta?.changes !== 1)
        fail(409, "Another supervisor already decided this request.");
    } catch (error) {
      if (isConflict(error)) fail(409, "Another supervisor already decided this request. Refresh.");
      throw error;
    }
    return json({ ok: true, repeated: false });
  }
  return fail(404, "Attendance delay route not found.");
}
function isConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "23505") ||
      (error instanceof Error && /UNIQUE constraint failed/.test(error.message)))
  );
}
