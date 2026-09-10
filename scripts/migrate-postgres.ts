import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "../src/server/database/postgres-migration-compiler";
import { migrationFiles } from "../src/server/database/sqlite-test-adapter";

const connectionString = process.env["SERAMET_POSTGRES_URL"];
if (!connectionString?.startsWith("postgres")) {
  throw new Error("SERAMET_POSTGRES_URL is required for deployment migrations");
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(736372616d6574)");
  await client.query(postgresCompatibilityPrelude);
  const migrationTable = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS table_name",
  );
  const hasMigrationTable = Boolean(migrationTable.rows[0]?.table_name);
  for (const file of migrationFiles) {
    const exists = hasMigrationTable
      ? await client.query<{ present: number }>(
          "SELECT 1 AS present FROM schema_migrations WHERE version=$1",
          [Number(file.slice(0, 4))],
        )
      : { rows: [] };
    if (exists.rows.length) continue;
    const source = await readFile(resolve(process.cwd(), "migrations", file), "utf8");
    const migration = compileSqliteMigrationForPostgres(source);
    await client.query(migration.sql);
    process.stdout.write(`Applied ${file} (${migration.triggerCount} triggers)\n`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
