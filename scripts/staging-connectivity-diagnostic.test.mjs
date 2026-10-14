import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import {
  authorizedDiagnosticConfig,
  diagnosticConfig,
  readonlyProbe,
  reportFailure,
} from "./staging-connectivity-diagnostic.mjs";

const url =
  "postgresql://seramet_staging_diagnostic.vnymbavsbxorwxpebkot:test@aws-1-eu-west-1.pooler.supabase.com:5432/postgres";
const authorizedEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_REF: "refs/heads/main",
  SERAMET_ENVIRONMENT: "staging",
  GITHUB_REPOSITORY_OWNER: "Xmanuel01",
  GITHUB_ACTOR: "Xmanuel01",
  GITHUB_TRIGGERING_ACTOR: "Xmanuel01",
  SERAMET_STAGING_READONLY_POSTGRES_URL: url,
};
test("owner dispatch and owner rerun pass both actor checks", () => {
  assert.equal(authorizedDiagnosticConfig(authorizedEnv).ssl.rejectUnauthorized, true);
});
test("unauthorized or missing identities fail before reading credentials", () => {
  for (const overrides of [
    { GITHUB_TRIGGERING_ACTOR: "collaborator" },
    { GITHUB_ACTOR: "collaborator" },
    { GITHUB_TRIGGERING_ACTOR: undefined },
    { GITHUB_ACTOR: undefined },
    { GITHUB_REPOSITORY_OWNER: undefined },
    { GITHUB_TRIGGERING_ACTOR: "" },
    { GITHUB_TRIGGERING_ACTOR: "unexpected\nidentity" },
    { GITHUB_TRIGGERING_ACTOR: 42 },
    { GITHUB_REF: "refs/heads/other" },
  ]) {
    let credentialReads = 0;
    const env = { ...authorizedEnv, ...overrides };
    Object.defineProperty(env, "SERAMET_STAGING_READONLY_POSTGRES_URL", {
      get() {
        credentialReads++;
        throw new Error("sensitive credential access");
      },
    });
    let rejected;
    try {
      authorizedDiagnosticConfig(env);
    } catch (error) {
      rejected = error;
    }
    assert.ok(rejected);
    assert.equal(credentialReads, 0);
    assert.deepEqual(reportFailure(rejected, "configuration"), {
      stage: "configuration",
      status: "FAIL",
      category: "SECURITY_PREREQUISITE",
      code: "CONFIGURATION_INVALID",
    });
    assert.doesNotMatch(
      JSON.stringify(reportFailure(rejected, "configuration")),
      /postgresql|SELECT|password|collaborator|unexpected/,
    );
  }
});
test("requires dedicated staging credential and verified TLS with session read-only defaults", () => {
  const client = new pg.Client(diagnosticConfig(url));
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.match(client.connectionParameters.options, /default_transaction_read_only=on/);
  for (const invalid of [
    undefined,
    url.replace("seramet_staging_diagnostic", "postgres"),
    url.replace("vnymbavsbxorwxpebkot", "production"),
    url + "?options=write",
    url + "?sslmode=no-verify",
    url + "?sslmode=disable",
  ]) {
    assert.throws(() => diagnosticConfig(invalid));
  }
});
test("fixed probe is read-only, rejects elevated identities, and rolls back even on failure", async () => {
  for (const elevated of [false, true]) {
    const queries = [];
    const client = {
      query: async (sql) => {
        queries.push(sql);
        return {
          rows: [
            {
              database_name: "postgres",
              role_name: "seramet_staging_diagnostic",
              read_only: "on",
              elevated,
              owner_member: false,
              backend_ssl: true,
            },
          ],
        };
      },
    };
    if (elevated) await assert.rejects(readonlyProbe(client));
    else assert.equal(await readonlyProbe(client), true);
    assert.equal(queries[0], "BEGIN READ ONLY");
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.ok(queries.every((sql) => /^(BEGIN READ ONLY|SELECT |ROLLBACK)/.test(sql)));
  }
});
test("query exceptions roll back and diagnostic output excludes all raw error fields", async () => {
  const queries = [];
  const error = Object.assign(new Error("postgresql://secret:password@private-host"), {
    code: "42501",
    detail: "SQL values",
    cert: "private-cert",
  });
  await assert.rejects(
    readonlyProbe({
      query: async (sql) => {
        queries.push(sql);
        if (sql.startsWith("SELECT")) throw error;
        return {};
      },
    }),
  );
  assert.equal(queries.at(-1), "ROLLBACK");
  assert.deepEqual(reportFailure(error, "query"), {
    stage: "query",
    status: "FAIL",
    category: "SQL_PERMISSION",
    code: "42501",
  });
  assert.equal(reportFailure({ code: "secret" }, "configuration").code, "UNKNOWN");
});
test("workflow has manual owner/main gate and only the dedicated diagnostic secret", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/staging-connectivity-diagnostic.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github.actor == github.repository_owner/);
  assert.match(workflow, /github.triggering_actor == github.repository_owner/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /group: seramet-staging/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.doesNotMatch(
    workflow,
    /migrate|lockdown|deploy|SERAMET_POSTGRES_URL|issues: write|pull-requests: write/,
  );
});
