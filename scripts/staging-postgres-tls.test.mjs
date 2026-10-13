import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { stagingTlsConfig } from "./staging-postgres-tls.mjs";

const url = "postgresql://postgres.project:test@aws-1-eu-west-1.pooler.supabase.com:5432/postgres";
test("missing TLS options require certificate verification regardless of PGSSLMODE", (t) => {
  const previous = process.env.PGSSLMODE;
  process.env.PGSSLMODE = "disable";
  t.after(() => {
    if (previous === undefined) delete process.env.PGSSLMODE;
    else process.env.PGSSLMODE = previous;
  });
  const client = new pg.Client(stagingTlsConfig(url));
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.host, "aws-1-eu-west-1.pooler.supabase.com");
  assert.equal(client.connectionParameters.user, "postgres.project");
  assert.equal(client.connectionParameters.database, "postgres");
});
test("verify-full URI cannot overwrite explicit certificate verification", () => {
  const client = new pg.Client(stagingTlsConfig(url + "?sslmode=verify-full"));
  assert.deepEqual(client.connectionParameters.ssl, { rejectUnauthorized: true });
});
test("rejects disabled, opportunistic, no-verify and custom TLS overrides", () => {
  for (const query of [
    "sslmode=disable",
    "sslmode=prefer",
    "sslmode=require",
    "sslmode=no-verify",
    "ssl=false",
    "ssl=no-verify",
    "sslrootcert=untrusted",
    "uselibpqcompat=true",
  ]) {
    assert.throws(() => stagingTlsConfig(url + "?" + query), /STAGING_TLS/);
  }
});
