// CI-only certification for the durable menu-import pipeline on disposable PostgreSQL 16.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SerametEnv, ServerActor } from "../src/lib/seramet-auth";
import { OnboardingService } from "../src/onboarding/onboarding-service";
import { allPermissionCodes, permissions } from "../src/platform/permissions";
import { PostgresD1Database } from "../src/server/database/postgres-database";
import { CURRENT_SCHEMA_VERSION } from "../src/server/database/schema-version";
import type { DurableQueueMessage } from "../src/server/environment";
import { handleWorkerQueue, type SerametWorkerMessage } from "../src/server/workers";

const connectionString = process.env.SERAMET_POSTGRES_URL;
const target = connectionString ? new URL(connectionString) : null;
const allowedDatabase =
  target &&
  [
    ["pos_ci", "/seramet_pos_ci"],
    ["seramet_test", "/seramet_test"],
  ].some(([username, pathname]) => target.username === username && target.pathname === pathname);
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  !allowedDatabase
) {
  throw new Error(
    "Menu-import PostgreSQL certification requires its disposable loopback CI database",
  );
}

const firstDb = PostgresD1Database.fromHyperdrive({ connectionString: connectionString! });
const secondDb = PostgresD1Database.fromHyperdrive({ connectionString: connectionString! });
const suffix = randomUUID();
const tenantId = `menu-import-ci-${suffix}`;
const firstBranchId = `branch-a-${suffix}`;
const secondBranchId = `branch-b-${suffix}`;
const userId = `manager-${suffix}`;
const restrictedUserId = `restricted-${suffix}`;
const roleId = `role-${suffix}`;
const restrictedRoleId = `restricted-role-${suffix}`;

