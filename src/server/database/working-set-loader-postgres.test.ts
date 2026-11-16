import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, expect, it } from "vitest";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import { migrationFiles } from "@/server/database/sqlite-test-adapter";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";

const tenantId = DEMO_TENANT_ID;
const old = "2026-01-05T10:00:00.000Z";

afterEach(() => setConfigurationRepositoryForTests());

// The working-set and by-id reads use json_extract, a numeric cast, LIKE ... ESCAPE and a
// partial index. This runs the repository's own SQL through embedded PostgreSQL.
it("runs the working-set and by-id reads on PostgreSQL", async () => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
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
    const query = async (sql: string, values?: unknown[]) => {
      const result = await postgres.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = new PostgresD1Database({
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    await postgres.query(
      `INSERT INTO tenants
       (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES ($1,$1,$1,$1,'KES','Africa/Nairobi','en-KE',1,'{}',$2,$2)`,
      [tenantId, old],
    );
    const row = (entityType: string, payload: Record<string, unknown>, updatedAt = old) =>
      postgres.query(
        `INSERT INTO authoritative_records
          (tenant_id, entity_type, entity_id, business_date, status, payload_json, version,
           created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7)`,
        [
          tenantId,
          entityType,
          payload["id"],
          updatedAt.slice(0, 10),
          payload["status"] ?? null,
          JSON.stringify({ tenantId, branchId: DEMO_WESTLANDS_BRANCH_ID, ...payload }),
          updatedAt,
        ],
      );
    const order = (id: string, status: string) => ({ id, status, lines: [], total: 10 });
    const bill = (id: string, status: string, orderIds: string[]) => ({
      id,
      status,
      orderIds,
      lines: [],
      total: 10,
      paid: status === "PAID" ? 10 : 0,
    });
    const payment = (id: string, unallocatedAmountMinor: number) => ({
      id,
      tenantId,
      status: "CONFIRMED",
      direction: "COLLECTION",
      amountMinor: 1_000,
      unallocatedAmountMinor,
      metadata: { directPayment: true },
    });
    await row("state:orders", order("ORD_1", "PAID"));
    await row("state:orders", order("ORD-OPEN", "OPEN"));
    await row("state:orders", order("ORD-TODAY", "PAID"), new Date().toISOString());
    await row("state:bills", bill("INV-1", "PAID", ["ORD_1"]));
    await row("state:bills", bill("INV-X", "PAID", ["ORDX1"]));
    await row("state:bills", bill("INV-OPEN", "OPEN", ["ORD-OPEN"]));
    await row("state:receipts", { id: "RCP-1", invoiceId: "INV-1", orderId: "ORD_1" });
    await row("state:payments", {
      id: "P-1",
      invoiceId: "INV-1",
      orderId: "ORD_1",
      method: "CASH",
      provider: "CASH",
      amount: 10,
      currency: "KES",
      reference: "CASH-1",
      cashier: "Cashier",
      terminal: "POS-01",
      timestamp: old,
    });
    await row("payments:transactions", payment("PAY-UNAPPLIED", 1_000));
    await row("payments:transactions", payment("PAY-APPLIED", 0));
    // Not transaction state: never part of either read.
    await row("system:api-idempotency", { id: "key-1", status: "OPEN" });
    const repository = new D1AuthoritativeTransactionRepository(db);

    const working = await repository.loadWorkingSet(tenantId);
    expect(working.orders.map((item) => item.id).sort()).toEqual(["ORD-OPEN", "ORD-TODAY"]);
    expect(working.bills.map((item) => item.id)).toEqual(["INV-OPEN"]);
    expect(working.receipts).toEqual([]);
    expect(working.paymentOperations!.transactions.map((item) => item.id)).toEqual([
      "PAY-UNAPPLIED",
    ]);

    const receipt = await repository.loadRecords(tenantId, [
      { collection: "receipts", id: "RCP-1" },
    ]);
    expect(receipt.receipts.map((item) => item.id)).toEqual(["RCP-1"]);
    expect(receipt.bills.map((item) => item.id)).toEqual(["INV-1"]);
    expect(receipt.orders.map((item) => item.id)).toEqual(["ORD_1"]);
    expect(receipt.payments.map((item) => item.id)).toEqual(["P-1"]);
    // "_" is a LIKE wildcard: ORDX1's bill is not ORD_1's.
    const byOrder = await repository.loadRecords(tenantId, [{ collection: "orders", id: "ORD_1" }]);
    expect(byOrder.bills.map((item) => item.id)).toEqual(["INV-1"]);

    const index = await postgres.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname='idx_authoritative_records_working_set'",
    );
    expect(index.rows[0]?.indexdef).toContain(
      "(tenant_id, entity_type, status, business_date, updated_at)",
    );
    expect(index.rows[0]?.indexdef).toMatch(/WHERE .*state:%.*payments:%/);
  } finally {
    await postgres.close();
  }
}, 120_000);
