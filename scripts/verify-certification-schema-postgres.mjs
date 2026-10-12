import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.SERAMET_POSTGRES_URL;
const target = url ? new URL(url) : null;
assert.equal(process.env.CI, "true");
assert.equal(target?.hostname, "127.0.0.1");
assert.equal(target?.port, "5432");
assert.equal(target?.username, "seramet_test");
assert.equal(target?.pathname, "/seramet_test");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
const names = [
  "menu_import_staged_items",
  "menu_import_staged_branch_settings",
  "manual_menu_item_requests",
  "file_import_state_events",
];
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const ledgerResult = await client.query(
    "SELECT version,name,checksum FROM public.schema_migrations ORDER BY version",
  );
  const ledger = ledgerResult.rows;
  assert.equal(ledger.length, 27, "Every migration 1-27 must be applied");
  assert.ok(ledger.every((row, index) => Number(row.version) === index + 1));
  assert.equal(ledger[26].name, "menu_import_pipeline");
  assert.equal(ledger[26].checksum, "menu-import-pipeline-0027-v2");
  const tableResult = await client.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c " +
      "JOIN pg_namespace n ON n.oid=c.relnamespace " +
      "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
      "AND c.relname=ANY($1::text[])",
    [names],
  );
  const tables = tableResult.rows;
  assert.equal(tables.length, names.length);
  for (const name of names) {
    const row = tables.find((item) => item.relname === name);
    assert.ok(row?.relrowsecurity, "Missing RLS for " + name);
  }
  console.log("Migration 27 ledger checksum and four new-table RLS flags: PASS");
} finally {
  try {
    await client.query("ROLLBACK");
  } catch {
    // No mutation was attempted.
  }
  await client.end();
}
