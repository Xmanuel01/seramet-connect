import assert from "node:assert/strict";
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";

// NO external database is accepted. This is only for the fresh GitHub Actions
// PostgreSQL 17 service; POS, finance and CRM scripts enforce their own fences.
const address = process.env.SERAMET_POSTGRES_URL;
const target = address ? new URL(address) : null;
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(target?.hostname, "127.0.0.1");
assert.equal(target?.port, "5432");
assert.equal(target?.username, "seramet_test");
assert.equal(target?.pathname, "/seramet_test");
const db = new pg.Client({ connectionString: address, connectionTimeoutMillis: 8000 });
try {
  await db.connect();
  const server = (await db.query("SHOW server_version")).rows[0].server_version;
  assert.match(server, /^17\./, "Certification must execute against PostgreSQL 17");
  await db.query("CREATE ROLE pos_ci LOGIN PASSWORD 'isolated_ci_only'");
  await db.query("CREATE DATABASE seramet_pos_ci OWNER pos_ci");
  await db.query("CREATE ROLE finance_ci LOGIN PASSWORD 'test_only_isolated'");
  await db.query("CREATE DATABASE seramet_finance_ci OWNER finance_ci");
  mkdirSync("cert-evidence", { recursive: true });
  writeFileSync("cert-evidence/postgres-version.txt", server + "\n");
  console.log("Disposable PostgreSQL 17 POS, CRM/menu and finance databases created");
} finally {
  await db.end();
}
