import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

const PIN_ITERATIONS = 600_000;
const DEVICE_CREDENTIAL_DAYS = 365;
const POS_SESSION_HOURS = 8;

type DeviceContext = {
  tenantId: string;
  deviceId: string;
  branchId: string;
  branchName: string;
  tenantName: string;
  deviceName: string;
  lifecycleState: string;
  allowEmployeeTiles: boolean;
  pinLength: 4 | 6;
  inactivityLockMinutes: number;
  maximumFailures: number;
  lockoutMinutes: number;
};

export type EmployeeCreateInput = {
  idempotencyKey: string;
  fullName: string;
  email?: string;
  employeeCode: string;
  phone?: string;
  jobTitle: string;
  roleId: string;
  assignedBranchIds: string[];
  primaryBranchId: string;
  pin: string;
  pinConfirmation: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  temporaryPin?: boolean;
};

export type OwnershipTransferInput = {
  targetUserId: string;
  confirmation: string;
  reason: string;
};

export class PosIdentityService {
  constructor(private readonly db: D1Database) {}

  async deviceStartup(rawCredential?: string) {
    if (!rawCredential) return { state: "UNREGISTERED" as const };
    const context = await this.resolveDeviceCredential(rawCredential);
    if (!context) return { state: "UNREGISTERED" as const };
    const employees =
      context.allowEmployeeTiles && context.lifecycleState === "ACTIVE"
        ? await this.db
            .prepare(
              `SELECT u.employee_code,u.name
             FROM users u JOIN user_branches ub
               ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=?
             WHERE u.tenant_id=? AND u.active=1 AND u.employment_status='ACTIVE'
               AND u.employee_code IS NOT NULL
             ORDER BY u.name LIMIT 100`,
            )
            .bind(context.branchId, context.tenantId)
            .all<{ employee_code: string; name: string }>()
        : { results: [] as Array<{ employee_code: string; name: string }> };
    await this.db
      .prepare(
        `UPDATE hardware_devices SET last_seen_at=?
         WHERE tenant_id=? AND id=?`,
      )
      .bind(now(), context.tenantId, context.deviceId)
      .run();
    return {
      state: context.lifecycleState,
      device: {
        id: context.deviceId,
        name: context.deviceName,
        tenantName: context.tenantName,
        branchId: context.branchId,
        branchName: context.branchName,
      },
      policy: {
        pinLength: context.pinLength,
        allowEmployeeTiles: context.allowEmployeeTiles,
        inactivityLockMinutes: context.inactivityLockMinutes,
      },
      employees: (employees.results ?? []).map((employee) => ({
        employeeCode: employee.employee_code,
        displayName: employee.name,
      })),
    };
  }

