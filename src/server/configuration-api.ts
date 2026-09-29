import {
  SerametHttpError,
  authenticateSerametRequest,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { ConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { PlatformState } from "@/platform/types";
import {
  hydrateAuthoritativeConfiguration,
  invalidateAuthoritativeConfiguration,
} from "@/server/database/authoritative-configuration";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { replaceRolePermissions } from "@/server/module-access-service";
import { replaceUserBranchAssignments } from "@/server/branch-access-service";
import { DatabaseRateLimiter, sensitiveRateLimits } from "@/server/rate-limit";
import { requireFullAuthentication } from "@/server/pos-auth-service";

export async function handleConfigurationApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const rolePermissionsRoute = /^\/api\/seramet\/access\/roles\/([^/]+)\/permissions$/.exec(
    url.pathname,
  );
  if (rolePermissionsRoute && request.method === "PUT") {
    const actor = await authenticateSerametRequest(request, env);
    requireFullAuthentication(actor);
    const db = requireDatabase(env);
    await new DatabaseRateLimiter(db).consume(
      `${actor.tenantId}:${actor.id}:role-permissions`,
      sensitiveRateLimits.configuration,
    );
    const body = await readRolePermissionsBody(request);
    const result = await replaceRolePermissions({
      db,
      actor,
      roleId: decodeURIComponent(rolePermissionsRoute[1]!),
      permissionCodes: body.permissions,
      reason: body.reason,
    });
    invalidateAuthoritativeConfiguration(db);
    await hydrateAuthoritativeConfiguration(db, env, true);
    return json({ ok: true, role: result });
  }
  const userBranchesRoute = /^\/api\/seramet\/access\/users\/([^/]+)\/branches$/.exec(url.pathname);
  if (userBranchesRoute && request.method === "PUT") {
    const actor = await authenticateSerametRequest(request, env);
    requireFullAuthentication(actor);
    const db = requireDatabase(env);
    await new DatabaseRateLimiter(db).consume(
      `${actor.tenantId}:${actor.id}:user-branches`,
      sensitiveRateLimits.configuration,
    );
    const body = await readUserBranchAssignmentBody(request);
    const result = await replaceUserBranchAssignments(db, actor, {
      userId: decodeURIComponent(userBranchesRoute[1]!),
      assignedBranchIds: body.assignedBranchIds,
      primaryBranchId: body.primaryBranchId,
      reason: body.reason,
    });
    invalidateAuthoritativeConfiguration(db);
    await hydrateAuthoritativeConfiguration(db, env, true);
    return json({ ok: true, assignment: result });
  }
  const isRead =
    url.pathname === "/api/seramet/configuration" ||
    url.pathname === "/api/seramet/configuration/export";
  if (isRead && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    const db = requireDatabase(env);
    const repository = await hydrateAuthoritativeConfiguration(db, env);
    const state = scopeState(repository.snapshot(), actor.tenantId);
    if (url.pathname.endsWith("/export")) {
      requireAny(actor, [permissions.settingsOrganisationManage, permissions.auditView]);
      const exported = { ...state, users: [] };
      return json({
        ok: true,
        schemaVersion: exported.schemaVersion,
        exportedAt: new Date().toISOString(),
        configuration: exported,
        checksum: await sha256(JSON.stringify(exported)),
        excluded: ["provider secrets", "users", "sessions", "password material"],
      });
    }
    return json({ ok: true, source: "authoritative-server", configuration: state });
  }

  if (url.pathname === "/api/seramet/configuration/import" && request.method === "POST") {
    const actor = await authenticateSerametRequest(request, env);
    requireFullAuthentication(actor);
    requireAny(actor, [permissions.settingsOrganisationManage]);
    const db = requireDatabase(env);
    await new DatabaseRateLimiter(db).consume(
      `${actor.tenantId}:${actor.id}`,
      sensitiveRateLimits.configuration,
    );
    const body = await readImportBody(request);
    const next = body.configuration;
    assertImportSafe(next, actor.tenantId);
    new ConfigurationRepository(next, { persistBrowser: false });
    const current = scopeState(
      (await hydrateAuthoritativeConfiguration(db, env)).snapshot(),
      actor.tenantId,
    );
    const preview = buildPreview(current, next);
    if (body.mode === "PREVIEW") return json({ ok: true, preview });
    assertRolePermissionChangesDelegable(current, next, actor);
    await persistConfiguration(db, next, actor);
    invalidateAuthoritativeConfiguration(db);
    await hydrateAuthoritativeConfiguration(db, env, true);
    return json({ ok: true, applied: true, preview });
  }
  return null;
}

async function persistConfiguration(db: D1Database, state: PlatformState, actor: ServerActor) {
  const statements: D1PreparedStatement[] = [];
  const stamp = new Date().toISOString();
  for (const tenant of state.tenants) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tenants (id, slug, legal_name, trading_name, default_currency, timezone,
       locale, active, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET legal_name=excluded.legal_name, trading_name=excluded.trading_name,
       default_currency=excluded.default_currency, timezone=excluded.timezone, locale=excluded.locale,
       active=excluded.active, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
        )
        .bind(
          tenant.id,
          tenant.slug,
          tenant.legalName,
          tenant.tradingName,
          tenant.defaultCurrency,
          tenant.timezone,
          tenant.locale,
          tenant.active ? 1 : 0,
          JSON.stringify(tenant),
          tenant.createdAt || stamp,
          stamp,
        ),
    );
  }
  for (const brand of state.brands)
    statements.push(
      db
        .prepare(
          `INSERT INTO brands (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,?,?)
     ON CONFLICT(tenant_id,id) DO UPDATE SET code=excluded.code,name=excluded.name,
     active=excluded.active,payload_json=excluded.payload_json`,
        )
        .bind(
          brand.tenantId,
          brand.id,
          brand.code,
          brand.name,
          brand.active ? 1 : 0,
          JSON.stringify(brand),
        ),
    );
  for (const branch of state.branches)
    statements.push(
      db
        .prepare(
          `INSERT INTO branches (tenant_id,id,brand_id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
     VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO UPDATE SET brand_id=excluded.brand_id,
     code=excluded.code,name=excluded.name,timezone=excluded.timezone,active=excluded.active,payload_json=excluded.payload_json`,
        )
        .bind(
          branch.tenantId,
          branch.id,
          branch.brandId ?? null,
          branch.code,
          branch.name,
          branch.timezone ?? state.tenants[0]!.timezone,
          Number(branch.metadata["businessDayCutoffMinutes"] ?? 240),
          branch.active ? 1 : 0,
          JSON.stringify(branch),
        ),
    );
  for (const row of state.warehouses)
    statements.push(
      upsertPayload(
        db,
        "warehouses",
        ["tenant_id", "id", "branch_id", "code", "name", "active"],
        [row.tenantId, row.id, row.branchId, row.code, row.name, row.active ? 1 : 0],
        row,
      ),
    );
  for (const row of state.departments)
    statements.push(
      upsertPayload(
        db,
        "departments",
        ["tenant_id", "id", "branch_id", "code", "name", "active"],
        [row.tenantId, row.id, row.branchId ?? null, row.code, row.name, row.active ? 1 : 0],
        row,
      ),
    );
  for (const row of state.stations)
    statements.push(
      upsertPayload(
        db,
        "stations",
        ["tenant_id", "id", "branch_id", "code", "name", "station_type", "active"],
        [
          row.tenantId,
          row.id,
          row.branchId,
          row.code,
          row.name,
          row.stationType,
          row.active ? 1 : 0,
        ],
        row,
      ),
    );
  for (const row of state.serviceAreas)
    statements.push(
      upsertPayload(
        db,
        "service_areas",
        ["tenant_id", "id", "branch_id", "name", "active"],
        [row.tenantId, row.id, row.branchId, row.name, row.active ? 1 : 0],
        row,
      ),
    );
  for (const row of state.tables)
    statements.push(
      upsertPayload(
        db,
        "restaurant_tables",
        ["tenant_id", "id", "branch_id", "service_area_id", "code", "seats", "active"],
        [
          row.tenantId,
          row.id,
          row.branchId,
          row.serviceAreaId ?? null,
          row.code,
          row.seats,
          row.active ? 1 : 0,
        ],
        row,
      ),
    );
  for (const row of state.connections)
    statements.push(
      db
        .prepare(
          `INSERT INTO provider_connections (tenant_id,id,branch_id,provider_id,environment,status,
     secret_reference,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(tenant_id,id) DO UPDATE SET branch_id=excluded.branch_id,provider_id=excluded.provider_id,
     environment=excluded.environment,status=excluded.status,secret_reference=excluded.secret_reference,
     payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        )
        .bind(
          row.tenantId,
          row.id,
          row.branchId ?? null,
          row.providerId,
          row.environment,
          row.status,
          row.secretReference ?? null,
          JSON.stringify(redactConnection(row)),
          row.createdAt || stamp,
          stamp,
        ),
    );
  for (const row of state.paymentMethods)
    statements.push(
      upsertPayload(
        db,
        "payment_methods",
        [
          "tenant_id",
          "id",
          "code",
          "category",
          "provider_connection_id",
          "settlement_account_id",
          "clearing_account_id",
          "receivable_account_id",
          "cash_account_id",
          "active",
        ],
        [
          row.tenantId,
          row.id,
          row.code,
          row.category,
          row.providerConnectionId ?? null,
          row.settlementAccountId ?? null,
          row.clearingAccountId ?? null,
          row.receivableAccountId ?? null,
          row.cashAccountId ?? null,
          row.enabled ? 1 : 0,
        ],
        row,
      ),
    );
  for (const row of state.orderChannels)
    statements.push(
      upsertPayload(
        db,
        "order_channels",
        ["tenant_id", "id", "code", "channel_type", "active"],
        [row.tenantId, row.id, row.code, row.channelType, row.enabled ? 1 : 0],
        row,
      ),
    );
  for (const row of state.devices)
    statements.push(
      db
        .prepare(
          `INSERT INTO hardware_devices (tenant_id,id,branch_id,device_type,name,trust_status,registered_by,
     registered_at,payload_json) VALUES (?,?,?,?,?,'PENDING',?,?,?) ON CONFLICT(tenant_id,id)
     DO UPDATE SET branch_id=excluded.branch_id,device_type=excluded.device_type,name=excluded.name,payload_json=excluded.payload_json`,
        )
        .bind(
          row.tenantId,
          row.id,
          row.branchId,
          row.deviceType,
          row.name,
          actor.id,
          stamp,
          JSON.stringify(row),
        ),
    );
  for (const row of state.printRoutes)
    statements.push(
      upsertPayload(
        db,
        "print_routes",
        [
          "tenant_id",
          "id",
          "branch_id",
          "document_type",
          "primary_device_id",
          "fallback_device_id",
        ],
        [
          row.tenantId,
          row.id,
          row.branchId,
          row.documentType,
          row.primaryDeviceId,
          row.fallbackDeviceId ?? null,
        ],
        row,
      ),
    );
  for (const row of state.documentIdentities)
    statements.push(
      upsertPayload(
        db,
        "document_identities",
        ["tenant_id", "id", "branch_id"],
        [row.tenantId, row.id, row.branchId ?? null],
        row,
      ),
    );
  for (const row of state.documentTemplates)
    statements.push(
      upsertPayload(
        db,
        "document_templates",
        ["tenant_id", "id", "branch_id", "document_type", "layout_version", "active"],
        [
          row.tenantId,
          row.id,
          row.branchId ?? null,
          row.documentType,
          row.layoutVersion,
          row.active ? 1 : 0,
        ],
        row,
      ),
    );
  for (const code of allPermissionCodes)
    statements.push(
      db
        .prepare(
          "INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT(code) DO NOTHING",
        )
        .bind(code, code),
    );
  for (const row of state.roles) {
    statements.push(
      upsertPayload(
        db,
        "roles",
        ["tenant_id", "id", "code", "name", "active"],
        [row.tenantId, row.id, row.code, row.name, row.active ? 1 : 0],
        row,
      ),
    );
    statements.push(
      db
        .prepare("DELETE FROM role_permissions WHERE tenant_id=? AND role_id=?")
        .bind(row.tenantId, row.id),
    );
    for (const code of row.permissions)
      statements.push(
        db
          .prepare(
            "INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(row.tenantId, row.id, code),
      );
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,
     reason,correlation_id,session_id,metadata_json,created_at) VALUES (?,?,?,?,?,'CONFIGURATION_IMPORTED',
     'PLATFORM_CONFIGURATION',?,'Validated configuration import',?,?,?,?)`,
      )
      .bind(
        actor.tenantId,
        crypto.randomUUID(),
        actor.branchId ?? null,
        actor.id,
        actor.deviceId ?? null,
        actor.tenantId,
        crypto.randomUUID(),
        actor.sessionId ?? null,
        JSON.stringify({ collections: collectionCounts(state) }),
        stamp,
      ),
  );
  await db.batch(statements);
}

