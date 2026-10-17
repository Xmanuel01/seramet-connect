import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { authorizeSerametMutation } from "@/lib/seramet-auth";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";

let actor: ServerActor;
vi.mock("@/lib/seramet-auth", async (original) => {
  const actual = await original<typeof import("@/lib/seramet-auth")>();
  return { ...actual, authenticateSerametRequest: vi.fn(async () => actor) };
});
import { handleAttendanceApi } from "@/server/attendance-api";
let db: SqliteD1TestDatabase;
const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
const origin = "http://localhost:3000";
function request(path: string, method = "GET", body?: unknown) {
  return new Request(origin + path, {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
async function call(path: string, method = "GET", body?: unknown) {
  const res = await handleAttendanceApi(request(path, method, body), {
    SERAMET_DB: db,
    SERAMET_ENVIRONMENT: "development",
  } as SerametEnv);
  if (!res) throw new Error("Attendance handler not routed");
  return {
    status: res.status,
    data: (await res.json()) as {
      session: {
        id: string;
        version: number;
        employeeId: string;
        clockInSource: string;
        clockOutAt: string | null;
        clockInAt: string;
      };
      repeated: boolean;
      records: Array<{ id: string; version: number; clockInAt: string }>;
      geofence: { version: number };
      employees: Array<{ id: string; scheduled_start: string | null }>;
    },
  };
}
const fence = {
  branchId,
  enabled: true,
  latitude: -1.264,
  longitude: 36.806,
  radiusMeters: 10,
  maxAccuracyMeters: 8,
  maxFixAgeSeconds: 30,
  graceMinutes: 0,
  expectedVersion: 0,
};
const freshLocation = () => ({
  latitude: fence.latitude,
  longitude: fence.longitude,
  accuracyMeters: 2,
  capturedAt: new Date().toISOString(),
});
const id = () => crypto.randomUUID();
describe.sequential("authoritative geofenced attendance", () => {
  beforeEach(() => {
    db = createDemoFixtureDatabase();
    const user = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? AND active=1 ORDER BY id LIMIT 1")
      .get(tenantId) as { id: string } | undefined;
    if (!user) throw new Error("Expected seeded user");
    db.sqlite
      .prepare(
        "INSERT INTO user_branches(tenant_id,user_id,branch_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(tenantId, user.id, branchId);
    actor = {
      id: user.id,
      name: "Employee",
      tenantId,
      branchId,
      branch: "Westlands",
      assignedBranches: [{ id: branchId, name: "Westlands", isPrimary: true }],
      assignedBranchIds: [branchId],
      primaryBranchId: branchId,
      branchScope: { type: "BRANCH", branchId },
      roleIds: [],
      role: "Manager",
      authLevel: "FULL",
      permissions: [
        permissions.attendanceUse,
        permissions.staffManage,
        permissions.settingsBranchManage,
      ],
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    db.close();
  });
  function supervisor(overrides: Record<string, unknown> = {}) {
    const open =
      overrides.action === "OUT"
        ? (db.sqlite
            .prepare(
              "SELECT id,version FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=? AND clock_out_at IS NULL",
            )
            .get(tenantId, String(overrides.employeeId ?? actor.id)) as
            { id: string; version: number } | undefined)
        : undefined;
    return {
      branchId,
      employeeId: actor.id,
      action: "IN",
      idempotencyKey: id(),
      reason: "Verified supervisor exception",
      ...(open ? { sessionId: open.id, expectedVersion: open.version } : {}),
      ...overrides,
    };
  }
  function pauseNextBatch() {
    let release!: () => void;
    let arrived!: () => void;
    const waiting = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = db.batch.bind(db);
    vi.spyOn(db, "batch").mockImplementationOnce(async (statements) => {
      arrived();
      await gate;
      return original(statements);
    });
    return { waiting, release };
  }
  it("acknowledges concurrent duplicate punches once and rejects changed key reuse", async () => {
    const input = supervisor();
    const paused = pauseNextBatch();
    const first = call("/api/seramet/attendance/supervisor", "POST", input);
    await paused.waiting;
    const second = await call("/api/seramet/attendance/supervisor", "POST", input);
    paused.release();
    expect(second.data.repeated).toBe(false);
    expect((await first).data.repeated).toBe(true);
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", {
        ...input,
        reason: "A different supervisor reason",
      }),
    ).rejects.toThrow(/different attendance request/);
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", { ...input, action: "OUT" }),
    ).rejects.toThrow(/different attendance request/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_events").get()?.count,
    ).toBe(1);
  });
  it("rolls back a losing correction without orphan audit events", async () => {
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    const record = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    const input = supervisor({
      action: "CORRECT_IN",
      sessionId: record.id,
      expectedVersion: record.version,
      occurredAt: record.clockInAt,
    });
    const paused = pauseNextBatch();
    const first = call("/api/seramet/attendance/supervisor", "POST", input).catch(
      (error: unknown) => error,
    );
    await paused.waiting;
    await call("/api/seramet/attendance/supervisor", "POST", {
      ...input,
      idempotencyKey: id(),
      reason: "Winner verified arrival correction",
    });
    paused.release();
    expect(await first).toMatchObject({ status: 409 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_events").get()?.count,
    ).toBe(2);
    expect(
      db.sqlite.prepare("SELECT version FROM employee_attendance_sessions").get()?.version,
    ).toBe(2);
  });
  it("deduplicates racing clock-outs and binds correction retries to their original values", async () => {
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    const input = supervisor({ action: "OUT" });
    const paused = pauseNextBatch();
    const first = call("/api/seramet/attendance/supervisor", "POST", input);
    await paused.waiting;
    await call("/api/seramet/attendance/supervisor", "POST", input);
    paused.release();
    expect((await first).data.repeated).toBe(true);
    const record = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    const correction = supervisor({
      action: "CORRECT_IN",
      sessionId: record.id,
      expectedVersion: record.version,
      occurredAt: record.clockInAt,
    });
    await call("/api/seramet/attendance/supervisor", "POST", correction);
    expect(
      (await call("/api/seramet/attendance/supervisor", "POST", correction)).data.repeated,
    ).toBe(true);
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", {
        ...correction,
        reason: "Altered correction request reason",
      }),
    ).rejects.toThrow(/different attendance request/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_events").get()?.count,
    ).toBe(3);
  });
  it("does not audit losing settings updates even for the same actor and millisecond", async () => {
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    const paused = pauseNextBatch();
    const first = call("/api/seramet/attendance/geofence", "PUT", fence).catch(
      (error: unknown) => error,
    );
    await paused.waiting;
    await call("/api/seramet/attendance/geofence", "PUT", { ...fence, radiusMeters: 20 });
    paused.release();
    expect(await first).toMatchObject({ status: 409 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM attendance_management_events").get()?.count,
    ).toBe(1);
    expect(db.sqlite.prepare("SELECT radius_m FROM attendance_geofences").get()?.radius_m).toBe(20);
  });
  it("rejects policy changes unless authentication is explicitly FULL", async () => {
    actor = { ...actor, authLevel: undefined };
    await expect(call("/api/seramet/attendance/geofence", "PUT", fence)).rejects.toThrow();
    actor = { ...actor, authLevel: "POS_PIN" };
    await expect(call("/api/seramet/attendance/geofence", "PUT", fence)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) count FROM attendance_geofences").get()?.count).toBe(
      0,
    );
  });
  it("keeps overnight sessions visible and calculates after-midnight schedules against the cutoff", async () => {
    vi.setSystemTime(new Date("2026-10-16T23:10:00Z")); // 02:10 Nairobi, prior business day.
    db.sqlite
      .prepare("UPDATE branches SET business_day_cutoff_minutes=240 WHERE tenant_id=? AND id=?")
      .run(tenantId, branchId);
    await call("/api/seramet/attendance/schedule", "PUT", {
      branchId,
      employeeId: actor.id,
      scheduledStart: "02:00",
      expectedVersion: 0,
    });
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    const session = db.sqlite
      .prepare("SELECT minutes_late,business_date FROM employee_attendance_sessions")
      .get();
    expect(session).toMatchObject({ minutes_late: 10, business_date: "2026-10-16" });
    vi.setSystemTime(new Date("2026-10-17T02:00:00Z")); // Past cutoff, still an open session.
    const report = await call("/api/seramet/attendance?branchId=" + branchId);
    expect(report.data.records).toHaveLength(1);
    await call("/api/seramet/attendance/supervisor", "POST", supervisor({ action: "OUT" }));
  });
  it("rolls back a new session if its durable audit cannot be written", async () => {
    db.sqlite.exec(
      "CREATE TRIGGER reject_test_event BEFORE INSERT ON employee_attendance_events BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END",
    );
    await expect(call("/api/seramet/attendance/supervisor", "POST", supervisor())).rejects.toThrow(
      /test audit unavailable/,
    );
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_sessions").get()?.count,
    ).toBe(0);
  });
  it("requires an explicitly enabled workplace geofence", async () => {
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        branchId,
        action: "IN",
        idempotencyKey: id(),
        location: freshLocation(),
      }),
    ).rejects.toThrow(/not configured/i);
  });
  it("records geo punches against the authenticated actor, with no precise coordinate retention", async () => {
    expect((await call("/api/seramet/attendance/geofence", "PUT", fence)).status).toBe(200);
    const punchKey = id();
    const first = await call("/api/seramet/attendance/punch", "POST", {
      branchId,
      action: "IN",
      idempotencyKey: punchKey,
      location: freshLocation(),
    });
    expect(first.data.session.employeeId).toBe(actor.id);
    expect(first.data.session.clockInSource).toBe("GEOFENCE");
    expect(first.data.session.clockOutAt).toBeNull();
    const repeat = await call("/api/seramet/attendance/punch", "POST", {
      branchId,
      action: "IN",
      idempotencyKey: punchKey,
      location: freshLocation(),
    });
    expect(repeat.data.repeated).toBe(true);
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        branchId,
        action: "IN",
        idempotencyKey: id(),
        location: freshLocation(),
      }),
    ).rejects.toThrow(/already|open/i);
    const out = await call("/api/seramet/attendance/punch", "POST", {
      branchId,
      action: "OUT",
      idempotencyKey: id(),
      location: freshLocation(),
      sessionId: first.data.session.id,
      expectedVersion: 1,
    });
    expect(out.data.session.clockOutAt).toBeTruthy();
    const audit = db.sqlite
      .prepare(
        "SELECT COUNT(*) count,MAX(accuracy_m) accuracy FROM employee_attendance_events WHERE tenant_id=?",
      )
      .get(tenantId) as { count: number; accuracy: number };
    expect(audit.count).toBe(2);
    expect(audit.accuracy).toBe(2);
    const session = db.sqlite
      .prepare("SELECT * FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=?")
      .get(tenantId, actor.id) as Record<string, unknown>;
    expect(JSON.stringify(session)).not.toContain("-1.264");
  });
  it("rejects stale, inaccurate and outside location claims", async () => {
    await call("/api/seramet/attendance/geofence", "PUT", fence);
    const base = { branchId, action: "IN", idempotencyKey: id() };
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        ...base,
        location: { ...freshLocation(), capturedAt: new Date(Date.now() - 60000).toISOString() },
      }),
    ).rejects.toThrow(/STALE_FIX/);
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        ...base,
        location: { ...freshLocation(), accuracyMeters: 50 },
      }),
    ).rejects.toThrow(/LOW_ACCURACY/);
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        ...base,
        location: { ...freshLocation(), latitude: -1.263 },
      }),
    ).rejects.toThrow(/OUTSIDE_GEOFENCE/);
    const count = db.sqlite
      .prepare("SELECT COUNT(*) count FROM employee_attendance_sessions")
      .get() as { count: number };
    expect(count.count).toBe(0);
  });
  it("never accepts an employeeId supplied to self punch or unauthorized supervisor exception", async () => {
    await call("/api/seramet/attendance/geofence", "PUT", fence);
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        branchId,
        action: "IN",
        idempotencyKey: id(),
        employeeId: "other",
        location: freshLocation(),
      }),
    ).rejects.toThrow(/Invalid attendance request/);
    actor = { ...actor, permissions: [permissions.attendanceUse] };
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", {
        branchId,
        employeeId: actor.id,
        action: "IN",
        idempotencyKey: id(),
        reason: "GPS not available",
      }),
    ).rejects.toThrow(/Staff management/i);
  });
  it("creates auditable supervisor exceptions and blocks concurrent stale corrections", async () => {
    const key = id();
    const start = await call("/api/seramet/attendance/supervisor", "POST", {
      branchId,
      employeeId: actor.id,
      action: "IN",
      idempotencyKey: key,
      reason: "GPS failed inside kitchen",
    });
    expect(start.data.session.clockInSource).toBe("SUPERVISOR");
    const same = await call("/api/seramet/attendance/supervisor", "POST", {
      branchId,
      employeeId: actor.id,
      action: "IN",
      idempotencyKey: key,
      reason: "GPS failed inside kitchen",
    });
    expect(same.data.repeated).toBe(true);
    await call("/api/seramet/attendance/supervisor", "POST", {
      branchId,
      employeeId: actor.id,
      action: "OUT",
      idempotencyKey: id(),
      reason: "Assisted terminal clock out",
      sessionId: start.data.session.id,
      expectedVersion: start.data.session.version,
    });
    const row = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0] as {
      id: string;
      version: number;
      clockInAt: string;
    };
    const correction = new Date(Date.parse(row.clockInAt) - 60000).toISOString();
    const corrected = await call("/api/seramet/attendance/supervisor", "POST", {
      branchId,
      employeeId: actor.id,
      sessionId: row.id,
      action: "CORRECT_IN",
      idempotencyKey: id(),
      reason: "Corrected verified arrival time",
      occurredAt: correction,
      expectedVersion: row.version,
    });
    expect(corrected.data.session.clockInAt).toBe(correction);
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", {
        branchId,
        employeeId: actor.id,
        sessionId: row.id,
        action: "CORRECT_IN",
        idempotencyKey: id(),
        reason: "Second conflicting correction",
        occurredAt: correction,
        expectedVersion: row.version,
      }),
    ).rejects.toThrow(/changed/i);
    const count = db.sqlite
      .prepare("SELECT COUNT(*) count FROM employee_attendance_events WHERE tenant_id=?")
      .get(tenantId) as { count: number };
    expect(count.count).toBe(3);
    await expect(
      db.prepare("DELETE FROM employee_attendance_events WHERE tenant_id=?").bind(tenantId).run(),
    ).rejects.toThrow(/append-only/i);
  });
  it("version-locks geofence and staff schedules, preserving immutable management audit", async () => {
    await call("/api/seramet/attendance/geofence", "PUT", fence);
    await expect(
      call("/api/seramet/attendance/geofence", "PUT", { ...fence, enabled: false }),
    ).rejects.toThrow(/changed/i);
    const current = (await call("/api/seramet/attendance?branchId=" + branchId)).data;
    expect(current.geofence.version).toBe(1);
    const employee = current.employees.find((value: { id: string }) => value.id === actor.id);
    expect(employee).toBeTruthy();
    await call("/api/seramet/attendance/schedule", "PUT", {
      branchId,
      employeeId: actor.id,
      scheduledStart: "09:30",
      expectedVersion: 0,
    });
    await expect(
      call("/api/seramet/attendance/schedule", "PUT", {
        branchId,
        employeeId: actor.id,
        scheduledStart: "10:30",
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/changed/i);
    const after = (await call("/api/seramet/attendance?branchId=" + branchId)).data;
    expect(
      after.employees.find((value: { id: string }) => value.id === actor.id)?.scheduled_start,
    ).toBe("09:30");
    const events = db.sqlite
      .prepare("SELECT COUNT(*) count FROM attendance_management_events WHERE tenant_id=?")
      .get(tenantId) as { count: number };
    expect(events.count).toBe(2);
    await expect(
      db.prepare("DELETE FROM attendance_management_events WHERE tenant_id=?").bind(tenantId).run(),
    ).rejects.toThrow(/append-only/i);
  });

  it("permits split shifts, retains schedule snapshots and appends explanations without hiding arrival", async () => {
    await call("/api/seramet/attendance/geofence", "PUT", fence);
    await call("/api/seramet/attendance/schedule", "PUT", {
      branchId,
      employeeId: actor.id,
      scheduledStart: "08:00",
      scheduledEnd: "17:00",
      expectedVersion: 0,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T05:17:00Z"));
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    let record = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    const firstId = record.id;
    const explanation = supervisor({
      action: "EXPLAIN",
      sessionId: record.id,
      expectedVersion: record.version,
      reason: "Late arrival explained by transport disruption",
    });
    await call("/api/seramet/attendance/supervisor", "POST", explanation);
    expect(
      (await call("/api/seramet/attendance/supervisor", "POST", explanation)).data.repeated,
    ).toBe(true);
    const unchanged = db.sqlite
      .prepare(
        "SELECT clock_in_at,minutes_late,scheduled_end FROM employee_attendance_sessions WHERE id=?",
      )
      .get(firstId);
    expect(unchanged).toMatchObject({
      clock_in_at: "2026-10-18T05:17:00.000Z",
      minutes_late: 17,
      scheduled_end: "17:00",
    });
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"));
    await call("/api/seramet/attendance/supervisor", "POST", supervisor({ action: "OUT" }));
    vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    record = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    expect(record.id).not.toBe(firstId);
    expect(
      db.sqlite
        .prepare("SELECT minutes_late FROM employee_attendance_sessions WHERE id=?")
        .get(record.id)?.minutes_late,
    ).toBeNull();
    await expect(
      call(
        "/api/seramet/attendance/supervisor",
        "POST",
        supervisor({
          action: "CORRECT_IN",
          sessionId: record.id,
          expectedVersion: record.version,
          occurredAt: "2026-10-18T08:00:00Z",
        }),
      ),
    ).rejects.toThrow(/overlaps/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_sessions").get()?.count,
    ).toBe(2);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM attendance_mutation_claims").get()?.count,
    ).toBe(4);
    const history = await handleAttendanceApi(
      request(`/api/seramet/attendance/sessions/${firstId}/history?branchId=${branchId}`),
      { SERAMET_DB: db } as SerametEnv,
    );
    const text = await history!.text();
    expect(text).toContain("Late arrival explained");
    expect(text).not.toContain("request_hash");
    expect(text).not.toContain("request_key");
  });

  it("exports branch-scoped, formula-safe history with an immutable access audit", async () => {
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    db.sqlite
      .prepare("UPDATE users SET name=? WHERE tenant_id=? AND id=?")
      .run('  =IMPORTDATA("bad")', tenantId, actor.id);
    const response = await handleAttendanceApi(
      request(`/api/seramet/attendance/export?branchId=${branchId}`),
      { SERAMET_DB: db } as SerametEnv,
    );
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const csv = await response!.text();
    expect(csv).toContain("'  =IMPORTDATA");
    expect(csv).not.toContain("latitude");
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM attendance_access_events").get()?.count,
    ).toBe(1);
    await expect(db.prepare("DELETE FROM attendance_access_events").run()).rejects.toThrow(
      /append-only/,
    );
    actor = { ...actor, permissions: [permissions.attendanceUse] };
    await expect(
      call(`/api/seramet/attendance/records?branchId=${branchId}&employeeId=another-user`),
    ).rejects.toThrow(/own attendance/);
    await expect(
      call(`/api/seramet/attendance/records?branchId=${branchId}&from=2026-02-30`),
    ).rejects.toThrow(/valid attendance range/);
    await expect(
      call(`/api/seramet/attendance/records?branchId=${branchId}&from=2026-01-01&to=2026-03-01`),
    ).rejects.toThrow(/31 business dates/);
  });

  it("serializes split-shift clock-in against correction of an earlier session", async () => {
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    const record = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    await call("/api/seramet/attendance/supervisor", "POST", supervisor({ action: "OUT" }));
    const closed = (await call("/api/seramet/attendance?branchId=" + branchId)).data.records[0]!;
    const paused = pauseNextBatch();
    const correction = call(
      "/api/seramet/attendance/supervisor",
      "POST",
      supervisor({
        action: "CORRECT_OUT",
        sessionId: record.id,
        expectedVersion: closed.version,
        occurredAt: new Date(Date.now() + 30000).toISOString(),
      }),
    ).catch((error: unknown) => error);
    await paused.waiting;
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    paused.release();
    expect(await correction).toMatchObject({ status: 409 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_events").get()?.count,
    ).toBe(3);
    expect(
      db.sqlite
        .prepare("SELECT version FROM employee_attendance_sessions WHERE id=?")
        .get(record.id)?.version,
    ).toBe(closed.version);
  });

  it("never substitutes another branch's latest personal session", async () => {
    const other = db.sqlite
      .prepare("SELECT id FROM branches WHERE tenant_id=? AND id<>? AND active=1 LIMIT 1")
      .get(tenantId, branchId) as { id: string };
    expect(other).toBeTruthy();
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    db.sqlite
      .prepare(
        "INSERT INTO user_branches(tenant_id,user_id,branch_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(tenantId, actor.id, other.id);
    actor = {
      ...actor,
      assignedBranchIds: [branchId, other.id],
      branchScope: { type: "BRANCH", branchId: other.id },
      branchId: other.id,
    };
    const response = await handleAttendanceApi(
      request(`/api/seramet/attendance?branchId=${other.id}`),
      { SERAMET_DB: db } as SerametEnv,
    );
    expect(await response!.json()).toMatchObject({
      me: null,
      openElsewhere: true,
      branchId: other.id,
    });
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", supervisor({ branchId: other.id })),
    ).rejects.toThrow(/open attendance session/);
  });

  it("never lets a stale clock-out close a newer split shift", async () => {
    await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    const originalOut = supervisor({ action: "OUT" });
    const closed = await call("/api/seramet/attendance/supervisor", "POST", originalOut);
    const next = await call("/api/seramet/attendance/supervisor", "POST", supervisor());
    expect(next.data.session.id).not.toBe(closed.data.session.id);
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", { ...originalOut, idempotencyKey: id() }),
    ).rejects.toThrow(/session changed/);
    const replay = await call("/api/seramet/attendance/supervisor", "POST", originalOut);
    expect(replay.data.repeated).toBe(true);
    expect(replay.data.session.id).toBe(closed.data.session.id);
    expect(
      db.sqlite
        .prepare("SELECT clock_out_at FROM employee_attendance_sessions WHERE id=?")
        .get(next.data.session.id)?.clock_out_at,
    ).toBeNull();
    await expect(
      call("/api/seramet/attendance/supervisor", "POST", {
        branchId,
        employeeId: actor.id,
        action: "OUT",
        reason: "Missing session reference denied",
        idempotencyKey: id(),
      }),
    ).rejects.toThrow(/selected session and version/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) count FROM employee_attendance_events").get()?.count,
    ).toBe(3);
  });

  it("denies legacy attendance transactions that would bypass location enforcement", () => {
    expect(() => authorizeSerametMutation(actor, "clockInEmployee")).toThrow(
      /Legacy attendance mutations are disabled/,
    );
    expect(() => authorizeSerametMutation(actor, "clockOutEmployee")).toThrow(
      /Legacy attendance mutations are disabled/,
    );
  });

  it("cannot modify another tenant or an unassigned branch", async () => {
    await expect(
      call("/api/seramet/attendance/geofence", "PUT", { ...fence, branchId: "branch-other" }),
    ).rejects.toThrow();
    actor = { ...actor, tenantId: "other-tenant" };
    await expect(
      call("/api/seramet/attendance/punch", "POST", {
        branchId,
        action: "IN",
        idempotencyKey: id(),
        location: freshLocation(),
      }),
    ).rejects.toThrow();
  });
});
