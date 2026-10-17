import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
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
  return { status: res.status, data: (await res.json()) as Record<string, any> };
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
  afterEach(() => db.close());
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
