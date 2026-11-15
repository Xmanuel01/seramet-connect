import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { expect, it } from "vitest";
import { InventoryIntelligenceService } from "@/inventory/inventory-intelligence-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { numericRows, PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { migrationFiles } from "@/server/database/sqlite-test-adapter";

// PostgreSQL returns SUM() over a BIGINT column as NUMERIC text. A restaurant with paid
// invoices then failed the inventory summary's integer checks (HTTP 500 on Inventory,
// Inventory Items and Procurement) while an empty test restaurant passed.
it("summarises inventory on PostgreSQL for a restaurant that has sold something", async () => {
  const postgres = new PGlite();
  try {
    await postgres.exec(postgresCompatibilityPrelude);
    for (const file of migrationFiles) {
      await postgres.exec(
        compileSqliteMigrationForPostgres(
          readFileSync(resolve(process.cwd(), "migrations", file), "utf8"),
        ).sql,
      );
    }
    // The invoice references rows this summary never reads.
    await postgres.exec("SET session_replication_role = replica");
    const query = async (sql: string, values?: unknown[]) => {
      const result = await postgres.query(sql, values);
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
        fields: result.fields,
      };
    };
    const db = new PostgresD1Database({
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    const stamp = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO invoices
           (tenant_id,id,branch_id,invoice_number,status,business_date,currency,total_minor,
            paid_minor,version,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,'PAID','2026-11-15','KES',?,?,1,'{}',?,?)`,
      )
      .bind("tenant-sold", "invoice-1", "branch-sold", "INV-1", 125_000, 125_000, stamp, stamp)
      .run();

    const actor = {
      id: "user-sold",
      name: "Owner",
      tenantId: "tenant-sold",
      branchId: "branch-sold",
      branch: "Main",
      permissions: [permissions.inventoryView],
      assignedBranchIds: ["branch-sold"],
      assignedBranches: [{ id: "branch-sold", name: "Main", isPrimary: true }],
      branchScope: { type: "BRANCH", branchId: "branch-sold" },
    } as unknown as ServerActor;
    const summary = await new InventoryIntelligenceService(db, actor).summary("branch-sold");
    expect(summary).toMatchObject({
      branchId: "branch-sold",
      inventoryValueMinor: 0,
      itemCount: 0,
      actualFoodCostBps: 0,
      theoreticalFoodCostBps: 0,
      varianceMinor: 0,
      unexplainedVarianceMinor: 0,
    });
  } finally {
    await postgres.close();
  }
}, 120_000);

it("turns NUMERIC text into numbers and refuses unsafe integers", () => {
  const fields = [
    { name: "total", dataTypeID: 1700 },
    { name: "label", dataTypeID: 25 },
  ];
  expect(numericRows({ rows: [{ total: "125000", label: "42" }], fields })).toEqual([
    { total: 125_000, label: "42" },
  ]);
  expect(numericRows({ rows: [{ total: "12.5", label: "x" }], fields })).toEqual([
    { total: 12.5, label: "x" },
  ]);
  expect(numericRows({ rows: [{ total: null, label: "x" }], fields })).toEqual([
    { total: null, label: "x" },
  ]);
  expect(() => numericRows({ rows: [{ total: "9007199254740993" }], fields })).toThrow(
    /safe range/,
  );
  // Without column types (older callers) rows pass through untouched.
  expect(numericRows({ rows: [{ total: "7" }] })).toEqual([{ total: "7" }]);
});
