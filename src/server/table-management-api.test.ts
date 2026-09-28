import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { permissions } from "@/platform/permissions";
import type { ServerActor, SerametEnv } from "@/lib/seramet-auth";
import { createMigratedTestDatabase, type SqliteD1TestDatabase } from "@/server/database/sqlite-test-adapter";
import { handleTableManagementApi } from "@/server/table-management-api";

let activeActor: ServerActor;
const tenantId = "tenant-tables-test";
const branchId = "branch-tables-test";

vi.mock("@/lib/seramet-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/seramet-auth")>();
  return {
    ...actual,
    authenticateSerametRequest: async () => activeActor,
  };
});
vi.mock("@/server/database/authoritative-configuration", () => ({
  invalidateAuthoritativeConfiguration: vi.fn(),
  hydrateAuthoritativeConfiguration: vi.fn(async () => ({ snapshot: () => ({}) })),
}));

let db: SqliteD1TestDatabase;
let env: SerametEnv;

async function send(path: string,method:"GET"|"POST"|"PATCH"="GET",body?:Record<string,unknown>) {
  const request = new Request("https://tables.seramet.test"+path,{
    method,
    ...(body ? { headers:{"content-type":"application/json","origin":"https://tables.seramet.test"},
      body:JSON.stringify(body) } : {}),
  });
  const result = await handleTableManagementApi(request,env);
  if (!result) throw new Error("Route not handled");
  return result;
}

describe.sequential("branch table management",()=>{
  beforeEach(()=>{
    db=createMigratedTestDatabase();
    env={ SERAMET_DB:db,SERAMET_ENVIRONMENT:"test" };
    const now="2026-09-28T00:00:00.000Z";
    db.sqlite.prepare(
      "INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,'{}',?,?)",
    ).run(tenantId,"tables-test","Tables Test","Tables Test","KES","Africa/Nairobi","en-KE",now,now);
    db.sqlite.prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,active,payload_json,lifecycle_state) VALUES (?,?,?,?,?,1,'{}','CONFIGURING')",
    ).run(tenantId,branchId,"BR1","Westlands","Africa/Nairobi");
    activeActor={
      id:"owner",name:"Owner",tenantId,branchId,branch:"Westlands",sessionId:"session-1",
      roleIds:[],role:"Account Owner",authLevel:"FULL",assignedBranchIds:[branchId],
      assignedBranches:[{id:branchId,name:"Westlands",isPrimary:true}],
      branchScope:{type:"BRANCH",branchId},permissions:[permissions.tableManage,permissions.posAccess],
    };
  });
  afterEach(()=>db.close());

  it("creates a Dining area and a two-seat table with an audit trail",async()=>{
    const area=await send("/api/seramet/table-management/areas","POST",{branchId,name:"Dining"});
    expect(area.status).toBe(201);
    const areaId=((await area.json()) as {area:{id:string}}).area.id;
    const table=await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:areaId,code:"01",seats:2,
    });
    expect(table.status).toBe(201);
    const list=await send("/api/seramet/table-management?branchId="+branchId);
    expect(await list.json()).toMatchObject({
      ok:true,areas:[{id:areaId,branchId,name:"Dining",active:true}],
      tables:[{code:"01",seats:2,serviceAreaId:areaId,active:true}],
    });
    const events=db.sqlite.prepare(
      "SELECT action FROM audit_events WHERE tenant_id=? ORDER BY created_at",
    ).all(tenantId) as {action:string}[];
    expect(events.map((row)=>row.action).sort()).toEqual([
      "RESTAURANT_TABLE_CREATED","SERVICE_AREA_CREATED",
    ]);
  });

  it("rejects duplicates, invalid areas and seats, and branch overrides",async()=>{
    const area=await send("/api/seramet/table-management/areas","POST",{branchId,name:"Dining"});
    const id=((await area.json()) as {area:{id:string}}).area.id;
    expect((await send("/api/seramet/table-management/areas","POST",{branchId,name:"dining"})).status).toBe(409);
    expect((await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:id,code:"01",seats:0,
    })).status).toBe(400);
    expect((await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:"other-branch-area",code:"01",seats:2,
    })).status).toBe(400);
    expect((await send("/api/seramet/table-management/tables","POST",{
      branchId:"different-branch",serviceAreaId:id,code:"01",seats:2,
    })).status).toBe(403);
    expect((await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:id,code:"01",seats:2,
    })).status).toBe(201);
    expect((await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:id,code:"01",seats:2,
    })).status).toBe(409);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM restaurant_tables WHERE tenant_id=?").get(tenantId)).toMatchObject({count:1});
  });

  it("allows authorized edits but refuses deactivation while an order is open",async()=>{
    const area=await send("/api/seramet/table-management/areas","POST",{branchId,name:"Dining"});
    const areaId=((await area.json()) as {area:{id:string}}).area.id;
    const created=await send("/api/seramet/table-management/tables","POST",{
      branchId,serviceAreaId:areaId,code:"01",seats:2,
    });
    const tableId=((await created.json()) as {table:{id:string}}).table.id;
    db.sqlite.prepare(
      "INSERT INTO orders(tenant_id,id,branch_id,status,business_date,currency,total_minor,correlation_id,payload_json,created_at,updated_at) VALUES (?,?,?,'OPEN','2026-09-28','KES',0,'test','{\"table\":\"01\"}','2026-09-28','2026-09-28')",
    ).run(tenantId,"open-order",branchId);
    expect((await send("/api/seramet/table-management/tables/"+tableId,"PATCH",{
      branchId,serviceAreaId:areaId,seats:2,active:false,
    })).status).toBe(409);
    expect((await send("/api/seramet/table-management/tables/"+tableId,"PATCH",{
      branchId,serviceAreaId:areaId,seats:4,active:true,
    })).status).toBe(200);
    db.sqlite.prepare("UPDATE orders SET status='PAID' WHERE tenant_id=?").run(tenantId);
    expect((await send("/api/seramet/table-management/tables/"+tableId,"PATCH",{
      branchId,serviceAreaId:areaId,seats:4,active:false,
    })).status).toBe(200);
    expect(db.sqlite.prepare("SELECT seats,active FROM restaurant_tables WHERE tenant_id=? AND id=?")
      .get(tenantId,tableId)).toMatchObject({seats:4,active:0});
  });

  it("never grants table writes to an actor without table.manage",async()=>{
    activeActor={...activeActor,permissions:[permissions.posAccess]};
    const response=await send("/api/seramet/table-management/areas","POST",{branchId,name:"Dining"});
    expect(response.status).toBe(403);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM service_areas").get()).toMatchObject({count:0});
  });
});
