import { z } from "zod";
import {
  authenticateSerametRequest,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";
import {
  hydrateAuthoritativeConfiguration,
  invalidateAuthoritativeConfiguration,
} from "@/server/database/authoritative-configuration";
import { requireFullAuthentication } from "@/server/pos-auth-service";

const createTableSchema = z
  .object({
    code: z.string().trim().min(1).max(16).regex(/^[a-zA-Z0-9-]+$/, "Use letters, numbers or hyphens"),
    seats: z.number().int().min(1).max(30),
    serviceAreaId: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict();

export type CreateTableInput = z.infer<typeof createTableSchema>;
type TableActor = Pick<ServerActor, "tenantId" | "branchId" | "id" | "permissions">;

export function parseCreateTableInput(raw: unknown): CreateTableInput {
  const result = createTableSchema.safeParse(raw);
  if (!result.success) {
    throw new SerametHttpError(
      400,
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return result.data;
}

export async function createConfiguredTable(
  db: D1Database,
  actor: TableActor,
  raw: unknown,
) {
  if (!actor.permissions.includes(permissions.tableManage))
    throw new SerametHttpError(403, "Table management permission is required");
  if (!actor.branchId)
    throw new SerametHttpError(400, "Select your restaurant branch first");
  const data = parseCreateTableInput(raw);
  const code = data.code.toUpperCase();
  const branch = await db
    .prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
    .bind(actor.tenantId, actor.branchId)
    .first<{ id: string }>();
  if (!branch) throw new SerametHttpError(404, "Active restaurant branch was not found");

  const areaId = data.serviceAreaId ?? null;
  if (areaId) {
    const area = await db
      .prepare(
        "SELECT id FROM service_areas WHERE tenant_id=? AND id=? AND branch_id=? AND active=1",
      )
      .bind(actor.tenantId, areaId, actor.branchId)
      .first<{ id: string }>();
    if (!area) throw new SerametHttpError(400, "The selected area is not in this branch");
  }
  const duplicate = await db
    .prepare(
      "SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND UPPER(code)=?",
    )
    .bind(actor.tenantId, actor.branchId, code)
    .first<{ id: string }>();
  if (duplicate) throw new SerametHttpError(409, "A table with this number already exists");

  const id = `table-${crypto.randomUUID()}`;
  const stamp = new Date().toISOString();
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO restaurant_tables
            (tenant_id,id,branch_id,service_area_id,code,seats,active,payload_json)
           VALUES (?,?,?,?,?,?,1,'{}')`,
        )
        .bind(actor.tenantId, id, actor.branchId, areaId, code, data.seats),
      db
        .prepare(
          `INSERT INTO audit_events
            (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,
             reason,correlation_id,metadata_json,created_at)
           VALUES (?,?,?,?,'RESTAURANT_TABLE_CREATED','RESTAURANT_TABLE',?,
                   'Authorized restaurant table setup',?,?,?)`,
        )
        .bind(
          actor.tenantId,
          crypto.randomUUID(),
          actor.branchId,
          actor.id,
          id,
          crypto.randomUUID(),
          JSON.stringify({ code, seats: data.seats, serviceAreaId: areaId }),
          stamp,
        ),
    ]);
  } catch (error) {
    // Keep a concurrent duplicate from leaking SQL details into the UI.
    if (error instanceof Error && /unique|duplicate|23505/i.test(error.message)) {
      throw new SerametHttpError(409, "A table with this number already exists");
    }
    throw error;
  }
  return { id, code, seats: data.seats, branchId: actor.branchId, serviceAreaId: areaId };
}

export async function handleTableManagementApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/seramet/tables/configuration") return null;
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ message: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json", "allow": "POST" },
    });
  }
  const actor = await authenticateSerametRequest(request, env);
  requireFullAuthentication(actor);
  if (!env.SERAMET_DB)
    throw new SerametHttpError(503, "Restaurant database is unavailable");
  const raw: unknown = await request.json().catch(() => {
    throw new SerametHttpError(400, "Please provide valid table details");
  });
  const table = await createConfiguredTable(env.SERAMET_DB, actor, raw);
  invalidateAuthoritativeConfiguration(env.SERAMET_DB);
  await hydrateAuthoritativeConfiguration(env.SERAMET_DB, env, true);
  return new Response(JSON.stringify({ ok: true, table }), {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
