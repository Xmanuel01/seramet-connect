import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

/** Disposable CI Postgres ONLY: prove lockdown fails closed and runs cleanly. */
const connectionString = process.env.SERAMET_POSTGRES_URL;
if (!connectionString) throw new Error("Missing disposable CI PostgreSQL URL");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/seramet_test") {
  throw new Error("Refusing security integration test outside disposable local seramet_test");
}
const db = new pg.Client({ connectionString });
await db.connect();
try {
  await db.query(
    "DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  await db.query(
    "DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  await db.query("GRANT USAGE ON SCHEMA public TO anon, authenticated");
  await db.query("GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated");
  const sql = await readFile("ops/sql/staging-public-schema-lockdown.sql", "utf8");
  // Isolated instance must refuse a direct accidentally unapproved execution.
  await assert.rejects(db.query(sql), /Lockdown refused/);
  await db.query("ROLLBACK");
  const before = await db.query(
    "SELECT count(*)::integer AS exposed FROM pg_tables WHERE schemaname='public' " +
      "AND NOT rowsecurity AND has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT')",
  );
  assert.ok(before.rows[0].exposed > 0, "Test must begin with a real exposed-table fixture");
  await db.query(
    "SET seramet.staging_schema_lockdown_approved = 'APPROVED_AFTER_ISOLATED_RESTORE'",
  );
  await db.query(sql);
  const result = await db.query(
    "SELECT count(*)::integer AS missing_rls, " +
      "count(*) FILTER (WHERE has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS anon_readable, " +
      "count(*) FILTER (WHERE has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT'))::integer AS auth_readable " +
      "FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity",
  );
  assert.deepEqual(result.rows[0], {
    missing_rls: 0,
    anon_readable: 0,
    auth_readable: 0,
  });
  const actual = await db.query(
    "SELECT count(*)::integer AS exposed FROM pg_tables " +
      "WHERE schemaname='public' AND " +
      "(has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT') OR " +
      "has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT'))",
  );
  assert.equal(actual.rows[0].exposed, 0);
  console.log("DISPOSABLE POSTGRES: approval guard and public-schema grants/RLS lockdown PASSED");
} finally {
  await db.end();
}
