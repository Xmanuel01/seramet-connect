import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentListService } from "@/server/documents-api";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenant = "docs-tenant";
const other = "docs-other";
const stamp = "2026-11-02T10:00:00.000Z";

function actor(branchId = "westlands", permissionList: string[] = allPermissionCodes): ServerActor {
  return {
    id: "docs-actor",
    name: "Test cashier",
    tenantId: tenant,
    roleIds: ["role"],
    permissions: [...permissionList],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    branch: branchId,
    role: "Cashier",
  };
}

function seed(db: SqliteD1TestDatabase) {
  const sql = db.sqlite;
  for (const id of [tenant, other])
    sql
      .prepare(
        "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
      )
      .run(id, id, id, id, stamp, stamp);
  for (const [t, branch] of [
    [tenant, "westlands"],
    [tenant, "ngong"],
    [other, "elsewhere"],
  ])
    sql
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
      )
      .run(t, branch, branch, branch);
  const invoice = (
    t: string,
    id: string,
    branch: string,
    date: string,
    status: string,
    total: number,
    paid: number,
  ) =>
    sql
      .prepare(
        "INSERT INTO invoices (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,paid_minor,version,payload_json,created_at,updated_at) VALUES (?,?,?,?,?,?, 'KES',?,?,1,?,?,?)",
      )
      .run(
        t,
        id,
        branch,
        id,
        status,
        date,
        total,
        paid,
        JSON.stringify({ id, status }),
        stamp,
        stamp,
      );
  invoice(tenant, "INV-1", "westlands", "2026-11-02", "PAID", 1000, 1000);
  invoice(tenant, "INV-2", "westlands", "2026-11-02", "OPEN", 1000, 0);
  invoice(tenant, "INV-3", "westlands", "2026-11-02", "OPEN", 1000, 400);
  invoice(tenant, "INV-4", "westlands", "2026-10-15", "PAID", 500, 500);
  invoice(tenant, "INV-5", "westlands", "2026-11-02", "SPLIT", 2000, 0);
  invoice(tenant, "INV-6", "ngong", "2026-11-02", "PAID", 700, 700);
  invoice(other, "INV-X", "elsewhere", "2026-11-02", "PAID", 900, 900);
  for (const [id, invoiceId, date] of [
    ["RCP-1", "INV-1", "2026-11-02"],
    ["RCP-4", "INV-4", "2026-10-15"],
  ])
    sql
      .prepare(
        "INSERT INTO receipts (tenant_id,id,branch_id,receipt_number,invoice_id,payment_transaction_id,business_date,original,reprint_count,payload_json,created_at) VALUES (?,?,?,?,?,NULL,?,1,0,?,?)",
      )
      .run(tenant, id, "westlands", id, invoiceId, date, JSON.stringify({ id, invoiceId }), stamp);
}

describe("invoice and receipt lists by date", () => {
  let db: SqliteD1TestDatabase;
  beforeEach(() => {
    db = createMigratedTestDatabase();
    seed(db);
  });
  afterEach(() => db.close());

  const today = { from: "2026-11-02", to: "2026-11-02" };

  it("returns only the branch and dates asked for, newest first, without merged or split bills", async () => {
    const page = await new DocumentListService(db, actor()).invoices(today);
    // Same date and time, so the newest id comes first.
    expect(page.rows.map((row) => row.id)).toEqual(["INV-3", "INV-2", "INV-1"]);
    // Older payloads without a business date carry the day they were filed under.
    expect(page.rows.every((row) => row.businessDate === "2026-11-02")).toBe(true);
    expect(page.hasMore).toBe(false);
    const month = await new DocumentListService(db, actor()).invoices({
      from: "2026-10-01",
      to: "2026-11-02",
    });
    expect(month.rows.map((row) => row.id)).toContain("INV-4");
  });

  it("filters by payment state the way the Invoices page does", async () => {
    const service = new DocumentListService(db, actor());
    const ids = async (status: "unpaid" | "paid" | "pending") =>
      (await service.invoices({ ...today, status })).rows.map((row) => row.id).sort();
    expect(await ids("paid")).toEqual(["INV-1"]);
    expect(await ids("unpaid")).toEqual(["INV-2", "INV-3"]);
    expect(await ids("pending")).toEqual(["INV-2"]);
  });

  it("pages through long histories", async () => {
    const service = new DocumentListService(db, actor());
    const first = await service.invoices({ ...today, limit: 2 });
    const second = await service.invoices({ ...today, limit: 2, offset: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(second.rows).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(3);
  });

  it("includes closed branches' history in an all-branches view", async () => {
    db.sqlite.prepare("UPDATE branches SET active=0 WHERE id='ngong'").run();
    const owner: ServerActor = {
      ...actor(),
      branchScope: { type: "ALL" },
    };
    const page = await new DocumentListService(db, owner).invoices(today);
    expect(page.rows.map((row) => row.id)).toContain("INV-6");
    expect(page.rows.map((row) => row.id)).not.toContain("INV-X");
  });

  it("lists receipts by date", async () => {
    const page = await new DocumentListService(db, actor()).receipts(today);
    expect(page.rows.map((row) => row.id)).toEqual(["RCP-1"]);
  });

  it("refuses other branches, missing permissions and bad ranges", async () => {
    await expect(
      new DocumentListService(db, actor()).invoices({ ...today, branchId: "elsewhere" }),
    ).rejects.toThrow();
    await expect(
      new DocumentListService(
        db,
        actor(
          "westlands",
          allPermissionCodes.filter((code) => code !== permissions.receiptsView),
        ),
      ).receipts(today),
    ).rejects.toThrow(/access/);
    const service = new DocumentListService(db, actor());
    await expect(service.invoices({ from: "2026-11-03", to: "2026-11-02" })).rejects.toThrow(
      /on or before/,
    );
    await expect(service.invoices({ from: "", to: "2026-11-02" })).rejects.toThrow(/valid/);
    await expect(service.invoices({ from: "2026-02-31", to: "2026-03-02" })).rejects.toThrow(
      /valid/,
    );
    await expect(service.invoices({ ...today, limit: 999 })).rejects.toThrow();
  });
});
