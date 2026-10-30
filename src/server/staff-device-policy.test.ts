import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { applyStaffDevicePolicy } from "@/server/staff-device-policy";
import { staffStationAccess } from "@/server/staff-station-access";
import { staffRolePresets } from "@/platform/staff-role-presets";
import { permissions, allPermissionCodes } from "@/platform/permissions";
import { authorizeSerametMutation, type ServerActor, type SerametEnv } from "@/lib/seramet-auth";
import { roleCanAccessPath } from "@/components/app/nav";
describe("staff device and station policy", () => {
  let db: SqliteD1TestDatabase, actor: ServerActor;
  const tenant = "tenant-demo-mona",
    branch = "branch-demo-westlands";
  beforeEach(() => {
    db = createDemoFixtureDatabase();
    const user = db.sqlite
      .prepare("SELECT id FROM users WHERE tenant_id=? LIMIT 1")
      .get(tenant) as { id: string };
    db.sqlite
      .prepare("INSERT INTO user_branches VALUES(?,?,?) ON CONFLICT DO NOTHING")
      .run(tenant, user.id, branch);
    actor = {
      id: user.id,
      name: "Disposable",
      tenantId: tenant,
      branchId: branch,
      branch: "Westlands",
      authLevel: "FULL",
      role: "Configured role",
      roleIds: [],
      permissions: allPermissionCodes,
      assignedBranches: [{ id: branch, name: "Westlands" }],
      assignedBranchIds: [branch],
      branchScope: { type: "BRANCH", branchId: branch },
    };
  });
  afterEach(() => db.close());
  it("strips sales writes from phone accounts and rejects revoked, wrong-type and cross-branch devices", async () => {
    let phone = await applyStaffDevicePolicy(actor, db);
    expect(phone.salesTerminal).toBe(false);
    expect(phone.permissions).not.toContain(permissions.ordersCreate);
    expect(phone.permissions).not.toContain(permissions.paymentsCollect);
    expect(phone.permissions).toContain(permissions.attendanceUse);
    const id = crypto.randomUUID();
    db.sqlite
      .prepare(
        "INSERT INTO hardware_devices(tenant_id,id,branch_id,device_type,name,trust_status,lifecycle_state,registered_at,payload_json) VALUES(?,?,?,'POS_TERMINAL','Disposable','ACTIVE','ACTIVE',?,'{}')",
      )
      .run(tenant, id, branch, new Date().toISOString());
    expect((await applyStaffDevicePolicy({ ...actor, deviceId: id }, db)).salesTerminal).toBe(true);
    const other = db.sqlite
      .prepare("SELECT id FROM branches WHERE tenant_id=? AND id<>? LIMIT 1")
      .get(tenant, branch) as { id: string };
    db.sqlite.prepare("UPDATE hardware_devices SET branch_id=? WHERE id=?").run(other.id, id);
    expect((await applyStaffDevicePolicy({ ...actor, deviceId: id }, db)).salesTerminal).toBe(
      false,
    );
    db.sqlite.prepare("UPDATE hardware_devices SET branch_id=? WHERE id=?").run(branch, id);
    db.sqlite.prepare("UPDATE hardware_devices SET device_type='KDS' WHERE id=?").run(id);
    expect((await applyStaffDevicePolicy({ ...actor, deviceId: id }, db)).salesTerminal).toBe(
      false,
    );
    db.sqlite.prepare("UPDATE hardware_devices SET trust_status='REVOKED' WHERE id=?").run(id);
    phone = await applyStaffDevicePolicy({ ...actor, deviceId: id }, db);
    expect(phone.salesTerminal).toBe(false);
  });
  it("lets only the active account owner sell from an unenrolled browser", async () => {
    const owner = (status: string, tenantId = tenant, userId = actor.id) =>
      db.sqlite
        .prepare(
          `INSERT INTO account_owners (tenant_id,user_id,status,granted_by,granted_at,ended_at,reason,metadata_json)
           VALUES (?,?,?,?,?,NULL,'test','{}')
           ON CONFLICT DO UPDATE SET status=excluded.status`,
        )
        .run(tenantId, userId, status, actor.id, new Date().toISOString());
    const canSeePos = (granted: ServerActor) =>
      roleCanAccessPath(granted.role, "/pos", granted.branch, granted.permissions, tenant);

    // Every permission, but not the owner: still needs an enrolled terminal.
    const manager = await applyStaffDevicePolicy(actor, db);
    expect(manager.salesTerminal).toBe(false);
    expect(manager.permissions).not.toContain(permissions.posAccess);
    expect(canSeePos(manager)).toBe(false);
    expect(() => authorizeSerametMutation(manager, "createOrder", tenant, branch)).toThrow(
      /enrolled sales terminal/,
    );

    // Owning a different restaurant grants nothing here.
    const other = db.sqlite.prepare("SELECT id FROM tenants WHERE id<>? LIMIT 1").get(tenant) as
      { id: string } | undefined;
    if (other) {
      owner("ACTIVE", other.id);
      expect((await applyStaffDevicePolicy(actor, db)).salesTerminal).toBe(false);
    }

    owner("ACTIVE");
    const active = await applyStaffDevicePolicy(actor, db);
    expect(active.salesTerminal).toBe(true);
    expect(active.permissions).toEqual(actor.permissions);
    expect(canSeePos(active)).toBe(true);
    expect(() => authorizeSerametMutation(active, "createOrder", tenant, branch)).not.toThrow();
    const otherBranch = db.sqlite
      .prepare("SELECT id FROM branches WHERE tenant_id=? AND id<>? LIMIT 1")
      .get(tenant, branch) as { id: string };
    expect(() =>
      authorizeSerametMutation(
        { ...active, assignedBranchIds: [branch, otherBranch.id] },
        "createOrder",
        tenant,
        otherBranch.id,
      ),
    ).toThrow(/active branch/);

    // Ownership handed over: back to terminal-only selling.
    const successor = crypto.randomUUID();
    const stamp = new Date().toISOString();
    db.sqlite
      .prepare(
        "INSERT INTO users (tenant_id,id,email,name,created_at,updated_at) VALUES (?,?,NULL,'Successor',?,?)",
      )
      .run(tenant, successor, stamp, stamp);
    owner("ACTIVE", tenant, successor);
    owner("TRANSFERRED");
    const former = await applyStaffDevicePolicy(actor, db);
    expect(former.salesTerminal).toBe(false);
    expect(canSeePos(former)).toBe(false);
  });
  it("assigns real branch stations with revision conflict and durable audit", async () => {
    const station = db.sqlite
      .prepare("SELECT id FROM stations WHERE tenant_id=? AND branch_id=? LIMIT 1")
      .get(tenant, branch) as { id: string };
    const payload = { branchId: branch, stationIds: [station.id], expectedVersion: 0 };
    const req = () =>
      new Request("http://localhost/api", { method: "PUT", body: JSON.stringify(payload) });
    await staffStationAccess(req(), { SERAMET_DB: db } as SerametEnv, actor, actor.id);
    await expect(
      staffStationAccess(req(), { SERAMET_DB: db } as SerametEnv, actor, actor.id),
    ).rejects.toThrow(/changed/);
    const chef = await applyStaffDevicePolicy(
      { ...actor, permissions: staffRolePresets.chef!.permissions },
      db,
    );
    expect(chef.kitchenStationIds).toEqual([station.id]);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) total FROM staff_access_events WHERE entity_type='STATION_ACCESS'",
        )
        .get(),
    ).toMatchObject({ total: 1 });
    await expect(
      staffStationAccess(
        new Request("http://localhost/api", {
          method: "PUT",
          body: JSON.stringify({ ...payload, stationIds: ["wrong-station"], expectedVersion: 1 }),
        }),
        { SERAMET_DB: db } as SerametEnv,
        actor,
        actor.id,
      ),
    ).rejects.toThrow(/not active/);
  });
  it("makes attendance universal without granting ordinary roles approval or financial administration", () => {
    for (const preset of Object.values(staffRolePresets))
      expect(preset.permissions).toContain(permissions.attendanceUse);
    for (const key of ["chef", "headChef", "bartender"]) {
      const role = staffRolePresets[key]!;
      expect(role.permissions).not.toContain(permissions.paymentsRecord);
      expect(role.permissions).not.toContain(permissions.usersManage);
      expect(role.permissions).not.toContain(permissions.procurementRequisitionApprove);
    }
    expect(staffRolePresets.headChef!.permissions).toContain(permissions.cookbookPublish);
  });
});
