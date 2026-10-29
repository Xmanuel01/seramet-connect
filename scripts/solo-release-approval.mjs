import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOLO_APPROVAL_MARKER = "SERAMET_SOLO_RELEASE_APPROVAL_V1";
export const SOLO_PRODUCTION_CHECK = "owner-approved-production-candidate";
export const requiredCoreChecks = ["validate", "postgres-crm", "postgres-recovery-fixture"];

export function approvalOperator(env, viewer) {
  if (env.GITHUB_ACTIONS === "true") {
    if (
      env.GITHUB_REPOSITORY !== "Xmanuel01/seramet-connect" ||
      env.GITHUB_ACTOR !== "Xmanuel01" ||
      env.GITHUB_TRIGGERING_ACTOR !== "Xmanuel01"
    )
      throw new Error("SOLO_RELEASE_REFUSED: DISPATCH_AND_RERUN_MUST_BE_OWNER");
    return "Xmanuel01";
  }
  return viewer;
}

export function verifySoloApproval({
  comment,
  pull,
  checks,
  owner,
  sha,
  scope,
  deploymentRun,
  now = Date.now(),
}) {
  const refuse = (reason) => {
    throw new Error("SOLO_RELEASE_REFUSED: " + reason);
  };
  if (!/^[a-f0-9]{40}$/.test(sha) || pull.head?.sha !== sha) refuse("STALE_COMMIT");
  if (pull.state !== "open" || pull.draft || pull.base?.ref !== "main")
    refuse("PR_NOT_RELEASE_CANDIDATE");
  if (pull.base?.repo?.full_name !== "Xmanuel01/seramet-connect" || owner !== "Xmanuel01")
    refuse("WRONG_REPOSITORY_OWNER");
  if (!["staging", "production-promotion"].includes(scope)) refuse("INVALID_SCOPE");
  if (comment.user?.login !== owner || comment.author_association !== "OWNER") refuse("NOT_OWNER");
  if (
    comment.issue_url !==
    `https://api.github.com/repos/Xmanuel01/seramet-connect/issues/${pull.number}`
  )
    refuse("WRONG_PULL_REQUEST");
  if (comment.created_at !== comment.updated_at) refuse("EDITED_APPROVAL");
  const [marker, ...body] = String(comment.body ?? "")
    .trim()
    .split("\n");
  if (marker !== SOLO_APPROVAL_MARKER) refuse("INVALID_MARKER");
  let approval;
  try {
    approval = JSON.parse(body.join("\n"));
  } catch {
    refuse("INVALID_APPROVAL_JSON");
  }
  if (!approval || typeof approval !== "object" || Array.isArray(approval))
    refuse("INVALID_APPROVAL_JSON");
  if (Object.keys(approval).sort().join(",") !== "commit,expires_at,nonce,pull_request,scope")
    refuse("INVALID_APPROVAL_FIELDS");
  if (approval.commit !== sha || approval.pull_request !== pull.number || approval.scope !== scope)
    refuse("APPROVAL_SCOPE_OR_COMMIT_MISMATCH");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(approval.nonce))
    refuse("INVALID_NONCE");
  const created = Date.parse(comment.created_at),
    expires = Date.parse(approval.expires_at);
  if (
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > now ||
    expires <= now ||
    expires - created > 7_200_000 ||
    now - created > 7_200_000
  )
    refuse("APPROVAL_EXPIRED_OR_INVALID");
  for (const name of requiredCoreChecks) {
    const latest = checks
      .filter((check) => check.name === name && check.head_sha === sha)
      .sort((a, b) => b.id - a.id)[0];
    if (
      latest?.app?.id !== 15368 ||
      latest.status !== "completed" ||
      latest.conclusion !== "success"
    )
      refuse("REQUIRED_CI_NOT_SUCCESSFUL");
  }
  if (
    deploymentRun &&
    (scope !== "staging" ||
      deploymentRun.event !== "workflow_dispatch" ||
      deploymentRun.path !== ".github/workflows/deploy-staging.yml" ||
      deploymentRun.head_sha !== sha ||
      deploymentRun.actor?.login !== owner ||
      deploymentRun.triggering_actor?.login !== owner ||
      !Number.isSafeInteger(deploymentRun.id))
  )
    refuse("UNVERIFIED_DEPLOYMENT_RUN");
  const latestChecks = new Map();
  for (const check of checks.filter((entry) => entry.head_sha === sha)) {
    if (!latestChecks.has(check.name) || latestChecks.get(check.name).id < check.id)
      latestChecks.set(check.name, check);
  }
  if (
    [...latestChecks.values()].some(
      (check) =>
        !(
          deploymentRun &&
          check.name === "deploy" &&
          check.app?.id === 15368 &&
          check.status === "in_progress" &&
          check.conclusion == null &&
          check.details_url?.startsWith(
            `https://github.com/Xmanuel01/seramet-connect/actions/runs/${deploymentRun.id}/job/`,
          )
        ) &&
        (check.status !== "completed" ||
          !["success", "neutral", "skipped"].includes(check.conclusion)),
    )
  )
    refuse("CANDIDATE_CHECKS_NOT_FINISHED_OR_FAILED");
  return {
    commit: sha,
    scope,
    owner,
    approvalCommentId: comment.id,
    expiresAt: approval.expires_at,
  };
}

function api(path, body) {
  return JSON.parse(
    execFileSync(
      process.platform === "win32" ? "gh.exe" : "gh",
      ["api", path, ...(body ? ["--method", "POST", "--input", "-"] : [])],
      {
        input: body ? JSON.stringify(body) : undefined,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ),
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const option = (key) => args[args.indexOf(key) + 1];
  const number = option("--pr"),
    commentId = option("--comment-id"),
    sha = option("--sha"),
    scope = option("--scope");
  if (
    !/^\d+$/.test(number ?? "") ||
    !/^\d+$/.test(commentId ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha ?? "")
  )
    throw new Error("Explicit PR, comment ID, commit SHA and scope are required");
  const owner = approvalOperator(
    process.env,
    process.env.GITHUB_ACTIONS === "true" ? null : api("/user").login,
  );
  const base = "/repos/Xmanuel01/seramet-connect";
  const pull = api(`${base}/pulls/${number}`);
  const comment = api(`${base}/issues/comments/${commentId}`);
  const checks = api(`${base}/commits/${sha}/check-runs?per_page=100`);
  if (checks.total_count >= 100)
    throw new Error("Incomplete check inventory; review pagination before release");
  const deploymentRun =
    process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_WORKFLOW === "Deploy staging"
      ? api(`${base}/actions/runs/${process.env.GITHUB_RUN_ID}`)
      : undefined;
  const result = verifySoloApproval({
    comment,
    pull,
    checks: checks.check_runs,
    owner,
    sha,
    scope,
    deploymentRun,
  });
  if (args.includes("--publish-production-status")) {
    if (scope !== "production-promotion")
      throw new Error("A staging approval can never authorize production promotion");
    api(`${base}/statuses/${sha}`, {
      state: "success",
      context: SOLO_PRODUCTION_CHECK,
      description: "Owner explicitly approved this tested commit for production promotion",
      target_url: comment.html_url,
    });
  }
  console.log(JSON.stringify(result));
}
