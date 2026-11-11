import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import pg from "pg";
import {
  LOCAL_RESTORE_IDENTITY_SQL,
  INCIDENT,
  auditDigest,
  assertConnectionTargets,
  assertStagingTarget,
  assertCounts,
  assertMatchingRecoveryPlans,
  assertOperatorApproval,
} from "./staging-app-recovery-guards.mjs";
import { buildStagingMenuReconciliationPlan } from "./staging-menu-reconciliation-plan.mjs";

/*
 * Separate ONE-TIME incident-scoped application-data recovery alternative.
 * Does not import, alter, or bypass the original full-restore recovery script.
 * --plan/--apply compare the actual local restored public tables to staging
 * and SHA256-verify the source archive. No generic data-repair functionality.
 */
const flags = process.argv.slice(2);
if (flags.length !== 1 || !["--plan", "--apply", "--verify"].includes(flags[0])) {
  throw new Error(
    "Usage: node scripts/reconcile-staging-menu-imports-app-restore.mjs --plan|--apply|--verify",
  );
}
const mode = flags[0];
if (process.env.SERAMET_ENVIRONMENT !== "staging" || !process.env.SERAMET_POSTGRES_URL) {
  throw new Error("An explicitly identified staging connection is required");
}
const stageDsn = process.env.SERAMET_POSTGRES_URL;
if (mode === "--verify") assertStagingTarget(stageDsn);
else {
  if (!process.env.SERAMET_APP_RESTORE_LOCAL_URL) {
    throw new Error("Missing dedicated local restored-application database connection");
  }
  assertConnectionTargets(stageDsn, process.env.SERAMET_APP_RESTORE_LOCAL_URL);
}

const countQuery =
  "SELECT " +
  "(SELECT COUNT(*)::integer FROM public.setup_imports WHERE import_kind='MENU') AS \"menuImports\", " +
  '(SELECT COUNT(*)::integer FROM public.setup_import_rows) AS "previewRows", ' +
  "(SELECT COUNT(*)::integer FROM public.worker_jobs WHERE job_type='SETUP_IMPORT_COMMIT') AS \"importJobs\", " +
  '(SELECT COUNT(*)::integer FROM public.menu_catalog_items) AS "menuItems"';

async function digestArchive(path) {
  if (!path) throw new Error("Source backup archive path must be supplied privately");
  const info = await stat(path);
  if (!info.isFile() || info.size !== INCIDENT.archiveSize) {
    throw new Error("Backup size/type does not match the independently verified source manifest");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== INCIDENT.archiveSha256) {
    throw new Error("Source archive SHA256 does not match the verified manifest");
  }
}

