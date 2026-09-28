import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessStagingApiPosture,
  inspectStagingApiPosture,
} from "./assert-staging-api-posture.mjs";

const locked = {
  public_tables: 303,
  rls_disabled: 0,
  anon_select: 0,
  authenticated_select: 0,
  anon_schema_usage: false,
  authenticated_schema_usage: false,
};

test("approved locked-down staging allows an independently checked release", () => {
  assert.deepEqual(assessStagingApiPosture(locked), []);
});

test("live incident counts cannot be cleared with an operator checkbox", () => {
  assert.deepEqual(
    assessStagingApiPosture({
      ...locked,
      rls_disabled: 302,
      anon_select: 302,
      authenticated_select: 302,
      anon_schema_usage: true,
      authenticated_schema_usage: true,
    }),
    [
      "PUBLIC_RLS_DISABLED",
      "PUBLIC_ANON_SELECT_REMAINS",
      "PUBLIC_AUTHENTICATED_SELECT_REMAINS",
      "ANON_PUBLIC_SCHEMA_USAGE_REMAINS",
      "AUTHENTICATED_PUBLIC_SCHEMA_USAGE_REMAINS",
    ],
  );
});

test("missing, incomplete and empty probes fail closed", () => {
  assert.ok(assessStagingApiPosture(null).length >= 2);
  assert.ok(assessStagingApiPosture({ ...locked, public_tables: 0 }).length > 0);
  assert.ok(assessStagingApiPosture({ ...locked, anon_schema_usage: null }).length > 0);
});

test("inspection is read-only and always rolls back", async () => {
  const queries = [];
  const db = {
    async query(sql) {
      queries.push(sql);
      if (sql.startsWith("SELECT")) return { rows: [locked] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await inspectStagingApiPosture(db), locked);
  assert.equal(queries[0], "BEGIN READ ONLY");
  assert.equal(queries.at(-1), "ROLLBACK");
});
