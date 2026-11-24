import assert from "node:assert/strict";
import { test } from "node:test";
import { assessProductionRelease } from "./verify-production-release-gate.mjs";

const merge = "a".repeat(40);
const head = "b".repeat(40);
const now = Date.parse("2026-11-24T06:00:00Z");

function passing() {
  return {
    now,
    env: {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: "Xmanuel01/seramet-connect",
      GITHUB_ACTOR: "Xmanuel01",
      GITHUB_TRIGGERING_ACTOR: "Xmanuel01",
      GITHUB_SHA: merge,
      SERAMET_PRODUCTION_APPROVED_SHA: merge,
      SERAMET_DATA_API_EXPOSURE_CLEARED: "true",
    },
    pull: {
      merged: true,
      merge_commit_sha: merge,
      head: { sha: head },
      base: { ref: "main", repo: { full_name: "Xmanuel01/seramet-connect" } },
    },
    mergeCommit: { tree: { sha: "t".repeat(40) } },
    candidateCommit: { tree: { sha: "t".repeat(40) } },
    candidateStatuses: [
      {
        context: "owner-approved-production-candidate",
        state: "success",
        creator: { login: "Xmanuel01" },
      },
    ],
    recoveryRuns: [
      {
        path: ".github/workflows/production-recovery-verification.yml",
        head_sha: merge,
        head_branch: "main",
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
        actor: { login: "Xmanuel01" },
        triggering_actor: { login: "Xmanuel01" },
        created_at: "2026-11-24T04:00:00Z",
      },
    ],
  };
}

test("merged, owner-approved, recovered and approved commit passes", () => {
  assert.deepEqual(assessProductionRelease(passing()), []);
});

test("a different dispatcher, branch or event is refused", () => {
  for (const [key, value] of [
    ["GITHUB_ACTOR", "someone-else"],
    ["GITHUB_TRIGGERING_ACTOR", "someone-else"],
    ["GITHUB_REF", "refs/heads/claude/approved-print-layouts"],
    ["GITHUB_EVENT_NAME", "push"],
  ]) {
    const input = passing();
    input.env[key] = value;
    assert.ok(assessProductionRelease(input).includes("NOT_OWNER_DISPATCH_FROM_MAIN"), key);
  }
});

test("the protected approved-SHA variable must name this exact commit", () => {
  const input = passing();
  input.env.SERAMET_PRODUCTION_APPROVED_SHA = head;
  assert.deepEqual(assessProductionRelease(input), ["RELEASE_SHA_NOT_APPROVED"]);
});

test("an unmerged PR, or one merged as another commit, is refused", () => {
  const open = passing();
  open.pull.merged = false;
  assert.deepEqual(assessProductionRelease(open), ["RELEASE_PR_NOT_MERGED_AS_THIS_COMMIT"]);
  const other = passing();
  other.pull.merge_commit_sha = "c".repeat(40);
  assert.deepEqual(assessProductionRelease(other), ["RELEASE_PR_NOT_MERGED_AS_THIS_COMMIT"]);
});

test("code that differs from the approved candidate is refused", () => {
  const input = passing();
  input.mergeCommit = { tree: { sha: "d".repeat(40) } };
  assert.deepEqual(assessProductionRelease(input), ["SOURCE_TREE_DIFFERS_FROM_APPROVED_CANDIDATE"]);
});

test("a staging-only, failed, superseded or non-owner approval is refused", () => {
  for (const statuses of [
    [],
    [
      {
        context: "owner-approved-production-candidate",
        state: "failure",
        creator: { login: "Xmanuel01" },
      },
    ],
    [
      {
        context: "owner-approved-production-candidate",
        state: "success",
        creator: { login: "a-bot" },
      },
    ],
    [
      {
        context: "owner-approved-production-candidate",
        state: "error",
        creator: { login: "Xmanuel01" },
      },
      {
        context: "owner-approved-production-candidate",
        state: "success",
        creator: { login: "Xmanuel01" },
      },
    ],
  ]) {
    const input = passing();
    input.candidateStatuses = statuses;
    assert.deepEqual(assessProductionRelease(input), [
      "CANDIDATE_NOT_OWNER_APPROVED_FOR_PRODUCTION",
    ]);
  }
});

test("a missing, failed, stale or other-commit recovery drill is refused", () => {
  for (const change of [
    () => [],
    (run) => [{ ...run, conclusion: "failure" }],
    (run) => [{ ...run, head_sha: head }],
    (run) => [{ ...run, created_at: "2026-11-22T04:00:00Z" }],
    (run) => [{ ...run, actor: { login: "a-bot" } }],
  ]) {
    const input = passing();
    input.recoveryRuns = change(input.recoveryRuns[0]);
    assert.deepEqual(assessProductionRelease(input), ["NO_FRESH_RECOVERY_DRILL_FOR_THIS_COMMIT"]);
  }
});

test("the Data API exposure review stays mandatory", () => {
  const input = passing();
  delete input.env.SERAMET_DATA_API_EXPOSURE_CLEARED;
  assert.deepEqual(assessProductionRelease(input), ["DATA_API_EXPOSURE_NOT_CLEARED"]);
});
