import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeProductionDeployment,
  checkProductionDeployment,
  verifyProductionBindings,
  verifyRecoveryEvidence,
  verifyRecoveryRun,
} from "./production-deployment-gate.mjs";

const sha = "a".repeat(40);
const project = "p".repeat(20);
const now = Date.parse("2026-10-22T12:00:00Z");
const env = {
  GITHUB_EVENT_NAME: "workflow_run",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY: "owner/repo",
  GITHUB_REPOSITORY_OWNER: "owner",
  SERAMET_PRODUCTION_AUTO_DEPLOY: "true",
  SERAMET_PRODUCTION_APPROVED_SHA: sha,
  SERAMET_PRODUCTION_PROJECT_REF: project,
  SERAMET_SUPABASE_URL: `https://${project}.supabase.co`,
  SERAMET_PUBLIC_ORIGIN: "https://seramet.co.ke",
  expectedSchemaVersion: 30,
};
const event = {
  workflow_run: {
    name: "Seramet CI",
    event: "push",
    head_branch: "main",
    head_repository: { full_name: "owner/repo" },
    status: "completed",
    conclusion: "success",
    head_sha: sha,
  },
};
const recovery = {
  id: 42,
  head_sha: sha,
  head_branch: "main",
  path: ".github/workflows/production-recovery-verification.yml",
  event: "workflow_dispatch",
  actor: { login: "owner" },
  triggering_actor: { login: "owner" },
  status: "completed",
  conclusion: "success",
  updated_at: new Date(now).toISOString(),
};
const proof = {
  status: "RESTORE_VERIFIED",
  environment: "production",
  projectRef: project,
  commit: sha,
  recoveryPointCreatedAt: new Date(now).toISOString(),
  dumpSha256: "b".repeat(64),
  coverage: "PUBLIC_APPLICATION_SCHEMA_ONLY",
  restorationTarget: "ISOLATED_LOCAL_POSTGRESQL_17",
};

test("only explicitly enabled, approved successful main CI can deploy", () => {
  assert.equal(authorizeProductionDeployment(env, event), sha);
  for (const patch of [
    { SERAMET_PRODUCTION_AUTO_DEPLOY: "false" },
    { SERAMET_PRODUCTION_APPROVED_SHA: "b".repeat(40) },
    { GITHUB_REF: "refs/heads/feature" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { SERAMET_PRODUCTION_PROJECT_REF: "vnymbavsbxorwxpebkot" },
    { SERAMET_SUPABASE_URL: "https://other.supabase.co" },
    { SERAMET_PUBLIC_ORIGIN: "https://staging.example.com" },
  ])
    assert.throws(() => authorizeProductionDeployment({ ...env, ...patch }, event));
  for (const patch of [
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { head_branch: "feature" },
    { event: "pull_request" },
    { head_repository: { full_name: "attacker/fork" } },
    { name: "Unrelated checks" },
    { status: "in_progress" },
  ])
    assert.throws(() =>
      authorizeProductionDeployment(env, { workflow_run: { ...event.workflow_run, ...patch } }),
    );
});

test("fresh owner-run recovery required; skipped or superseded attempts cannot pass", () => {
  assert.equal(verifyRecoveryRun([recovery], sha, "owner", now), 42);
  for (const patch of [
    { head_sha: "b".repeat(40) },
    { path: "other.yml" },
    { actor: { login: "other" } },
    { triggering_actor: { login: "other" } },
    { conclusion: "skipped" },
    { event: "push" },
    { updated_at: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
    { updated_at: new Date(now + 1000).toISOString() },
  ])
    assert.throws(() => verifyRecoveryRun([{ ...recovery, ...patch }], sha, "owner", now));
  assert.throws(() =>
    verifyRecoveryRun([{ ...recovery, conclusion: "failure" }, recovery], sha, "owner", now),
  );
});

test("recovery artifact binds project, commit, restore target and original capture time", () => {
  verifyRecoveryEvidence(proof, sha, project, now);
  for (const patch of [
    { projectRef: "vnymbavsbxorwxpebkot" },
    { commit: "c".repeat(40) },
    { status: "QUEUED" },
    { coverage: "UNKNOWN" },
    { dumpSha256: "invalid" },
    { restorationTarget: "PRODUCTION" },
    { recoveryPointCreatedAt: new Date(now - 3 * 60 * 60 * 1000).toISOString() },
  ])
    assert.throws(() => verifyRecoveryEvidence({ ...proof, ...patch }, sha, project, now));
});

test("stale CI never deploys; evidence retrieval errors are fail closed", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      checkProductionDeployment(env, event, async () => {
        calls++;
        return { ok: true, json: async () => ({ object: { sha: "b".repeat(40) } }) };
      }),
    /SUPERSEDED/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => checkProductionDeployment(env, event, async () => ({ ok: false })),
    /UNAVAILABLE/,
  );
});

