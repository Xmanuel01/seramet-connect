import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const ref = (id) => createHash("md5").update(id).digest("hex").slice(0, 12);
const refuse = (message) => {
  throw new Error("STAGING_MANAGEMENT_BACKLOG_REFUSED: " + message);
};
const isExpectedPayload = (raw, branchId) => {
  try {
    const payload = JSON.parse(raw);
    return (
      payload &&
      !Array.isArray(payload) &&
      Object.keys(payload).sort().join(",") === "branchId,businessDate" &&
      payload.branchId === branchId &&
      payload.businessDate === null
    );
  } catch {
    return false;
  }
};
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  return value;
};

/**
 * 2026-09-28 staging incident: only date-free, zero-attempt recalculations for
 * one preexisting branch may be collapsed. The newest existing job is retained
 * PENDING; never manufacture a successful run or auto-ack any unfinished work.
 * If anything about the workload changed, refuse instead of guessing.
 */
export function planStagingManagementBacklog({
  jobs,
  branches,
  activeOtherJobCount,
  pendingImportCount,
  schemaVersion,
}) {
  if (schemaVersion !== 26) refuse("Schema changed");
  if (pendingImportCount !== 0)
    refuse("Reconcile the three unscanned menu import jobs first, after backup");
  if (activeOtherJobCount !== 0)
    refuse("New or non-management active work exists; re-audit before retry");
  if (
    branches.length !== 1 ||
    branches[0].lifecycle_state !== "CONFIGURING" ||
    Number(branches[0].is_bootstrap) !== 1
  )
    refuse("Original staging branch setup has changed");
  if (jobs.length !== 41) refuse("Expected exactly 41 original pending recalculations");
  const tenantId = branches[0].tenant_id;
  const branchId = branches[0].id;
  const uniqueIds = new Set();
  const uniqueKeys = new Set();
  for (const job of jobs) {
    if (
      job.tenant_id !== tenantId ||
      job.branch_id !== branchId ||
      job.job_type !== "MANAGEMENT_INTELLIGENCE_RECALCULATION" ||
      job.status !== "PENDING" ||
      Number(job.attempt_count) !== 0 ||
      job.started_at !== null ||
      job.finished_at !== null ||
      job.lease_owner !== null ||
      job.lease_expires_at !== null ||
      !job.idempotency_key ||
      !job.id ||
      !isExpectedPayload(job.payload_json, branchId) ||
      uniqueIds.has(job.id) ||
      uniqueKeys.has(job.idempotency_key)
    ) {
      refuse("One of the dated management jobs has changed or could be material");
    }
    uniqueIds.add(job.id);
    uniqueKeys.add(job.idempotency_key);
  }
  const ordered = [...jobs].sort(
    (a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id),
  );
  if (
    !ordered[0].scheduled_at.startsWith("2026-09-22") ||
    !ordered.at(-1).scheduled_at.startsWith("2026-09-25")
  )
    refuse("Stale-work time window changed");
  const latest = ordered.at(-1);
  const superseded = ordered.slice(0, -1);
  const snapshot = hash(
    JSON.stringify(
      stable({
        schemaVersion,
        branches,
        jobs: ordered,
        activeOtherJobCount,
        pendingImportCount,
        retainedJobId: latest.id,
        supersededIds: superseded.map((job) => job.id),
      }),
    ),
  );
  return {
    tenantId,
    branchId,
    retained: latest,
    superseded,
    fingerprint: snapshot,
    publicSummary: {
      tenant_ref: ref(tenantId),
      branch_ref: ref(branchId),
      retained_job_ref: ref(latest.id),
      to_quarantine: superseded.length,
      to_recalculate_once: 1,
      other_active_jobs: 0,
      exact_snapshot_sha256: snapshot,
      instruction: "Retain newest pending job for one current business-day refresh only",
    },
  };
}