try {
  await assertMigration();
  await seed(firstDb);
  const firstEnv = environment(firstDb);
  const secondEnv = environment(secondDb);
  const first = new OnboardingService(
    firstDb,
    actor(userId, [firstBranchId, secondBranchId]),
    firstEnv,
  );
  const second = new OnboardingService(
    secondDb,
    actor(userId, [firstBranchId, secondBranchId]),
    secondEnv,
  );

  const preview = await first.previewImport({
    kind: "MENU",
    originalName: "postgres-certification.csv",
    mimeType: "text/csv",
    bytes: menuCsv("PG", 41),
    duplicateStrategy: "CREATE",
    idempotencyKey: `preview-${suffix}`,
    targetMode: "SELECTED_BRANCHES",
    targetBranchIds: [firstBranchId, secondBranchId],
  });
  assert.equal(preview.errorCount, 0);
  assert.equal(preview.rowCount, 41);

  const approvals = await Promise.allSettled([
    first.commitImport(preview.id, preview.commitKey),
    second.commitImport(preview.id, preview.commitKey),
  ]);
  assert.ok(approvals.some((result) => result.status === "fulfilled"));
  assert.equal(await workerCount("SETUP_IMPORT_COMMIT", preview.id), 1);
  assert.equal(
    await scalar(
      "SELECT plan_revision FROM setup_imports WHERE tenant_id=? AND id=?",
      tenantId,
      preview.id,
    ),
    1,
  );
  assert.equal(
    await scalar("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?", tenantId),
    0,
  );
  await assert.rejects(
    first.commitImport(preview.id, `${preview.commitKey}:altered`),
    /idempotency key/i,
  );

  const firstCommitJob = await pendingJob("SETUP_IMPORT_COMMIT", preview.id);
  await deliverConcurrently(firstCommitJob, firstEnv, secondEnv);
  assert.equal(await stagedRows(preview.id), 20);
  assert.equal(
    await scalar("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?", tenantId),
    0,
  );

  // A lost acknowledgement or duplicate delivery cannot replay the completed batch.
  await deliverConcurrently(firstCommitJob, firstEnv, secondEnv);
  assert.equal(await stagedRows(preview.id), 20);

  // Stop after a partial batch, then resume with a fresh repository/connection.
  await drain("SETUP_IMPORT_COMMIT", preview.id, secondEnv);
  const ready = await second.importStatus(preview.id);
  assert.equal(ready.status, "COMMITTED");
  assert.equal(ready.publishStatus, "READY");
  assert.equal(await stagedRows(preview.id), 41);
  assert.equal(
    await scalar("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?", tenantId),
    0,
  );

  const inspected = await second.inspectImport(preview.id);
  assert.ok(inspected.publishKey);
  const publishes = await Promise.allSettled([
    first.publishImport(preview.id, inspected.publishKey!),
    second.publishImport(preview.id, inspected.publishKey!),
  ]);
  assert.ok(publishes.some((result) => result.status === "fulfilled"));
  assert.equal(await workerCount("SETUP_IMPORT_PUBLISH", preview.id), 1);
  await assert.rejects(
    first.publishImport(preview.id, `${inspected.publishKey}:altered`),
    /idempotency key/i,
  );

  const firstPublishJob = await pendingJob("SETUP_IMPORT_PUBLISH", preview.id);
  await deliverConcurrently(firstPublishJob, firstEnv, secondEnv);
  assert.equal(await publicationVerifiedRows(preview.id), 20);
  assert.equal(
    await scalar("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?", tenantId),
    0,
    "bounded publication verification must not expose a partial live menu",
  );
  await deliverConcurrently(firstPublishJob, firstEnv, secondEnv);
  assert.equal(await publicationVerifiedRows(preview.id), 20);

  await drain("SETUP_IMPORT_PUBLISH", preview.id, firstEnv);
  const published = await first.importStatus(preview.id);
  assert.equal(published.publishStatus, "PUBLISHED");
  assert.equal(
    await scalar("SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=?", tenantId),
    41,
  );
  assert.equal(
    await scalar(
      "SELECT COUNT(*) count FROM menu_item_branch_settings WHERE tenant_id=?",
      tenantId,
    ),
    82,
  );
  assert.equal(
    await scalar(
      "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND published_at IS NOT NULL",
      tenantId,
      preview.id,
    ),
    41,
  );
  assert.deepEqual(await first.publishImport(preview.id, inspected.publishKey!), {
    id: preview.id,
    duplicate: true,
    queued: false,
    status: "PUBLISHED",
  });

  const restricted = new OnboardingService(
    secondDb,
    actor(restrictedUserId, [secondBranchId]),
    secondEnv,
  );
  await assert.rejects(restricted.inspectImport(preview.id), /branch|assignment|permission/i);

  // Corrupting a staged activation proves the publication guard fails closed with no live rows.
  const guarded = await first.previewImport({
    kind: "MENU",
    originalName: "guarded-publication.csv",
    mimeType: "text/csv",
    bytes: menuCsv("GUARD", 2),
    duplicateStrategy: "CREATE",
    idempotencyKey: `guarded-${suffix}`,
    targetMode: "SELECTED_BRANCHES",
    targetBranchIds: [firstBranchId, secondBranchId],
  });
  await first.commitImport(guarded.id, guarded.commitKey);
  await drain("SETUP_IMPORT_COMMIT", guarded.id, firstEnv);
  const guardedPreview = await first.inspectImport(guarded.id);
  await firstDb
    .prepare(
      `DELETE FROM menu_import_staged_branch_settings
       WHERE tenant_id=? AND import_id=? AND branch_id=?`,
    )
    .bind(tenantId, guarded.id, secondBranchId)
    .run();
  await first.publishImport(guarded.id, guardedPreview.publishKey!);
  await drain("SETUP_IMPORT_PUBLISH", guarded.id, firstEnv);
  assert.equal(
    await scalar(
      "SELECT COUNT(*) count FROM menu_catalog_items WHERE tenant_id=? AND code LIKE 'GUARD-%'",
      tenantId,
    ),
    0,
  );
  assert.notEqual(
    await scalar<string>(
      "SELECT publish_status FROM setup_imports WHERE tenant_id=? AND id=?",
      tenantId,
      guarded.id,
    ),
    "PUBLISHED",
  );

  const stateHistory = await firstDb
    .prepare(
      "SELECT state FROM file_import_state_events WHERE tenant_id=? AND import_id=? ORDER BY created_at,id",
    )
    .bind(tenantId, preview.id)
    .all<{ state: string }>();
  for (const state of [
    "APPROVED",
    "COMMITTING",
    "VERIFYING",
    "READY_TO_PUBLISH",
    "PUBLISHING",
    "PUBLISHED",
  ]) {
    assert.ok(
      stateHistory.results?.some((row) => row.state === state),
      `missing ${state} history`,
    );
  }

  console.log("Menu import PostgreSQL batching, recovery, atomic publication and isolation: PASS");
} finally {
  await Promise.all([firstDb.close(), secondDb.close()]);
}

