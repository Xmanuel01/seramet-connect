import pg from "pg";
import { randomUUID } from "node:crypto";
import { planStagingManagementBacklog } from "./staging-management-backlog-plan.mjs";

const apply = process.argv.includes("--apply");
if (
  process.argv.some((arg) => !["--plan", "--apply"].includes(arg)) ||
  (process.argv.includes("--plan") && apply)
)
  throw new Error("Use --plan OR --apply");

if (process.env.SERAMET_ENVIRONMENT !== "staging" || !process.env.SERAMET_POSTGRES_URL)
  throw new Error("STAGING ONLY: set staging environment and staging-only Postgres DSN");
const dsn = new URL(process.env.SERAMET_POSTGRES_URL);
if (
  !["postgres:", "postgresql:"].includes(dsn.protocol) ||
  !(
    dsn.hostname.includes("vnymbavsbxorwxpebkot") ||
    decodeURIComponent(dsn.username).includes("vnymbavsbxorwxpebkot")
  )
) {
  throw new Error("Postgres DSN does not identify the approved staging project");
}
const db = new pg.Client({ connectionString: process.env.SERAMET_POSTGRES_URL });
let transactionOpen = false;

async function snapshot() {
  const rows = await db.query(
    "SELECT * FROM public.worker_jobs WHERE job_type='MANAGEMENT_INTELLIGENCE_RECALCULATION' " +
      "AND status='PENDING' ORDER BY scheduled_at,id" +
      (apply ? " FOR UPDATE" : ""),
  );
  const jobs = rows.rows;
  if (!jobs.length) throw new Error("Management backlog absent or already processed; stop");
  const tenantId = jobs[0].tenant_id;
  const branch = await db.query(
    "SELECT * FROM public.branches WHERE tenant_id=$1 ORDER BY id" + (apply ? " FOR SHARE" : ""),
    [tenantId],
  );
  const [activeOther, pendingImport, schema, activeManagement] = await Promise.all([
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs " +
        "WHERE status IN ('PENDING','RETRY_PENDING','CLAIMED','RUNNING') " +
        "AND job_type<>'MANAGEMENT_INTELLIGENCE_RECALCULATION'",
    ),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs " +
        "WHERE job_type='SETUP_IMPORT_COMMIT' AND status IN ('PENDING','RETRY_PENDING','CLAIMED','RUNNING')",
    ),
    db.query("SELECT max(version)::integer AS version FROM public.schema_migrations"),
    db.query(
      "SELECT COUNT(*)::integer AS count FROM public.worker_jobs " +
        "WHERE job_type='MANAGEMENT_INTELLIGENCE_RECALCULATION' " +
        "AND status IN ('PENDING','RETRY_PENDING','CLAIMED','RUNNING')",
    ),
  ]);
  if (activeManagement.rows[0].count !== jobs.length)
    throw new Error("Other management work is running or changed; stop");
  const plan = planStagingManagementBacklog({
    jobs,
    branches: branch.rows,
    activeOtherJobCount: activeOther.rows[0].count,
    pendingImportCount: pendingImport.rows[0].count,
    schemaVersion: schema.rows[0].version,
  });
  const existingAudit = await db.query(
    "SELECT COUNT(*)::integer AS count FROM public.audit_events " +
      "WHERE tenant_id=$1 AND entity_type='WORKER_JOB' AND action='MANAGEMENT_JOB_SUPERSEDED' " +
      "AND entity_id=ANY($2::text[])",
    [plan.tenantId, plan.superseded.map((job) => job.id)],
  );
  if (existingAudit.rows[0].count)
    throw new Error("Management job was previously superseded; stop");
  return plan;
}

function requireApproval(plan) {
  const env = process.env;
  if (
    env.SERAMET_MANAGEMENT_BACKUP_RESTORE_VERIFIED !== "true" ||
    !env.SERAMET_MANAGEMENT_RESTORE_EVIDENCE?.trim() ||
    !env.SERAMET_MANAGEMENT_OPERATOR?.trim() ||
    env.SERAMET_MANAGEMENT_APPROVED_PLAN_SHA256 !== plan.fingerprint ||
    env.SERAMET_MANAGEMENT_APPROVED_BRANCH_REF !== plan.publicSummary.branch_ref ||
    env.SERAMET_MANAGEMENT_APPROVED_RETAINED_JOB_REF !== plan.publicSummary.retained_job_ref ||
    env.SERAMET_MANAGEMENT_QUEUE_REDELIVERY_REVIEWED !== "true"
  ) {
    throw new Error(
      "Missing restore proof, exact-plan approval, reviewed Queue redelivery or operator",
    );
  }
}

