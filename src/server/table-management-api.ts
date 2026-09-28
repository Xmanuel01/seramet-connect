import { z } from "zod";
import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeBranchRead,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import {
  hydrateAuthoritativeConfiguration,
  invalidateAuthoritativeConfiguration,
} from "@/server/database/authoritative-configuration";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { requireFullAuthentication } from "@/server/pos-auth-service";

const prefix = "/api/seramet/table-management";
const areaInput = z.object({
  branchId: z.string().min(1),
  name: z.string().trim().min(2).max(60),
}).strict();
const tableInput = z.object({
  branchId: z.string().min(1),
  serviceAreaId: z.string().min(1),
  code: z.string().trim().regex(/^[a-zA-Z0-9_-]{1,16}$/).transform((value) => value.toUpperCase()),
  seats: z.number().int().min(1).max(24),
}).strict();
const editInput = z.object({
  branchId: z.string().min(1),
  serviceAreaId: z.string().min(1),
  seats: z.number().int().min(1).max(24),
  active: z.boolean(),
}).strict();

type AreaRecord = {
  id: string;
  tenant_id: string;
  branch_id: string;
  name: string;
  active: number;
};
type TableRecord = {
  id: string;
  tenant_id: string;
  branch_id: string;
  service_area_id: string | null;
  code: string;
  seats: number;
  active: number;
};

export async function handleTableManagementApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== prefix &&
      url.pathname !== prefix + "/areas" &&
      url.pathname !== prefix + "/tables" &&
      !/^\/api\/seramet\/table-management\/tables\/[^/]+$/.test(url.pathname)) return null;

  const db = env.SERAMET_DB;
  if (!db) throw new SerametHttpError(503, "Authoritative database is unavailable");
  const actor = await authenticateSerametRequest(request, env);

  if (url.pathname === prefix && request.method === "GET") {
    if (!actor.permissions.some((permission) =>
      [permissions.tableManage, permissions.posAccess, permissions.reservationView].includes(
        permission as typeof permissions.tableManage,
      ))) {
      throw new SerametHttpError(403, "Table or POS access is required");
    }
    const branchId = url.searchParams.get("branchId")?.trim();
    if (!branchId) throw new SerametHttpError(400, "branchId is required");
    authorizeBranchRead(actor, branchId);
    await assertBranch(db, actor.tenantId, branchId);
    const areas = await db.prepare(
      "SELECT id,tenant_id,branch_id,name,active FROM service_areas WHERE tenant_id=? AND branch_id=? ORDER BY name,id",
    ).bind(actor.tenantId, branchId).all<AreaRecord>();
    const tables = await db.prepare(
      "SELECT id,tenant_id,branch_id,service_area_id,code,seats,active FROM restaurant_tables WHERE tenant_id=? AND branch_id=? ORDER BY code,id",
    ).bind(actor.tenantId, branchId).all<TableRecord>();
    return json({ ok: true, areas: (areas.results ?? []).map(toArea), tables: (tables.results ?? []).map(toTable) });
  }

  requireFullAuthentication(actor);
  if (!actor.permissions.includes(permissions.tableManage)) {
    throw new SerametHttpError(403, "table.manage permission is required");
  }

  if (url.pathname === prefix + "/areas" && request.method === "POST") {
    const input = parseBody(areaInput, await parseJson(request));
    requireActiveBranch(actor, input.branchId);
    await assertBranch(db, actor.tenantId, input.branchId);
    const existing = await db.prepare(
      "SELECT id FROM service_areas WHERE tenant_id=? AND branch_id=? AND LOWER(TRIM(name))=LOWER(?)",
    ).bind(actor.tenantId, input.branchId, input.name).first<{id:string}>();
    if (existing) throw new SerametHttpError(409, "An area with that name already exists");
    const id = await deterministicAreaId(actor.tenantId, input.branchId, input.name);
    const area = { id, tenantId: actor.tenantId, branchId: input.branchId, name: input.name, active: true };
    await auditedBatch(db, actor, input.branchId, "SERVICE_AREA_CREATED", "SERVICE_AREA", id,
      [db.prepare(
        "INSERT INTO service_areas (tenant_id,id,branch_id,name,active,payload_json) VALUES (?,?,?,?,1,?)",
      ).bind(actor.tenantId,id,input.branchId,input.name,JSON.stringify(area))]);
    await refresh(db, env);
    return json({ ok:true, area },201);
  }

  if (url.pathname === prefix + "/tables" && request.method === "POST") {
    const input = parseBody(tableInput, await parseJson(request));
    requireActiveBranch(actor, input.branchId);
    await assertBranch(db, actor.tenantId, input.branchId);
    await assertArea(db, actor.tenantId, input.branchId, input.serviceAreaId);
    const existing = await db.prepare(
      "SELECT id FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND UPPER(code)=?",
    ).bind(actor.tenantId,input.branchId,input.code).first();
    if (existing) throw new SerametHttpError(409, "That table number is already in use");
    const id = crypto.randomUUID();
    const table = { id,tenantId:actor.tenantId,branchId:input.branchId,serviceAreaId:input.serviceAreaId,
      code:input.code,seats:input.seats,active:true };
    await auditedBatch(db,actor,input.branchId,"RESTAURANT_TABLE_CREATED","RESTAURANT_TABLE",id,
      [db.prepare(
        "INSERT INTO restaurant_tables (tenant_id,id,branch_id,service_area_id,code,seats,active,payload_json) VALUES (?,?,?,?,?,?,1,?)",
      ).bind(actor.tenantId,id,input.branchId,input.serviceAreaId,input.code,input.seats,JSON.stringify(table))]);
    await refresh(db,env);
    return json({ok:true,table},201);
  }

  const editMatch = /^\/api\/seramet\/table-management\/tables\/([^/]+)$/.exec(url.pathname);
  if (editMatch && request.method === "PATCH") {
    const id = decodeURIComponent(editMatch[1]!);
    const input = parseBody(editInput, await parseJson(request));
    requireActiveBranch(actor,input.branchId);
    await assertBranch(db,actor.tenantId,input.branchId);
    await assertArea(db,actor.tenantId,input.branchId,input.serviceAreaId);
    const current = await db.prepare(
      "SELECT * FROM restaurant_tables WHERE tenant_id=? AND branch_id=? AND id=?",
    ).bind(actor.tenantId,input.branchId,id).first<TableRecord & {payload_json:string}>();
    if (!current) throw new SerametHttpError(404,"Table not found in this branch");
    if (!input.active && current.active === 1) {
      await assertNoOpenOrders(db,actor.tenantId,input.branchId,current.code);
    }
    const table = { ...parsePayload(current.payload_json), id,tenantId:actor.tenantId,branchId:input.branchId,
      serviceAreaId:input.serviceAreaId,code:current.code,seats:input.seats,active:input.active };
    await auditedBatch(db,actor,input.branchId,"RESTAURANT_TABLE_UPDATED","RESTAURANT_TABLE",id,
      [db.prepare(
        "UPDATE restaurant_tables SET service_area_id=?,seats=?,active=?,payload_json=? WHERE tenant_id=? AND branch_id=? AND id=?",
      ).bind(input.serviceAreaId,input.seats,input.active?1:0,JSON.stringify(table),actor.tenantId,input.branchId,id)]);
    await refresh(db,env);
    return json({ok:true,table});
  }

  throw new SerametHttpError(405,"Unsupported table-management method");
}

