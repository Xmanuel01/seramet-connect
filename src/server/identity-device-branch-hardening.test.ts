import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { authenticateSerametRequest } from "@/lib/seramet-auth";
import { handleIdentityDeviceApi } from "@/server/identity-device-api";
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
        .bind(provisioned.tenantId, roleId, "PIN_TEST_CASHIER", "PIN test cashier"),
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

    // PIN login must remove an earlier owner's browser cookies on shared POS devices.
    const response = await handleIdentityDeviceApi(
      new Request("https://pos.seramet.test/api/seramet/public/employee/login", {
        method: "POST",
        headers: {
          origin: "https://pos.seramet.test",
          "content-type": "application/json",
          cookie: `seramet_device=${encodeURIComponent(device.credential)}; seramet_access=previous-owner; seramet_refresh=previous-refresh`,
        },
        body: JSON.stringify({ identifier: "CASH-01", pin: "602947" }),
      }),
      { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" } as SerametEnv,
    );
    if (!response) throw new Error("Employee login route was not handled");
    expect(response.status).toBe(200);
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("seramet_access=;");
    expect(cookies).toContain("seramet_refresh=;");
    expect(cookies).toContain("seramet_pos_session=");
    await db
      .prepare("DELETE FROM role_permissions WHERE tenant_id=? AND role_id=?")
      .bind(provisioned.tenantId, roleId)
      .run();
    await db
      .prepare("INSERT INTO role_permissions(tenant_id,role_id,permission_code) VALUES(?,?,?)")
      .bind(provisioned.tenantId, roleId, permissions.attendanceUse)
      .run();
    const attendanceLogin = await handleIdentityDeviceApi(
      new Request("https://pos.seramet.test/api/seramet/public/employee/login", {
        method: "POST",
        headers: {
          origin: "https://pos.seramet.test",
          "content-type": "application/json",
          cookie: `seramet_device=${encodeURIComponent(device.credential)}`,
        },
        body: JSON.stringify({ identifier: "CASH-01", pin: "602947" }),
      }),
      { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" } as SerametEnv,
    );
    expect(attendanceLogin?.status).toBe(200);
    expect(await attendanceLogin!.json()).toMatchObject({ nextPath: "/attendance" });
    expect((await service.authenticatePosSession(login.token)).permissions).toEqual([
      permissions.attendanceUse,
    ]);
    await db
      .prepare("DELETE FROM role_permissions WHERE tenant_id=? AND role_id=?")
      .bind(provisioned.tenantId, roleId)
      .run();
    await db
      .prepare("INSERT INTO role_permissions(tenant_id,role_id,permission_code) VALUES(?,?,?)")
      .bind(provisioned.tenantId, roleId, permissions.posAccess)
      .run();

    await db
      .prepare("UPDATE roles SET active=0 WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, roleId)
      .run();
    expect((await service.authenticatePosSession(login.token)).permissions).not.toContain(
      permissions.posAccess,
    );
    await db
      .prepare("UPDATE roles SET active=1 WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, roleId)
      .run();
    await db
      .prepare("UPDATE users SET effective_until=? WHERE tenant_id=? AND id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), provisioned.tenantId, employee.id)
      .run();
    await expect(service.authenticatePosSession(login.token)).rejects.toThrow(
      /invalid or revoked/i,
    );
    await db
      .prepare("UPDATE users SET effective_until=NULL WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, employee.id)
      .run();

    await service.resetPin(actor, employee.id, {
      pin: "830275",
      pinConfirmation: "830275",
      reason: "Employee requested secure credential reset",
    });
    await expect(service.authenticatePosSession(login.token)).rejects.toThrow(/revoked/i);
  }, 30_000);

  it("creates attendance-only employees idempotently without identity or privilege escalation", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const actor = await ownerActor(provisioned);
    const roleId = "attendance-only-role";
    await db
      .prepare(
        "INSERT INTO roles(tenant_id,id,code,name,active,payload_json) VALUES(?,?,'ATTENDANCE_STAFF','Attendance only',1,'{}')",
      )
      .bind(actor.tenantId, roleId)
      .run();
    await db
      .prepare("INSERT INTO role_permissions(tenant_id,role_id,permission_code) VALUES(?,?,?)")
      .bind(actor.tenantId, roleId, permissions.attendanceUse)
      .run();
    const service = new PosIdentityService(db);
    const input = employeeInput(roleId, provisioned.branchId, "602947");
    const employee = await service.createEmployee(actor, input);
    expect(await service.createEmployee(actor, input)).toEqual(employee);
    await expect(
      service.createEmployee({ ...actor, id: "different-creator" }, input),
    ).rejects.toThrow(/Idempotency/);
    await expect(
      service.createEmployee(
        { ...actor, assignedBranchIds: [], branchScope: { type: "BRANCH", branchId: "other" } },
        input,
      ),
    ).rejects.toThrow(/outside your authority/);
    await expect(
      service.createEmployee(actor, { ...input, fullName: "Changed identity" }),
    ).rejects.toThrow(/idempotency/i);
    await expect(
      service.createEmployee(
        { ...actor, authLevel: "POS_PIN" },
        { ...input, idempotencyKey: crypto.randomUUID() },
      ),
    ).rejects.toThrow(/full account/i);
    await expect(
      service.createEmployee({ ...actor, permissions: [permissions.attendanceUse] }, input),
    ).rejects.toThrow(/permission/i);
    await expect(
      service.createEmployee(actor, {
        ...input,
        roleId: actor.roleIds[0]!,
        idempotencyKey: crypto.randomUUID(),
        employeeCode: "OWNER-ATTEMPT",
      }),
    ).rejects.toThrow(/role/i);
    const permissionsForEmployee = await db
      .prepare(
        "SELECT rp.permission_code FROM user_roles ur JOIN role_permissions rp ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id WHERE ur.tenant_id=? AND ur.user_id=?",
      )
      .bind(actor.tenantId, employee.id)
      .all<{ permission_code: string }>();
    expect(permissionsForEmployee.results?.map((row) => row.permission_code)).toEqual([
      permissions.attendanceUse,
    ]);
    expect(
      (
        await db
          .prepare("SELECT COUNT(*) count FROM employee_creation_attempts WHERE tenant_id=?")
          .bind(actor.tenantId)
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });

  it("requires temporary PIN replacement before protected operations and revokes setup sessions", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const owner = await ownerActor(provisioned);
    const roleId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO roles(tenant_id,id,code,name,active,payload_json) VALUES(?,?,'ATTENDANCE_STAFF','Attendance',1,'{}')",
      )
      .bind(owner.tenantId, roleId)
      .run();
    await db
      .prepare("INSERT INTO role_permissions(tenant_id,role_id,permission_code) VALUES(?,?,?)")
      .bind(owner.tenantId, roleId, permissions.attendanceUse)
      .run();
    await db
      .prepare(
        "INSERT INTO hardware_devices(tenant_id,id,branch_id,device_type,name,trust_status,registered_by,registered_at,payload_json,lifecycle_state,credential_version) VALUES(?,?,?,'POS_TERMINAL','Disposable terminal','PENDING',?,?,'{}','ACTIVATION_PENDING',0)",
      )
      .bind(owner.tenantId, deviceId, owner.branchId, owner.id, stamp)
      .run();
    const service = new PosIdentityService(db);
    const device = await service.issueDeviceCredential(owner, deviceId);
    await service.createEmployee(owner, {
      ...employeeInput(roleId, owner.branchId, "602947"),
      temporaryPin: true,
    });
    const setup = await service.loginEmployee(device.credential, "CASH-01", "602947");
    expect(setup.mustChangePin).toBe(true);
    const env = { SERAMET_DB: db, SERAMET_ENVIRONMENT: "development" } as SerametEnv;
    const protectedRequest = new Request("https://pos.seramet.test/api/seramet/auth/session", {
      headers: { cookie: `seramet_pos_session=${setup.token}` },
    });
    await expect(authenticateSerametRequest(protectedRequest, env)).rejects.toThrow(
      /temporary PIN/,
    );
    await expect(
      service.completeTemporaryPin(setup.token, undefined, {
        currentPin: "602947",
        pin: "830275",
        pinConfirmation: "830275",
      }),
    ).rejects.toThrow(/authorized POS device/);
    const complete = await handleIdentityDeviceApi(
      new Request("https://pos.seramet.test/api/seramet/public/employee/change-pin", {
        method: "POST",
        headers: {
          origin: "https://pos.seramet.test",
          "content-type": "application/json",
          cookie: `seramet_device=${device.credential}; seramet_pos_session=${setup.token}`,
        },
        body: JSON.stringify({ currentPin: "602947", pin: "830275", pinConfirmation: "830275" }),
      }),
      env,
    );
    expect(complete?.status).toBe(200);
    expect(await complete!.json()).toMatchObject({ reauthenticationRequired: true });
    await expect(service.authenticatePosSession(setup.token)).rejects.toThrow(/revoked/);
    const fresh = await service.loginEmployee(device.credential, "CASH-01", "830275");
    expect(fresh.mustChangePin).toBe(false);
    expect((await service.authenticatePosSession(fresh.token)).permissions).toEqual([
      permissions.attendanceUse,
    ]);
    expect(db.sqlite.prepare("SELECT COUNT(*) count FROM employee_pin_history").get()?.count).toBe(
      1,
    );
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM audit_events WHERE action='EMPLOYEE_PIN_CHANGED'")
        .get()?.count,
    ).toBe(1);
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

  it("allows a second configuring branch after completing the wizard, before tenant go-live", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const actor = await ownerActor(provisioned);
    const brand = await db
      .prepare("SELECT id FROM brands WHERE tenant_id=? LIMIT 1")
      .bind(provisioned.tenantId)
      .first<{ id: string }>();
    const service = new OnboardingService(db, actor, {});
    const input = {
      idempotencyKey: "pre-live-second-branch-0001",
      brandId: brand!.id,
      code: "NGONG",
      name: "Ngong Road",
      timezone: "Africa/Nairobi",
      businessDayCutoffMinutes: 240,
      negativeStockPolicy: "BLOCK" as const,
      createWarehouse: { code: "NGONG-STORE", name: "Ngong Stock" },
    };

    // Incomplete first-branch onboarding must still prevent bypassing setup.
    await expect(service.createBranch(input)).rejects.toThrow(/onboarding/i);
    // Completing the wizard must not require prematurely activating the first
    // branch, nor require marking the *entire tenant* LIVE before branch two.
    await db
      .prepare(
        "UPDATE onboarding_wizard_progress SET status='COMPLETED',current_step=12 WHERE tenant_id=?",
      )
      .bind(provisioned.tenantId)
      .run();
    const result = await service.createBranch(input);
    expect(await service.createBranch(input)).toEqual(result);

    const branches = await db
      .prepare("SELECT code,lifecycle_state FROM branches WHERE tenant_id=? ORDER BY code")
      .bind(provisioned.tenantId)
      .all<{ code: string; lifecycle_state: string }>();
    expect(branches.results).toContainEqual({
      code: "NGONG",
      lifecycle_state: "CONFIGURING",
    });
    const original = branches.results?.find((row) => row.code !== "NGONG");
    expect(original?.lifecycle_state).toBe("DRAFT");
    const ownerAccess = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM user_branches WHERE tenant_id=? AND user_id=? AND branch_id=?",
      )
      .bind(provisioned.tenantId, provisioned.userId, result.id)
      .first<{ count: number }>();
    expect(ownerAccess?.count).toBe(1);
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

describe.sequential("employee editing", () => {
  beforeEach(() => {
    db = createMigratedTestDatabase();
  });

  afterEach(() => db.close());

  async function standardRole(tenantId: string, code: string) {
    const row = await db
      .prepare("SELECT id FROM roles WHERE tenant_id=? AND code=?")
      .bind(tenantId, code)
      .first<{ id: string }>();
    return row!.id;
  }

  it("updates an employee's details and role, refuses duplicates, and guards the owner's record", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const owner = await ownerActor(provisioned);
    const service = new PosIdentityService(db);
    const cashier = await standardRole(provisioned.tenantId, "CASHIER");
    const chef = await standardRole(provisioned.tenantId, "CHEF");
    const employee = await service.createEmployee(owner, {
      ...employeeInput(cashier, provisioned.branchId, "602947"),
      email: "cashier.one@example.test",
      phone: "0700000001",
    });
    await service.createEmployee(owner, {
      ...employeeInput(cashier, provisioned.branchId, "830275"),
      idempotencyKey: "employee-create-second-00000001",
      fullName: "Cashier Two",
      employeeCode: "CASH-02",
      email: "cashier.two@example.test",
      phone: "0700000002",
    });

    await service.updateEmployee(owner, employee.id, {
      fullName: "Head Cook One",
      employeeCode: "cook-01",
      jobTitle: "Cook",
      email: "Cook.One@Example.test",
      phone: "+254 700 000 003",
      roleId: chef,
    });
    const saved = await db
      .prepare(
        `SELECT u.name,u.employee_code,u.job_title,u.email,u.normalized_email,u.phone,
                (SELECT GROUP_CONCAT(role_id) FROM user_roles ur
                  WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id) AS roles
         FROM users u WHERE u.tenant_id=? AND u.id=?`,
      )
      .bind(provisioned.tenantId, employee.id)
      .first();
    expect(saved).toEqual({
      name: "Head Cook One",
      employee_code: "COOK-01",
      job_title: "Cook",
      email: "Cook.One@Example.test",
      normalized_email: "cook.one@example.test",
      phone: "+254 700 000 003",
      roles: chef,
    });
    const audits = await db
      .prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE tenant_id=? AND action=? AND entity_id=?",
      )
      .bind(provisioned.tenantId, "EMPLOYEE_UPDATED", employee.id)
      .first<{ count: number }>();
    expect(audits?.count).toBe(1);

    const details = {
      fullName: "Head Cook One",
      employeeCode: "CASH-02",
      jobTitle: "Cook",
      email: "cook.one@example.test",
      phone: "0700000003",
      roleId: chef,
    };
    await expect(service.updateEmployee(owner, employee.id, details)).rejects.toMatchObject({
      status: 409,
    });
    // The owner edits their own name and contact details, but not their sign-in email or role.
    await expect(
      service.updateEmployee(owner, provisioned.userId, { ...details, employeeCode: "OWNER-1" }),
    ).rejects.toMatchObject({ status: 400 });
    const ownerRow = await db
      .prepare("SELECT email FROM users WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, provisioned.userId)
      .first<{ email: string }>();
    const ownerRolesBefore = await db
      .prepare("SELECT role_id FROM user_roles WHERE tenant_id=? AND user_id=? ORDER BY role_id")
      .bind(provisioned.tenantId, provisioned.userId)
      .all();
    const ownDetails = {
      fullName: "Owner Renamed",
      employeeCode: "OWNER-1",
      jobTitle: "Proprietor",
      email: ownerRow!.email,
      phone: "0700000009",
    };
    await service.updateEmployee(owner, provisioned.userId, { ...ownDetails, roleId: chef });
    expect(
      await db
        .prepare("SELECT name,employee_code,job_title,phone FROM users WHERE tenant_id=? AND id=?")
        .bind(provisioned.tenantId, provisioned.userId)
        .first(),
    ).toEqual({
      name: "Owner Renamed",
      employee_code: "OWNER-1",
      job_title: "Proprietor",
      phone: "0700000009",
    });
    expect(
      await db
        .prepare("SELECT role_id FROM user_roles WHERE tenant_id=? AND user_id=? ORDER BY role_id")
        .bind(provisioned.tenantId, provisioned.userId)
        .all(),
    ).toEqual(ownerRolesBefore);
    // Nobody else edits the owner's record, even with the same permissions.
    await expect(
      service.updateEmployee({ ...owner, id: employee.id }, provisioned.userId, ownDetails),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("needs credential permission, every branch in scope, and cancels invitations on email change", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const owner = await ownerActor(provisioned);
    const service = new PosIdentityService(db);
    const cashier = await standardRole(provisioned.tenantId, "CASHIER");
    const employee = await service.createEmployee(owner, {
      ...employeeInput(cashier, provisioned.branchId, "602947"),
      email: "cashier.one@example.test",
      phone: "0700000001",
    });
    const details = {
      fullName: "Cashier One",
      employeeCode: "CASH-01",
      jobTitle: "Cashier",
      email: "cashier.one@example.test",
      phone: "0700000001",
      roleId: cashier,
    };

    // Editing needs the same credential permission as creating.
    await expect(
      service.updateEmployee(
        {
          ...owner,
          permissions: owner.permissions.filter(
            (code) => code !== permissions.employeeCredentialsManage,
          ),
        },
        employee.id,
        details,
      ),
    ).rejects.toMatchObject({ status: 403 });

    // A manager scoped to one branch cannot edit someone who also works at another.
    await db.batch([
      db
        .prepare(
          "INSERT INTO branches (tenant_id,id,code,name,timezone,active,payload_json) VALUES (?,?,?,?,?,1,'{}')",
        )
        .bind(provisioned.tenantId, "branch-second", "SECOND", "Second Branch", "Africa/Nairobi"),
      db
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .bind(provisioned.tenantId, employee.id, "branch-second"),
    ]);
    const scoped = {
      ...owner,
      branchScope: { type: "BRANCH" as const, branchId: provisioned.branchId },
    };
    await expect(service.updateEmployee(scoped, employee.id, details)).rejects.toMatchObject({
      status: 403,
    });

    // A pending invitation to the old address is cancelled when the email changes.
    await db
      .prepare(
        `INSERT INTO employee_account_invitations
          (tenant_id,id,user_id,actor_id,email,request_key,branches_json,status,created_at,expires_at)
         VALUES (?,?,?,?,?,?,'{}','PENDING',?,?)`,
      )
      .bind(
        provisioned.tenantId,
        "invitation-old-email",
        employee.id,
        provisioned.userId,
        "cashier.one@example.test",
        "invitation-request-1",
        new Date().toISOString(),
        new Date(Date.now() + 86_400_000).toISOString(),
      )
      .run();
    await service.updateEmployee(owner, employee.id, {
      ...details,
      email: "cashier.new@example.test",
    });
    const invitation = await db
      .prepare("SELECT status FROM employee_account_invitations WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, "invitation-old-email")
      .first<{ status: string }>();
    expect(invitation?.status).toBe("REVOKED");
  });

  it("reports a code held by an inactive employee as a duplicate", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const owner = await ownerActor(provisioned);
    const service = new PosIdentityService(db);
    const cashier = await standardRole(provisioned.tenantId, "CASHIER");
    const employee = await service.createEmployee(owner, {
      ...employeeInput(cashier, provisioned.branchId, "602947"),
      email: "cashier.one@example.test",
      phone: "0700000001",
    });
    const former = await service.createEmployee(owner, {
      ...employeeInput(cashier, provisioned.branchId, "830275"),
      idempotencyKey: "employee-create-former-00000001",
      fullName: "Former Cashier",
      employeeCode: "FORMER-1",
      email: "former@example.test",
      phone: "0700000002",
    });
    await db
      .prepare("UPDATE users SET active=0 WHERE tenant_id=? AND id=?")
      .bind(provisioned.tenantId, former.id)
      .run();
    await expect(
      service.updateEmployee(owner, employee.id, {
        fullName: "Cashier One",
        employeeCode: "FORMER-1",
        jobTitle: "Cashier",
        email: "cashier.one@example.test",
        phone: "0700000001",
        roleId: cashier,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not let a manager edit someone with more access than they have", async () => {
    const provisioned = await new RestaurantRegistrationService(db).register(
      identity(),
      registration(),
    );
    const owner = await ownerActor(provisioned);
    const service = new PosIdentityService(db);
    const supervisor = await standardRole(provisioned.tenantId, "SUPERVISOR");
    const employee = await service.createEmployee(owner, {
      ...employeeInput(supervisor, provisioned.branchId, "602947"),
      email: "supervisor@example.test",
      phone: "0700000001",
    });
    const manager = {
      ...owner,
      id: "limited-manager",
      permissions: [permissions.usersManage, permissions.employeeCredentialsManage],
    };
    await expect(
      service.updateEmployee(manager, employee.id, {
        fullName: "Renamed",
        employeeCode: "CASH-01",
        jobTitle: "Supervisor",
        email: "supervisor@example.test",
        phone: "0700000001",
        roleId: supervisor,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