async function readRolePermissionsBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new SerametHttpError(400, "Role permission request must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SerametHttpError(400, "Role permission request is invalid");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["permissions", "reason"].includes(key))) {
    throw new SerametHttpError(400, "Role permission request contains unknown fields");
  }
  if (
    !Array.isArray(record["permissions"]) ||
    record["permissions"].length > allPermissionCodes.length ||
    record["permissions"].some((permission) => typeof permission !== "string")
  ) {
    throw new SerametHttpError(400, "Role permissions must be a bounded string array");
  }
  if (typeof record["reason"] !== "string") {
    throw new SerametHttpError(400, "Role permission change reason is required");
  }
  return { permissions: record["permissions"] as string[], reason: record["reason"] };
}

async function readUserBranchAssignmentBody(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new SerametHttpError(400, "Branch assignment request must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SerametHttpError(400, "Branch assignment request is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !["assignedBranchIds", "primaryBranchId", "reason"].includes(key),
    )
  ) {
    throw new SerametHttpError(400, "Branch assignment request contains unknown fields");
  }
  if (
    !Array.isArray(record["assignedBranchIds"]) ||
    record["assignedBranchIds"].length < 1 ||
    record["assignedBranchIds"].length > 100 ||
    record["assignedBranchIds"].some((branchId) => typeof branchId !== "string" || !branchId.trim())
  ) {
    throw new SerametHttpError(400, "assignedBranchIds must contain one to 100 branch IDs");
  }
  if (typeof record["primaryBranchId"] !== "string" || !record["primaryBranchId"].trim()) {
    throw new SerametHttpError(400, "primaryBranchId is required");
  }
  if (typeof record["reason"] !== "string") {
    throw new SerametHttpError(400, "Branch assignment reason is required");
  }
  return {
    assignedBranchIds: record["assignedBranchIds"] as string[],
    primaryBranchId: record["primaryBranchId"],
    reason: record["reason"],
  };
}