function environment(db: PostgresD1Database): SerametEnv {
  return {
    SERAMET_ENVIRONMENT: "test",
    SERAMET_DB: db,
    SERAMET_WORK_QUEUE: { async send() {} },
    SERAMET_MALWARE_SCANNER: {
      async fetch(_input, init) {
        const headers = new Headers(init?.headers);
        return Response.json({
          verdict: "CLEAN",
          sha256: headers.get("x-seramet-content-sha256"),
          evidenceId: `pg-${headers.get("x-seramet-scan-job-id")}-${randomUUID()}`,
          scannerId: "postgres-ci-scanner",
          engine: "postgres-ci-scanner",
          signatureVersion: "ci-1",
          scannedAt: new Date().toISOString(),
          jobId: headers.get("x-seramet-scan-job-id"),
          objectKey: headers.get("x-seramet-object-key"),
          objectVersion: headers.get("x-seramet-object-version"),
        });
      },
    },
  };
}

function actor(id: string, branchIds: string[]): ServerActor {
  return {
    id,
    name: "Menu import CI manager",
    tenantId,
    sessionId: `session-${id}`,
    roleIds: [id === userId ? roleId : restrictedRoleId],
    permissions: [permissions.setupImport, permissions.setupView, permissions.branchSwitch],
    assignedBranchIds: branchIds,
    assignedBranches: branchIds.map((branchId) => ({ id: branchId, name: branchId })),
    branchScope: { type: "BRANCH", branchId: branchIds[0]! },
    branchId: branchIds[0]!,
    branch: branchIds[0]!,
    role: "Manager",
  };
}

function menuCsv(prefix: string, rows: number) {
  return new TextEncoder().encode(
    [
      "templateVersion,itemCode,name,categoryCode,basePrice,currency,stationCode,available",
      ...Array.from(
        { length: rows },
        (_, index) => `2,${prefix}-${index + 1},${prefix} item ${index + 1},MAIN,100,KES,MAIN,true`,
      ),
    ].join("\n"),
  );
}

async function deliverConcurrently(
  job: { id: string; correlation_id: string },
  firstEnv: SerametEnv,
  secondEnv: SerametEnv,
) {
  await Promise.all([
    handleWorkerQueue(batch(job, 1), firstEnv),
    handleWorkerQueue(batch(job, 1), secondEnv),
  ]);
}

function batch(job: { id: string; correlation_id: string }, attempts: number) {
  const message: DurableQueueMessage<SerametWorkerMessage> = {
    id: `message-${job.id}-${randomUUID()}`,
    timestamp: new Date(),
    body: { kind: "worker-job", tenantId, jobId: job.id, correlationId: job.correlation_id },
    attempts,
    ack() {},
    retry() {},
  };
  return { queue: "menu-import-postgres", messages: [message] };
}

async function drain(jobType: string, importId: string, env: SerametEnv) {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const job = await firstDb
      .prepare(
        `SELECT id,correlation_id FROM worker_jobs
         WHERE tenant_id=? AND job_type=?
           AND (status='PENDING' OR (status='RETRY_PENDING' AND scheduled_at<=?))
           AND idempotency_key LIKE ? ORDER BY created_at,id LIMIT 1`,
      )
      .bind(tenantId, jobType, new Date().toISOString(), `setup-import-%:${importId}:%`)
      .first<{ id: string; correlation_id: string }>();
    if (!job) return;
    await handleWorkerQueue(batch(job, 1), env);
  }
  throw new Error(`Worker chain did not finish for ${jobType}`);
}

async function pendingJob(jobType: string, importId: string) {
  const job = await firstDb
    .prepare(
      `SELECT id,correlation_id FROM worker_jobs
       WHERE tenant_id=? AND job_type=? AND status='PENDING' AND idempotency_key LIKE ?
       ORDER BY created_at,id LIMIT 1`,
    )
    .bind(tenantId, jobType, `setup-import-%:${importId}:%`)
    .first<{ id: string; correlation_id: string }>();
  assert.ok(job, `missing ${jobType} job`);
  return job;
}

