import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { hydrateAuthoritativeConfiguration } from "./authoritative-configuration";
import { createMigratedTestDatabase, type SqliteD1TestDatabase } from "./sqlite-test-adapter";
import { D1AuthoritativeTransactionRepository } from "./authoritative-transaction-repository";

const tenantId = "snapshot-read-disposable";
let db: SqliteD1TestDatabase;

beforeEach(async () => {
  db = createMigratedTestDatabase();
  const stamp = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenantId, tenantId, "Disposable", "Disposable", stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,'main','MAIN','Main','Africa/Nairobi',240,1,'{}')",
    )
    .bind(tenantId)
    .run();
  await hydrateAuthoritativeConfiguration(db, {}, true);
  const record = db.prepare(
    "INSERT INTO authoritative_records (tenant_id,entity_type,entity_id,payload_json,version,created_at,updated_at) VALUES (?,?,?,?,1,?,?)",
  );
  await record
    .bind(
      tenantId,
      "state:orders",
      "order-1",
      JSON.stringify({ id: "order-1", branch: "Main", branchId: "main" }),
      stamp,
      stamp,
    )
    .run();
  // System rows share the table but are never part of a snapshot.
  await record
    .bind(tenantId, "system:api-idempotency", "key-1", "x".repeat(50_000), stamp, stamp)
    .run();
});

afterEach(() => {
  db.close();
  setConfigurationRepositoryForTests();
});

function recordQueries() {
  const queries: string[] = [];
  const prepare = db.prepare.bind(db);
  vi.spyOn(db, "prepare").mockImplementation((query) => {
    queries.push(query.replace(/\s+/g, " ").trim());
    return prepare(query);
  });
  return queries;
}

describe("authoritative snapshot read", () => {
  it("checks the schema and tenant once per request, not once per call", async () => {
    const repo = new D1AuthoritativeTransactionRepository(db);
    const queries = recordQueries();
    await repo.revision(tenantId);
    await repo.loadState(tenantId);
    await repo.revision(tenantId);
    expect(queries.filter((query) => query.includes("FROM schema_migrations"))).toHaveLength(1);
    expect(queries.filter((query) => query.includes("FROM tenants"))).toHaveLength(1);
  });

  it("still rejects an inactive tenant on every request", async () => {
    await db.prepare("UPDATE tenants SET active=0 WHERE id=?").bind(tenantId).run();
    await expect(new D1AuthoritativeTransactionRepository(db).loadState(tenantId)).rejects.toThrow(
      "Tenant is not active",
    );
  });

  it("reads only snapshot rows from the database", async () => {
    const repo = new D1AuthoritativeTransactionRepository(db);
    const all = vi.fn();
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((query) => {
      const statement = prepare(query);
      if (!query.includes("FROM authoritative_records")) return statement;
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values);
        const read = bound.all.bind(bound);
        bound.all = async <T>() => {
          const result = await read<T>();
          all(result.results);
          return result;
        };
        return bound;
      };
      return statement;
    });
    const state = await repo.loadState(tenantId);
    expect(state.orders.map((order) => order.id)).toEqual(["order-1"]);
    const rows = all.mock.calls.flatMap(([results]) => results as Array<{ entity_type: string }>);
    expect(rows.map((row) => row.entity_type)).toEqual(["state:orders"]);
  });
});
