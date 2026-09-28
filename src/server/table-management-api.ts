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
    code: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[a-zA-Z0-9-]+$/, "Use letters, numbers or hyphens"),
    seats: z.number().int().min(1).max(30),
    serviceAreaId: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict();

export type CreateTableInput = z.infer<typeof createTableSchema>;
type TableActor = Pick<ServerActor, "tenantId" | "branchId" | "id" | "permissions">;

export function parseCreateTableInput(raw: unknown): CreateTableInput {
  const result = createTableSchema.safeParse(raw);
  if (!result.success) {
    throw new SerametHttpError(400, result.error.issues.map((issue) => issue.message).join("; "));
  }
  return result.data;
}

export async function createConfiguredTable(db: D1Database, actor: TableActor, raw: unknown) {
  if (!actor.permissions.includes(permissions.tableManage))
    throw new SerametHttpError(403, "Table management permission is required");
  if (!actor.branchId) throw new SerametHttpError(400, "Select your restaurant branch first");
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
    .prepare("SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND UPPER(code)=?")
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

const createAreaSchema = z
  .object({ name: z.string().trim().min(2).max(80) })
  .strict();

const updateTableSchema = z
  .object({
    seats: z.number().int().min(1).max(30),
    serviceAreaId: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export async function createServiceArea(db: D1Database, actor: TableActor, raw: unknown) {
  if (!actor.permissions.includes(permissions.tableManage))
    throw new SerametHttpError(403, "Table management permission is required");
  if (!actor.branchId) throw new SerametHttpError(400, "Select a restaurant branch");
  const parsed = createAreaSchema.safeParse(raw);
  if (!parsed.success) throw new SerametHttpError(400, "Enter a valid dining area name");
  const branch = await db.prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
    .bind(actor.tenantId, actor.branchId).first();
  if (!branch) throw new SerametHttpError(404, "Active restaurant branch was not found");
  const duplicate = await db.prepare(
    "SELECT id FROM service_areas WHERE tenant_id=? AND branch_id=? AND LOWER(name)=LOWER(?)",
  ).bind(actor.tenantId, actor.branchId, parsed.data.name).first();
  if (duplicate) throw new SerametHttpError(409, "A dining area with that name already exists");
  const id = `area-${crypto.randomUUID()}`;
  const stamp = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(
        "INSERT INTO service_areas (tenant_id,id,branch_id,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      ).bind(actor.tenantId,id,actor.branchId,parsed.data.name),
      db.prepare(
        `INSERT INTO audit_events
        (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
        VALUES (?,?,?,?,'SERVICE_AREA_CREATED','SERVICE_AREA',?,'Authorized restaurant area setup',?,?,?)`,
      ).bind(actor.tenantId,crypto.randomUUID(),actor.branchId,actor.id,id,crypto.randomUUID(),
        JSON.stringify({name:parsed.data.name}),stamp),
    ]);
  } catch (error) {
    if (error instanceof Error && /unique|duplicate|23505/i.test(error.message)) {
      throw new SerametHttpError(409, "A dining area with that name already exists");
    }
    throw error;
  }
  return {id,tenantId:actor.tenantId,branchId:actor.branchId,name:parsed.data.name,active:true};
}

/** Immutable table number. Capacity and area can change without rewriting historical order references. */
export async function updateConfiguredTable(
  db: D1Database, actor: TableActor, tableId: string, raw: unknown,
) {
  if (!actor.permissions.includes(permissions.tableManage))
    throw new SerametHttpError(403, "Table management permission is required");
  if (!actor.branchId) throw new SerametHttpError(400, "Select a restaurant branch");
  const parsed = updateTableSchema.safeParse(raw);
  if (!parsed.success) throw new SerametHttpError(400, "Provide valid table capacity and dining area");
  const current = await db.prepare(
    "SELECT id,code,seats,service_area_id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND id=? AND active=1",
  ).bind(actor.tenantId,actor.branchId,tableId).first<{
    id:string;code:string;seats:number;service_area_id:string|null;
  }>();
  if (!current) throw new SerametHttpError(404, "Active table is not available in this branch");
  const areaId = parsed.data.serviceAreaId;
  if (areaId) {
    const area = await db.prepare(
      "SELECT id FROM service_areas WHERE tenant_id=? AND branch_id=? AND id=? AND active=1",
    ).bind(actor.tenantId,actor.branchId,areaId).first();
    if (!area) throw new SerametHttpError(400, "Dining area is not in this branch");
  }
  const stamp = new Date().toISOString();
  await db.batch([
    db.prepare(
      "UPDATE restaurant_tables SET seats=?,service_area_id=? WHERE tenant_id=? AND branch_id=? AND id=? AND active=1",
    ).bind(parsed.data.seats,areaId,actor.tenantId,actor.branchId,tableId),
    db.prepare(
      `INSERT INTO audit_events
       (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
       VALUES (?,?,?,?,'RESTAURANT_TABLE_UPDATED','RESTAURANT_TABLE',?,'Authorized capacity or area change',?,?,?)`,
    ).bind(actor.tenantId,crypto.randomUUID(),actor.branchId,actor.id,tableId,crypto.randomUUID(),
      JSON.stringify({before:{seats:current.seats,serviceAreaId:current.service_area_id},
        after:{seats:parsed.data.seats,serviceAreaId:areaId}}),stamp),
  ]);
  return {id:tableId,code:current.code,seats:parsed.data.seats,serviceAreaId:areaId};
}

export async function handleTableManagementApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const tableEdit = /^\/api\/seramet\/tables\/configuration\/([^/]+)$/.exec(url.pathname);
  const isCreateTable = url.pathname === "/api/seramet/tables/configuration";
  const isCreateArea = url.pathname === "/api/seramet/tables/areas";
  if (!tableEdit && !isCreateTable && !isCreateArea) return null;
  if ((tableEdit && request.method !== "PATCH") ||
      (!tableEdit && request.method !== "POST")) {
    return new Response(JSON.stringify({message:"Method not allowed"}), {
      status:405,headers:{"content-type":"application/json",allow:tableEdit?"PATCH":"POST"},
    });
  }
  const actor = await authenticateSerametRequest(request,env);
  requireFullAuthentication(actor);
  if (!env.SERAMET_DB) throw new SerametHttpError(503,"Restaurant database is unavailable");
  const raw:unknown = await request.json().catch(() => {
    throw new SerametHttpError(400,"Please provide valid table details");
  });
  const response = tableEdit
    ? {table:await updateConfiguredTable(env.SERAMET_DB,actor,decodeURIComponent(tableEdit[1]!),raw)}
    : isCreateArea
      ? {area:await createServiceArea(env.SERAMET_DB,actor,raw)}
      : {table:await createConfiguredTable(env.SERAMET_DB,actor,raw)};
  invalidateAuthoritativeConfiguration(env.SERAMET_DB);
  await hydrateAuthoritativeConfiguration(env.SERAMET_DB,env,true);
  return new Response(JSON.stringify({ok:true,...response}), {
    status:tableEdit?200:201,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
  });
}
