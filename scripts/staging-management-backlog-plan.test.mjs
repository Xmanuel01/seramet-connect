import assert from "node:assert/strict";
import { test } from "node:test";
import { planStagingManagementBacklog } from "./staging-management-backlog-plan.mjs";

const state = () => ({
  schemaVersion: 26,
  pendingImportCount: 0,
  activeOtherJobCount: 0,
  branches: [
    {
      id: "generic-branch",
      tenant_id: "tenant",
      lifecycle_state: "CONFIGURING",
      is_bootstrap: 1,
    },
  ],
  jobs: Array.from({ length: 42 }, (_, i) => ({
    tenant_id: "tenant",
    branch_id: "generic-branch",
    id: "job-" + i,
    idempotency_key: "management-recalc-" + i,
    job_type: "MANAGEMENT_INTELLIGENCE_RECALCULATION",
    payload_json: JSON.stringify({ branchId: "generic-branch", businessDate: null }),
    status: "PENDING",
    attempt_count: 0,
    started_at: null,
    finished_at: null,
    lease_owner: null,
    lease_expires_at: null,
    scheduled_at: new Date(
      Date.UTC(2026, 8, i === 41 ? 28 : i === 40 ? 25 : 22, 11, i),
    ).toISOString(),
  })),
});

test("retains the Sep28 job and supersedes exactly 41 identical prior requests", () => {
  const p = planStagingManagementBacklog(state());
  assert.equal(p.retained.id, "job-41");
  assert.equal(p.superseded.length, 41);
  assert.equal(p.publicSummary.to_recalculate_once, 1);
  assert.match(p.fingerprint, /^[a-f0-9]{64}$/);
});

test("refuses a novel intermediate date not present in the vetted original 41 jobs", () => {
  const a = state();
  a.jobs[17].scheduled_at = "2026-09-26T11:17:00.000Z";
  assert.throws(() => planStagingManagementBacklog(a), /Stale-work time window changed/);
});

test("rejects pending unscanned menu imports or other active jobs", () => {
  const a = state();
  a.pendingImportCount = 3;
  assert.throws(() => planStagingManagementBacklog(a), /menu import jobs first/);
  const b = state();
  b.activeOtherJobCount = 1;
  assert.throws(() => planStagingManagementBacklog(b), /non-management active work/);
});

test("rejects any historical business date or changed branch target", () => {
  const a = state();
  a.jobs[1].payload_json = JSON.stringify({
    branchId: "generic-branch",
    businessDate: "2026-09-21",
  });
  assert.throws(() => planStagingManagementBacklog(a), /could be material/);
  const b = state();
  b.jobs[2].payload_json = JSON.stringify({
    branchId: "other-branch",
    businessDate: null,
  });
  assert.throws(() => planStagingManagementBacklog(b), /could be material/);
});

test("refuses any started, leased, retried or already terminal job", () => {
  for (const field of ["started_at", "lease_owner", "attempt_count", "status"]) {
    const a = state();
    a.jobs[3][field] = {
      started_at: "2026-09-22",
      lease_owner: "worker",
      attempt_count: 1,
      status: "RUNNING",
    }[field];
    assert.throws(() => planStagingManagementBacklog(a), /could be material/);
  }
});

test("rejects changed count, schema or branch status", () => {
  const a = state();
  a.jobs.pop();
  assert.throws(() => planStagingManagementBacklog(a), /exactly 41/);
  const b = state();
  b.schemaVersion = 27;
  assert.throws(() => planStagingManagementBacklog(b), /Schema changed/);
  const c = state();
  c.branches[0].lifecycle_state = "ACTIVE";
  assert.throws(() => planStagingManagementBacklog(c), /branch setup has changed/);
});

test("rejects duplicate job IDs or idempotency keys", () => {
  const a = state();
  a.jobs[2].id = a.jobs[1].id;
  assert.throws(() => planStagingManagementBacklog(a), /could be material/);
  const b = state();
  b.jobs[2].idempotency_key = b.jobs[1].idempotency_key;
  assert.throws(() => planStagingManagementBacklog(b), /could be material/);
});
