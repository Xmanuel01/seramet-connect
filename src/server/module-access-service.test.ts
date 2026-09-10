import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { handleSerametApiRequest } from "@/lib/seramet-api";
import { moduleDecision } from "@/platform/module-access-registry";
import { permissions } from "@/platform/permissions";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import type { SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { replaceRolePermissions, resolveServerModuleAccess } from "@/server/module-access-service";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";

describe.sequential("server-authoritative module access", () => {
  let db: SqliteD1TestDatabase;

  beforeEach(() => {
    db = createDemoFixtureDatabase();
  });

  afterEach(() => {
    db.close();
    setConfigurationRepositoryForTests();
  });

  it("persists the current schema and revisions every access-bearing assignment mutation", () => {
    expect(db.sqlite.prepare("SELECT MAX(version) version FROM schema_migrations").get()).toEqual({
      version: 17,
    });
    const before = revision();
    insertScopedUser("revision-user", [permissions.dashboardView]);
    const afterInsert = revision();
    expect(afterInsert).toBeGreaterThan(before);
    db.sqlite
      .prepare("DELETE FROM user_roles WHERE tenant_id=? AND user_id=?")
      .run(tenantId, "revision-user");
    expect(revision()).toBeGreaterThan(afterInsert);
  });

  it("falls back safely for a legacy all-branch tenant with no hierarchy nodes", async () => {
    const legacyTenantId = "tenant-legacy-without-hierarchy";
    db.sqlite
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,?,'Africa/Nairobi','en-KE',1,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      )
      .run(legacyTenantId, "legacy-no-hierarchy", "Legacy tenant", "Legacy tenant", "KES");
    const profile = await resolveServerModuleAccess(db, {
      ...actor([permissions.dashboardView, permissions.tenantScopeAllBranches]),
      tenantId: legacyTenantId,
    });
    expect(moduleDecision(profile, "dashboard")?.route).toBe(true);
    expect(moduleDecision(profile, "dashboard")?.authorizedScopes).toContain("BRANCH");
  });

  it("does not let branch scope climb into HQ even when the permission code is present", async () => {
    const profile = await resolveServerModuleAccess(
      db,
      actor([permissions.enterpriseView], "branch-only-user"),
    );
    expect(moduleDecision(profile, "hq-command")?.route).toBe(false);
    expect(moduleDecision(profile, "hq-command")?.reasons).toContain("ORGANIZATIONAL_SCOPE_DENIED");
  });

  it("honors active hierarchy assignments but excludes expired temporary access", async () => {
    insertScopedUser("temporary-user", [permissions.enterpriseView], false);
    insertEnterpriseAssignment(
      "temporary-active",
      "temporary-user",
      "enterprise-demo-region",
      "2026-01-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
    );
    const active = await resolveServerModuleAccess(
      db,
      actor([permissions.enterpriseView], "temporary-user", []),
      "2026-01-15T00:00:00.000Z",
    );
    const expired = await resolveServerModuleAccess(
      db,
      actor([permissions.enterpriseView], "temporary-user", []),
      "2026-02-02T00:00:00.000Z",
    );
    expect(moduleDecision(active, "hq-command")?.route).toBe(true);
    expect(moduleDecision(expired, "hq-command")?.route).toBe(false);
  });

  it("applies authoritative module policy and commercial entitlement constraints", async () => {
    db.sqlite
      .prepare(
        "UPDATE feature_entitlements SET enabled=0 WHERE tenant_id=? AND feature_key='intelligence.basic'",
      )
      .run(tenantId);
    db.sqlite.exec(`
      INSERT INTO enterprise_policy_definitions
        (tenant_id,id,code,name,category,value_schema_json,sensitive,active,created_by,created_at,updated_at)
      VALUES
        ('${tenantId}','module-policy-inventory','MODULE_ACCESS.INVENTORY','Inventory module','ACCESS','{}',0,1,'test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
      INSERT INTO enterprise_policy_assignments
        (tenant_id,id,policy_id,scope_node_id,value_json,state,approval_policy_json,effective_from,version,created_by,created_at)
      VALUES
        ('${tenantId}','module-policy-inventory-root','module-policy-inventory','enterprise-demo-group','false','LOCKED','{}','2026-01-01T00:00:00.000Z',1,'test',CURRENT_TIMESTAMP);
    `);
    const manager = actor(
      [permissions.inventoryView, permissions.intelligenceAsk, permissions.tenantScopeAllBranches],
      "user-demo-emmanuel-obiambo",
      [branchId],
    );
    const profile = await resolveServerModuleAccess(db, manager, "2026-09-09T00:00:00.000Z");
    expect(moduleDecision(profile, "inventory")?.route).toBe(false);
    expect(moduleDecision(profile, "inventory")?.reasons).toContain("POLICY_DENIED");
    expect(moduleDecision(profile, "ai")?.route).toBe(false);
    expect(moduleDecision(profile, "ai")?.reasons).toContain("ENTITLEMENT_REQUIRED");
  });

  it("replaces role permissions atomically, audits the change and increments revision", async () => {
    const before = revision();
    const result = await replaceRolePermissions({
      db,
      actor: actor([permissions.enterpriseAccessManage]),
      roleId: "role-demo-branch-manager",
      permissionCodes: [permissions.dashboardView, permissions.posAccess],
      reason: "Align branch access with operating responsibilities",
    });
    expect(result.unchanged).toBe(false);
    expect(result.accessRevision).toBeGreaterThan(before);
    const stored = db.sqlite
      .prepare(
        "SELECT permission_code FROM role_permissions WHERE tenant_id=? AND role_id=? ORDER BY permission_code",
      )
      .all(tenantId, "role-demo-branch-manager") as Array<{ permission_code: string }>;
    expect(stored.map((row) => row.permission_code)).toEqual([
      permissions.dashboardView,
      permissions.posAccess,
    ]);
    const audit = db.sqlite
      .prepare(
        "SELECT reason,metadata_json FROM audit_events WHERE tenant_id=? AND action='ROLE_PERMISSIONS_CHANGED' ORDER BY created_at DESC LIMIT 1",
      )
      .get(tenantId) as { reason: string; metadata_json: string };
    expect(audit.reason).toMatch(/operating responsibilities/i);
    expect(JSON.parse(audit.metadata_json)).toMatchObject({
      added: [],
      removed: expect.arrayContaining([permissions.enterpriseView]),
    });
  });

  it("constrains delegated administrators from adding or removing authority they lack", async () => {
    await expect(
      replaceRolePermissions({
        db,
        actor: actor([permissions.settingsRoleManage, permissions.dashboardView]),
        roleId: "role-demo-branch-manager",
        permissionCodes: [permissions.dashboardView],
        reason: "Attempt an authority change outside delegated rights",
      }),
    ).rejects.toThrow(/outside their delegated authority/i);
  });

  it("denies a branch-only actor through the direct enterprise API boundary", async () => {
    insertScopedUser("api-branch-only", [permissions.enterpriseView]);
    await hydrateAuthoritativeConfiguration(db, {}, true);
    const response = await handleSerametApiRequest(
      new Request("http://localhost/api/seramet/enterprise/overview", {
        headers: developmentHeaders("api-branch-only"),
      }),
      {
        SERAMET_ENVIRONMENT: "development",
        SERAMET_ENABLE_DEV_AUTH: "true",
        SERAMET_DB: db,
      },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/module permission|scope/i),
    });
  });

  it.each([
    apiActorCase("Waiter", permissions.ordersView, "orders", "audit"),
    apiActorCase("Cashier", permissions.paymentsView, "payments", "inventoryMovements"),
    apiActorCase("Supervisor", permissions.inventoryView, "inventoryMovements", "payments"),
    apiActorCase("Branch Manager", permissions.invoicesView, "invoices", "audit"),
    apiActorCase("Regional Manager", permissions.ordersView, "orders", "payments"),
    apiActorCase("General Manager", permissions.auditView, "audit", "payments"),
    apiActorCase("CFO", permissions.paymentsView, "payments", "orders"),
    apiActorCase("Owner", permissions.auditView, "audit", "inventoryMovements"),
    apiActorCase("Franchisee", permissions.inventoryView, "inventoryMovements", "audit"),
  ])(
    "$label API reads allow the configured module and reject an ungranted module",
    async ({ label, permissionCode, allowedCollection, deniedCollection }) => {
      const userId = `api-matrix-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
      insertScopedUser(userId, [permissionCode]);
      await hydrateAuthoritativeConfiguration(db, {}, true);
      const allowed = await handleSerametApiRequest(
        new Request(
          `http://localhost/api/seramet/query/${allowedCollection}?branchId=${branchId}`,
          { headers: developmentHeaders(userId) },
        ),
        developmentEnvironment(db),
      );
      const denied = await handleSerametApiRequest(
        new Request(`http://localhost/api/seramet/query/${deniedCollection}?branchId=${branchId}`, {
          headers: developmentHeaders(userId),
        }),
        developmentEnvironment(db),
      );
      expect(allowed.status).toBe(200);
      expect(denied.status).toBe(403);
    },
  );

  function revision() {
    return Number(
      (
        db.sqlite
          .prepare("SELECT revision FROM access_control_revisions WHERE tenant_id=?")
          .get(tenantId) as { revision: number }
      ).revision,
    );
  }

  function insertScopedUser(id: string, permissionCodes: string[], includeBranch = true) {
    const roleId = `role-${id}`;
    db.sqlite
      .prepare(
        "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      )
      .run(tenantId, roleId, roleId.toUpperCase(), "Configured scoped role");
    db.sqlite
      .prepare(
        "INSERT INTO users (tenant_id,id,name,active,payload_json,created_at,updated_at) VALUES (?,?,?,1,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
      )
      .run(tenantId, id, "Configured scoped user");
    for (const code of permissionCodes) {
      db.sqlite
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .run(tenantId, roleId, code);
    }
    db.sqlite
      .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
      .run(tenantId, id, roleId);
    if (includeBranch) {
      db.sqlite
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .run(tenantId, id, branchId);
    }
  }

  function insertEnterpriseAssignment(
    id: string,
    userId: string,
    scopeNodeId: string,
    validFrom: string,
    validUntil: string,
  ) {
    db.sqlite
      .prepare(
        `INSERT INTO enterprise_role_assignments
          (tenant_id,id,user_id,role_id,scope_node_id,descend_to_children,effect,valid_from,
           valid_until,granted_by,reason,created_at)
         VALUES (?,?,?,?,?,1,'ALLOW',?,?,?,'Temporary access test',CURRENT_TIMESTAMP)`,
      )
      .run(
        tenantId,
        id,
        userId,
        `role-${userId}`,
        scopeNodeId,
        validFrom,
        validUntil,
        "user-demo-emmanuel-obiambo",
      );
  }
});

function actor(
  permissionCodes: string[],
  id = "access-manager",
  branches = [branchId],
): ServerActor {
  return {
    id,
    name: "Configured access actor",
    tenantId,
    roleIds: [],
    permissions: permissionCodes,
    assignedBranchIds: branches,
    assignedBranches: branches.map((branch) => ({ id: branch, name: branch })),
    branchScope: branches.length
      ? { type: "BRANCH", branchId: branches[0]! }
      : { type: "BRANCH", branchId },
    branchId,
    role: "Arbitrary display role",
    branch: "Configured branch",
  };
}

function developmentHeaders(userId: string) {
  return {
    "x-seramet-dev-auth": "enabled",
    "x-seramet-user-id": userId,
    "x-seramet-tenant-id": tenantId,
    "x-seramet-branch-id": branchId,
  };
}

function apiActorCase(
  label: string,
  permissionCode: string,
  allowedCollection: string,
  deniedCollection: string,
) {
  return { label, permissionCode, allowedCollection, deniedCollection };
}

function developmentEnvironment(db: SqliteD1TestDatabase) {
  return {
    SERAMET_ENVIRONMENT: "development",
    SERAMET_ENABLE_DEV_AUTH: "true",
    SERAMET_DB: db,
  } as const;
}