async function readPlanSnapshot(db, { lock }) {
  const suffix = lock ? " FOR UPDATE" : "";
  const imports = (
    await db.query(
      "SELECT * FROM public.setup_imports WHERE import_kind='MENU' AND status='COMMITTING' ORDER BY created_at" +
        suffix,
    )
  ).rows;
  if (
    imports.length !== 3 ||
    imports.some(
      ({ id, tenant_id }) => !INCIDENT.ids.includes(id) || tenant_id !== INCIDENT.tenantId,
    )
  ) {
    throw new Error("Unexpected live or restored import scope; refuse");
  }
  const ids = imports.map(({ id }) => id);
  const tenantId = INCIDENT.tenantId;
  // Intentionally sequential: concurrent queries on the same pg.Client are unsafe.
  const rows = (
    await db.query(
      "SELECT * FROM public.setup_import_rows WHERE tenant_id=$1 AND import_id=ANY($2::text[]) ORDER BY import_id,row_number" +
        (lock ? " FOR SHARE" : ""),
      [tenantId, ids],
    )
  ).rows;
  const jobs = (
    await db.query(
      "SELECT * FROM public.worker_jobs WHERE tenant_id=$1 AND job_type='SETUP_IMPORT_COMMIT' " +
        "AND payload_json::jsonb->>'importId'=ANY($2::text[]) ORDER BY id" +
        suffix,
      [tenantId, ids],
    )
  ).rows;
  const branches = (
    await db.query(
      "SELECT * FROM public.branches WHERE tenant_id=$1 ORDER BY id" + (lock ? " FOR SHARE" : ""),
      [tenantId],
    )
  ).rows;
  const existingCodeCount = (
    await db.query(
      "SELECT COUNT(*)::integer AS count FROM public.menu_catalog_items m WHERE m.tenant_id=$1 " +
        "AND EXISTS (SELECT 1 FROM public.setup_import_rows r WHERE r.tenant_id=$1 " +
        "AND r.import_id=ANY($2::text[]) AND upper(m.code)=upper(r.normalized_json::jsonb->>'code'))",
      [tenantId, ids],
    )
  ).rows[0].count;
  const appliedAuditCount = (
    await db.query(
      "SELECT COUNT(*)::integer AS count FROM public.audit_events WHERE tenant_id=$1 " +
        "AND entity_type='SETUP_IMPORT' AND entity_id=ANY($2::text[]) " +
        "AND action IN ('SETUP_IMPORT_APPLIED','SETUP_IMPORT_COMMITTED','SETUP_IMPORT_QUARANTINED')",
      [tenantId, ids],
    )
  ).rows[0].count;
  const schemaVersion = (
    await db.query(
      "SELECT COALESCE(MAX(version),0)::integer AS version FROM public.schema_migrations",
    )
  ).rows[0].version;
  const activeJobs = (
    await db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs WHERE tenant_id=$1 " +
        "AND job_type='SETUP_IMPORT_COMMIT' AND status IN ('PENDING','CLAIMED','RUNNING','RETRY_PENDING')",
      [tenantId],
    )
  ).rows[0].count;
  if (activeJobs !== 3) throw new Error("Unexpected additional active import jobs");
  const counts = (await db.query(countQuery)).rows[0];
  assertCounts(counts, lock ? "Live staging" : "Isolated public-schema restore");
  return {
    plan: buildStagingMenuReconciliationPlan({
      imports,
      rows,
      jobs,
      branches,
      existingCodeCount,
      appliedAuditCount,
      schemaVersion,
    }),
    counts,
  };
}

async function readLocalSnapshot() {
  const local = new pg.Client({
    connectionString: process.env.SERAMET_APP_RESTORE_LOCAL_URL,
    connectionTimeoutMillis: 10000,
  });
  let inTransaction = false;
  try {
    try {
      await local.connect();
    } catch (error) {
      if (error?.code === "28P01") {
        throw new Error("LOCAL restored PostgreSQL password authentication failed");
      }
      throw new Error(
        "LOCAL restored PostgreSQL connection failed: " +
          (error instanceof Error ? error.message : "unknown connection error"),
      );
    }
    const identity = (await local.query(LOCAL_RESTORE_IDENTITY_SQL)).rows[0];
    if (
      identity.host !== "127.0.0.1" ||
      identity.database !== INCIDENT.localDatabase ||
      identity.username !== "postgres"
    ) {
      throw new Error("Restore database identity check failed");
    }
    await local.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    inTransaction = true;
    const snapshot = await readPlanSnapshot(local, { lock: false });
    await local.query("ROLLBACK");
    inTransaction = false;
    return snapshot;
  } finally {
    if (inTransaction) await local.query("ROLLBACK").catch(() => {});
    await local.end();
  }
}

