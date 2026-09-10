import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeBranchRead,
  type SerametEnv,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { DeviceType } from "@/platform/types";
import { moduleDecision, type ModuleKey } from "@/platform/module-access-registry";
import { ServerOperationError } from "@/server/errors";
import { handleConfigurationApi } from "@/server/configuration-api";
import { resolveServerModuleAccess } from "@/server/module-access-service";

const deviceTypes = new Set<DeviceType>([
  "POS_TERMINAL",
  "TABLET",
  "KDS",
  "PRINTER_BRIDGE",
  "MANAGER_DEVICE",
  "SELF_SERVICE",
  "PRINTER",
  "SCANNER",
  "CASH_DRAWER",
  "OTHER",
]);

const pagedEntityTypes: Record<string, string> = {
  orders: "state:orders",
  invoices: "state:bills",
  payments: "payments:transactions",
  settlements: "payments:settlementBatches",
  bank: "payments:bankTransactions",
  inventoryMovements: "state:stockMovements",
  audit: "state:auditEvents",
};

const pagedCollectionModules: Record<string, ModuleKey> = {
  orders: "orders",
  invoices: "invoices",
  payments: "payments",
  settlements: "payments",
  bank: "payments",
  inventoryMovements: "inventory",
  audit: "audit",
};

export async function handleOperationsApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const configurationResponse = await handleConfigurationApi(request, env);
  if (configurationResponse) return configurationResponse;
  if (url.pathname === "/api/seramet/auth/session" && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    const moduleAccess = await resolveServerModuleAccess(requireDatabase(env), actor);
    return json({
      ok: true,
      actor: {
        id: actor.id,
        name: actor.name,
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        branch: actor.branch,
        roles: actor.roleIds,
        permissions: actor.permissions,
        assignedBranches: actor.assignedBranches,
        primaryBranchId: actor.primaryBranchId,
        sessionId: actor.sessionId,
        deviceId: actor.deviceId,
        moduleAccess,
      },
    });
  }

  if (url.pathname === "/api/seramet/access/modules" && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    return json({
      ok: true,
      moduleAccess: await resolveServerModuleAccess(requireDatabase(env), actor),
    });
  }

  if (url.pathname === "/api/seramet/auth/logout" && request.method === "POST") {
    const actor = await authenticateSerametRequest(request, env);
    if (env.SERAMET_DB && actor.sessionId) {
      await env.SERAMET_DB.prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE tenant_id = ? AND id = ? AND revoked_at IS NULL",
      )
        .bind(new Date().toISOString(), actor.tenantId, actor.sessionId)
        .run();
    }
    return json({ ok: true });
  }

  const queryRoute = /^\/api\/seramet\/query\/([^/]+)$/.exec(url.pathname);
  if (queryRoute && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    const db = requireDatabase(env);
    const collection = decodeURIComponent(queryRoute[1]!);
    const entityType = pagedEntityTypes[collection];
    if (!entityType) throw new SerametHttpError(404, "Unsupported authoritative collection");
    const access = await resolveServerModuleAccess(db, actor);
    const decision = moduleDecision(access, pagedCollectionModules[collection]!);
    if (!decision?.actions.READ) {
      throw new SerametHttpError(
        403,
        "Module read permission, scope, entitlement or policy denied",
      );
    }
    const requestedBranch = url.searchParams.get("branchId")?.trim();
    const branchId =
      requestedBranch || (actor.branchScope.type === "BRANCH" ? actor.branchId : undefined);
    if (branchId) authorizeBranchRead(actor, actor.tenantId, branchId);
    const limit = boundedLimit(url.searchParams.get("limit"));
    const status = url.searchParams.get("status")?.trim();
    if (status && !/^[A-Z][A-Z0-9_]{0,39}$/.test(status)) {
      throw new SerametHttpError(400, "Status filter is invalid");
    }
    const cursor = parseCursor(url.searchParams.get("cursor"));
    const predicates = ["tenant_id = ?", "entity_type = ?"];
    const values: unknown[] = [actor.tenantId, entityType];
    if (branchId) {
      predicates.push("branch_id = ?");
      values.push(branchId);
    }
    if (status) {
      predicates.push("status = ?");
      values.push(status);
    }
    if (cursor) {
      predicates.push("(updated_at < ? OR (updated_at = ? AND entity_id < ?))");
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    values.push(limit + 1);
    const rows = await db
      .prepare(
        `SELECT entity_id,branch_id,status,payload_json,version,created_at,updated_at
       FROM authoritative_records WHERE ${predicates.join(" AND ")}
       ORDER BY updated_at DESC, entity_id DESC LIMIT ?`,
      )
      .bind(...values)
      .all<{
        entity_id: string;
        branch_id: string | null;
        status: string | null;
        payload_json: string;
        version: number;
        created_at: string;
        updated_at: string;
      }>();
    const page = (rows.results ?? []).slice(0, limit);
    const last = page.at(-1);
    return json({
      ok: true,
      collection,
      items: page.map((row) => ({
        id: row.entity_id,
        branchId: row.branch_id,
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        data: JSON.parse(row.payload_json),
      })),
      nextCursor:
        (rows.results?.length ?? 0) > limit && last
          ? JSON.stringify({ updatedAt: last.updated_at, id: last.entity_id })
          : null,
    });
  }

  if (url.pathname === "/api/seramet/query/aggregates/operations" && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    const db = requireDatabase(env);
    const requestedBranch = url.searchParams.get("branchId")?.trim();
    const branchId =
      requestedBranch || (actor.branchScope.type === "BRANCH" ? actor.branchId : undefined);
    if (branchId) authorizeBranchRead(actor, actor.tenantId, branchId);
    const result = branchId
      ? await db
          .prepare(
            `SELECT entity_type,status,COUNT(*) AS count FROM authoritative_records
           WHERE tenant_id=? AND branch_id=? GROUP BY entity_type,status`,
          )
          .bind(actor.tenantId, branchId)
          .all()
      : await db
          .prepare(
            `SELECT entity_type,status,COUNT(*) AS count FROM authoritative_records
           WHERE tenant_id=? GROUP BY entity_type,status`,
          )
          .bind(actor.tenantId)
          .all();
    return json({ ok: true, branchId: branchId ?? null, groups: result.results ?? [] });
  }

  if (url.pathname === "/api/seramet/devices" && request.method === "GET") {
    const actor = await requirePermission(request, env, permissions.settingsHardwareManage);
    const db = requireDatabase(env);
    const result = await db
      .prepare(
        `SELECT id, branch_id, device_type, name, trust_status, registered_at, revoked_at, last_seen_at
         FROM hardware_devices WHERE tenant_id = ? ORDER BY registered_at DESC LIMIT 250`,
      )
      .bind(actor.tenantId)
      .all();
    return json({ ok: true, devices: result.results ?? [] });
  }

  if (url.pathname === "/api/seramet/devices/register" && request.method === "POST") {
    const actor = await requirePermission(request, env, permissions.settingsHardwareManage);
    const db = requireDatabase(env);
    const body = await readObject(request, ["branchId", "deviceType", "name"]);
    const branchId = requiredString(body, "branchId");
    authorizeBranchRead(actor, actor.tenantId, branchId);
    const deviceType = requiredString(body, "deviceType") as DeviceType;
    if (!deviceTypes.has(deviceType)) throw new SerametHttpError(400, "Unsupported device type");
    const name = requiredString(body, "name");
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO hardware_devices
          (tenant_id, id, branch_id, device_type, name, trust_status, registered_by,
           registered_at, payload_json)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, '{}')`,
      )
      .bind(actor.tenantId, id, branchId, deviceType, name, actor.id, stamp)
      .run();
    await appendAudit(db, actor, "DEVICE_REGISTERED", "HARDWARE_DEVICE", id, stamp);
    return json({ ok: true, device: { id, branchId, deviceType, name, status: "PENDING" } }, 201);
  }

  const deviceAction = /^\/api\/seramet\/devices\/([^/]+)\/(activate|revoke)$/.exec(url.pathname);
  if (deviceAction && request.method === "POST") {
    const actor = await requirePermission(request, env, permissions.settingsHardwareManage);
    const db = requireDatabase(env);
    const id = decodeURIComponent(deviceAction[1]!);
    const status = deviceAction[2] === "activate" ? "ACTIVE" : "REVOKED";
    const stamp = new Date().toISOString();
    await db
      .prepare(
        `UPDATE hardware_devices
         SET trust_status = ?, revoked_at = CASE WHEN ? = 'REVOKED' THEN ? ELSE NULL END
         WHERE tenant_id = ? AND id = ?`,
      )
      .bind(status, status, stamp, actor.tenantId, id)
      .run();
    if (status === "REVOKED") {
      await db
        .prepare(
          "UPDATE auth_sessions SET revoked_at = ? WHERE tenant_id = ? AND device_id = ? AND revoked_at IS NULL",
        )
        .bind(stamp, actor.tenantId, id)
        .run();
    }
    await appendAudit(db, actor, `DEVICE_${status}`, "HARDWARE_DEVICE", id, stamp);
    return json({ ok: true, id, status });
  }

  if (url.pathname === "/api/seramet/system/health" && request.method === "GET") {
    const actor = await authenticateSerametRequest(request, env);
    if (
      !actor.permissions.includes(permissions.auditView) &&
      !actor.permissions.includes(permissions.settingsIntegrationManage)
    ) {
      throw new SerametHttpError(403, "Operations health permission is required");
    }
    const db = requireDatabase(env);
    const [schema, jobs, deadLetters, backup] = await Promise.all([
      db
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .first<{ version: number }>(),
      db
        .prepare(
          `SELECT status, COUNT(*) AS count FROM worker_jobs
           WHERE tenant_id = ? GROUP BY status`,
        )
        .bind(actor.tenantId)
        .all<{ status: string; count: number }>(),
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM integration_dead_letters
           WHERE tenant_id = ? AND status = 'OPEN'`,
        )
        .bind(actor.tenantId)
        .first<{ count: number }>(),
      db
        .prepare(
          `SELECT status, completed_at, verified_at FROM backup_records
           WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 1`,
        )
        .bind(actor.tenantId)
        .first<{ status: string; completed_at: string | null; verified_at: string | null }>(),
    ]);
    return json({
      ok: true,
      database: { status: "available", schemaVersion: schema?.version ?? 0 },
      queue: { status: env.SERAMET_WORK_QUEUE ? "available" : "unavailable" },
      workers: jobs.results ?? [],
      deadLetters: deadLetters?.count ?? 0,
      backup: backup ?? null,
      build: {
        version: env.SERAMET_APP_VERSION ?? "0.5.0",
        buildId: env.SERAMET_BUILD_ID ?? "development",
        environment: env.SERAMET_ENVIRONMENT ?? env.NODE_ENV ?? "development",
      },
    });
  }

  return null;
}