test("healthy configured production passes; development and stale schema fail closed", async () => {
  const health = {
    ok: true,
    environment: "production",
    schemaVersion: 30,
    database: "authoritative",
    queue: "available",
    buildId: "d".repeat(40),
    issues: [],
  };
  const responses = (payload) => async (url) => ({
    ok: true,
    json: async () =>
      url.includes("git/ref/heads/main")
        ? { object: { sha } }
        : url.includes("/actions/workflows/")
          ? { workflow_runs: [{ ...recovery, updated_at: new Date().toISOString() }] }
          : payload,
  });
  assert.deepEqual(await checkProductionDeployment(env, event, responses(health)), {
    sha,
    recoveryRunId: 42,
  });
  for (const patch of [
    { environment: "development" },
    { schemaVersion: 29 },
    { queue: "unavailable" },
    { database: "local" },
    { issues: ["NOT_READY"] },
    { buildId: "manual" },
  ])
    await assert.rejects(
      () => checkProductionDeployment(env, event, responses({ ...health, ...patch })),
      /BOOTSTRAP_REQUIRED/,
    );
});

test("incomplete production bindings cannot be replaced automatically", () => {
  const configured = {
    ...env,
    SERAMET_CLOUDFLARE_HYPERDRIVE_ID: "id",
    SERAMET_CLOUDFLARE_R2_BUCKET: "bucket",
    SERAMET_CLOUDFLARE_QUEUE: "work",
    SERAMET_CLOUDFLARE_SCAN_QUEUE: "scan",
  };
  const bindings = [
    { name: "SERAMET_ENVIRONMENT", text: "production" },
    { name: "SERAMET_DATABASE_PROVIDER", text: "postgres" },
    { name: "SERAMET_IDENTITY_PROVIDER", text: "supabase" },
    { name: "SERAMET_SUPABASE_URL", text: env.SERAMET_SUPABASE_URL },
    { name: "SERAMET_PUBLIC_ORIGIN", text: env.SERAMET_PUBLIC_ORIGIN },
    { name: "SERAMET_HYPERDRIVE", id: "id" },
    { name: "SERAMET_OBJECTS", bucket_name: "bucket" },
    { name: "SERAMET_WORK_QUEUE", queue_name: "work" },
    { name: "SERAMET_SCAN_QUEUE", queue_name: "scan" },
  ];
  verifyProductionBindings({ success: true, result: { bindings } }, configured);
  assert.throws(() =>
    verifyProductionBindings({ success: true, result: { bindings: [] } }, configured),
  );
  assert.throws(() =>
    verifyProductionBindings(
      { success: true, result: { bindings } },
      { ...configured, SERAMET_CLOUDFLARE_QUEUE: "staging-work" },
    ),
  );
});

test("workflow runs trusted main code, no migrations or secret provisioning", () => {
  const workflow = readFileSync(".github/workflows/deploy-production.yml", "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: seramet-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(
    workflow,
    /migrate:postgres|secret put|hyperdrive update|--admin|pull_request_target/,
  );
});