async function terminallyQuarantine(db, plan, evidence) {
  const stamp = new Date().toISOString();
  const operator = process.env.SERAMET_APP_RECOVERY_OPERATOR_ID;
  for (const { record, job, reason } of plan.dispositions) {
    const report = JSON.stringify({
      ...JSON.parse(record.report_json),
      incidentRecovery: {
        disposition: reason,
        recoveryScope: "APPLICATION_PUBLIC_SCHEMA_ONLY",
        canonicalReference: plan.canonicalRef,
        sourceArchiveSha256: INCIDENT.archiveSha256,
        restoreEvidenceSha256: evidence,
        planSha256: plan.fingerprint,
        timestamp: stamp,
        originalSavedRowsPreserved: true,
        replayProhibitedUntilFreshVerifiedScan: true,
      },
    });
    const verification = JSON.stringify({
      status: "FAILED",
      reason: "ADMINISTRATIVE_QUARANTINE_NO_EXECUTION_NOT_CSV_VALIDATION_FAILURE",
      disposition: reason,
      planSha256: plan.fingerprint,
    });
    const imp = await db.query(
      "UPDATE public.setup_imports SET status='REJECTED',verification_status='FAILED'," +
        "verification_json=$1,report_json=$2,updated_at=$3 " +
        "WHERE tenant_id=$4 AND id=$5 AND status='COMMITTING' AND committed_at IS NULL " +
        "AND verification_status='PENDING' RETURNING id",
      [verification, report, stamp, plan.tenantId, record.id],
    );
    if (imp.rowCount !== 1) throw new Error("Import changed before guarded update");
    const worker = await db.query(
      "UPDATE public.worker_jobs SET status='DEAD_LETTER',finished_at=$1,updated_at=$1," +
        "last_error=$2,lease_owner=NULL,lease_expires_at=NULL " +
        "WHERE tenant_id=$3 AND id=$4 AND status='PENDING' AND attempt_count=0 " +
        "AND started_at IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL RETURNING id",
      [
        stamp,
        "Administrative owner-approved quarantine: " + reason + "; job never executed",
        plan.tenantId,
        job.id,
      ],
    );
    if (worker.rowCount !== 1) throw new Error("Worker job changed before guarded update");
    const metadata = JSON.stringify({
      recoveryScope: "APPLICATION_PUBLIC_SCHEMA_ONLY",
      disposition: reason,
      canonicalReference: plan.canonicalRef,
      planSha256: plan.fingerprint,
      sourceArchiveSha256: INCIDENT.archiveSha256,
      restoreEvidenceSha256: evidence,
      operatorId: operator,
      previewRowsPreserved: true,
      jobWasNeverExecuted: true,
      scannerWasNotRun: true,
      noReplayUntilFreshScannedV3: true,
    });
    await db.query(
      "INSERT INTO public.audit_events (tenant_id,id,branch_id,actor_id,action,entity_type," +
        "entity_id,reason,correlation_id,metadata_json,created_at) VALUES " +
        "($1,$2,$3,$4,'SETUP_IMPORT_QUARANTINED','SETUP_IMPORT',$5,$6,$7,$8,$9)",
      [
        plan.tenantId,
        randomUUID(),
        record.branch_id,
        operator,
        record.id,
        reason,
        job.correlation_id,
        metadata,
        stamp,
      ],
    );
  }
  const ids = plan.dispositions.map(({ record }) => record.id);
  const jobIds = plan.dispositions.map(({ job }) => job.id);
  const preCommit = (
    await db.query(
      "SELECT " +
        "(SELECT COUNT(*)::integer FROM public.setup_imports WHERE tenant_id=$1 AND id=ANY($2::text[]) " +
        "AND status='REJECTED' AND verification_status='FAILED' AND committed_at IS NULL) AS imports," +
        "(SELECT COUNT(*)::integer FROM public.worker_jobs WHERE tenant_id=$1 AND id=ANY($3::text[]) " +
        "AND status='DEAD_LETTER' AND attempt_count=0) AS jobs," +
        "(SELECT COUNT(*)::integer FROM public.audit_events WHERE tenant_id=$1 " +
        "AND action='SETUP_IMPORT_QUARANTINED' AND entity_id=ANY($2::text[])) AS audits," +
        "(SELECT COUNT(*)::integer FROM public.setup_import_rows WHERE tenant_id=$1 " +
        "AND import_id=ANY($2::text[]) AND status IN ('VALID','WARNING') " +
        "AND committed_entity_id IS NULL AND committed_entity_type IS NULL) AS saved_rows",
      [plan.tenantId, ids, jobIds],
    )
  ).rows[0];
  if (
    preCommit.imports !== 3 ||
    preCommit.jobs !== 3 ||
    preCommit.audits !== 3 ||
    preCommit.saved_rows !== 1029
  ) {
    throw new Error("Postconditions failed: transaction must roll back");
  }
  const stillEight = (
    await db.query("SELECT COUNT(*)::integer AS count FROM public.menu_catalog_items")
  ).rows[0].count;
  if (stillEight !== 8) throw new Error("Catalogue unexpectedly changed; roll back");
}