function upsertPayload(
  db: D1Database,
  table: string,
  columns: string[],
  values: unknown[],
  payload: unknown,
) {
  const allColumns = [...columns, "payload_json"];
  const updates = allColumns
    .slice(2)
    .map((column) => `${column}=excluded.${column}`)
    .join(",");
  return db
    .prepare(
      `INSERT INTO ${table} (${allColumns.join(",")}) VALUES (${allColumns.map(() => "?").join(",")})
    ON CONFLICT(tenant_id,id) DO UPDATE SET ${updates}`,
    )
    .bind(...values, JSON.stringify(payload));
}

function scopeState(state: PlatformState, tenantId: string): PlatformState {
  const scoped = <T extends { tenantId: string }>(rows: T[]) =>
    rows.filter((row) => row.tenantId === tenantId);
  return {
    ...state,
    tenants: state.tenants.filter((row) => row.id === tenantId),
    brands: scoped(state.brands),
    branches: scoped(state.branches),
    warehouses: scoped(state.warehouses),
    departments: scoped(state.departments),
    stations: scoped(state.stations),
    serviceAreas: scoped(state.serviceAreas),
    tables: scoped(state.tables),
    paymentMethods: scoped(state.paymentMethods),
    orderChannels: scoped(state.orderChannels),
    connections: scoped(state.connections),
    devices: scoped(state.devices),
    printRoutes: scoped(state.printRoutes),
    documentIdentities: scoped(state.documentIdentities),
    documentTemplates: scoped(state.documentTemplates),
    roles: scoped(state.roles),
    users: scoped(state.users),
  };
}

