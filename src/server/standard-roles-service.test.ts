import { afterEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { accountOwnerPermissions, standardRoles } from "@/platform/standard-roles";
import type { PermissionCode } from "@/platform/types";
import { createDemoFixtureDatabase } from "@/server/database/local-development-database";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { RestaurantRegistrationService } from "@/server/registration-service";
import { installStandardRoles } from "@/server/settings-configuration-service";

let db: SqliteD1TestDatabase | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

async function roles(tenantId: string) {
  const rows = await db!
    .prepare("SELECT id,code FROM roles WHERE tenant_id=? ORDER BY code")
    .bind(tenantId)
    .all<{ id: string; code: string }>();
  return rows.results ?? [];
}

async function rolePermissions(tenantId: string, code: string) {
  const rows = await db!
    .prepare(
      `SELECT rp.permission_code FROM role_permissions rp
       JOIN roles r ON r.tenant_id=rp.tenant_id AND r.id=rp.role_id
       WHERE rp.tenant_id=? AND r.code=? ORDER BY rp.permission_code`,
    )
    .bind(tenantId, code)
    .all<{ permission_code: string }>();
  return (rows.results ?? []).map((row) => row.permission_code);
}

describe("standard staff roles", () => {
  it("are all assignable by an account owner", () => {
    expect(standardRoles.map((role) => role.code)).toEqual([
      "CHEF",
      "HEAD_CHEF",
      "BARTENDER",
      "CASHIER",
      "SUPERVISOR",
    ]);
    for (const role of standardRoles) {
      expect(role.permissions.length).toBeGreaterThan(0);
      expect(role.permissions.every((code) => accountOwnerPermissions.includes(code))).toBe(true);
    }
  });

  it("come with every new restaurant, alongside the account owner", async () => {
    db = createMigratedTestDatabase();
    const { tenantId } = await new RestaurantRegistrationService(db).register(
      {
        provider: "supabase",
        subject: "standard-roles-owner",
        sessionId: "supabase:standard-roles",
        email: "owner@example.test",
        emailVerified: true,
        issuedAt: Math.floor(Date.now() / 1000) - 60,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      {
        idempotencyKey: "standard-roles-registration-0001",
        administratorName: "Restaurant Owner",
        slug: "standard-roles-kitchen",
        legalName: "Standard Roles Kitchen Limited",
        tradingName: "Standard Roles Kitchen",
        countryCode: "KE",
        currency: "KES",
        timezone: "Africa/Nairobi",
        locale: "en-KE",
        brandCode: "PRIMARY",
        brandName: "Standard Roles Kitchen",
        branchCode: "MAIN",
        branchName: "Main Branch",
        businessDayCutoffMinutes: 240,
        negativeStockPolicy: "MANAGER_OVERRIDE",
        serviceModes: ["DINE_IN", "TAKEAWAY"],
      },
    );
    expect((await roles(tenantId)).map((role) => role.code).sort()).toEqual(
      ["ACCOUNT_OWNER", ...standardRoles.map((role) => role.code)].sort(),
    );
    for (const role of standardRoles)
      expect(await rolePermissions(tenantId, role.code)).toEqual([...role.permissions].sort());
  });

  it("are added to an existing restaurant without touching roles it already has", async () => {
    db = createDemoFixtureDatabase();
    const tenantId = "tenant-demo-mona";
    // A Cashier role the restaurant made itself, with its own permissions.
    await db.batch([
      db
        .prepare(
          "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
        )
        .bind(tenantId, "role-own-cashier", "CASHIER", "Cashier"),
      db
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .bind(tenantId, "role-own-cashier", permissions.posAccess),
    ]);
    const before = await roles(tenantId);
    const existing = new Set(before.map((role) => role.code));
    const missing = standardRoles.filter((role) => !existing.has(role.code));
    const kept = standardRoles.find((role) => existing.has(role.code));
    expect(missing.length).toBeGreaterThan(0);
    expect(kept).toBeTruthy();
    const keptPermissions = await rolePermissions(tenantId, kept!.code);

    const first = await installStandardRoles(db, actor(tenantId), { reason: "Add staff roles" });
    expect(first.added.sort()).toEqual(missing.map((role) => role.code).sort());
    expect(await rolePermissions(tenantId, kept!.code)).toEqual(keptPermissions);
    for (const role of missing)
      expect(await rolePermissions(tenantId, role.code)).toEqual([...role.permissions].sort());

    const again = await installStandardRoles(db, actor(tenantId), { reason: "Add staff roles" });
    expect(again.added).toEqual([]);
    expect((await roles(tenantId)).length).toBe(before.length + missing.length);
  });

  it("need role management permission", async () => {
    db = createDemoFixtureDatabase();
    const tenantId = "tenant-demo-mona";
    const before = (await roles(tenantId)).length;
    await expect(
      installStandardRoles(db, actor(tenantId, []), { reason: "Add staff roles" }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await roles(tenantId)).length).toBe(before);
  });
});

function actor(
  tenantId: string,
  granted: PermissionCode[] = [permissions.settingsRoleManage],
): ServerActor {
  const branchId = "branch-demo-westlands";
  return {
    id: "standard-roles-actor",
    name: "Standard roles actor",
    tenantId,
    roleIds: [],
    permissions: granted,
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Westlands" }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    role: "Settings administrator",
    branch: "Westlands",
  };
}
