import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  buildStagingMenuReconciliationPlan,
  STAGING_PROJECT_REF,
} from "./staging-menu-reconciliation-plan.mjs";

/**
 * ONE-TIME STAGING INCIDENT TOOL; not a migration, no CI application.
 *
 * Default: read-only plan. All destructive state transitions need an isolated
 * verified restore, exact snapshot SHA256 approval, identity checks, and a
 * separately authorized staging write connection. No rows are deleted.
 *
 * Import status REJECTED and job status DEAD_LETTER are the existing schema's
 * terminal states. Audit metadata explicitly distinguishes an administrative
 * quarantine from a validation error or an actually attempted worker failure.
 */
const apply = process.argv.includes("--apply");
if (
  process.argv.some((arg) => !["--apply", "--plan"].includes(arg)) ||
  (process.argv.includes("--apply") && process.argv.includes("--plan"))
) {
  throw new Error("Usage: node scripts/reconcile-staging-menu-imports.mjs [--plan | --apply]");
}
if (process.env.SERAMET_ENVIRONMENT !== "staging") {
  throw new Error("STAGING ONLY: set SERAMET_ENVIRONMENT=staging");
}
if (!process.env.SERAMET_POSTGRES_URL) {
  throw new Error("Staging Postgres connection is required; never paste credentials into logs");
}
const dsn = new URL(process.env.SERAMET_POSTGRES_URL);
if (
  !["postgres:", "postgresql:"].includes(dsn.protocol) ||
  !(
    dsn.hostname.includes(STAGING_PROJECT_REF) ||
    decodeURIComponent(dsn.username).includes(STAGING_PROJECT_REF)
  )
) {
  throw new Error("Postgres connection does not identify the expected staging Supabase project");
}
const db = new pg.Client({ connectionString: process.env.SERAMET_POSTGRES_URL });
const optionalLock = apply ? " FOR UPDATE" : "";

async function snapshot() {
  const imports = (
    await db.query(
      "SELECT * FROM public.setup_imports WHERE import_kind='MENU' AND status='COMMITTING' ORDER BY created_at" +
        optionalLock,
    )
  ).rows;
  if (imports.length !== 3 || new Set(imports.map((record) => record.tenant_id)).size !== 1) {
    throw new Error("Expected exactly the three known staging pending menu imports");
  }
  const tenantId = imports[0].tenant_id;
  const ids = imports.map((record) => record.id);
  const [rows, jobs, branches, catalogue, applied, migrations, importJobCount] = await Promise.all([
    db.query(
      "SELECT * FROM public.setup_import_rows WHERE tenant_id=$1 AND import_id=ANY($2::text[]) " +
        "ORDER BY import_id,row_number" +
        (apply ? " FOR SHARE" : ""),
      [tenantId, ids],
    ),
    db.query(
      "SELECT * FROM public.worker_jobs WHERE tenant_id=$1 AND job_type='SETUP_IMPORT_COMMIT' " +
        "AND payload_json::jsonb->>'importId'=ANY($2::text[]) ORDER BY id" +
        optionalLock,
      [tenantId, ids],
    ),
    db.query(
      "SELECT * FROM public.branches WHERE tenant_id=$1 ORDER BY id" + (apply ? " FOR SHARE" : ""),
      [tenantId],
    ),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.menu_catalog_items m WHERE m.tenant_id=$1 " +
        "AND EXISTS (SELECT 1 FROM public.setup_import_rows r " +
        "WHERE r.tenant_id=$1 AND r.import_id=ANY($2::text[]) " +
        "AND upper(m.code)=upper(r.normalized_json::jsonb->>'code'))",
      [tenantId, ids],
    ),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.audit_events " +
        "WHERE tenant_id=$1 AND entity_type='SETUP_IMPORT' AND entity_id=ANY($2::text[]) " +
        "AND action IN ('SETUP_IMPORT_APPLIED','SETUP_IMPORT_COMMITTED','SETUP_IMPORT_QUARANTINED')",
      [tenantId, ids],
    ),
    db.query("SELECT COALESCE(MAX(version),0)::integer AS version FROM public.schema_migrations"),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs " +
        "WHERE tenant_id=$1 AND job_type='SETUP_IMPORT_COMMIT' AND status IN " +
        "('PENDING','CLAIMED','RUNNING','RETRY_PENDING')",
      [tenantId],
    ),
  ]);
  if (importJobCount.rows[0].count !== 3) {
    throw new Error("Unexpected additional active menu import jobs: reconcile manually");
  }
  return buildStagingMenuReconciliationPlan({
    imports,
    rows: rows.rows,
    jobs: jobs.rows,
    branches: branches.rows,
    existingCodeCount: catalogue.rows[0].count,
    appliedAuditCount: applied.rows[0].count,
    schemaVersion: migrations.rows[0].version,
  });
}

function checkApprovals(plan) {
  const env = process.env;
  if (
    env.SERAMET_RECONCILE_BACKUP_RESTORE_VERIFIED !== "true" ||
    !env.SERAMET_RECONCILE_RESTORE_EVIDENCE?.trim()
  ) {
    throw new Error(
      "Missing independently verified backup, isolated restore and evidence reference",
    );
  }
  if (
    env.SERAMET_RECONCILE_APPROVED_PLAN_SHA256 !== plan.fingerprint ||
    env.SERAMET_RECONCILE_APPROVED_TENANT_REF !== plan.tenantRef ||
    env.SERAMET_RECONCILE_APPROVED_CANONICAL_REF !== plan.canonicalRef
  ) {
    throw new Error("Exact tenant, canonical V3 and current plan fingerprint were not approved");
  }
  if (
    env.SERAMET_RECONCILE_UNSCANNED_IMPORTS_WILL_NOT_REPLAY !== "true" ||
    !env.SERAMET_RECONCILE_OPERATOR?.trim()
  ) {
    throw new Error("Explicit no-replay acknowledgment and operator identity are required");
  }
}

