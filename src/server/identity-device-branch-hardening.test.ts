import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { ServerActor } from "@/lib/seramet-auth";
import { OnboardingService } from "@/onboarding/onboarding-service";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { PosIdentityService, requireFullAuthentication } from "@/server/pos-auth-service";
import { RestaurantRegistrationService } from "@/server/registration-service";
import type { VerifiedExternalIdentity } from "@/server/identity/supabase-identity";

let db: SqliteD1TestDatabase;

describe.sequential("identity, device and branch hardening", () => {
  beforeEach(() => {
    db = createMigratedTestDatabase();
  });

  afterEach(() => db.close());

  it("registers one protected account owner and one explicit draft branch", async () => {
    const service = new RestaurantRegistrationService(db);
    const first = await service.register(identity(), registration());
    const replay = await service.register(identity(), registration());
    expect(replay).toEqual(first);

    const counts = await db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM branches WHERE tenant_id=?) AS branches,
          (SELECT COUNT(*) FROM account_owners WHERE tenant_id=? AND status='ACTIVE') AS owners`,
      )
      .bind(first.tenantId, first.tenantId)
      .first<{ branches: number; owners: number }>();
    const branch = await db
      .prepare("SELECT lifecycle_state,is_bootstrap FROM branches WHERE tenant_id=? AND id=?")
      .bind(first.tenantId, first.branchId)
      .first<{ lifecycle_state: string; is_bootstrap: number }>();

    expect(counts).toEqual({ branches: 1, owners: 1 });
    expect(branch).toEqual({ lifecycle_state: "DRAFT", is_bootstrap: 1 });
    await expect(
      db
        .prepare("UPDATE users SET active=0 WHERE tenant_id=? AND id=?")
        .bind(first.tenantId, first.userId)
        .run(),
    ).rejects.toThrow(/active account owner/i);
  });

  it("binds employee PIN authentication to an active device and branch", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const actor = await ownerActor(provisioned);
    const roleId = "role-cashier";
    const deviceId = "device-pos-1";
    const stamp = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          "UPDATE branches SET lifecycle_state='ACTIVE',is_bootstrap=0 WHERE tenant_id=? AND id=?",
        )
        .bind(provisioned.tenantId, provisioned.branchId),
      db
        .prepare(
          "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
        )
        .bind(provisioned.tenantId, roleId, "CASHIER", "Cashier"),
      db
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .bind(provisioned.tenantId, roleId, permissions.posAccess),
      db
        .prepare(
          `INSERT INTO hardware_devices
          (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json,
           lifecycle_state,credential_version)
         VALUES (?,?,?,'POS_TERMINAL','Front POS','PENDING',?,?,'{}','ACTIVATION_PENDING',0)`,
        )
        .bind(provisioned.tenantId, deviceId, provisioned.branchId, provisioned.userId, stamp),
    ]);

    const service = new PosIdentityService(db);
    await expect(service.loginEmployee(undefined, "CASH-01", "602947")).rejects.toThrow(/device/i);
    const device = await service.issueDeviceCredential(actor, deviceId, "test-build");
    expect((await service.deviceStartup(device.credential)).state).toBe("ACTIVE");
    await expect(
      service.createEmployee(actor, employeeInput(roleId, provisioned.branchId, "123456")),
    ).rejects.toThrow(/predictable/i);

    const employee = await service.createEmployee(
      actor,
      employeeInput(roleId, provisioned.branchId, "602947"),
    );
    const credential = await db
      .prepare(
        "SELECT hash_base64,salt_base64,algorithm FROM employee_pin_credentials WHERE tenant_id=? AND user_id=?",
      )
      .bind(provisioned.tenantId, employee.id)
      .first<{ hash_base64: string; salt_base64: string; algorithm: string }>();
    expect(credential?.algorithm).toBe("PBKDF2-SHA256");
    expect(JSON.stringify(credential)).not.toContain("602947");
    await expect(service.loginEmployee(device.credential, "CASH-01", "929292")).rejects.toThrow(
      /incorrect/i,
    );

    const login = await service.loginEmployee(device.credential, "CASH-01", "602947");
    const posActor = await service.authenticatePosSession(login.token);
    expect(posActor.branchId).toBe(provisioned.branchId);
    expect(posActor.authLevel).toBe("POS_PIN");
    expect(() => requireFullAuthentication(posActor)).toThrow(/full account/i);

    await service.resetPin(actor, employee.id, {
      pin: "830275",
      pinConfirmation: "830275",
      reason: "Employee requested secure credential reset",
    });
    await expect(service.authenticatePosSession(login.token)).rejects.toThrow(/revoked/i);
  }, 30_000);

  it("creates a later branch idempotently with hierarchy and owner access", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const actor = await ownerActor(provisioned);
    await db
      .prepare(
        "UPDATE branches SET lifecycle_state='ACTIVE',is_bootstrap=0 WHERE tenant_id=? AND id=?",
      )
      .bind(provisioned.tenantId, provisioned.branchId)
      .run();
    const brand = await db
      .prepare("SELECT id FROM brands WHERE tenant_id=? LIMIT 1")
      .bind(provisioned.tenantId)
      .first<{ id: string }>();
    const service = new OnboardingService(db, actor, {});
    const input = {
      idempotencyKey: "branch-create-idempotency-0001",
      brandId: brand!.id,
      code: "SECOND",
      name: "Second Branch",
      timezone: "Africa/Nairobi",
      businessDayCutoffMinutes: 240,
      negativeStockPolicy: "BLOCK" as const,
      createWarehouse: { code: "SECOND-MAIN", name: "Main Store" },
    };
    const first = await service.createBranch(input);
    expect(await service.createBranch(input)).toEqual(first);
    const counts = await db
      .prepare(
        `SELECT
        (SELECT COUNT(*) FROM branches WHERE tenant_id=? AND code='SECOND') AS branches,
        (SELECT COUNT(*) FROM enterprise_nodes WHERE tenant_id=? AND branch_id=?) AS nodes,
        (SELECT COUNT(*) FROM user_branches WHERE tenant_id=? AND user_id=? AND branch_id=?) AS owner_access`,
      )
      .bind(
        provisioned.tenantId,
        provisioned.tenantId,
        first.id,
        provisioned.tenantId,
        provisioned.userId,
        first.id,
      )
      .first<{ branches: number; nodes: number; owner_access: number }>();
    expect(counts).toEqual({ branches: 1, nodes: 1, owner_access: 1 });
  });

  it("transfers ownership only after recent full authentication and preserves an active owner", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const actor = await ownerActor(provisioned);
    const targetId = "user-next-owner";
    const stamp = new Date().toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO users
          (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at,
           normalized_email,employment_status,effective_from)
         VALUES (?,?,?,'Next Owner',1,1,'{}',?,?,?,'ACTIVE',?)`,
        )
        .bind(
          provisioned.tenantId,
          targetId,
          "next@example.test",
          stamp,
          stamp,
          "next@example.test",
          stamp,
        ),
      db
        .prepare(
          `INSERT INTO identity_accounts
          (tenant_id,user_id,provider,subject,email,email_verified,linked_at,last_authenticated_at,metadata_json)
         VALUES (?,?, 'supabase','next-owner','next@example.test',1,?,?,'{}')`,
        )
        .bind(provisioned.tenantId, targetId, stamp, stamp),
    ]);
    const result = await new PosIdentityService(db).transferOwnership(actor, {
      targetUserId: targetId,
      confirmation: "TRANSFER OWNERSHIP",
      reason: "Business ownership reassignment approved",
    });
    expect(result.newOwnerId).toBe(targetId);
    const owners = await db
      .prepare("SELECT user_id,status FROM account_owners WHERE tenant_id=? ORDER BY user_id")
      .bind(provisioned.tenantId)
      .all<{ user_id: string; status: string }>();
    expect(owners.results).toContainEqual({ user_id: targetId, status: "ACTIVE" });
    expect(owners.results).toContainEqual({ user_id: provisioned.userId, status: "TRANSFERRED" });
  });
});