async function requirePermission(request: Request, env: SerametEnv, permission: string) {
  const actor = await authenticateSerametRequest(request, env);
  if (!actor.permissions.includes(permission)) {
    throw new SerametHttpError(403, `${permission} permission is required`);
  }
  return actor;
}

function requireDatabase(env: SerametEnv) {
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative database unavailable",
    );
  }
  return env.SERAMET_DB;
}

async function appendAudit(
  db: NonNullable<SerametEnv["SERAMET_DB"]>,
  actor: Awaited<ReturnType<typeof authenticateSerametRequest>>,
  action: string,
  entityType: string,
  entityId: string,
  stamp: string,
) {
  await db
    .prepare(
      `INSERT INTO audit_events
        (tenant_id, id, branch_id, actor_id, device_id, action, entity_type, entity_id,
         correlation_id, session_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
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
      stamp,
    )
    .run();
}

async function readObject(request: Request, allowed: string[]) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SerametHttpError(400, "Request body must be an object");
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new SerametHttpError(400, `Unknown fields: ${unknown.join(", ")}`);
  return record;
}

function requiredString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new SerametHttpError(400, `${key} is required`);
  return value.trim();
}

function boundedLimit(value: string | null) {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1) throw new SerametHttpError(400, "Limit is invalid");
  return Math.min(parsed, 200);
}

function parseCursor(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") throw new Error();
    if (!Number.isFinite(Date.parse(parsed.updatedAt)) || !parsed.id) throw new Error();
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new SerametHttpError(400, "Cursor is invalid");
  }
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