async function quarantine(plan) {
  const stamp = new Date().toISOString();
  const evidence = process.env.SERAMET_RECONCILE_RESTORE_EVIDENCE.trim();
  const actor = "system:staging-reconciliation:" +
    process.env.SERAMET_RECONCILE_OPERATOR.trim();
  for (const { record, job, reason } of plan.dispositions) {
    const reportJson = JSON.stringify({
      ...JSON.parse(record.report_json),
      incidentRecovery: {
        disposition: reason,
        canonicalReference: plan.canonicalRef,
        planSha256: plan.fingerprint,
        restoreEvidenceReference: evidence,
        timestamp: stamp,
        originalSavedRowsPreserved: true,
        replayProhibitedUntilFreshVerifiedScan: true,
      },
    });
    const verificationJson = JSON.stringify({
      status: "FAILED",
      reason: "ADMINISTRATIVE_QUARANTINE_NOT_IMPORT_VALIDATION_FAILURE",
      disposition: reason,
      planSha256: plan.fingerprint,
    });
    const importUpdate = await db.query(
      "UPDATE public.setup_imports SET status='REJECTED', verification_status='FAILED', " +
        "verification_json=$1, report_json=$2, updated_at=$3 " +
        "WHERE tenant_id=$4 AND id=$5 AND status='COMMITTING' " +
        "AND committed_at IS NULL AND verification_status='PENDING' RETURNING id",
      [verificationJson, reportJson, stamp, plan.tenantId, record.id],
    );
    if (importUpdate.rowCount !== 1) throw new Error("Import changed during quarantine; rollback");
    const jobUpdate = await db.query(
      "UPDATE public.worker_jobs SET status='DEAD_LETTER', finished_at=$1, updated_at=$1, " +
        "last_error=$2, lease_owner=NULL, lease_expires_at=NULL " +
        "WHERE tenant_id=$3 AND id=$4 AND status='PENDING' AND attempt_count=0 " +
        "AND started_at IS NULL AND lease_owner IS NULL RETURNING id",
      [
        stamp,
        "Administrative staging import quarantine, no execution: " + reason,
        plan.tenantId,
        job.id,
      ],
    );
    if (jobUpdate.rowCount !== 1) throw new Error("Job changed during quarantine; rollback");
    const metadata = JSON.stringify({
      disposition: reason,
      canonicalImportReference: plan.canonicalRef,
      originalImportId: record.id,
      workerJobId: job.id,
      operator: process.env.SERAMET_RECONCILE_OPERATOR.trim(),
      planSha256: plan.fingerprint,
      restoreEvidenceReference: evidence,
      originalPreviewRowsPreserved: true,
      originalJobPreserved: true,
      nextStep: "real-scanner-and-correct-branches-new-menu-v3-preview",
    });
    await db.query(
      "INSERT INTO public.audit_events " +
        "(tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason," +
        "correlation_id,metadata_json,created_at) VALUES " +
        "($1,$2,$3,$4,'SETUP_IMPORT_QUARANTINED','SETUP_IMPORT',$5,$6,$7,$8,$9)",
      [
        plan.tenantId,
        randomUUID(),
        record.branch_id,
        actor,
        record.id,
        reason,
        job.correlation_id,
        metadata,
        stamp,
      ],
    );
  }
  const [imports, jobs, audited] = await Promise.all([
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.setup_imports WHERE tenant_id=$1 " +
        "AND id=ANY($2::text[]) AND status='REJECTED' AND verification_status='FAILED'",
      [plan.tenantId, plan.dispositions.map((item) => item.record.id)],
    ),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs WHERE tenant_id=$1 " +
        "AND id=ANY($2::text[]) AND status='DEAD_LETTER' AND attempt_count=0",
      [plan.tenantId, plan.dispositions.map((item) => item.job.id)],
    ),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.audit_events WHERE tenant_id=$1 " +
        "AND action='SETUP_IMPORT_QUARANTINED' AND entity_id=ANY($2::text[])",
      [plan.tenantId, plan.dispositions.map((item) => item.record.id)],
    ),
  ]);
  if (imports.rows[0].count !== 3 || jobs.rows[0].count !== 3 || audited.rows[0].count !== 3) {
    throw new Error("Reconciliation postconditions failed; rollback the whole transaction");
  }
}

let transactionOpen = false;
try {
  await db.connect();
  await db.query(
    apply
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  transactionOpen = true;
  await db.query("SET LOCAL lock_timeout = '6s'");
  if (apply) await db.query("SELECT pg_advisory_xact_lock(20260927, 1)");
  const plan = await snapshot();
  console.log("Sanitized staging reconciliation: " + JSON.stringify(plan.publicSummary, null, 2));
  if (apply) {
    checkApprovals(plan);
    await quarantine(plan);
    await db.query("COMMIT");
    transactionOpen = false;
    console.log(
      "Three import previews and jobs administratively quarantined; no rows deleted. " +
        "The V3 reference is UNSCANNED and MUST NOT be replayed. Review other pending jobs separately.",
    );
  } else {
    await db.query("ROLLBACK");
    transactionOpen = false;
    console.log(
      "READ-ONLY PLAN ONLY. No changes. Apply requires independently verified " +
        "backup and isolated restore, exact plan approval, and a separate staging write credential.",
    );
  }
} catch (error) {
  if (transactionOpen) {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* preserve original error */
    }
  }
  console.error(
    "Reconciliation refused: " + (error instanceof Error ? error.message : "unknown failure"),
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
