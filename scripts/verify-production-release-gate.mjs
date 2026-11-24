import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SOLO_PRODUCTION_CHECK } from "./solo-release-approval.mjs";

const REPOSITORY = "Xmanuel01/seramet-connect";
const OWNER = "Xmanuel01";
const RECOVERY_WORKFLOW_PATH = ".github/workflows/production-recovery-verification.yml";
const RECOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHA = /^[a-f0-9]{40}$/;

/**
 * Production deployment gate, evaluated before any credential, migration or Worker change.
 *
 * It links the main commit being deployed to the exact candidate the owner approved:
 * the release PR must be merged into main as this exact commit, carry an identical source
 * tree, and hold the owner's `owner-approved-production-candidate` status. A fresh,
 * successful encrypted backup/isolated-restore drill must exist for this same commit, and
 * the protected production approved-SHA variable must name it. Nothing here can be
 * satisfied by a branch push, an edited comment or an operator checkbox alone.
 */
export function assessProductionRelease({
  env,
  pull,
  mergeCommit,
  candidateCommit,
  candidateStatuses,
  recoveryRuns,
  now = Date.now(),
}) {
  const issues = [];
  const sha = (env.GITHUB_SHA ?? "").trim();
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REPOSITORY !== REPOSITORY ||
    env.GITHUB_ACTOR !== OWNER ||
    env.GITHUB_TRIGGERING_ACTOR !== OWNER
  )
    issues.push("NOT_OWNER_DISPATCH_FROM_MAIN");
  if (!SHA.test(sha)) issues.push("INVALID_DEPLOY_SHA");
  if ((env.SERAMET_PRODUCTION_APPROVED_SHA ?? "").trim() !== sha)
    issues.push("RELEASE_SHA_NOT_APPROVED");
  if (env.SERAMET_DATA_API_EXPOSURE_CLEARED !== "true")
    issues.push("DATA_API_EXPOSURE_NOT_CLEARED");

  const candidate = pull?.head?.sha;
  if (
    !pull ||
    pull.merged !== true ||
    pull.base?.ref !== "main" ||
    pull.base?.repo?.full_name !== REPOSITORY ||
    pull.merge_commit_sha !== sha ||
    !SHA.test(candidate ?? "")
  )
    issues.push("RELEASE_PR_NOT_MERGED_AS_THIS_COMMIT");
  if (
    !mergeCommit?.tree?.sha ||
    !candidateCommit?.tree?.sha ||
    mergeCommit.tree.sha !== candidateCommit.tree.sha
  )
    issues.push("SOURCE_TREE_DIFFERS_FROM_APPROVED_CANDIDATE");

  // GitHub lists statuses newest first; the latest one for the context decides.
  const approval = (candidateStatuses ?? []).find(
    (status) => status.context === SOLO_PRODUCTION_CHECK,
  );
  if (approval?.state !== "success" || approval.creator?.login !== OWNER)
    issues.push("CANDIDATE_NOT_OWNER_APPROVED_FOR_PRODUCTION");

  const recovered = (recoveryRuns ?? []).some((run) => {
    const created = Date.parse(run.created_at);
    return (
      run.path === RECOVERY_WORKFLOW_PATH &&
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "workflow_dispatch" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.actor?.login === OWNER &&
      run.triggering_actor?.login === OWNER &&
      Number.isFinite(created) &&
      created <= now &&
      now - created <= RECOVERY_MAX_AGE_MS
    );
  });
  if (!recovered) issues.push("NO_FRESH_RECOVERY_DRILL_FOR_THIS_COMMIT");
  return issues;
}

function api(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const number = process.env.RELEASE_PR ?? "";
  const sha = process.env.GITHUB_SHA ?? "";
  if (!/^\d+$/.test(number) || !SHA.test(sha))
    throw new Error("An explicit release PR number and deploy commit are required");
  const base = `/repos/${REPOSITORY}`;
  const pull = api(`${base}/pulls/${number}`);
  const candidate = SHA.test(pull.head?.sha ?? "") ? pull.head.sha : null;
  const issues = assessProductionRelease({
    env: process.env,
    pull,
    mergeCommit: api(`${base}/git/commits/${sha}`),
    candidateCommit: candidate ? api(`${base}/git/commits/${candidate}`) : null,
    candidateStatuses: candidate ? api(`${base}/commits/${candidate}/statuses?per_page=100`) : [],
    recoveryRuns: api(
      `${base}/actions/workflows/production-recovery-verification.yml/runs?head_sha=${sha}&per_page=20`,
    ).workflow_runs,
  });
  if (issues.length) {
    console.error(
      "Production release blocked before credentials or migrations: " +
        issues.join(", ") +
        ". Do not disable this gate.",
    );
    process.exitCode = 1;
  } else {
    console.log(`Production release gate: PASS for ${sha} (candidate ${candidate}, PR #${number})`);
  }
}
