import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertProductionDsn,
  assessProductionApiPosture,
} from "./assert-production-api-posture.mjs";

const locked = {
  public_tables: 303,
  rls_disabled: 0,
  anon_select: 0,
  authenticated_select: 0,
  anon_schema_usage: false,
  authenticated_schema_usage: false,
};

test("only the production Supabase project is accepted", () => {
  assert.doesNotThrow(() =>
    assertProductionDsn(
      "postgresql://postgres.qnhqylslyhxjcksuhgyq:x@aws-0-eu.pooler.supabase.com:5432/postgres",
    ),
  );
  for (const dsn of [
    "postgresql://postgres.vnymbavsbxorwxpebkot:x@aws-0-eu.pooler.supabase.com:5432/postgres",
    "postgresql://postgres.qnhqylslyhxjcksuhgyq:x@vnymbavsbxorwxpebkot.example:5432/postgres",
    "postgresql://postgres:x@localhost:5432/postgres",
    "mysql://postgres.qnhqylslyhxjcksuhgyq:x@host/db",
    "not a url",
    undefined,
  ])
    assert.throws(() => assertProductionDsn(dsn), String(dsn));
});

test("an empty schema is allowed before migrations but never after", () => {
  const empty = { ...locked, public_tables: 0 };
  assert.deepEqual(assessProductionApiPosture(empty, "pre-migration"), []);
  assert.deepEqual(assessProductionApiPosture(empty, "post-migration"), [
    "NO_PUBLIC_TABLE_INVENTORY",
  ]);
});

test("exposed tables or grants block both phases", () => {
  const exposed = { ...locked, rls_disabled: 2, anon_select: 1, anon_schema_usage: true };
  for (const phase of ["pre-migration", "post-migration"])
    assert.deepEqual(assessProductionApiPosture(exposed, phase), [
      "PUBLIC_RLS_DISABLED",
      "PUBLIC_ANON_SELECT_REMAINS",
      "ANON_PUBLIC_SCHEMA_USAGE_REMAINS",
    ]);
  assert.deepEqual(assessProductionApiPosture(locked, "post-migration"), []);
});

test("the production workflow keeps its gates in order and is owner/main only", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-production.yml", import.meta.url),
    "utf8",
  );
  assert.ok(/^on:\n  workflow_dispatch:/m.test(workflow), "dispatch only, never on push");
  assert.ok(!/^\s+(push|pull_request|schedule):/m.test(workflow));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes("github.triggering_actor == github.repository_owner"));
  assert.ok(workflow.includes("environment: production"));
  const order = [
    "scripts/verify-production-release-gate.mjs",
    "npm run validate",
    "Confirm existing production Cloudflare resources",
    "assert-production-api-posture.mjs pre-migration",
    "npm run migrate:postgres",
    "assert-production-api-posture.mjs post-migration",
    "render-cloudflare-config.mjs production",
    "wrangler@4.149.0 deploy",
    "scripts/verify-production-health.mjs",
  ].map((step) => {
    const index = workflow.indexOf(step);
    assert.ok(index >= 0, step);
    return index;
  });
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  );
  assert.ok(
    !workflow.includes("SERAMET_REUSE_EXISTING_VARS"),
    "production never reuses preview vars",
  );
});
