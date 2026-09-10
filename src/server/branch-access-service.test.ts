import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authenticateSerametRequest, type ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { replaceUserBranchAssignments } from "@/server/branch-access-service";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const westlands = "branch-demo-westlands";
const ngongRoad = "branch-demo-ngong-road";
const userId = "branch-context-user";

describe.sequential("authoritative branch context", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(async () => {
    db = createDemoFixtureDatabase();
    activeDatabase = db;
    insertUser([permissions.dashboardView, permissions.tenantScopeAllBranches]);
    await hydrateAuthoritativeConfiguration(db, developmentEnvironment(), true);
  });

  afterEach(() => {
    db.close();
    activeDatabase = undefined;
    setConfigurationRepositoryForTests();
  });

  it("selects the primary branch automatically and rejects a stale branch header", async () => {
    const actor = await authenticateSerametRequest(requestFor(westlands), developmentEnvironment());
    expect(actor.branchId).toBe(westlands);
    expect(actor.primaryBranchId).toBe(westlands);

    await expect(
      authenticateSerametRequest(requestFor(ngongRoad), developmentEnvironment()),
    ).rejects.toThrow(/branch switching permission is required/i);
  });

  it("does not let broad reporting scope silently enable branch switching", async () => {
    await expect(
      authenticateSerametRequest(requestFor(westlands, true), developmentEnvironment()),
    ).rejects.toThrow(/all-branch scope requires branch switching authority/i);
  });

  it("allows an explicitly authorized user to switch only among assigned branches", async () => {
    db.sqlite
      .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
      .run(tenantId, `role-${userId}`, permissions.branchSwitch);
    await hydrateAuthoritativeConfiguration(db, developmentEnvironment(), true);

    const actor = await authenticateSerametRequest(requestFor(ngongRoad), developmentEnvironment());
    expect(actor.branchId).toBe(ngongRoad);
    expect(actor.primaryBranchId).toBe(westlands);
  });

  it("uses normalized permission and assignment tables instead of stale JSON payloads", async () => {
    db.sqlite
      .prepare("UPDATE roles SET payload_json=? WHERE tenant_id=? AND id=?")
      .run('{"permissions":[]}', tenantId, `role-${userId}`);
    db.sqlite
      .prepare("UPDATE users SET payload_json=? WHERE tenant_id=? AND id=?")
      .run('{"roleIds":[],"assignedBranchIds":[]}', tenantId, userId);
    await hydrateAuthoritativeConfiguration(db, developmentEnvironment(), true);

    const actor = await authenticateSerametRequest(requestFor(westlands), developmentEnvironment());
    expect(actor.permissions).toContain(permissions.dashboardView);
    expect(actor.roleIds).toEqual([`role-${userId}`]);
    expect(actor.assignedBranchIds).toEqual([westlands, ngongRoad]);
  });

  it("replaces assignments atomically, changes the primary branch and writes audit history", async () => {
    const before = revision();
    const result = await replaceUserBranchAssignments(db, manager(), {
      userId,
      assignedBranchIds: [ngongRoad],
      primaryBranchId: ngongRoad,
      reason: "Transferred to the Ngong Road operating branch",
    });
    expect(result.primaryBranchId).toBe(ngongRoad);
    expect(result.accessRevision).toBeGreaterThan(before);
    expect(
      db.sqlite
        .prepare("SELECT branch_id FROM user_branches WHERE tenant_id=? AND user_id=?")
        .all(tenantId, userId),
    ).toEqual([{ branch_id: ngongRoad }]);
    expect(
      db.sqlite
        .prepare("SELECT branch_id FROM user_primary_branches WHERE tenant_id=? AND user_id=?")
        .get(tenantId, userId),
    ).toEqual({ branch_id: ngongRoad });
    const audit = db.sqlite
      .prepare(
        "SELECT reason,metadata_json FROM audit_events WHERE tenant_id=? AND action='USER_BRANCH_ASSIGNMENT_CHANGED' AND entity_id=?",
      )
      .get(tenantId, userId) as { reason: string; metadata_json: string };
    expect(audit.reason).toMatch(/transferred/i);
    expect(JSON.parse(audit.metadata_json)).toMatchObject({
      previousPrimaryBranchId: westlands,
      primaryBranchId: ngongRoad,
      assignedBranchIds: [ngongRoad],
    });
  });

  it("rejects branch assignment changes outside the manager's scope", async () => {
    await expect(
      replaceUserBranchAssignments(db, manager([permissions.usersManage], [westlands]), {
        userId,
        assignedBranchIds: [ngongRoad],
        primaryBranchId: ngongRoad,
        reason: "Attempted out-of-scope transfer",
      }),
    ).rejects.toThrow(/outside the actor's scope/i);
  });

  function insertUser(permissionCodes: string[]) {
    const stamp = "2026-09-09T08:00:00.000Z";
    db.sqlite
      .prepare(
        "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      )
      .run(tenantId, `role-${userId}`, "BRANCH_CONTEXT", "Branch context user");
    for (const permission of permissionCodes) {
      db.sqlite
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .run(tenantId, `role-${userId}`, permission);
    }
    db.sqlite
      .prepare(
        `INSERT INTO users
          (tenant_id,id,email,name,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,1,'{}',?,?)`,
      )
      .run(tenantId, userId, "branch-context@test.local", "Branch Context User", stamp, stamp);
    db.sqlite
      .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
      .run(tenantId, userId, `role-${userId}`);
    db.sqlite
      .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?),(?,?,?)")
      .run(tenantId, userId, westlands, tenantId, userId, ngongRoad);
    db.sqlite
      .prepare(
        `INSERT INTO user_primary_branches
          (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(tenantId, userId, westlands, "test", stamp, "Test primary branch");
  }

  function revision() {
    return Number(
      (
        db.sqlite
          .prepare("SELECT revision FROM access_control_revisions WHERE tenant_id=?")
          .get(tenantId) as { revision: number }
      ).revision,
    );
  }
});

function requestFor(branchId: string, allScope = false) {
  return new Request("http://localhost/api/seramet/auth/session", {
    headers: {
      "x-seramet-dev-auth": "enabled",
      "x-seramet-tenant-id": tenantId,
      "x-seramet-user-id": userId,
      "x-seramet-branch-id": branchId,
      ...(allScope ? { "x-seramet-branch-scope": "ALL" } : {}),
    },
  });
}

function manager(
  permissionCodes = [permissions.usersManage, permissions.tenantScopeAllBranches],
  assignedBranchIds = [westlands, ngongRoad],
): ServerActor {
  const primaryBranchId = assignedBranchIds[0];
  return {
    id: "branch-access-manager",
    name: "Branch Access Manager",
    tenantId,
    roleIds: [],
    permissions: permissionCodes,
    assignedBranchIds,
    assignedBranches: assignedBranchIds.map((id) => ({ id, name: id })),
    ...(primaryBranchId ? { primaryBranchId } : {}),
    branchScope: { type: "BRANCH", branchId: assignedBranchIds[0]! },
    branchId: assignedBranchIds[0]!,
    role: "Configured manager",
    branch: assignedBranchIds[0]!,
  };
}

function developmentEnvironment() {
  return {
    SERAMET_ENVIRONMENT: "development",
    SERAMET_ENABLE_DEV_AUTH: "true",
    SERAMET_DB: dbReference(),
  };
}

let activeDatabase: SqliteD1TestDatabase | undefined;
function dbReference() {
  if (!activeDatabase) throw new Error("Test database is not available");
  return activeDatabase;
}