  async issueDeviceCredential(actor: ServerActor, deviceId: string, appVersion?: string) {
    requireFullAuthentication(actor);
    requirePermission(actor, permissions.deviceActivate);
    const device = await this.db
      .prepare(
        `SELECT id,branch_id,lifecycle_state,credential_version FROM hardware_devices
         WHERE tenant_id=? AND id=?`,
      )
      .bind(actor.tenantId, deviceId)
      .first<{
        id: string;
        branch_id: string;
        lifecycle_state: string;
        credential_version: number;
      }>();
    if (!device) throw operation("VALIDATION_FAILED", 404, "Device was not found");
    if (!actor.assignedBranchIds.includes(device.branch_id) && actor.branchScope.type !== "ALL") {
      throw operation("PERMISSION_DENIED", 403, "Device branch is outside your authority");
    }
    if (["RETIRED"].includes(device.lifecycle_state)) {
      throw operation("INVALID_STATE_TRANSITION", 409, "Retired devices cannot be activated");
    }
    const secret = randomToken();
    const tokenHash = await sha256(secret);
    const version = Number(device.credential_version) + 1;
    const stamp = now();
    const expiresAt = new Date(Date.now() + DEVICE_CREDENTIAL_DAYS * 86_400_000).toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE device_credentials SET revoked_at=?
           WHERE tenant_id=? AND device_id=? AND revoked_at IS NULL`,
        )
        .bind(stamp, actor.tenantId, deviceId),
      this.db
        .prepare(
          `INSERT INTO device_credentials
            (tenant_id,device_id,version,token_hash,issued_at,expires_at,last_used_at,revoked_at,
             rotated_from_version,metadata_json)
           VALUES (?,?,?,?,?,?,?,NULL,?,?)`,
        )
        .bind(
          actor.tenantId,
          deviceId,
          version,
          tokenHash,
          stamp,
          expiresAt,
          stamp,
          device.credential_version || null,
          JSON.stringify({ activatedBy: actor.id, appVersion: appVersion ?? null }),
        ),
      this.db
        .prepare(
          `UPDATE hardware_devices SET trust_status='ACTIVE',lifecycle_state='ACTIVE',
             activated_at=?,activated_by=?,revoked_at=NULL,credential_version=?,app_version=?
           WHERE tenant_id=? AND id=?`,
        )
        .bind(stamp, actor.id, version, appVersion ?? null, actor.tenantId, deviceId),
      audit(this.db, actor, "DEVICE_ACTIVATED", "HARDWARE_DEVICE", deviceId, {
        branchId: device.branch_id,
        credentialVersion: version,
      }),
    ]);
    return { credential: `${deviceId}.${secret}`, expiresAt, version };
  }

  async revokeDevice(actor: ServerActor, deviceId: string, reason: string) {
    requireFullAuthentication(actor);
    requirePermission(actor, permissions.deviceActivate);
    if (reason.trim().length < 3) throw operation("VALIDATION_FAILED", 400, "Reason is required");
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE hardware_devices SET trust_status='REVOKED',lifecycle_state='REVOKED',revoked_at=?
           WHERE tenant_id=? AND id=?`,
        )
        .bind(stamp, actor.tenantId, deviceId),
      this.db
        .prepare(
          `UPDATE device_credentials SET revoked_at=?
           WHERE tenant_id=? AND device_id=? AND revoked_at IS NULL`,
        )
        .bind(stamp, actor.tenantId, deviceId),
      this.db
        .prepare(
          `UPDATE pos_sessions SET revoked_at=?,revoke_reason='DEVICE_REVOKED'
           WHERE tenant_id=? AND device_id=? AND revoked_at IS NULL`,
        )
        .bind(stamp, actor.tenantId, deviceId),
      audit(this.db, actor, "DEVICE_REVOKED", "HARDWARE_DEVICE", deviceId, {
        reason: reason.trim(),
      }),
    ]);
  }

  async createEmployee(actor: ServerActor, input: EmployeeCreateInput) {
    requireFullAuthentication(actor);
    requirePermission(actor, permissions.usersManage);
    requirePermission(actor, permissions.employeeCredentialsManage);
    validateEmployeeInput(input);
    const replay = await this.db
      .prepare(
        `SELECT response_json,request_hash FROM employee_creation_attempts
         WHERE tenant_id=? AND idempotency_key=?`,
      )
      .bind(actor.tenantId, input.idempotencyKey)
      .first<{ response_json: string; request_hash: string }>();
    const requestHash = await sha256(stableJson(input));
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw operation("CONFLICT", 409, "Idempotency key was reused with different employee data");
      }
      return JSON.parse(replay.response_json) as { id: string; employeeCode: string };
    }
    const branchIds = [...new Set(input.assignedBranchIds)];
    if (!branchIds.includes(input.primaryBranchId)) {
      throw operation("VALIDATION_FAILED", 400, "Primary branch must be assigned");
    }
    if (branchIds.length > 1 && !actor.permissions.includes(permissions.tenantScopeAllBranches)) {
      throw operation("PERMISSION_DENIED", 403, "Multi-branch assignment is not authorized");
    }
    if (
      branchIds.some((id) => !actor.assignedBranchIds.includes(id)) &&
      actor.branchScope.type !== "ALL"
    ) {
      throw operation("PERMISSION_DENIED", 403, "Employee branch is outside your authority");
    }
    const placeholders = branchIds.map(() => "?").join(",");
    const branches = await this.db
      .prepare(
        `SELECT id FROM branches WHERE tenant_id=? AND lifecycle_state IN ('DRAFT','CONFIGURING','ACTIVE')
         AND id IN (${placeholders})`,
      )
      .bind(actor.tenantId, ...branchIds)
      .all<{ id: string }>();
    if ((branches.results ?? []).length !== branchIds.length) {
      throw operation("VALIDATION_FAILED", 400, "Employee branch assignment is invalid");
    }
    const rolePermissions = await this.db
      .prepare(
        `SELECT rp.permission_code FROM roles r JOIN role_permissions rp
           ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         WHERE r.tenant_id=? AND r.id=? AND r.active=1`,
      )
      .bind(actor.tenantId, input.roleId)
      .all<{ permission_code: string }>();
    if (!(rolePermissions.results ?? []).length)
      throw operation("VALIDATION_FAILED", 400, "Role is invalid");
    const forbidden = (rolePermissions.results ?? [])
      .map((row) => row.permission_code)
      .filter((code) => !actor.permissions.includes(code));
    if (forbidden.length) {
      throw operation("PERMISSION_DENIED", 403, "Cannot grant permissions outside your authority");
    }
    const policy = await this.policy(actor.tenantId);
    validatePin(input.pin, input.pinConfirmation, policy.pinLength);
    const duplicate = await this.db
      .prepare(
        `SELECT id FROM users WHERE tenant_id=? AND active=1
         AND (normalized_email=? OR employee_code=?) LIMIT 1`,
      )
      .bind(actor.tenantId, normalizeEmail(input.email), normalizeCode(input.employeeCode))
      .first();
    if (duplicate)
      throw operation("DUPLICATE", 409, "An active employee already uses that identity");
    const userId = crypto.randomUUID();
    const stamp = now();
    const credential = await derivePin(input.pin);
    const response = { id: userId, employeeCode: normalizeCode(input.employeeCode) };
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `INSERT INTO users
            (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at,
             employee_code,normalized_email,phone,job_title,employment_status,effective_from,effective_until)
           VALUES (?,?,?,?,1,1,'{}',?,?,?,?,?,?,'ACTIVE',?,?)`,
        )
        .bind(
          actor.tenantId,
          userId,
          input.email?.trim() || null,
          input.fullName.trim(),
          stamp,
          stamp,
          normalizeCode(input.employeeCode),
          normalizeEmail(input.email),
          input.phone?.trim() || null,
          input.jobTitle.trim(),
          input.effectiveFrom,
          input.effectiveUntil ?? null,
        ),
      this.db
        .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
        .bind(actor.tenantId, userId, input.roleId),
      this.db
        .prepare(
          `INSERT INTO employee_pin_credentials
            (tenant_id,user_id,algorithm,algorithm_version,iterations,salt_base64,hash_base64,pin_length,
             failed_attempts,locked_until,temporary,must_change,changed_at,changed_by,version)
           VALUES (?,?,'PBKDF2-SHA256',1,?,?,?,?,0,NULL,?,?,?, ?,1)`,
        )
        .bind(
          actor.tenantId,
          userId,
          credential.iterations,
          credential.salt,
          credential.hash,
          input.pin.length,
          input.temporaryPin ? 1 : 0,
          input.temporaryPin ? 1 : 0,
          stamp,
          actor.id,
        ),
    ];
    for (const branchId of branchIds) {
      statements.push(
        this.db
          .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
          .bind(actor.tenantId, userId, branchId),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO user_primary_branches
            (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason)
           VALUES (?,?,?,?,?,'Employee creation')`,
        )
        .bind(actor.tenantId, userId, input.primaryBranchId, actor.id, stamp),
      this.db
        .prepare(
          `INSERT INTO employee_creation_attempts
            (tenant_id,idempotency_key,request_hash,response_json,created_by,created_at)
           VALUES (?,?,?,?,?,?)`,
        )
        .bind(
          actor.tenantId,
          input.idempotencyKey,
          requestHash,
          JSON.stringify(response),
          actor.id,
          stamp,
        ),
      audit(this.db, actor, "EMPLOYEE_CREATED", "USER", userId, {
        employeeCode: response.employeeCode,
        roleId: input.roleId,
        branchIds,
        primaryBranchId: input.primaryBranchId,
        temporaryPin: Boolean(input.temporaryPin),
      }),
    );
    await this.db.batch(statements);
    return response;
  }

  async resetPin(
    actor: ServerActor,
    userId: string,
    input: { pin: string; pinConfirmation: string; reason: string; temporary?: boolean },
  ) {
    requireFullAuthentication(actor);
    requirePermission(actor, permissions.employeeCredentialsManage);
    if (input.reason.trim().length < 8)
      throw operation("VALIDATION_FAILED", 400, "Reset reason is required");
    const policy = await this.policy(actor.tenantId);
    validatePin(input.pin, input.pinConfirmation, policy.pinLength);
    const current = await this.db
      .prepare(
        `SELECT version,algorithm,iterations,salt_base64,hash_base64 FROM employee_pin_credentials
         WHERE tenant_id=? AND user_id=?`,
      )
      .bind(actor.tenantId, userId)
      .first<{
        version: number;
        algorithm: string;
        iterations: number;
        salt_base64: string;
        hash_base64: string;
      }>();
    if (!current) throw operation("VALIDATION_FAILED", 404, "Employee credential was not found");
    if (await verifyPin(input.pin, current)) {
      throw operation("VALIDATION_FAILED", 400, "New PIN must differ from the current PIN");
    }
    const credential = await derivePin(input.pin);
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO employee_pin_history
            (tenant_id,user_id,version,algorithm,iterations,salt_base64,hash_base64,replaced_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .bind(
          actor.tenantId,
          userId,
          current.version,
          current.algorithm,
          current.iterations,
          current.salt_base64,
          current.hash_base64,
          stamp,
        ),
      this.db
        .prepare(
          `UPDATE employee_pin_credentials SET iterations=?,salt_base64=?,hash_base64=?,pin_length=?,
             failed_attempts=0,locked_until=NULL,temporary=?,must_change=?,changed_at=?,changed_by=?,
             version=version+1 WHERE tenant_id=? AND user_id=?`,
        )
        .bind(
          credential.iterations,
          credential.salt,
          credential.hash,
          input.pin.length,
          input.temporary ? 1 : 0,
          input.temporary ? 1 : 0,
          stamp,
          actor.id,
          actor.tenantId,
          userId,
        ),
      this.db
        .prepare(
          `UPDATE pos_sessions SET revoked_at=?,revoke_reason='PIN_RESET'
           WHERE tenant_id=? AND user_id=? AND revoked_at IS NULL`,
        )
        .bind(stamp, actor.tenantId, userId),
      this.db
        .prepare(
          `INSERT INTO credential_reset_records
            (tenant_id,id,user_id,reset_by,reason,temporary,created_at) VALUES (?,?,?,?,?,?,?)`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          userId,
          actor.id,
          input.reason.trim(),
          input.temporary ? 1 : 0,
          stamp,
        ),
      audit(this.db, actor, "EMPLOYEE_PIN_RESET", "USER", userId, {
        temporary: Boolean(input.temporary),
        reason: input.reason.trim(),
      }),
    ]);
  }

  async transferOwnership(actor: ServerActor, input: OwnershipTransferInput) {
    requireFullAuthentication(actor);
    requirePermission(actor, permissions.ownershipTransfer);
    if (input.confirmation !== "TRANSFER OWNERSHIP") {
      throw operation("VALIDATION_FAILED", 400, "Ownership transfer confirmation is invalid");
    }
    if (input.reason.trim().length < 8) {
      throw operation("VALIDATION_FAILED", 400, "Ownership transfer reason is required");
    }
    if (input.targetUserId === actor.id) {
      throw operation("VALIDATION_FAILED", 400, "Select another verified user as the new owner");
    }
    const recentThreshold = new Date(Date.now() - 15 * 60_000).toISOString();
    const [currentOwner, session, target, ownerRole] = await Promise.all([
      this.db
        .prepare(
          "SELECT status FROM account_owners WHERE tenant_id=? AND user_id=? AND status='ACTIVE'",
        )
        .bind(actor.tenantId, actor.id)
        .first<{ status: string }>(),
      this.db
        .prepare(
          `SELECT issued_at FROM auth_sessions
           WHERE tenant_id=? AND id=? AND user_id=? AND revoked_at IS NULL AND issued_at>=?`,
        )
        .bind(actor.tenantId, actor.sessionId ?? "", actor.id, recentThreshold)
        .first<{ issued_at: string }>(),
      this.db
        .prepare(
          `SELECT u.id,u.name FROM users u
           JOIN identity_accounts ia ON ia.tenant_id=u.tenant_id AND ia.user_id=u.id
           WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND u.employment_status='ACTIVE'
             AND ia.email_verified=1 LIMIT 1`,
        )
        .bind(actor.tenantId, input.targetUserId)
        .first<{ id: string; name: string }>(),
      this.db
        .prepare("SELECT id FROM roles WHERE tenant_id=? AND code='ACCOUNT_OWNER' AND active=1")
        .bind(actor.tenantId)
        .first<{ id: string }>(),
    ]);
    if (!currentOwner)
      throw operation(
        "PERMISSION_DENIED",
        403,
        "Only an active account owner can transfer ownership",
      );
    if (!session)
      throw operation(
        "AUTHENTICATION_REQUIRED",
        401,
        "Sign in again before transferring ownership",
      );
    if (!target)
      throw operation(
        "VALIDATION_FAILED",
        400,
        "The new owner must be an active verified tenant user",
      );
    if (!ownerRole)
      throw operation("INVALID_STATE_TRANSITION", 409, "Account Owner role is not configured");
    const existingOwner = await this.db
      .prepare(
        "SELECT status FROM account_owners WHERE tenant_id=? AND user_id=? AND status='ACTIVE'",
      )
      .bind(actor.tenantId, target.id)
      .first();
    if (existingOwner)
      throw operation("DUPLICATE", 409, "The selected user is already an active owner");
    const stamp = now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO account_owners (tenant_id,user_id,status,granted_by,granted_at,reason)
           VALUES (?,?,'ACTIVE',?,?,?)
           ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='ACTIVE',granted_by=excluded.granted_by,
             granted_at=excluded.granted_at,reason=excluded.reason,ended_at=NULL`,
        )
        .bind(actor.tenantId, target.id, actor.id, stamp, input.reason.trim()),
      this.db
        .prepare(
          "INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",
        )
        .bind(actor.tenantId, target.id, ownerRole.id),
      this.db
        .prepare(
          `INSERT INTO user_branches (tenant_id,user_id,branch_id)
           SELECT tenant_id,?,id FROM branches WHERE tenant_id=? AND lifecycle_state<>'CLOSED'
           ON CONFLICT DO NOTHING`,
        )
        .bind(target.id, actor.tenantId),
      this.db
        .prepare(
          `UPDATE account_owners SET status='TRANSFERRED',ended_at=?,reason=?
           WHERE tenant_id=? AND user_id=? AND status='ACTIVE'`,
        )
        .bind(stamp, input.reason.trim(), actor.tenantId, actor.id),
      this.db
        .prepare("DELETE FROM user_roles WHERE tenant_id=? AND user_id=? AND role_id=?")
        .bind(actor.tenantId, actor.id, ownerRole.id),
      this.db
        .prepare(
          `UPDATE auth_sessions SET revoked_at=? WHERE tenant_id=? AND user_id IN (?,?)
           AND revoked_at IS NULL`,
        )
        .bind(stamp, actor.tenantId, actor.id, target.id),
      audit(this.db, actor, "ACCOUNT_OWNERSHIP_TRANSFERRED", "TENANT", actor.tenantId, {
        previousOwnerId: actor.id,
        newOwnerId: target.id,
        reason: input.reason.trim(),
      }),
    ]);
    return { previousOwnerId: actor.id, newOwnerId: target.id, transferredAt: stamp };
  }

  async loginEmployee(
    rawDeviceCredential: string | undefined,
    identifier: string,
    pin: string,
    networkHash?: string,
  ) {
    const device = rawDeviceCredential
      ? await this.resolveDeviceCredential(rawDeviceCredential)
      : undefined;
    if (!device || device.lifecycleState !== "ACTIVE") {
      throw operation("DEVICE_REVOKED", 401, "Employee sign-in is unavailable on this device");
    }
    const normalizedIdentifier = identifier.trim().toLowerCase();
    const employee = await this.db
      .prepare(
        `SELECT u.id,u.name,u.active,u.employment_status,u.effective_from,u.effective_until,
                c.algorithm,c.iterations,c.salt_base64,c.hash_base64,c.failed_attempts,c.locked_until,
                c.must_change,c.version
         FROM users u JOIN user_branches ub
           ON ub.tenant_id=u.tenant_id AND ub.user_id=u.id AND ub.branch_id=?
         LEFT JOIN employee_pin_credentials c ON c.tenant_id=u.tenant_id AND c.user_id=u.id
         WHERE u.tenant_id=? AND (u.normalized_email=? OR LOWER(u.employee_code)=?) LIMIT 1`,
      )
      .bind(device.branchId, device.tenantId, normalizedIdentifier, normalizedIdentifier)
      .first<Record<string, unknown>>();
    const stamp = now();
    const validEmployee =
      employee &&
      employee["active"] === 1 &&
      employee["employment_status"] === "ACTIVE" &&
      (!employee["effective_from"] ||
        Date.parse(String(employee["effective_from"])) <= Date.now()) &&
      (!employee["effective_until"] ||
        Date.parse(String(employee["effective_until"])) > Date.now());
    if (!validEmployee || !employee?.["hash_base64"]) {
      await derivePin(pin, zeroSalt());
      await this.recordAttempt(device, undefined, "FAILURE", "INVALID_CREDENTIAL", networkHash);
      throw operation("AUTHENTICATION_REQUIRED", 401, "Employee identifier or PIN is incorrect");
    }
    const userId = String(employee["id"]);
    if (employee["locked_until"] && Date.parse(String(employee["locked_until"])) > Date.now()) {
      await this.recordAttempt(device, userId, "LOCKED", "TEMPORARY_LOCKOUT", networkHash);
      throw operation("AUTHENTICATION_REQUIRED", 429, "Employee sign-in is temporarily locked");
    }
    const correct = await verifyPin(pin, {
      algorithm: String(employee["algorithm"]),
      iterations: Number(employee["iterations"]),
      salt_base64: String(employee["salt_base64"]),
      hash_base64: String(employee["hash_base64"]),
    });
    if (!correct) {
      const failures = Number(employee["failed_attempts"] ?? 0) + 1;
      const lockedUntil =
        failures >= device.maximumFailures
          ? new Date(Date.now() + device.lockoutMinutes * 60_000).toISOString()
          : null;
      await this.db
        .prepare(
          `UPDATE employee_pin_credentials SET failed_attempts=?,locked_until=?
           WHERE tenant_id=? AND user_id=?`,
        )
        .bind(failures, lockedUntil, device.tenantId, userId)
        .run();
      await this.recordAttempt(
        device,
        userId,
        lockedUntil ? "LOCKED" : "FAILURE",
        "INVALID_CREDENTIAL",
        networkHash,
      );
      throw operation(
        "AUTHENTICATION_REQUIRED",
        lockedUntil ? 429 : 401,
        "Employee identifier or PIN is incorrect",
      );
    }
    const sessionSecret = randomToken();
    const tokenHash = await sha256(sessionSecret);
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + POS_SESSION_HOURS * 3_600_000).toISOString();
    const inactivityExpiresAt = new Date(
      Date.now() + device.inactivityLockMinutes * 60_000,
    ).toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE employee_pin_credentials SET failed_attempts=0,locked_until=NULL
           WHERE tenant_id=? AND user_id=?`,
        )
        .bind(device.tenantId, userId),
      this.db
        .prepare(
          `INSERT INTO pos_sessions
            (tenant_id,id,user_id,device_id,branch_id,token_hash,auth_level,issued_at,expires_at,
             last_seen_at,inactivity_expires_at,revoked_at,revoke_reason,credential_version,metadata_json)
           VALUES (?,?,?,?,?,?,'POS_PIN',?,?,?,?,NULL,NULL,?,'{}')`,
        )
        .bind(
          device.tenantId,
          sessionId,
          userId,
          device.deviceId,
          device.branchId,
          tokenHash,
          stamp,
          expiresAt,
          stamp,
          inactivityExpiresAt,
          Number(employee["version"]),
        ),
      this.attemptStatement(device, userId, "SUCCESS", "AUTHENTICATED", networkHash),
    ]);
    return {
      token: sessionSecret,
      expiresAt,
      mustChangePin: Boolean(employee["must_change"]),
      employee: { id: userId, name: String(employee["name"]), branchId: device.branchId },
    };
  }

  async authenticatePosSession(token: string): Promise<ServerActor> {
    const tokenHash = await sha256(token);
    const session = await this.db
      .prepare(
        `SELECT s.tenant_id,s.id,s.user_id,s.device_id,s.branch_id,s.expires_at,
                s.inactivity_expires_at,s.revoked_at,s.credential_version,u.name,
                u.active,u.employment_status,d.lifecycle_state,c.version AS current_credential_version,
                b.name AS branch_name
         FROM pos_sessions s
         JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id
         JOIN hardware_devices d ON d.tenant_id=s.tenant_id AND d.id=s.device_id
         JOIN employee_pin_credentials c ON c.tenant_id=s.tenant_id AND c.user_id=s.user_id
         JOIN branches b ON b.tenant_id=s.tenant_id AND b.id=s.branch_id
         JOIN user_branches ub ON ub.tenant_id=s.tenant_id AND ub.user_id=s.user_id AND ub.branch_id=s.branch_id
         WHERE s.token_hash=? LIMIT 1`,
      )
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    if (
      !session ||
      session["revoked_at"] ||
      session["active"] !== 1 ||
      session["employment_status"] !== "ACTIVE"
    ) {
      throw operation("SESSION_REVOKED", 401, "POS session is invalid or revoked");
    }
    if (session["lifecycle_state"] !== "ACTIVE")
      throw operation("DEVICE_REVOKED", 401, "POS device is not active");
    if (Number(session["credential_version"]) !== Number(session["current_credential_version"])) {
      throw operation("SESSION_REVOKED", 401, "POS session was invalidated by a credential change");
    }
    if (
      Date.parse(String(session["expires_at"])) <= Date.now() ||
      Date.parse(String(session["inactivity_expires_at"])) <= Date.now()
    ) {
      throw operation("SESSION_REVOKED", 401, "POS session expired");
    }
    const [roles, granted] = await Promise.all([
      this.db
        .prepare(
          `SELECT r.id,r.name FROM user_roles ur JOIN roles r
             ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id
           WHERE ur.tenant_id=? AND ur.user_id=? AND r.active=1`,
        )
        .bind(String(session["tenant_id"]), String(session["user_id"]))
        .all<{ id: string; name: string }>(),
      this.db
        .prepare(
          `SELECT DISTINCT rp.permission_code FROM user_roles ur JOIN role_permissions rp
             ON rp.tenant_id=ur.tenant_id AND rp.role_id=ur.role_id
           WHERE ur.tenant_id=? AND ur.user_id=?`,
        )
        .bind(String(session["tenant_id"]), String(session["user_id"]))
        .all<{ permission_code: string }>(),
    ]);
    const stamp = now();
    const policy = await this.policy(String(session["tenant_id"]));
    await this.db
      .prepare(
        "UPDATE pos_sessions SET last_seen_at=?,inactivity_expires_at=? WHERE tenant_id=? AND id=?",
      )
      .bind(
        stamp,
        new Date(Date.now() + policy.inactivityLockMinutes * 60_000).toISOString(),
        String(session["tenant_id"]),
        String(session["id"]),
      )
      .run();
    return {
      id: String(session["user_id"]),
      name: String(session["name"]),
      tenantId: String(session["tenant_id"]),
      sessionId: String(session["id"]),
      deviceId: String(session["device_id"]),
      roleIds: (roles.results ?? []).map((role) => role.id),
      permissions: (granted.results ?? []).map((row) => row.permission_code),
      assignedBranchIds: [String(session["branch_id"])],
      assignedBranches: [
        { id: String(session["branch_id"]), name: String(session["branch_name"]), isPrimary: true },
      ],
      primaryBranchId: String(session["branch_id"]),
      branchScope: { type: "BRANCH", branchId: String(session["branch_id"]) },
      branchId: String(session["branch_id"]),
      branch: String(session["branch_name"]),
      role: roles.results?.[0]?.name ?? "Employee",
      authLevel: "POS_PIN",
    };
  }

  async logoutPosSession(token: string) {
    const tokenHash = await sha256(token);
    await this.db
      .prepare(
        `UPDATE pos_sessions SET revoked_at=?,revoke_reason='EMPLOYEE_LOGOUT'
         WHERE token_hash=? AND revoked_at IS NULL`,
      )
      .bind(now(), tokenHash)
      .run();
  }

  async listEmployees(actor: ServerActor) {
    requirePermission(actor, permissions.usersView);
    const branchPredicate =
      actor.branchScope.type === "ALL"
        ? ""
        : "AND EXISTS (SELECT 1 FROM user_branches scoped WHERE scoped.tenant_id=u.tenant_id AND scoped.user_id=u.id AND scoped.branch_id=?)";
    const values =
      actor.branchScope.type === "ALL" ? [actor.tenantId] : [actor.tenantId, actor.branchId];
    const rows = await this.db
      .prepare(
        `SELECT u.id,u.name,u.email,u.employee_code,u.phone,u.job_title,u.employment_status,u.active,
                pb.branch_id AS primary_branch_id,c.locked_until,c.must_change,
                CASE WHEN c.user_id IS NULL THEN 0 ELSE 1 END AS credential_configured
         FROM users u LEFT JOIN user_primary_branches pb
           ON pb.tenant_id=u.tenant_id AND pb.user_id=u.id
         LEFT JOIN employee_pin_credentials c ON c.tenant_id=u.tenant_id AND c.user_id=u.id
         WHERE u.tenant_id=? ${branchPredicate} ORDER BY u.name LIMIT 500`,
      )
      .bind(...values)
      .all<Record<string, unknown>>();
    return rows.results ?? [];
  }

  private async resolveDeviceCredential(rawCredential: string): Promise<DeviceContext | undefined> {
    const separator = rawCredential.indexOf(".");
    if (separator < 1) return undefined;
    const deviceId = rawCredential.slice(0, separator);
    const secret = rawCredential.slice(separator + 1);
    if (!secret || secret.length > 256) return undefined;
    const tokenHash = await sha256(secret);
    const row = await this.db
      .prepare(
        `SELECT d.tenant_id,d.id,d.branch_id,d.name,d.lifecycle_state,b.name AS branch_name,
                t.trading_name,p.allow_employee_tiles,p.pin_length,p.inactivity_lock_minutes,
                p.maximum_failures,p.lockout_minutes
         FROM device_credentials c JOIN hardware_devices d
           ON d.tenant_id=c.tenant_id AND d.id=c.device_id AND d.credential_version=c.version
         JOIN branches b ON b.tenant_id=d.tenant_id AND b.id=d.branch_id
         JOIN tenants t ON t.id=d.tenant_id
         JOIN pos_security_policies p ON p.tenant_id=d.tenant_id
         WHERE d.id=? AND c.token_hash=? AND c.revoked_at IS NULL AND c.expires_at>? LIMIT 1`,
      )
      .bind(deviceId, tokenHash, now())
      .first<Record<string, unknown>>();
    if (!row) return undefined;
    await this.db
      .prepare("UPDATE device_credentials SET last_used_at=? WHERE token_hash=?")
      .bind(now(), tokenHash)
      .run();
    return {
      tenantId: String(row["tenant_id"]),
      deviceId: String(row["id"]),
      branchId: String(row["branch_id"]),
      branchName: String(row["branch_name"]),
      tenantName: String(row["trading_name"]),
      deviceName: String(row["name"]),
      lifecycleState: String(row["lifecycle_state"]),
      allowEmployeeTiles: Boolean(row["allow_employee_tiles"]),
      pinLength: Number(row["pin_length"]) === 4 ? 4 : 6,
      inactivityLockMinutes: Number(row["inactivity_lock_minutes"]),
      maximumFailures: Number(row["maximum_failures"]),
      lockoutMinutes: Number(row["lockout_minutes"]),
    };
  }

  private async policy(tenantId: string) {
    const row = await this.db
      .prepare(
        `SELECT pin_length,inactivity_lock_minutes,maximum_failures,lockout_minutes
         FROM pos_security_policies WHERE tenant_id=?`,
      )
      .bind(tenantId)
      .first<{
        pin_length: number;
        inactivity_lock_minutes: number;
        maximum_failures: number;
        lockout_minutes: number;
      }>();
    return {
      pinLength: row?.pin_length === 4 ? (4 as const) : (6 as const),
      inactivityLockMinutes: row?.inactivity_lock_minutes ?? 15,
      maximumFailures: row?.maximum_failures ?? 5,
      lockoutMinutes: row?.lockout_minutes ?? 15,
    };
  }

  private attemptStatement(
    device: DeviceContext,
    userId: string | undefined,
    result: "SUCCESS" | "FAILURE" | "THROTTLED" | "LOCKED" | "REVOKED",
    reasonCode: string,
    networkHash?: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO authentication_attempts
          (id,tenant_id,device_id,user_id,network_hash,credential_type,result,reason_code,occurred_at,metadata_json)
         VALUES (?,?,?,?,?,'EMPLOYEE_PIN',?,?,?,'{}')`,
      )
      .bind(
        crypto.randomUUID(),
        device.tenantId,
        device.deviceId,
        userId ?? null,
        networkHash ?? null,
        result,
        reasonCode,
        now(),
      );
  }

  private async recordAttempt(
    device: DeviceContext,
    userId: string | undefined,
    result: "SUCCESS" | "FAILURE" | "THROTTLED" | "LOCKED" | "REVOKED",
    reasonCode: string,
    networkHash?: string,
  ) {
    await this.attemptStatement(device, userId, result, reasonCode, networkHash).run();
  }
}