function assertImportSafe(state: PlatformState, tenantId: string) {
  if (state.tenants.length !== 1 || state.tenants[0]?.id !== tenantId)
    throw new SerametHttpError(403, "Import tenant does not match authenticated tenant");
  const scopedCollections = [
    state.brands,
    state.branches,
    state.warehouses,
    state.departments,
    state.stations,
    state.serviceAreas,
    state.tables,
    state.paymentMethods,
    state.orderChannels,
    state.connections,
    state.devices,
    state.printRoutes,
    state.documentIdentities,
    state.documentTemplates,
    state.roles,
  ];
  if (scopedCollections.some((rows) => rows.some((row) => row.tenantId !== tenantId)))
    throw new SerametHttpError(403, "Cross-tenant configuration import rejected");
  if (state.users.length)
    throw new SerametHttpError(
      400,
      "User accounts cannot be imported through configuration import",
    );
  const secretPattern = /secret|password|passkey|token|private.?key|authorization|cvv|pan/i;
  for (const connection of state.connections)
    if (Object.keys(connection.configuration).some((key) => secretPattern.test(key)))
      throw new SerametHttpError(400, "Provider secrets are not accepted in configuration imports");
}

function assertRolePermissionChangesDelegable(
  current: PlatformState,
  next: PlatformState,
  actor: ServerActor,
) {
  if (actor.permissions.includes(permissions.enterpriseAccessManage)) return;
  const currentByRole = new Map(current.roles.map((role) => [role.id, new Set(role.permissions)]));
  const unauthorized = new Set<string>();
  for (const role of next.roles) {
    const before = currentByRole.get(role.id) ?? new Set<string>();
    const after = new Set(role.permissions);
    for (const code of new Set([...before, ...after])) {
      if (before.has(code) !== after.has(code) && !actor.permissions.includes(code)) {
        unauthorized.add(code);
      }
    }
  }
  if (unauthorized.size) {
    throw new SerametHttpError(
      403,
      "Configuration import cannot change permissions outside the actor's delegated authority",
    );
  }
}

