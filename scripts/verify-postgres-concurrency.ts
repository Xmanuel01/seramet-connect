import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { D1AuthoritativeTransactionRepository } from "../src/server/database/authoritative-transaction-repository";
import { PostgresD1Database } from "../src/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "../src/server/database/postgres-migration-compiler";
import { migrationFiles } from "../src/server/database/sqlite-test-adapter";
import type { ServerActor } from "../src/lib/seramet-auth";

const connectionString = process.env["SERAMET_POSTGRES_TEST_URL"];
if (!connectionString?.startsWith("postgres")) {
  throw new Error("SERAMET_POSTGRES_TEST_URL must reference an isolated PostgreSQL test database");
}
if (process.env["SERAMET_POSTGRES_TEST_CONFIRM"] !== "isolated-test-database") {
  throw new Error(
    "Set SERAMET_POSTGRES_TEST_CONFIRM=isolated-test-database after verifying the URL is non-production",
  );
}
if (
  process.env["SERAMET_POSTGRES_URL"] &&
  process.env["SERAMET_POSTGRES_URL"] === connectionString
) {
  throw new Error("The PostgreSQL test URL must not equal the deployment migration URL");
}

const schema = `seramet_concurrency_${crypto.randomUUID().replaceAll("-", "")}`;
const tenantId = "postgres-concurrency-tenant";
const branchId = "postgres-concurrency-branch";
const userId = "postgres-concurrency-user";
const admin = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 10_000 });
let database: PostgresD1Database | undefined;

try {
  await admin.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
  const testPool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    options: `-c search_path=${schema}`,
  });
  database = new PostgresD1Database(testPool);
  await database.exec(postgresCompatibilityPrelude);
  for (const file of migrationFiles) {
    const source = await readFile(resolve(process.cwd(), "migrations", file), "utf8");
    await database.exec(compileSqliteMigrationForPostgres(source).sql);
  }
  await seed(database);

  const repository = new D1AuthoritativeTransactionRepository(database);
  const competing = await Promise.allSettled([
    commit(repository, "revision-a", "hash-a", "Terminal A", 0),
    commit(repository, "revision-b", "hash-b", "Terminal B", 0),
  ]);
  assertEqual(
    competing.filter((result) => result.status === "fulfilled").length,
    1,
    "exactly one same-revision mutation must commit",
  );
  assertEqual(
    competing.filter((result) => result.status === "rejected").length,
    1,
    "exactly one same-revision mutation must conflict",
  );

  const revision = await repository.revision(tenantId);
  const replayed = await Promise.all([
    commit(repository, "replay-key", "replay-hash", "Retry-safe", revision),
    commit(repository, "replay-key", "replay-hash", "Retry-safe", revision),
  ]);
  assertEqual(
    replayed.filter((result) => result.duplicate).length,
    1,
    "one simultaneous replay must resolve as a duplicate",
  );
  const commitCount = await database
    .prepare("SELECT COUNT(*)::int AS count FROM mutation_commits WHERE tenant_id=?")
    .bind(tenantId)
    .first<{ count: number }>();
  assertEqual(commitCount?.count, 2, "only two distinct mutation commits may exist");

  process.stdout.write(
    JSON.stringify({
      ok: true,
      provider: "postgres",
      schemaIsolated: true,
      sameRevisionWinnerCount: 1,
      retryDuplicateCount: 1,
    }) + "\n",
  );
} finally {
  await database?.close().catch(() => undefined);
  await admin
    .query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`)
    .catch(() => undefined);
  await admin.end();
}

async function seed(db: PostgresD1Database) {
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
    )
    .bind(
      tenantId,
      tenantId,
      tenantId,
      tenantId,
      "KES",
      "Africa/Nairobi",
      "en-KE",
      JSON.stringify({ id: tenantId, active: true }),
      stamp,
      stamp,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO branches
        (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
       VALUES (?,?,?,?,?,240,1,?)`,
    )
    .bind(tenantId, branchId, "TEST", "PostgreSQL Test", "Africa/Nairobi", "{}")
    .run();
  await db
    .prepare(
      `INSERT INTO users
        (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,1,1,'{}',?,?)`,
    )
    .bind(tenantId, userId, "postgres-concurrency@example.test", "PostgreSQL Test", stamp, stamp)
    .run();
}

function commit(
  repository: D1AuthoritativeTransactionRepository,
  idempotencyKey: string,
  requestHash: string,
  customer: string,
  expectedRevision: number,
) {
  return repository.commitMutation({
    actor: actor(),
    action: "upsertOrderDraft",
    payload: {
      draft: {
        tenantId,
        branchId,
        branch: "PostgreSQL Test",
        customer,
        channel: "DINE_IN",
        cashier: userId,
        lines: [
          {
            id: `line-${idempotencyKey}`,
            productId: "product-test",
            name: "Test item",
            category: "Test",
            quantity: 1,
            unitPrice: 100,
            productionStation: "TEST",
          },
        ],
      },
      targetStatus: "OPEN",
    },
    idempotencyKey,
    requestHash,
    correlationId: `correlation-${idempotencyKey}`,
    expectedRevision,
  });
}

function actor(): ServerActor {
  return {
    id: userId,
    name: "PostgreSQL Test",
    tenantId,
    roleIds: [],
    permissions: ["orders.create", "orders.update"],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "PostgreSQL Test" }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    role: "Manager",
    branch: "PostgreSQL Test",
  };
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}; expected ${expected}, received ${actual}`);
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