async function deterministicAreaId(tenantId: string, branchId: string, name: string) {
  const key = tenantId + ":" + branchId + ":" + name.trim().toLowerCase();
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return "area-" + Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SerametHttpError(400,"Invalid table-management input");
  return parsed.data;
}
async function parseJson(request: Request) {
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > 2048) throw new SerametHttpError(413,"Request is too large");
  const body = await request.text();
  if (body.length > 2048) throw new SerametHttpError(413,"Request is too large");
  try { return JSON.parse(body) as unknown; }
  catch { throw new SerametHttpError(400,"Expected valid JSON"); }
}
function requireActiveBranch(actor: ServerActor, branchId: string) {
  if (branchId !== actor.branchId || !actor.assignedBranchIds.includes(branchId)) {
    throw new SerametHttpError(403,"Switch to the assigned branch before changing tables");
  }
}
async function assertBranch(db:D1Database,tenantId:string,branchId:string) {
  const result = await db.prepare("SELECT id FROM branches WHERE tenant_id=? AND id=? AND active=1")
    .bind(tenantId,branchId).first();
  if (!result) throw new SerametHttpError(404,"Active branch not found");
}
async function assertArea(db:D1Database,tenantId:string,branchId:string,id:string) {
  const area = await db.prepare("SELECT id FROM service_areas WHERE tenant_id=? AND branch_id=? AND id=? AND active=1")
    .bind(tenantId,branchId,id).first();
  if (!area) throw new SerametHttpError(400,"Choose an active area in this branch");
}
async function assertNoOpenOrders(db:D1Database,tenantId:string,branchId:string,code:string) {
  const orders = await db.prepare(
    "SELECT payload_json FROM orders WHERE tenant_id=? AND branch_id=? AND status IN ('DRAFT','HELD','OPEN','SENT_TO_KITCHEN','IN_PROGRESS','READY','SERVED','BILL_REQUESTED','AWAITING_PAYMENT','PARTIALLY_PAID')",
  ).bind(tenantId,branchId).all<{payload_json:string}>();
  if ((orders.results??[]).some(({payload_json})=>{
    try { const payload=JSON.parse(payload_json) as {table?:unknown}; return payload.table===code; }
    catch { return true; } // Fail closed on unparseable authoritative orders.
  })) throw new SerametHttpError(409,"Cannot deactivate a table with an open order");
}
function parsePayload(value:string):Record<string,unknown> {
  try { const parsed=JSON.parse(value) as unknown;return parsed && typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{}; }
  catch {return {};}
}
function toArea(row:AreaRecord) {
  return {id:row.id,tenantId:row.tenant_id,branchId:row.branch_id,name:row.name,active:row.active===1};
}
function toTable(row:TableRecord) {
  return {id:row.id,tenantId:row.tenant_id,branchId:row.branch_id,
    serviceAreaId:row.service_area_id??undefined,code:row.code,seats:row.seats,active:row.active===1};
}
async function auditedBatch(db:D1Database,actor:ServerActor,branchId:string,action:string,entityType:string,id:string,
  statements:D1PreparedStatement[]) {
  try {
    await db.batch([...statements,db.prepare(
      "INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,correlation_id,session_id,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(actor.tenantId,crypto.randomUUID(),branchId,actor.id,actor.deviceId??null,action,entityType,id,
      "Authorized branch table management",crypto.randomUUID(),actor.sessionId??null,"{}",new Date().toISOString())]);
  } catch(error) {
    if (typeof error==="object" && error && "code" in error && ((error as {code?:unknown}).code==="23505" ||
      (error instanceof Error && /unique constraint/i.test(error.message)))) {
      throw new SerametHttpError(409,"This table or area already exists; refresh and retry");
    }
    throw error;
  }
}
async function refresh(db:D1Database,env:SerametEnv) {
  invalidateAuthoritativeConfiguration(db);
  await hydrateAuthoritativeConfiguration(db,env,true);
}
function json(body:unknown,status=200) {
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