async function readImportBody(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => !["mode", "configuration"].includes(key));
  if (unknown.length) throw new SerametHttpError(400, `Unknown fields: ${unknown.join(", ")}`);
  if (body["mode"] !== "PREVIEW" && body["mode"] !== "APPLY")
    throw new SerametHttpError(400, "mode must be PREVIEW or APPLY");
  if (!body["configuration"] || typeof body["configuration"] !== "object")
    throw new SerametHttpError(400, "configuration is required");
  return {
    mode: body["mode"] as "PREVIEW" | "APPLY",
    configuration: body["configuration"] as PlatformState,
  };
}

function buildPreview(current: PlatformState, next: PlatformState) {
  const before = collectionCounts(current);
  const after = collectionCounts(next);
  return {
    before,
    after,
    conflicts: Object.keys(after)
      .filter((key) => after[key]! < before[key]!)
      .map((collection) => ({ collection, type: "OMITTED_RECORDS_RETAINED" })),
  };
}
function collectionCounts(state: PlatformState): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length]),
  );
}
function redactConnection<T extends { configuration: Record<string, unknown> }>(value: T) {
  const sensitive = /secret|password|passkey|token|private.?key|authorization|cvv|pan/i;
  return {
    ...value,
    configuration: Object.fromEntries(
      Object.entries(value.configuration).filter(([key]) => !sensitive.test(key)),
    ),
  };
}
function requireAny(actor: ServerActor, required: string[]) {
  if (!required.some((code) => actor.permissions.includes(code)))
    throw new SerametHttpError(403, "Configuration permission is required");
}
function requireDatabase(env: SerametEnv) {
  if (!env.SERAMET_DB) throw new SerametHttpError(503, "Authoritative database is required");
  return env.SERAMET_DB;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