export function requireFullAuthentication(actor: ServerActor) {
  if (actor.authLevel !== "FULL") {
    throw operation("PERMISSION_DENIED", 403, "Full account authentication is required");
  }
}

export function deviceCredentialCookie(value: string, secure: boolean) {
  return `seramet_device=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${DEVICE_CREDENTIAL_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}

export function posSessionCookie(value: string, secure: boolean) {
  return `seramet_pos_session=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${POS_SESSION_HOURS * 3_600}${secure ? "; Secure" : ""}`;
}

export function clearPosSessionCookie(secure: boolean) {
  return `seramet_pos_session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function readCookie(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function validateEmployeeInput(input: EmployeeCreateInput) {
  if (input.fullName.trim().length < 2 || input.fullName.length > 120)
    throw operation("VALIDATION_FAILED", 400, "Employee name is invalid");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(input.employeeCode.trim()))
    throw operation("VALIDATION_FAILED", 400, "Employee code is invalid");
  if (input.jobTitle.trim().length < 2 || input.jobTitle.length > 100)
    throw operation("VALIDATION_FAILED", 400, "Job title is invalid");
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()))
    throw operation("VALIDATION_FAILED", 400, "Employee email is invalid");
  if (!/^\d{4}-\d{2}-\d{2}/.test(input.effectiveFrom))
    throw operation("VALIDATION_FAILED", 400, "Effective date is invalid");
}

