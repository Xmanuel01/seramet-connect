import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import { handleAttendanceDelays } from "@/server/attendance-delay-api";
import type { ServerActor } from "@/lib/seramet-auth";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
describe("durable arrival delay requests", () => {
  let db: SqliteD1TestDatabase;
  let actor: ServerActor;
  let managed = false;
  const tenant = "tenant-demo-mona",
    branch = "branch-demo-westlands";
  beforeEach(() => {
    db = createDemoFixtureDatabase();
    managed = false;
    const user = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? ORDER BY id LIMIT 1")
      .get(tenant) as { id: string };
    actor = {
      id: user.id,
      name: "Employee",
      tenantId: tenant,
      branchId: branch,
      branch: "Westlands",
      branchScope: { type: "BRANCH", branchId: branch },
      assignedBranches: [{ id: branch, name: "Westlands" }],
      assignedBranchIds: [branch],
      role: "Employee",
      roleIds: [],
      permissions: [],
    };
    db.sqlite
      .prepare(
        "INSERT INTO users(tenant_id,id,name,created_at,updated_at) VALUES(?,'disposable-supervisor','Supervisor',?,?)",
      )
      .run(tenant, new Date().toISOString(), new Date().toISOString());
  });
  afterEach(() => db.close());
  const body = () => ({
    branchId: branch,
    idempotencyKey: crypto.randomUUID(),
    expectedArrivalAt: new Date(Date.now() + 1800000).toISOString(),
    reason: "Transport delayed at the station",
  });
  async function call(path = "", method = "GET", data?: unknown) {
    const response = await handleAttendanceDelays(
      new Request("http://localhost/api/seramet/attendance/delays" + path, {
        method,
        ...(data ? { body: JSON.stringify(data) } : {}),
      }),
      actor,
      db,
      async (id) => {
        if (id !== branch) throw Error("scope denied");
        return {
          actor,
          db,
          branch: { id: branch, timezone: "Africa/Nairobi", business_day_cutoff_minutes: 240 },
        };
      },
      managed,
    );
    if (!response) throw Error("not routed");
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  it("persists outside-site notices without GPS or attendance and rejects altered replay", async () => {
    const request = body();
    const first = await call("", "POST", request);
    expect(first.status).toBe(201);
    expect((await call("", "POST", request)).body.repeated).toBe(true);
    await expect(
      call("", "POST", { ...request, reason: "Changed content under original key" }),
    ).rejects.toThrow(/different details/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) total FROM employee_attendance_sessions").get(),
    ).toMatchObject({ total: 0 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) total FROM attendance_delay_events").get(),
    ).toMatchObject({ total: 1 });
    await expect(call("", "POST", body())).rejects.toThrow(/pending delay request/);
  });
  it("requires supervisor review, denies self approval and preserves one durable decision", async () => {
    const id = String((await call("", "POST", body())).body.id);
    const command = {
      branchId: branch,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      status: "APPROVED",
      note: "Noted, travel safely",
    };
    await expect(call(`/${id}/decision`, "POST", command)).rejects.toThrow(/Supervisor permission/);
    managed = true;
    await expect(call(`/${id}/decision`, "POST", command)).rejects.toThrow(/own delay/);
    const supervisor = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? AND id<>? LIMIT 1")
      .get(tenant, actor.id) as { id: string };
    actor = { ...actor, id: supervisor.id };
    expect((await call()).body.unread).toBe(1);
    await call(`/${id}/read`, "POST", { branchId: branch });
    expect((await call()).body.unread).toBe(0);
    await call(`/${id}/decision`, "POST", command);
    expect((await call(`/${id}/decision`, "POST", command)).body.repeated).toBe(true);
    await expect(
      call(`/${id}/decision`, "POST", {
        ...command,
        idempotencyKey: crypto.randomUUID(),
        status: "REJECTED",
      }),
    ).rejects.toThrow(/request changed/);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) total FROM attendance_delay_events").get(),
    ).toMatchObject({ total: 2 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) total FROM employee_attendance_events").get(),
    ).toMatchObject({ total: 0 });
  });
  it("scopes own reads and rejects another tenant or branch decision", async () => {
    const id = String((await call("", "POST", body())).body.id);
    const other = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? AND id<>? LIMIT 1")
      .get(tenant, actor.id) as { id: string };
    actor = { ...actor, id: other.id };
    expect((await call()).body.requests).toEqual([]);
    managed = true;
    actor = { ...actor, tenantId: "another-tenant" };
    await expect(call(`/${id}/read`, "POST", { branchId: branch })).rejects.toThrow(/not found/);
    await expect(call(`/${id}/read`, "POST", { branchId: "another-branch" })).rejects.toThrow(
      /scope denied/,
    );
  });
});
