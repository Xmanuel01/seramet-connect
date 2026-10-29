import assert from "node:assert/strict";
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function expectedCertificationLedger() {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    return db
      .prepare("SELECT version,name,checksum FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

const names = [
  "menu_import_staged_items",
  "menu_import_staged_branch_settings",
  "manual_menu_item_requests",
  "file_import_state_events",
  "attendance_geofences",
  "attendance_shift_assignments",
  "employee_attendance_sessions",
  "employee_attendance_events",
  "attendance_management_events",
  "attendance_employee_versions",
  "attendance_mutation_claims",
  "attendance_access_events",
  "attendance_delay_requests",
  "attendance_delay_events",
  "attendance_delay_reads",
  "employee_account_invitations",
  "employee_station_access",
  "staff_access_events",
];
const expectedLedger = expectedCertificationLedger();

export function assertCertificationSchema(ledger, tables) {
  assert.deepEqual(
    ledger,
    expectedLedger,
    "Migration ledger must exactly match every current version, name and checksum marker",
  );
  assert.equal(tables.length, names.length, "All menu and workforce security tables must exist");
  for (const name of names) {
    const row = tables.find((item) => item.relname === name);
    assert.ok(row?.relrowsecurity, "Missing RLS for " + name);
  }
}

async function main() {
  const url = process.env.SERAMET_POSTGRES_URL;
  const target = url ? new URL(url) : null;
  assert.equal(process.env.CI, "true");
  assert.equal(target?.hostname, "127.0.0.1");
  assert.equal(target?.port, "5432");
  assert.equal(target?.username, "seramet_test");
  assert.equal(target?.pathname, "/seramet_test");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const ledgerResult = await client.query(
      "SELECT version::integer AS version,name,checksum FROM public.schema_migrations ORDER BY version",
    );
    const ledger = ledgerResult.rows;
    const tableResult = await client.query(
      "SELECT c.relname,c.relrowsecurity FROM pg_class c " +
        "JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
        "AND c.relname=ANY($1::text[])",
      [names],
    );
    const tables = tableResult.rows;
    assertCertificationSchema(ledger, tables);
    console.log("Complete current migration ledger and menu/workforce table RLS flags: PASS");
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // No mutation was attempted.
    }
    await client.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