async function verifyIndependent(db) {
  const ids = INCIDENT.ids;
  const counts = (
    await db.query(
      "SELECT " +
        "(SELECT COUNT(*)::integer FROM public.setup_imports WHERE id=ANY($1::text[]) " +
        "AND tenant_id=$2 AND status='REJECTED' AND verification_status='FAILED' " +
        "AND committed_at IS NULL AND report_json::jsonb->'incidentRecovery'->>'sourceArchiveSha256'=$3 " +
        "AND report_json::jsonb->'incidentRecovery'->>'planSha256'=$4) AS imports," +
        "(SELECT COUNT(*)::integer FROM public.worker_jobs WHERE tenant_id=$2 " +
        "AND job_type='SETUP_IMPORT_COMMIT' AND payload_json::jsonb->>'importId'=ANY($1::text[]) " +
        "AND status='DEAD_LETTER' AND attempt_count=0 AND started_at IS NULL) AS jobs," +
        "(SELECT COUNT(*)::integer FROM public.setup_import_rows WHERE tenant_id=$2 " +
        "AND import_id=ANY($1::text[]) AND status IN ('VALID','WARNING') " +
        "AND committed_entity_id IS NULL AND committed_entity_type IS NULL) AS saved_rows," +
        "(SELECT COUNT(*)::integer FROM public.audit_events WHERE tenant_id=$2 " +
        "AND entity_id=ANY($1::text[]) AND action='SETUP_IMPORT_QUARANTINED' " +
        "AND metadata_json::jsonb->>'planSha256'=$4 " +
        "AND metadata_json::jsonb->>'sourceArchiveSha256'=$3) AS audits," +
        "(SELECT COUNT(*)::integer FROM public.menu_catalog_items) AS menu_items",
      [ids, INCIDENT.tenantId, INCIDENT.archiveSha256, INCIDENT.approvedPlanSha256],
    )
  ).rows[0];
  if (
    counts.imports !== 3 ||
    counts.jobs !== 3 ||
    counts.saved_rows !== 1029 ||
    counts.audits !== 3 ||
    counts.menu_items !== 8
  ) {
    throw new Error("Independent verification failed; stop staging release and review manually");
  }
  return counts;
}

async function main() {
  if (mode !== "--verify") await digestArchive(process.env.SERAMET_APP_RESTORE_ARCHIVE);
  const restored = mode === "--verify" ? null : await readLocalSnapshot();
  const stage = new pg.Client({ connectionString: stageDsn, connectionTimeoutMillis: 10000 });
  let transactionOpen = false;
  try {
    try {
      await stage.connect();
    } catch (error) {
      if (error?.code === "28P01") {
        throw new Error("STAGING PostgreSQL password authentication failed");
      }
      throw new Error(
        "STAGING PostgreSQL connection failed: " +
          (error instanceof Error ? error.message : "unknown connection error"),
      );
    }
    if (mode === "--verify") {
      await stage.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      transactionOpen = true;
      const summary = await verifyIndependent(stage);
      await stage.query("ROLLBACK");
      transactionOpen = false;
      console.log(
        JSON.stringify({ verified: true, scope: "THREE_IMPORTS_ONLY", ...summary }, null, 2),
      );
      return;
    }
    await stage.query(
      mode === "--apply"
        ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
        : "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    await stage.query("SET LOCAL lock_timeout='6s'");
    if (mode === "--apply") await stage.query("SELECT pg_advisory_xact_lock(20260927,1)");
    const current = await readPlanSnapshot(stage, { lock: mode === "--apply" });
    assertMatchingRecoveryPlans(restored.plan, current.plan);
    const evidence = auditDigest(current.plan);
    console.log(
      "Sanitized app-only recovery preflight: " +
        JSON.stringify(
          {
            ...current.plan.publicSummary,
            archiveSha256: INCIDENT.archiveSha256,
            restoredPublicCounts: restored.counts,
            stagingPublicCounts: current.counts,
            restoreEvidenceSha256: evidence,
            mode,
          },
          null,
          2,
        ),
    );
    if (mode === "--apply") {
      assertOperatorApproval(process.env, current.plan);
      await terminallyQuarantine(stage, current.plan, evidence);
      await stage.query("COMMIT");
      transactionOpen = false;
      console.log("COMMITTED: three imports and jobs quarantined; preview rows untouched.");
      console.log("IMPORTANT: independently run --verify before unfreezing any consumers.");
    } else {
      await stage.query("ROLLBACK");
      transactionOpen = false;
      console.log("READ ONLY: no staging data changed. Await exact manual review and approval.");
    }
  } finally {
    if (transactionOpen) await stage.query("ROLLBACK").catch(() => {});
    await stage.end();
  }
}
main().catch((error) => {
  console.error(
    "App-only reconciliation REFUSED: " +
      (error instanceof Error ? error.message : "unexpected error"),
  );
  process.exitCode = 1;
});