function identity(): VerifiedExternalIdentity {
  return {
    provider: "supabase",
    subject: "owner-subject",
    sessionId: "owner-session",
    email: "owner@example.test",
    emailVerified: true,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function registration() {
  return {
    idempotencyKey: "registration-owner-idempotency-0001",
    administratorName: "Restaurant Owner",
    legalName: "Restaurant Limited",
    tradingName: "Restaurant",
    countryCode: "KE",
    currency: "KES",
    timezone: "Africa/Nairobi",
    locale: "en-KE",
    brandCode: "PRIMARY",
    branchCode: "MAIN",
    branchName: "Main Branch",
  };
}

async function ownerActor(provisioned: { tenantId: string; userId: string; branchId: string }) {
  const role = await db
    .prepare("SELECT id FROM roles WHERE tenant_id=? AND code='ACCOUNT_OWNER'")
    .bind(provisioned.tenantId)
    .first<{ id: string }>();
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO auth_sessions
      (tenant_id,id,user_id,device_id,issued_at,expires_at,last_seen_at,token_version,metadata_json)
     VALUES (?,?,?,NULL,?,?,?,?, '{}')`,
    )
    .bind(
      provisioned.tenantId,
      "owner-full-session",
      provisioned.userId,
      stamp,
      new Date(Date.now() + 3_600_000).toISOString(),
      stamp,
      1,
    )
    .run();
  return {
    id: provisioned.userId,
    name: "Restaurant Owner",
    tenantId: provisioned.tenantId,
    roleIds: [role!.id],
    permissions: allPermissionCodes.filter((code) => code !== permissions.platformTenantsProvision),
    assignedBranchIds: [provisioned.branchId],
    assignedBranches: [{ id: provisioned.branchId, name: "Main Branch", isPrimary: true }],
    primaryBranchId: provisioned.branchId,
    branchScope: { type: "ALL" as const },
    branchId: provisioned.branchId,
    branch: "Main Branch",
    role: "Account Owner",
    sessionId: "owner-full-session",
    authLevel: "FULL" as const,
  } satisfies ServerActor;
}

function employeeInput(roleId: string, branchId: string, pin: string) {
  return {
    idempotencyKey: `employee-create-${pin}-00000001`,
    fullName: "Cashier One",
    employeeCode: "CASH-01",
    jobTitle: "Cashier",
    roleId,
    assignedBranchIds: [branchId],
    primaryBranchId: branchId,
    pin,
    pinConfirmation: pin,
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    temporaryPin: false,
  };
}
