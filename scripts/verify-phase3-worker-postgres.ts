import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PostgresD1Database } from "@/server/database/postgres-database";
import { handleWorkerQueue } from "@/server/workers";

const raw = process.env.SERAMET_POSTGRES_URL;
const target = raw ? new URL(raw) : null;
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  target.username !== "finance_ci" ||
  target.pathname !== "/seramet_finance_ci"
) {
  throw new Error("Phase 3 failure certification requires disposable CI PostgreSQL");
}
const db = PostgresD1Database.fromHyperdrive({ connectionString: raw! });
const tenantId = process.argv.includes("--worker-child")
  ? process.argv.at(-2)!
  : "phase3-worker-" + randomUUID();
const childJob = process.argv.at(-1)!;
const stamp = new Date().toISOString();
const control = new pg.Client({ connectionString: raw });
try {
  if (process.argv.includes("--worker-child")) {
    assert.match(tenantId, /^phase3-worker-[a-f0-9-]+$/);
    await deliver(childJob);
  } else {
    await control.connect();
    await db
      .prepare(
        "INSERT INTO tenants(id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES(?,?,?,?,'KES','Africa/Nairobi','en-KE',0,'{}',?,?)",
      )
      .bind(tenantId, tenantId, "Synthetic crash recovery", "CI", stamp, stamp)
      .run();
    await verifyRetryExhaustion();
    await verifyKilledProcess();
    console.log("PHASE3_POSTGRES_WORKER_FAILURE_CERTIFICATION_PASS");
  }
} finally {
  if (!process.argv.includes("--worker-child")) {
    await control.query("ROLLBACK").catch(() => undefined);
    await control.end();
  }
  await db.close();
}

async function seed(jobId: string, type: string, maxAttempts = 3) {
  await db
    .prepare(
      "INSERT INTO worker_jobs(tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,max_attempts,scheduled_at,created_at,updated_at) VALUES(?,?,?,'{}',?,?,'PENDING',0,?,?,?,?)",
    )
    .bind(tenantId, jobId, type, jobId, jobId, maxAttempts, stamp, stamp, stamp)
    .run();
}
async function state(jobId: string) {
  return db
    .prepare(
      "SELECT status,attempt_count,finished_at,last_error,lease_owner,lease_expires_at FROM worker_jobs WHERE tenant_id=? AND id=?",
    )
    .bind(tenantId, jobId)
    .first<{
      status: string;
      attempt_count: number;
      finished_at: string | null;
      last_error: string | null;
      lease_owner: string | null;
      lease_expires_at: string | null;
    }>();
}
async function completionCount(jobId: string) {
  return Number(
    await db
      .prepare(
        "SELECT COUNT(*) AS count FROM realtime_events WHERE tenant_id=? AND entity_type='WORKER_JOB' AND entity_id=?",
      )
      .bind(tenantId, jobId)
      .first("count"),
  );
}
async function deliver(jobId: string, attempts = 1) {
  let acknowledged = 0;
  let retried = 0;
  await handleWorkerQueue(
    {
      queue: "disposable-phase3-failure",
      messages: [
        {
          id: jobId,
          timestamp: new Date(),
          attempts,
          body: { kind: "worker-job", tenantId, jobId, correlationId: jobId },
          ack: () => {
            acknowledged += 1;
          },
          retry: () => {
            retried += 1;
          },
        },
      ],
    },
    { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test" },
  );
  return { acknowledged, retried };
}
async function verifyRetryExhaustion() {
  const jobId = "unsupported-" + randomUUID();
  await seed(jobId, "PHASE3_INTENTIONAL_UNSUPPORTED_JOB", 2);
  assert.deepEqual(await deliver(jobId), { acknowledged: 0, retried: 1 });
  let row = await state(jobId);
  assert.equal(row?.status, "RETRY_PENDING");
  assert.equal(row?.attempt_count, 1);
  assert.equal(row?.finished_at, null);
  assert.equal(row?.lease_owner, null);
  assert.match(row?.last_error ?? "", /No live worker implementation/);
  await db
    .prepare("UPDATE worker_jobs SET scheduled_at=? WHERE tenant_id=? AND id=?")
    .bind(new Date(Date.now() - 1000).toISOString(), tenantId, jobId)
    .run();
  assert.deepEqual(await deliver(jobId, 2), { acknowledged: 1, retried: 0 });
  row = await state(jobId);
  assert.equal(row?.status, "DEAD_LETTER");
  assert.equal(row?.attempt_count, 2);
  assert.ok(row?.finished_at);
  assert.equal(await completionCount(jobId), 0);
  assert.deepEqual(await deliver(jobId, 3), { acknowledged: 1, retried: 0 });
  assert.deepEqual(
    await state(jobId),
    row,
    "Terminal redelivery must preserve the failure evidence",
  );
  console.log(
    "PostgreSQL worker retries, bounded exhaustion, application dead letter and terminal redelivery PASS",
  );
}
async function verifyKilledProcess() {
  const jobId = "killed-" + randomUUID();
  await seed(jobId, "INVENTORY_EXPIRY_ALERTS");
  await control.query("BEGIN");
  await control.query("LOCK TABLE public.inventory_lots IN ACCESS EXCLUSIVE MODE");
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      require.resolve("vite-node/cli"),
      fileURLToPath(import.meta.url),
      "--worker-child",
      tenantId,
      jobId,
    ],
    {
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  let stderr = "";
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(-1500);
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  try {
    const deadline = Date.now() + 15000;
    let running = false;
    while (Date.now() < deadline && child.exitCode === null) {
      const row = await state(jobId);
      if (row?.status === "RUNNING") {
        running = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(running, "Child must persist its RUNNING claim before termination: " + stderr);
    assert.equal(await completionCount(jobId), 0);
    child.kill("SIGKILL");
    assert.equal((await exited).signal, "SIGKILL");
    assert.equal((await state(jobId))?.status, "RUNNING");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await control.query("ROLLBACK");
  }
  // Only the disposable fixture's clock is advanced. The previous native staging
  // check separately proved that an active lease is not stolen.
  await db
    .prepare("UPDATE worker_jobs SET lease_expires_at=? WHERE tenant_id=? AND id=?")
    .bind(new Date(Date.now() - 1000).toISOString(), tenantId, jobId)
    .run();
  assert.deepEqual(await deliver(jobId, 2), { acknowledged: 1, retried: 0 });
  const recovered = await state(jobId);
  assert.equal(recovered?.status, "SUCCEEDED");
  assert.equal(recovered?.attempt_count, 2);
  assert.equal(recovered?.lease_owner, null);
  assert.equal(recovered?.lease_expires_at, null);
  assert.equal(await completionCount(jobId), 1);
  assert.deepEqual(await deliver(jobId, 3), { acknowledged: 1, retried: 0 });
  assert.deepEqual(await state(jobId), recovered);
  assert.equal(await completionCount(jobId), 1);
  console.log(
    "PostgreSQL actual SIGKILL after durable claim, expired-lease recovery and one completion PASS",
  );
}
