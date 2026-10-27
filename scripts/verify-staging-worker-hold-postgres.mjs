import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildStagingWorkerHoldSql, holdSnapshotSql } from "./staging-worker-hold-plan.mjs";

const url = new URL(process.env.SERAMET_POSTGRES_URL ?? "https://invalid.local");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !["/seramet_test", "/seramet_restore"].includes(url.pathname)
)
  throw new Error("Hold verifier requires an isolated loopback database");
const db = new pg.Client({ connectionString: url.href });
await db.connect();
try {
  const tenant = "hold-fixture-" + randomUUID(),
    stamp = "2020-01-01T00:00:00.000Z",
    cutoff = "2020-01-02T00:00:00.000Z";
  await db.query(
    `INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES($1,$1,$1,$1,'KES','Africa/Nairobi','en-KE',1,'{}',$2,$2)`,
    [tenant, stamp],
  );
  for (const [id, status] of [
    ["expired", "RUNNING"],
    ["dead", "DEAD_LETTER"],
    ["done", "SUCCEEDED"],
  ])
    await db.query(
      `INSERT INTO worker_jobs(tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,scheduled_at,lease_owner,lease_expires_at,last_error,result_json,created_at,updated_at) VALUES($1,$2,'MUST_NOT_EXECUTE','{"preserve":"payload"}',$2,$2,$3,3,$4,'original-consumer',$4,'Original diagnostic','{"preserve":"result"}',$4,$4)`,
      [tenant, id, status, stamp],
    );
  const before = await db.query("SELECT * FROM worker_jobs WHERE tenant_id=$1 ORDER BY id", [
    tenant,
  ]);
  const snapshot = (await db.query(holdSnapshotSql(cutoff))).rows[0];
  assert.equal(snapshot.jobs, 2);
  const options = {
    projectRef: "vnymbavsbxorwxpebkot",
    cutoff,
    count: 2,
    snapshotSha256: snapshot.snapshot_sha256,
    batchId: randomUUID(),
    backupRun: 1,
    backupRestoreVerified: true,
    operator: "Xmanuel01",
    isolated: true,
  };
  await assert.rejects(
    db.query(buildStagingWorkerHoldSql({ ...options, snapshotSha256: "0".repeat(64) })),
    /snapshot changed/,
  );
  await db.query("ROLLBACK");
  assert.deepEqual(
    (await db.query("SELECT * FROM worker_jobs WHERE tenant_id=$1 ORDER BY id", [tenant])).rows,
    before.rows,
  );
  await db.query(buildStagingWorkerHoldSql(options));
  const after = (
    await db.query("SELECT * FROM worker_jobs WHERE tenant_id=$1 ORDER BY id", [tenant])
  ).rows;
  for (const original of before.rows) {
    const current = after.find((row) => row.id === original.id);
    if (original.status === "SUCCEEDED") {
      assert.deepEqual(current, original);
      continue;
    }
    assert.equal(current.status, "FAILED");
    assert.equal(current.payload_json, original.payload_json);
    assert.equal(current.last_error, original.last_error);
    assert.equal(current.attempt_count, 3);
    assert.equal(current.lease_owner, original.lease_owner);
    assert.equal(JSON.parse(current.result_json).preserve, "result");
    assert.equal(
      JSON.parse(current.result_json).seramet_recovery_hold.original_status,
      original.status,
    );
  }
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::integer n FROM audit_events WHERE tenant_id=$1 AND action='WORKER_JOB_NO_REPLAY_HOLD'",
        [tenant],
      )
    ).rows[0].n,
    2,
  );
  await assert.rejects(db.query(buildStagingWorkerHoldSql(options)), /snapshot changed/);
  await db.query("ROLLBACK");
  console.log(
    "DISPOSABLE POSTGRES: exact-snapshot no-replay holds, immutable evidence, audit counts and atomic rejection PASS",
  );
} finally {
  await db.end();
}
