import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalOperator,
  SOLO_APPROVAL_MARKER,
  requiredCoreChecks,
  verifySoloApproval,
} from "./solo-release-approval.mjs";

test("the staging operator must own both dispatch and rerun", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "Xmanuel01/seramet-connect",
    GITHUB_ACTOR: "Xmanuel01",
    GITHUB_TRIGGERING_ACTOR: "Xmanuel01",
  };
  assert.equal(approvalOperator(env, null), "Xmanuel01");
  for (const change of [
    { GITHUB_ACTOR: "other" },
    { GITHUB_TRIGGERING_ACTOR: "other" },
    { GITHUB_REPOSITORY: "other/repo" },
  ])
    assert.throws(() => approvalOperator({ ...env, ...change }, null));
});

function fixture(scope = "staging") {
  const sha = "a".repeat(40),
    now = Date.parse("2026-10-27T10:00:00Z");
  const approval = {
    commit: sha,
    pull_request: 156,
    scope,
    expires_at: "2026-10-27T11:00:00Z",
    nonce: "12345678-1234-4123-8123-123456789abc",
  };
  return {
    sha,
    now,
    scope,
    owner: "Xmanuel01",
    pull: {
      number: 156,
      state: "open",
      draft: false,
      head: { sha },
      base: { ref: "main", repo: { full_name: "Xmanuel01/seramet-connect" } },
    },
    comment: {
      id: 123,
      user: { login: "Xmanuel01" },
      author_association: "OWNER",
      created_at: "2026-10-27T09:30:00Z",
      updated_at: "2026-10-27T09:30:00Z",
      issue_url: "https://api.github.com/repos/Xmanuel01/seramet-connect/issues/156",
      body: SOLO_APPROVAL_MARKER + "\n" + JSON.stringify(approval),
    },
    checks: requiredCoreChecks.map((name, id) => ({
      id,
      name,
      head_sha: sha,
      app: { id: 15368 },
      status: "completed",
      conclusion: "success",
    })),
  };
}
test("owner approval is bound to this exact tested commit and action", () => {
  for (const scope of ["staging", "production-promotion"])
    assert.equal(verifySoloApproval(fixture(scope)).scope, scope);
});

test("a verified staging deployment can exclude only its own currently running job", () => {
  const value = fixture();
  value.deploymentRun = {
    id: 123456,
    event: "workflow_dispatch",
    path: ".github/workflows/deploy-staging.yml",
    head_sha: value.sha,
    actor: { login: value.owner },
    triggering_actor: { login: value.owner },
  };
  value.checks.push({
    id: 200,
    name: "deploy",
    head_sha: value.sha,
    app: { id: 15368 },
    status: "in_progress",
    conclusion: null,
    details_url: "https://github.com/Xmanuel01/seramet-connect/actions/runs/123456/job/987",
  });
  assert.equal(verifySoloApproval(value).scope, "staging");
  for (const change of [
    { deploymentRun: { ...value.deploymentRun, id: 999999 } },
    { deploymentRun: { ...value.deploymentRun, path: "other.yml" } },
    { deploymentRun: { ...value.deploymentRun, triggering_actor: { login: "other" } } },
    { scope: "production-promotion" },
  ])
    assert.throws(() => verifySoloApproval({ ...value, ...change }));
  value.checks.at(-1).name = "validate";
  assert.throws(() => verifySoloApproval(value), /CI|CHECKS/);
});
test("staging approval cannot be reused for production or after another push", () => {
  const value = fixture();
  assert.throws(
    () => verifySoloApproval({ ...value, scope: "production-promotion" }),
    /SCOPE_OR_COMMIT/,
  );
  assert.throws(() => verifySoloApproval({ ...value, sha: "b".repeat(40) }), /STALE_COMMIT/);
});
test("non-owner, edited, expired, malformed and foreign-PR approvals fail closed", () => {
  for (const mutate of [
    (f) => {
      f.comment.user.login = "someone-else";
    },
    (f) => {
      f.comment.updated_at = "2026-10-27T09:31:00Z";
    },
    (f) => {
      f.now += 7_200_000;
    },
    (f) => {
      f.comment.body = "approved";
    },
    (f) => {
      f.comment.issue_url += "0";
    },
    (f) => {
      f.owner = "another-owner";
    },
    (f) => {
      f.pull.base.ref = "another-branch";
    },
    (f) => {
      f.pull.state = "closed";
    },
    (f) => {
      f.pull.draft = true;
    },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => verifySoloApproval(value), /SOLO_RELEASE_REFUSED/);
  }
});
test("no owner approval overrides pending, failed, stale or impersonated CI", () => {
  for (const mutate of [
    (f) => {
      f.checks.pop();
    },
    (f) => {
      f.checks[0].conclusion = "failure";
    },
    (f) => {
      f.checks[0].status = "in_progress";
    },
    (f) => {
      f.checks[0].app.id = 1;
    },
    (f) => {
      f.checks[0].head_sha = "b".repeat(40);
    },
    (f) => {
      f.checks.push({ ...f.checks[0], id: 100, name: "browser", conclusion: "failure" });
    },
    (f) => {
      f.checks.push({
        ...f.checks[0],
        id: 100,
        name: "browser",
        status: "in_progress",
        conclusion: null,
      });
    },
    (f) => {
      f.checks.push({ ...f.checks[0], id: 100, conclusion: "cancelled" });
    },
  ]) {
    const value = fixture();
    mutate(value);
    assert.throws(() => verifySoloApproval(value), /CI|CHECKS/);
  }
});
