import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assessProductionHealth } from "./verify-production-health.mjs";

export function authorizeProductionDeployment(env, event) {
  const run = event?.workflow_run;
  if (
    env.GITHUB_EVENT_NAME !== "workflow_run" ||
    env.SERAMET_PRODUCTION_AUTO_DEPLOY !== "true" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    run?.name !== "Seramet CI" ||
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.head_repository?.full_name !== env.GITHUB_REPOSITORY ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "") ||
    env.SERAMET_PRODUCTION_APPROVED_SHA !== run.head_sha ||
    !/^[a-z]{20}$/.test(env.SERAMET_PRODUCTION_PROJECT_REF ?? "") ||
    env.SERAMET_PRODUCTION_PROJECT_REF === "vnymbavsbxorwxpebkot" ||
    env.SERAMET_SUPABASE_URL !== `https://${env.SERAMET_PRODUCTION_PROJECT_REF}.supabase.co` ||
    env.SERAMET_PUBLIC_ORIGIN !== "https://seramet.co.ke"
  ) {
    throw new Error("PRODUCTION_DEPLOYMENT_AUTHORIZATION_REQUIRED");
  }
  return run.head_sha;
}

export function verifyRecoveryRun(runs, sha, owner, now = Date.now()) {
  const run = runs.find((row) => row.head_sha === sha && row.head_branch === "main");
  const age = now - Date.parse(run?.updated_at);
  if (
    !run ||
    run.path !== ".github/workflows/production-recovery-verification.yml" ||
    run.event !== "workflow_dispatch" ||
    run.actor?.login !== owner ||
    run.triggering_actor?.login !== owner ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !Number.isSafeInteger(run.id) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 2 * 60 * 60 * 1000
  ) {
    throw new Error("CURRENT_PRODUCTION_RECOVERY_REQUIRED");
  }
  return run.id;
}

export function verifyRecoveryEvidence(proof, sha, projectRef, now = Date.now()) {
  const age = now - Date.parse(proof?.recoveryPointCreatedAt);
  if (
    proof?.status !== "RESTORE_VERIFIED" ||
    proof.environment !== "production" ||
    proof.projectRef !== projectRef ||
    proof.commit !== sha ||
    proof.coverage !== "PUBLIC_APPLICATION_SCHEMA_ONLY" ||
    proof.restorationTarget !== "ISOLATED_LOCAL_POSTGRESQL_17" ||
    !/^[a-f0-9]{64}$/.test(proof.dumpSha256 ?? "") ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 2 * 60 * 60 * 1000
  )
    throw new Error("PRODUCTION_RECOVERY_ARTIFACT_INVALID");
}

export function verifyProductionBindings(payload, env) {
  const bindings = new Map((payload?.result?.bindings ?? []).map((row) => [row.name, row]));
  const expected = [
    ["SERAMET_ENVIRONMENT", "text", "production"],
    ["SERAMET_DATABASE_PROVIDER", "text", "postgres"],
    ["SERAMET_IDENTITY_PROVIDER", "text", "supabase"],
    ["SERAMET_SUPABASE_URL", "text", env.SERAMET_SUPABASE_URL],
    ["SERAMET_PUBLIC_ORIGIN", "text", env.SERAMET_PUBLIC_ORIGIN],
    ["SERAMET_HYPERDRIVE", "id", env.SERAMET_CLOUDFLARE_HYPERDRIVE_ID],
    ["SERAMET_OBJECTS", "bucket_name", env.SERAMET_CLOUDFLARE_R2_BUCKET],
    ["SERAMET_WORK_QUEUE", "queue_name", env.SERAMET_CLOUDFLARE_QUEUE],
    ["SERAMET_SCAN_QUEUE", "queue_name", env.SERAMET_CLOUDFLARE_SCAN_QUEUE],
  ];
  if (
    payload?.success !== true ||
    bindings.has("SERAMET_MALWARE_SCANNER") ||
    expected.some(([name, field, value]) => !value || bindings.get(name)?.[field] !== value)
  )
    throw new Error("PRODUCTION_BINDINGS_REQUIRE_BOOTSTRAP_REVIEW");
}

export async function checkProductionDeployment(env, event, fetchFn = fetch) {
  const sha = authorizeProductionDeployment(env, event);
  const api = async (path) => {
    const response = await fetchFn(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error("PRODUCTION_RELEASE_EVIDENCE_UNAVAILABLE");
    return response.json();
  };
  const main = await api("git/ref/heads/main");
  if (main.object?.sha !== sha) throw new Error("PRODUCTION_CANDIDATE_SUPERSEDED");
  const recovery = await api(
    "actions/workflows/production-recovery-verification.yml/runs?branch=main&per_page=100",
  );
  const recoveryRunId = verifyRecoveryRun(
    recovery.workflow_runs ?? [],
    sha,
    env.GITHUB_REPOSITORY_OWNER,
  );
  // Automatic updates do not bootstrap or migrate a production database.
  const response = await fetchFn(`${env.SERAMET_PUBLIC_ORIGIN}/api/seramet/health/operational`, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("PRODUCTION_BOOTSTRAP_REQUIRED");
  const health = await response.json();
  if (
    !/^[a-f0-9]{40}$/.test(health?.buildId ?? "") ||
    !assessProductionHealth(health, env.expectedSchemaVersion, health.buildId).ready
  ) {
    throw new Error("PRODUCTION_BOOTSTRAP_REQUIRED");
  }
  return { sha, recoveryRunId };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const match = /CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(
      readFileSync("src/server/database/schema-version.ts", "utf8"),
    );
    if (!match) throw new Error("PRODUCTION_SCHEMA_IDENTITY_REQUIRED");
    const { sha, recoveryRunId } = await checkProductionDeployment(
      { ...process.env, expectedSchemaVersion: Number(match[1]) },
      JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
    );
    appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${sha}\nrecovery_run=${recoveryRunId}\n`);
    process.stdout.write("PRODUCTION_AUTOMATIC_UPDATE_AUTHORIZED\n");
  } catch (error) {
    process.stderr.write(
      (error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "PRODUCTION_DEPLOYMENT_PREFLIGHT_FAILED") + "\n",
    );
    process.exitCode = 1;
  }
}
