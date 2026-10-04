import { mkdirSync, writeFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { allPermissionCodes, permissions } from "../src/platform/permissions";
import { createLocalDevelopmentDatabase } from "../src/server/database/local-development-database";

if (process.env.SERAMET_E2E === "true" && process.env.CI !== "true") {
  throw new Error("Local pilot fixture creation requires CI=true or an explicit CI runner");
}
if (process.env.SERAMET_E2E !== "true") throw new Error("SERAMET_E2E=true is required");

const db = createLocalDevelopmentDatabase();
const suffix = randomUUID();
const tenantId = `e2e-${suffix}`;
const firstBranchId = `e2e-branch-a-${suffix}`;
const secondBranchId = `e2e-branch-b-${suffix}`;
const userId = `e2e-user-${suffix}`;
const restrictedUserId = `e2e-restricted-${suffix}`;
const roleId = `e2e-role-${suffix}`;
const restrictedRoleId = `e2e-restricted-role-${suffix}`;
const stationId = `e2e-station-${suffix}`;
const secondStationId = `e2e-station-b-${suffix}`;
const menuItemId = `e2e-menu-${suffix}`;
const cashMethodId = `e2e-cash-${suffix}`;
const stamp = new Date().toISOString();
const jwtSecret = requiredEnvironment("SERAMET_JWT_SECRET");
const jwtIssuer = requiredEnvironment("SERAMET_JWT_ISSUER");
const jwtAudience = requiredEnvironment("SERAMET_JWT_AUDIENCE");
const managerSessionId = `e2e-session-${suffix}`;
const restrictedSessionId = `e2e-restricted-session-${suffix}`;

try {
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,?,?,?)",
    )
    .bind(
      tenantId,
      tenantId,
      "Pilot E2E Ltd",
      "Pilot E2E",
      JSON.stringify({
        id: tenantId,
        slug: tenantId,
        legalName: "Pilot E2E Ltd",
        tradingName: "Pilot E2E",
        active: true,
        defaultCurrency: "KES",
        timezone: "Africa/Nairobi",
        locale: "en-KE",
        countryCode: "KE",
        createdAt: stamp,
        updatedAt: stamp,
      }),
      stamp,
      stamp,
    )
    .run();
  for (const [id, code, name] of [
    [firstBranchId, "E2EA", "Pilot Branch A"],
    [secondBranchId, "E2EB", "Pilot Branch B"],
  ]) {
    await db
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,?)",
      )
      .bind(
        tenantId,
        id,
        code,
        name,
        JSON.stringify({
          id,
          tenantId,
          code,
          name,
          timezone: "Africa/Nairobi",
          businessDayCutoffMinutes: 240,
          address: "",
          phone: "",
          email: "",
          active: true,
          metadata: {},
        }),
      )
      .run();
  }
  await db
    .prepare(
      "INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES (?,?,?,?,?,'KITCHEN',1,'{}')",
    )
    .bind(tenantId, stationId, firstBranchId, "MAIN", "Main Kitchen")
    .run();
  await db
    .prepare(
      "INSERT INTO stations (tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES (?,?,?,?,?,'KITCHEN',1,'{}')",
    )
    .bind(tenantId, secondStationId, secondBranchId, "MAIN", "Main Kitchen")
    .run();
  for (const code of allPermissionCodes) {
    await db
      .prepare("INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT DO NOTHING")
      .bind(code, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
    )
    .bind(tenantId, restrictedRoleId, "PILOT_RESTRICTED", "Restricted branch manager")
    .run();
  for (const code of [permissions.setupImport, permissions.setupView]) {
    await db
      .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
      .bind(tenantId, restrictedRoleId, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
    )
    .bind(tenantId, roleId, "PILOT_MANAGER", "Pilot manager")
    .run();
  for (const code of allPermissionCodes) {
    await db
      .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
      .bind(tenantId, roleId, code)
      .run();
  }
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,1,1,'{}',?,?)",
    )
    .bind(tenantId, userId, `${userId}@test.invalid`, "Pilot manager", stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,1,1,'{}',?,?)",
    )
    .bind(
      tenantId,
      restrictedUserId,
      `${restrictedUserId}@test.invalid`,
      "Restricted manager",
      stamp,
      stamp,
    )
    .run();
  for (const [sessionId, sessionUserId] of [
    [managerSessionId, userId],
    [restrictedSessionId, restrictedUserId],
  ]) {
    await db
      .prepare(
        `INSERT INTO auth_sessions
          (tenant_id,id,user_id,device_id,issued_at,expires_at,revoked_at,last_seen_at,
           token_version,ip_hash,metadata_json)
         VALUES (?,?,?,NULL,?,?,NULL,?,1,NULL,'{}')`,
      )
      .bind(
        tenantId,
        sessionId,
        sessionUserId,
        stamp,
        new Date(Date.now() + 60 * 60_000).toISOString(),
        stamp,
      )
      .run();
  }
  await db
    .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
    .bind(tenantId, userId, roleId)
    .run();
  await db
    .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
    .bind(tenantId, restrictedUserId, restrictedRoleId)
    .run();
  for (const branchId of [firstBranchId, secondBranchId]) {
    await db
      .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
      .bind(tenantId, userId, branchId)
      .run();
  }
  await db
    .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
    .bind(tenantId, restrictedUserId, secondBranchId)
    .run();
  await db
    .prepare(
      "INSERT INTO user_primary_branches (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason) VALUES (?,?,?,?,?,?)",
    )
    .bind(tenantId, userId, firstBranchId, "system:e2e", stamp, "Disposable browser fixture")
    .run();
  await db
    .prepare(
      "INSERT INTO user_primary_branches (tenant_id,user_id,branch_id,assigned_by,assigned_at,reason) VALUES (?,?,?,?,?,?)",
    )
    .bind(
      tenantId,
      restrictedUserId,
      secondBranchId,
      "system:e2e",
      stamp,
      "Disposable restricted browser fixture",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO payment_methods (tenant_id,id,code,category,cash_account_id,active,payload_json) VALUES (?,?,?,'CASH','cash-on-hand',1,?)",
    )
    .bind(
      tenantId,
      cashMethodId,
      "CASH",
      JSON.stringify({
        id: cashMethodId,
        tenantId,
        code: "CASH",
        displayName: "Cash",
        category: "CASH",
        enabled: true,
        sortOrder: 1,
        requiresReference: false,
        requiresCustomer: false,
        supportsRefund: true,
        supportsSplit: true,
        cashAccountId: "cash-on-hand",
        metadata: {},
      }),
    )
    .run();
  await db
    .prepare(
      "INSERT INTO order_channels (tenant_id,id,code,channel_type,active,payload_json) VALUES (?,?,?,'DINE_IN',1,?)",
    )
    .bind(
      tenantId,
      `e2e-channel-${suffix}`,
      "DINE_IN",
      JSON.stringify({
        id: `e2e-channel-${suffix}`,
        tenantId,
        code: "DINE_IN",
        displayName: "Dine in",
        channelType: "DINE_IN",
        enabled: true,
        requiresCustomer: false,
        requiresTable: false,
        requiresAddress: false,
        isExternallyPaid: false,
        sortOrder: 1,
        metadata: {},
      }),
    )
    .run();
  await db
    .prepare(
      "INSERT INTO menu_catalog_items (tenant_id,id,code,sku,name,category_code,description,selling_price_minor,currency,service_charge_applicable,station_id,sellable,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,'MAIN_MEALS','Pilot fixture',100000,'KES',0,?,1,1,'{}',?,?)",
    )
    .bind(tenantId, menuItemId, "E2E-001", "E2E-001", "Pilot meal", stationId, stamp, stamp)
    .run();
  for (const branchId of [firstBranchId, secondBranchId]) {
    await db
      .prepare(
        "INSERT INTO menu_item_branch_settings (tenant_id,branch_id,menu_item_id,selling_price_minor,available,channel_availability_json,updated_at) VALUES (?,?,?,100000,1,'{}',?)",
      )
      .bind(tenantId, branchId, menuItemId, stamp)
      .run();
  }
  mkdirSync(resolve(process.cwd(), ".seramet"), { recursive: true });
  writeFileSync(
    resolve(process.cwd(), ".seramet", "e2e-fixture.json"),
    JSON.stringify(
      {
        tenantId,
        userId,
        restrictedUserId,
        managerAccessToken: signToken(userId, managerSessionId),
        restrictedAccessToken: signToken(restrictedUserId, restrictedSessionId),
        firstBranchId,
        secondBranchId,
        menuItemId,
      },
      null,
      2,
    ),
  );
  console.log("Disposable pilot browser fixture created");
} finally {
  db.close();
}

function signToken(subject: string, sessionId: string) {
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: subject,
    tid: tenantId,
    sid: sessionId,
    iss: jwtIssuer,
    aud: jwtAudience,
    iat: now,
    nbf: now - 1,
    exp: now + 3_600,
    jti: randomUUID(),
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for disposable browser sessions`);
  return value;
}
