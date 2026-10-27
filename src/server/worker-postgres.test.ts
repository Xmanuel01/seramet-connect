import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { migrationFiles } from "@/server/database/sqlite-test-adapter";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { handleWorkerQueue } from "@/server/workers";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes } from "@/platform/permissions";

afterEach(() => {
  vi.useRealTimers();
  setConfigurationRepositoryForTests();
});

async function postgresFixture() {
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
    // Execute the production adapter's SQL through embedded PostgreSQL, not a SQL mock.
    const query = async (sql: string, values?: unknown[]) => {
      const result = await postgres.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = new PostgresD1Database({
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    return { postgres, db };
  } catch (error) {
    await postgres.close();
    throw error;
  }
}

it("runs inventory expiry SQL on PostgreSQL, preserving UTC cutoff, tenant isolation and redelivery safety", async () => {
  const { postgres, db } = await postgresFixture();
  try {
    const stamp = "2026-10-27T21:30:00.000Z";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(stamp));
    for (const tenant of ["expiry-a", "expiry-b"]) {
      await postgres.query(
        `INSERT INTO tenants
         (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES ($1,$1,$1,$1,'KES','Africa/Nairobi','en-KE',1,'{}',$2,$2)`,
        [tenant, stamp],
      );
      await postgres.query(
        `INSERT INTO branches (tenant_id,id,code,name,timezone,active,payload_json)
         VALUES ($1,'branch','branch','Branch','Africa/Nairobi',1,'{}')`,
        [tenant],
      );
      await postgres.query(
        `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json)
         VALUES ($1,'warehouse','branch','warehouse','Warehouse',1,'{}')`,
        [tenant],
      );
      await postgres.query(
        `INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json)
         VALUES ($1,'item','item','Item','kg',1,'{}')`,
        [tenant],
      );
    }
    for (const [tenant, id, expiry, status] of [
      ["expiry-a", "boundary", "2026-10-30", "AVAILABLE"],
      ["expiry-a", "future", "2026-10-31", "AVAILABLE"],
      ["expiry-a", "unavailable", "2026-10-27", "CONSUMED"],
      ["expiry-b", "other-tenant", "2026-10-27", "AVAILABLE"],
    ]) {
      await postgres.query(
        `INSERT INTO inventory_lots
         (tenant_id,id,branch_id,warehouse_id,inventory_item_id,lot_number,received_at,
          expiry_date,quantity_received_minor,quantity_remaining_minor,status,created_at,updated_at)
         VALUES ($1,$2,'branch','warehouse','item',$2,$3,$4,1000,1000,$5,$3,$3)`,
        [tenant, id, stamp, expiry, status],
      );
    }
    await postgres.query(
      `INSERT INTO worker_jobs
       (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,scheduled_at,created_at,updated_at)
       VALUES ('expiry-a','expiry-job','INVENTORY_EXPIRY_ALERTS','{}','expiry-job','expiry-correlation','PENDING',$1,$1,$1)`,
      [stamp],
    );
    const message = {
      id: "expiry-message",
      timestamp: new Date(stamp),
      body: {
        kind: "worker-job" as const,
        tenantId: "expiry-a",
        jobId: "expiry-job",
        correlationId: "expiry-correlation",
      },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    };
    const batch = { queue: "disposable-embedded-postgres", messages: [message] };
    await handleWorkerQueue(batch, { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test" });
    expect(await postgres.query("SELECT status,last_error FROM worker_jobs")).toMatchObject({
      rows: [{ status: "SUCCEEDED", last_error: null }],
    });
    await handleWorkerQueue(batch, { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test" });
    const alerts = await postgres.query(
      "SELECT tenant_id,entity_id,version FROM authoritative_records WHERE entity_type='system:manager-action'",
    );
    expect(alerts.rows).toEqual([
      { tenant_id: "expiry-a", entity_id: "inventory-expiry:boundary", version: 1 },
    ]);
    expect(message.ack).toHaveBeenCalledTimes(2);
    expect(message.retry).not.toHaveBeenCalled();
  } finally {
    await postgres.close();
  }
}, 120_000);

it.each(["expirePoints", "expireStoredValue"] as const)(
  "%s executes its production query on an empty PostgreSQL ledger",
  async (method) => {
    const { postgres, db } = await postgresFixture();
    try {
      const actor: ServerActor = {
        id: "expiry-reviewer",
        tenantId: "empty-expiry-tenant",
        branchId: "empty-expiry-branch",
        name: "Expiry reviewer",
        branch: "Empty branch",
        role: "Manager",
        roleIds: [],
        permissions: [...allPermissionCodes],
        branchScope: { type: "BRANCH", branchId: "empty-expiry-branch" },
        assignedBranchIds: ["empty-expiry-branch"],
        assignedBranches: [{ id: "empty-expiry-branch", name: "Empty branch" }],
      };
      const service = new LoyaltyValueService(db, actor);
      await expect(service[method](new Date("2026-10-27T21:30:00.000Z"))).resolves.toEqual(
        method === "expirePoints"
          ? { expiredEntries: 0 }
          : { expiredGiftCards: 0, expiredDefinitions: 0, expiredIssues: 0 },
      );
    } finally {
      await postgres.close();
    }
  },
  120_000,
);
