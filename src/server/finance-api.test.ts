import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";
import { financeDefaultWindow } from "@/server/finance-api";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

let db: SqliteD1TestDatabase;
const tenantId = "finance-default-tenant";
const branchId = "finance-default-branch";

const actor = (scope: "BRANCH" | "ALL" = "BRANCH"): ServerActor => ({
  id: "finance-reviewer",
  name: "Finance reviewer",
  tenantId,
  roleIds: ["finance"],
  permissions: [...allPermissionCodes],
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "Nairobi" }],
  branchScope: scope === "ALL" ? { type: "ALL" } : { type: "BRANCH", branchId },
  branchId,
  branch: "Nairobi",
  role: "Accountant",
});

beforeEach(() => {
  db = createMigratedTestDatabase();
  const sql = db.sqlite;
  sql
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?, 'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .run(tenantId, tenantId, tenantId, tenantId, "2026-09-01", "2026-09-01");
  sql
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'Africa/Nairobi',240,1,'{}')",
    )
    .run(tenantId, branchId, "NBO", "Nairobi");
});

afterEach(() => db.close());

describe("finance API default accounting window", () => {
  it("uses the authenticated branch timezone and cutoff instead of UTC", async () => {
    await expect(
      financeDefaultWindow(db, actor(), undefined, new Date("2026-09-30T00:30:00.000Z")),
    ).resolves.toEqual({ from: "2026-09-01", to: "2026-09-29" });
  });

  it("rejects ambiguous all-branch defaults when accounting calendars differ", async () => {
    db.sqlite
      .prepare(
        "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?, 'UTC',0,1,'{}')",
      )
      .run(tenantId, "finance-second", "UTC", "UTC Branch");
    await expect(financeDefaultWindow(db, actor("ALL"))).rejects.toMatchObject({ status: 400 });
  });
});