async function workerCount(jobType: string, importId: string) {
  return Number(
    await firstDb
      .prepare(
        "SELECT COUNT(*) count FROM worker_jobs WHERE tenant_id=? AND job_type=? AND idempotency_key LIKE ?",
      )
      .bind(tenantId, jobType, `setup-import-%:${importId}:%`)
      .first("count"),
  );
}

async function stagedRows(importId: string) {
  return scalar(
    "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND materialized_at IS NOT NULL",
    tenantId,
    importId,
  );
}

async function publicationVerifiedRows(importId: string) {
  return scalar(
    "SELECT COUNT(*) count FROM setup_import_rows WHERE tenant_id=? AND import_id=? AND publication_verified_at IS NOT NULL",
    tenantId,
    importId,
  );
}

async function scalar<T extends string | number = number>(sql: string, ...values: unknown[]) {
  const row = await firstDb
    .prepare(sql)
    .bind(...values)
    .first<Record<string, T>>();
  assert.ok(row, `Expected one row for scalar query: ${sql}`);
  const [value] = Object.values(row);
  assert.notEqual(value, undefined, `Expected one scalar value for query: ${sql}`);
  return value!;
}

async function assertMigration() {
  assert.equal(
    await scalar("SELECT MAX(version) version FROM schema_migrations"),
    CURRENT_SCHEMA_VERSION,
  );
  for (const table of [
    "menu_import_staged_items",
    "menu_import_staged_branch_settings",
    "manual_menu_item_requests",
    "file_import_state_events",
  ]) {
    assert.equal(
      await scalar(
        "SELECT COUNT(*) count FROM information_schema.tables WHERE table_schema='public' AND table_name=?",
        table,
      ),
      1,
    );
    assert.equal(
      await scalar(
        "SELECT COUNT(*) count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=? AND c.relrowsecurity",
        table,
      ),
      1,
      `${table} must have PostgreSQL row-level security enabled`,
    );
  }
}

async function seed(db: PostgresD1Database) {
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO tenants
        (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
       VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
    )
    .bind(tenantId, tenantId, tenantId, tenantId, stamp, stamp)
    .run();
  for (const [branchId, code] of [
    [firstBranchId, "A"],
    [secondBranchId, "B"],
  ]) {
    await db
      .prepare(
        `INSERT INTO branches
          (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
         VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')`,
      )
      .bind(tenantId, branchId, code, code)
      .run();
    await db
      .prepare(
        `INSERT INTO stations
          (tenant_id,id,branch_id,code,name,station_type,active,payload_json)
         VALUES (?,?,?,'MAIN','Main Kitchen','KITCHEN',1,'{}')`,
      )
      .bind(tenantId, `station-${branchId}`, branchId)
      .run();
  }
  for (const code of allPermissionCodes) {
    await db
      .prepare("INSERT INTO permissions (code,description) VALUES (?,?) ON CONFLICT DO NOTHING")
      .bind(code, code)
      .run();
  }
  for (const [id, code] of [
    [roleId, "IMPORT_MANAGER"],
    [restrictedRoleId, "RESTRICTED_IMPORT_MANAGER"],
  ]) {
    await db
      .prepare(
        "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,?,1,'{}')",
      )
      .bind(tenantId, id, code, code)
      .run();
    for (const permission of [
      permissions.setupImport,
      permissions.setupView,
      permissions.branchSwitch,
    ]) {
      await db
        .prepare("INSERT INTO role_permissions (tenant_id,role_id,permission_code) VALUES (?,?,?)")
        .bind(tenantId, id, permission)
        .run();
    }
  }
  for (const [id, role, branches] of [
    [userId, roleId, [firstBranchId, secondBranchId]],
    [restrictedUserId, restrictedRoleId, [secondBranchId]],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO users
          (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,1,1,'{}',?,?)`,
      )
      .bind(tenantId, id, `${id}@test.invalid`, id, stamp, stamp)
      .run();
    await db
      .prepare("INSERT INTO user_roles (tenant_id,user_id,role_id) VALUES (?,?,?)")
      .bind(tenantId, id, role)
      .run();
    for (const branchId of branches) {
      await db
        .prepare("INSERT INTO user_branches (tenant_id,user_id,branch_id) VALUES (?,?,?)")
        .bind(tenantId, id, branchId)
        .run();
    }
  }
}
