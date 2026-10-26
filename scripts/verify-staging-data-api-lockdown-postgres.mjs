import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertStagingBacklogReady, inspectStagingBacklog } from "./inspect-staging-backlog.mjs";

/** Disposable CI Postgres ONLY: prove lockdown fails closed and runs cleanly. */
const connectionString = process.env.SERAMET_POSTGRES_URL;
if (!connectionString) throw new Error("Missing disposable CI PostgreSQL URL");
const url = new URL(connectionString);
const allowedDatabase =
  url.pathname === "/seramet_test" ||
  (url.pathname === "/seramet_restore" && process.env.SERAMET_ISOLATED_RESTORE === "true");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !allowedDatabase) {
  throw new Error("Refusing security integration test outside an approved disposable database");
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
  const schemaAccess = await db.query(
    "SELECT has_schema_privilege('anon','public','USAGE') AS anon_usage, " +
      "has_schema_privilege('authenticated','public','USAGE') AS authenticated_usage",
  );
  assert.deepEqual(schemaAccess.rows[0], {
    anon_usage: false,
    authenticated_usage: false,
  });

  // The staging pooler uses the database owner. Prove the same authority can
  // still read and prepare a no-op write, then roll the transaction back.
  await db.query("BEGIN");
  await db.query("SELECT COUNT(*) FROM public.schema_migrations");
  await db.query("UPDATE public.worker_jobs SET updated_at=updated_at WHERE false");
  await db.query("ROLLBACK");
  // Temporary tables shadow only this isolated verifier connection's job data.
  await db.query(`CREATE TEMP TABLE setup_imports (
    tenant_id text, file_checksum text, import_kind text, status text
  )`);
  await db.query(`CREATE TEMP TABLE worker_jobs (
    job_type text, status text, lease_expires_at text
  )`);
  try {
    await db.query(`INSERT INTO worker_jobs VALUES
      ('fixture-expired','RUNNING',(CURRENT_TIMESTAMP - interval '1 minute')::text),
      ('fixture-unleased','CLAIMED',NULL),
      ('fixture-active','RUNNING',(CURRENT_TIMESTAMP + interval '1 hour')::text),
      ('fixture-queued','PENDING',NULL),
      ('fixture-terminal','SUCCEEDED',(CURRENT_TIMESTAMP - interval '1 day')::text),
      ('fixture-quarantined','DEAD_LETTER',NULL)`);
    const before = await db.query("SELECT * FROM pg_temp.worker_jobs ORDER BY job_type");
    const backlog = await inspectStagingBacklog(db);
    assert.equal(backlog.expiredWorkerLeases, 1);
    assert.equal(backlog.missingWorkerLeases, 1);
    assert.throws(() => assertStagingBacklogReady(backlog), /Abandoned worker leases/);
    assert.deepEqual(
      (await db.query("SELECT * FROM pg_temp.worker_jobs ORDER BY job_type")).rows,
      before.rows,
      "Read-only release preflight must not replay or change worker jobs",
    );
    await db.query(`DELETE FROM pg_temp.worker_jobs
      WHERE job_type IN ('fixture-expired','fixture-unleased')`);
    assertStagingBacklogReady(await inspectStagingBacklog(db));
    await db.query(`UPDATE pg_temp.worker_jobs SET lease_expires_at='invalid'
      WHERE job_type='fixture-active'`);
    await assert.rejects(inspectStagingBacklog(db), /invalid input syntax/);
    assert.equal(
      (await db.query("SELECT 1 AS usable_after_rollback")).rows[0].usable_after_rollback,
      1,
    );
  } finally {
    await db.query("DROP TABLE pg_temp.worker_jobs, pg_temp.setup_imports");
  }
  console.log(
    "DISPOSABLE POSTGRES: abandoned lease gate, active/terminal exclusions and read-only rollback PASSED",
  );
  console.log("DISPOSABLE POSTGRES: approval guard and public-schema grants/RLS lockdown PASSED");
} finally {
  await db.end();
}
