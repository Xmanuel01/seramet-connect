import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assessStagingReleaseApproval } from "./verify-staging-release-gate.mjs";

const sha = "a".repeat(40);
const approved = {
  GITHUB_SHA: sha,
  SERAMET_STAGING_APPROVED_SHA: sha,
  SERAMET_STAGING_BACKUP_RESTORE_VERIFIED: "true",
  SERAMET_STAGING_BACKLOG_REVIEW_APPROVED: "true",
  SERAMET_DATA_API_EXPOSURE_CLEARED: "true",
};

test("a specifically approved commit with verified backup and backlog review passes", () => {
  assert.deepEqual(assessStagingReleaseApproval(approved), []);
});

test("an unrelated new commit cannot reuse stale staging approval", () => {
  assert.deepEqual(assessStagingReleaseApproval({ ...approved, GITHUB_SHA: "b".repeat(40) }), [
    "RELEASE_SHA_NOT_APPROVED",
  ]);
});

test("missing release verification fails closed before migration", () => {
  assert.deepEqual(assessStagingReleaseApproval({ GITHUB_SHA: sha }), [
    "RELEASE_SHA_NOT_APPROVED",
    "STAGING_BACKUP_RESTORE_NOT_VERIFIED",
    "PENDING_WORK_NOT_REVIEWED",
    "DATA_API_EXPOSURE_NOT_CLEARED",
  ]);
});

test("an approval never overrides unreviewed Data API exposure", () => {
  assert.deepEqual(
    assessStagingReleaseApproval({ ...approved, SERAMET_DATA_API_EXPOSURE_CLEARED: "false" }),
    ["DATA_API_EXPOSURE_NOT_CLEARED"],
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

test("staging approval runs before dependency installation and every infrastructure write", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-staging.yml", import.meta.url),
    "utf8",
  );
  const gate = workflow.indexOf("run: node scripts/verify-staging-release-gate.mjs");
  assert.ok(gate >= 0, "Release approval must remain mandatory");
  for (const command of [
    "run: npm ci",
    "queues create",
    "run: npm run migrate:postgres",
    "hyperdrive update",
    "deploy --config",
  ]) {
    const position = workflow.indexOf(command);
    assert.ok(position > gate, `${command} must not precede release approval`);
  }
  const gateStep = workflow.slice(workflow.lastIndexOf("      - name:", gate), gate);
  assert.doesNotMatch(
    gateStep,
    /continue-on-error:|\bif:/,
    "Approval cannot be skipped or ignored",
  );
});
