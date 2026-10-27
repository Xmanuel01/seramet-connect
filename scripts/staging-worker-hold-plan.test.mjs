import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStagingWorkerHoldSql, holdSnapshotSql } from "./staging-worker-hold-plan.mjs";
const plan = {
  projectRef: "vnymbavsbxorwxpebkot",
  cutoff: "2026-10-27T03:05:21.864129Z",
  count: 502,
  snapshotSha256: "a".repeat(64),
  batchId: "12345678-1234-4123-8123-123456789abc",
  backupRun: 1,
  backupRestoreVerified: true,
  operator: "Xmanuel01",
};
test("a hold is bounded, transactional, audited and never replays or marks success", () => {
  const sql = buildStagingWorkerHoldSql(plan);
  assert.match(sql, /BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /Hold snapshot changed/);
  assert.match(sql, /status='FAILED'/);
  assert.match(sql, /WORKER_JOB_NO_REPLAY_HOLD/);
  assert.match(sql, /Original job evidence changed/);
  assert.doesNotMatch(sql, /status\s*=\s*'SUCCEEDED'|DELETE FROM|DROP TABLE|attempt_count\s*=/);
  assert.match(sql, /COMMIT;/);
});
test("production, missing restore, unbounded or inexact targets fail closed", () => {
  for (const change of [
    { projectRef: "qnhqylslyhxjcksuhgyq" },
    { operator: "other" },
    { backupRestoreVerified: false },
    { count: 0 },
    { count: 1001 },
    { snapshotSha256: "bad" },
    { batchId: "bad" },
    { cutoff: "now' OR true--" },
    { isolated: "true" },
  ])
    assert.throws(() => buildStagingWorkerHoldSql({ ...plan, ...change }));
  assert.throws(() => holdSnapshotSql("not-a-date"));
});
