import assert from "node:assert/strict";
import { test } from "node:test";
import { assessStagingReleaseApproval } from "./verify-staging-release-gate.mjs";

const sha = "a".repeat(40);
const approved = {
  GITHUB_SHA: sha,
  SERAMET_STAGING_APPROVED_SHA: sha,
  SERAMET_STAGING_BACKUP_RESTORE_VERIFIED: "true",
  SERAMET_STAGING_BACKLOG_REVIEW_APPROVED: "true",
};

test("a specifically approved commit with verified backup and backlog review passes", () => {
  assert.deepEqual(assessStagingReleaseApproval(approved), []);
});

test("an unrelated new commit cannot reuse stale staging approval", () => {
  assert.deepEqual(
    assessStagingReleaseApproval({ ...approved, GITHUB_SHA: "b".repeat(40) }),
    ["RELEASE_SHA_NOT_APPROVED"],
  );
});

test("missing release verification fails closed before migration", () => {
  assert.deepEqual(
    assessStagingReleaseApproval({ GITHUB_SHA: sha }),
    [
      "RELEASE_SHA_NOT_APPROVED",
      "STAGING_BACKUP_RESTORE_NOT_VERIFIED",
      "PENDING_WORK_NOT_REVIEWED",
    ],
  );
});

test("an approval never excuses a missing backup or unreviewed pending jobs", () => {
  assert.deepEqual(
    assessStagingReleaseApproval({
      ...approved,
      SERAMET_STAGING_BACKUP_RESTORE_VERIFIED: "false",
      SERAMET_STAGING_BACKLOG_REVIEW_APPROVED: "false",
    }),
    ["STAGING_BACKUP_RESTORE_NOT_VERIFIED", "PENDING_WORK_NOT_REVIEWED"],
  );
});
