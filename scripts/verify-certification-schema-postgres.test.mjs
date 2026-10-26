import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import {
  assertCertificationSchema,
  expectedCertificationLedger,
} from "./verify-certification-schema-postgres.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  try {
    const directory = new URL("../migrations/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort())
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    return db
      .prepare("SELECT name AS relname FROM sqlite_schema WHERE type='table'")
      .all()
      .filter((row) =>
        /^(menu_import_staged_|manual_menu_|file_import_state_|attendance_|employee_attendance_|employee_account_invitations|employee_station_access|staff_access_events)/.test(
          row.relname,
        ),
      )
      .map((row) => ({ relname: row.relname, relrowsecurity: true }));
  } finally {
    db.close();
  }
}

test("current complete ledger passes while historical version 27 is rejected", () => {
  const ledger = expectedCertificationLedger();
  const tables = fixture();
  assert.equal(ledger.at(-1).version, 30);
  assert.equal(tables.length, 18);
  assert.doesNotThrow(() => assertCertificationSchema(ledger, tables));
  assert.throws(() => assertCertificationSchema(ledger.slice(0, 27), tables), /Migration ledger/);
});

test("ledger name, checksum, gap and extra migration drift fail closed", () => {
  const ledger = expectedCertificationLedger();
  const tables = fixture();
  for (const invalid of [
    ledger.map((row, index) => (index === 26 ? { ...row, checksum: "stale-marker" } : row)),
    ledger.map((row, index) => (index === 28 ? { ...row, name: "wrong-name" } : row)),
    ledger.filter((row) => row.version !== 28),
    [...ledger, { version: 31, name: "unknown", checksum: "unknown" }],
  ])
    assert.throws(() => assertCertificationSchema(invalid, tables), /Migration ledger/);
});

test("missing workforce tables or disabled RLS cannot pass menu-only certification", () => {
  const ledger = expectedCertificationLedger();
  const tables = fixture();
  assert.throws(() => assertCertificationSchema(ledger, tables.slice(0, 4)), /tables must exist/);
  for (const table of tables) {
    assert.throws(
      () =>
        assertCertificationSchema(
          ledger,
          tables.map((row) => (row === table ? { ...row, relrowsecurity: false } : row)),
        ),
      /Missing RLS/,
    );
  }
});