function validatePin(pin: string, confirmation: string, requiredLength: 4 | 6) {
  if (pin !== confirmation)
    throw operation("VALIDATION_FAILED", 400, "PIN confirmation does not match");
  if (!new RegExp(`^\\d{${requiredLength}}$`).test(pin))
    throw operation("VALIDATION_FAILED", 400, `PIN must contain exactly ${requiredLength} digits`);
  const ascending = "01234567890123456789".includes(pin);
  const descending = "98765432109876543210".includes(pin);
  const repeated = new Set(pin).size === 1;
  if (ascending || descending || repeated)
    throw operation("VALIDATION_FAILED", 400, "Choose a less predictable PIN");
}

async function derivePin(pin: string, providedSalt?: Uint8Array) {
  const salt = providedSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const saltBytes = Uint8Array.from(salt);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes.buffer, iterations: PIN_ITERATIONS },
    key,
    256,
  );
  return {
    iterations: PIN_ITERATIONS,
    salt: base64(saltBytes),
    hash: base64(new Uint8Array(bits)),
  };
}

async function verifyPin(
  pin: string,
  credential: { algorithm: string; iterations: number; salt_base64: string; hash_base64: string },
) {
  if (credential.algorithm !== "PBKDF2-SHA256" || credential.iterations < 310_000) return false;
  const salt = fromBase64(credential.salt_base64);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt).buffer,
      iterations: credential.iterations,
    },
    key,
    256,
  );
  return constantTimeEqual(new Uint8Array(bits), fromBase64(credential.hash_base64));
}

function zeroSalt() {
  return new Uint8Array(16);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1)
    difference |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  return difference === 0;
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase() || null;
}

function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function requirePermission(actor: ServerActor, permission: string) {
  if (!actor.permissions.includes(permission))
    throw operation("PERMISSION_DENIED", 403, `${permission} permission is required`);
}

function operation(
  code: ConstructorParameters<typeof ServerOperationError>[0],
  status: number,
  message: string,
) {
  return new ServerOperationError(code, status, message);
}

function audit(
  db: D1Database,
  actor: ServerActor,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  return db
    .prepare(
      `INSERT INTO audit_events
      (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
       correlation_id,session_id,metadata_json,created_at)
     VALUES (?,?,?,?,?,?,?,?,NULL,?,?,?,?)`,
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      actor.branchId,
      actor.id,
      actor.deviceId ?? null,
      action,
      entityType,
      entityId,
      crypto.randomUUID(),
      actor.sessionId ?? null,
      JSON.stringify(metadata),
      now(),
    );
}

function now() {
  return new Date().toISOString();
}