async function collapse(plan) {
  const stamp = new Date().toISOString();
  for (const job of plan.superseded) {
    const result = await db.query(
      "UPDATE public.worker_jobs SET status='DEAD_LETTER',finished_at=$1,updated_at=$1," +
        "last_error='ADMINISTRATIVE_SUPERSEDED_BY_ONE_DATE_FREE_BRANCH_RECALCULATION'," +
        "lease_owner=NULL,lease_expires_at=NULL " +
        "WHERE tenant_id=$2 AND id=$3 AND status='PENDING' AND attempt_count=0 " +
        "AND started_at IS NULL AND finished_at IS NULL " +
        "AND lease_owner IS NULL AND lease_expires_at IS NULL RETURNING id",
      [stamp, plan.tenantId, job.id],
    );
    if (result.rowCount !== 1) throw new Error("Job changed mid-reconciliation");
    const metadata = JSON.stringify({
      incident: "STAGING_2026_09_28",
      disposition: "ADMINISTRATIVE_SUPERSEDED_WITHOUT_EXECUTION",
      supersededJobId: job.id,
      retainedJobId: plan.retained.id,
      approvedSnapshotSha256: plan.fingerprint,
      restoreEvidenceReference: process.env.SERAMET_MANAGEMENT_RESTORE_EVIDENCE.trim(),
      operator: process.env.SERAMET_MANAGEMENT_OPERATOR.trim(),
      oldRecordsPreserved: true,
      recalculationDate: "CURRENT_AT_PROCESSING_TIME",
    });
    await db.query(
      "INSERT INTO public.audit_events " +
        "(tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason," +
        "correlation_id,metadata_json,created_at) VALUES " +
        "($1,$2,$3,$4,'MANAGEMENT_JOB_SUPERSEDED','WORKER_JOB',$5,$6,$7,$8,$9)",
      [
        plan.tenantId,
        randomUUID(),
        plan.branchId,
        process.env.SERAMET_MANAGEMENT_OPERATOR.trim(),
        job.id,
        "Replaced by one pending branch recalc; no prior attempts",
        job.correlation_id,
        metadata,
        stamp,
      ],
    );
  }
  const [terminal, remaining, audited] = await Promise.all([
    db.query(
      "SELECT count(*)::integer AS count FROM public.worker_jobs " +
        "WHERE tenant_id=$1 AND id=ANY($2::text[]) AND status='DEAD_LETTER' AND attempt_count=0",
      [plan.tenantId, plan.superseded.map((job) => job.id)],
    ),
    db.query(
      "SELECT count(*)::integer AS count FROM public.worker_jobs " +
        "WHERE tenant_id=$1 AND id=$2 AND status='PENDING' AND attempt_count=0",
      [plan.tenantId, plan.retained.id],
    ),
    db.query(
      "SELECT count(*)::integer AS count FROM public.audit_events " +
        "WHERE tenant_id=$1 AND action='MANAGEMENT_JOB_SUPERSEDED' AND entity_type='WORKER_JOB' " +
        "AND entity_id=ANY($2::text[])",
      [plan.tenantId, plan.superseded.map((job) => job.id)],
    ),
  ]);
  if (
    terminal.rows[0].count !== plan.superseded.length ||
    remaining.rows[0].count !== 1 ||
    audited.rows[0].count !== plan.superseded.length
  )
    throw new Error("Postconditions failed; transaction will rollback");
}

try {
  await db.connect();
  await db.query(
    apply
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
      : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  transactionOpen = true;
  await db.query("SET LOCAL lock_timeout='6s'");
  if (apply) await db.query("SELECT pg_advisory_xact_lock(20260928, 2)");
  const plan = await snapshot();
  console.info("Sanitized management job plan: " + JSON.stringify(plan.publicSummary));
  if (!apply) {
    await db.query("ROLLBACK");
    transactionOpen = false;
    console.info(`Read-only inspection. ${plan.superseded.length} jobs remain unchanged until an authorized apply.`);
  } else {
    requireApproval(plan);
    await collapse(plan);
    await db.query("COMMIT");
    transactionOpen = false;
    console.info(
      `${plan.superseded.length} superseded jobs preserved as terminal + audited; newest PENDING. ` +
        "Do not resume the worker until the scanner, Queue and branch prereqs are verified.",
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
  console.error(error instanceof Error ? error.message : "Unknown recovery failure");
  process.exitCode = 1;
} finally {
  await db.end();
}
