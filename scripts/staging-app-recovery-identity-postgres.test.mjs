import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { LOCAL_RESTORE_IDENTITY_SQL } from "./staging-app-recovery-guards.mjs";

test(
  "CIDR-safe local restore identity query on disposable PostgreSQL",
  { skip: !process.env.SERAMET_POSTGRES_URL },
  async () => {
    const client = new pg.Client({
      connectionString: process.env.SERAMET_POSTGRES_URL,
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      const normalized = (await client.query(LOCAL_RESTORE_IDENTITY_SQL)).rows[0];
      const rawResult = await client.query("SELECT inet_server_addr()::text AS host");
      const raw = rawResult.rows[0].host;
      const literalResult = await client.query("SELECT host('127.0.0.1/32'::inet) AS host");
      const literal = literalResult.rows[0].host;

      assert.equal(literal, "127.0.0.1");
      assert.equal(normalized.host, raw.split("/")[0]);
      assert.equal(normalized.username, "seramet_test");
      assert.equal(normalized.database, "seramet_test");
    } finally {
      await client.end();
    }
  },
);
