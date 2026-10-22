import type { SerametEnv } from "@/lib/seramet-auth";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { permissions } from "@/platform/permissions";
import { deliverPdfEmail, pdfDigest, TransactionalEmailError } from "@/server/transactional-email";

// The shared worker owns the lease; permissions and immutable snapshot scope are rechecked on each attempt.
export async function deliverDailyClosingEmail(
  env: SerametEnv,
  tenantId: string,
  jobId: string,
  transport: typeof fetch = fetch,
) {
  const db = env.SERAMET_DB;
  if (!db) throw new Error("CLOSING_EMAIL_DATABASE_REQUIRED");
  const job = await db
    .prepare(
      "SELECT branch_id,payload_json FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type='DAILY_CLOSING_EMAIL' AND status='RUNNING'",
    )
    .bind(tenantId, jobId)
    .first<{ branch_id: string; payload_json: string }>();
  if (!job) throw new TransactionalEmailError("CLOSING_EMAIL_AUTHORIZED_JOB_REQUIRED");
  const payload = JSON.parse(job.payload_json) as {
    dayCloseId: string;
    revision: number;
    recipientUserId: string;
  };
  const recipient = await db
    .prepare(
      `SELECT u.email FROM users u JOIN user_branches b ON b.tenant_id=u.tenant_id AND b.user_id=u.id
    WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND b.branch_id=? AND EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1
      JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
      WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rp.permission_code=?)`,
    )
    .bind(tenantId, payload.recipientUserId, job.branch_id, permissions.reconciliationView)
    .first<{ email: string | null }>();
  if (!recipient?.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email))
    throw new TransactionalEmailError("CLOSING_EMAIL_RECIPIENT_NOT_AUTHORIZED");
  const state = await new D1AuthoritativeTransactionRepository(db).loadState(tenantId);
  const day = state.paymentOperations?.dayCloses.find(
    (d) => d.id === payload.dayCloseId && d.branchId === job.branch_id && d.tenantId === tenantId,
  );
  const snapshot = day?.snapshots.find((s) => s.revision === payload.revision);
  if (!snapshot?.dailyReport?.recipientUserIds.includes(payload.recipientUserId))
    throw new TransactionalEmailError("CLOSING_EMAIL_SNAPSHOT_SCOPE_INVALID");
  if (day?.status !== "CLOSED" || day.snapshot?.revision !== payload.revision)
    throw new TransactionalEmailError("CLOSING_EMAIL_PERIOD_REOPENED");
  const { renderDailyClosingPdf } = await import("@/server/daily-closing-report");
  const pdf = await renderDailyClosingPdf(snapshot);
  await deliverPdfEmail(
    env,
    tenantId,
    jobId,
    {
      to: { email: recipient.email },
      subject: `Daily Closing Report - ${snapshot.businessDate} - ${snapshot.dailyReport.branch}`,
      text: `The business day has closed. Attached is immutable report ${snapshot.dailyReport.reference}. Financial closure is independent of email delivery.`,
      filename: `daily-closing-${snapshot.businessDate}-r${snapshot.revision}.pdf`,
      sha256: await pdfDigest(pdf),
    },
    pdf,
    transport,
  );
  await db
    .prepare(
      `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
    VALUES (?,?,?,'system:daily-closing','CLOSING_EMAIL_PROVIDER_ACCEPTED','DayClose',?,'Provider acceptance is not inbox delivery',?,'{}',?) ON CONFLICT(tenant_id,id) DO NOTHING`,
    )
    .bind(tenantId, jobId, job.branch_id, payload.dayCloseId, jobId, new Date().toISOString())
    .run();
}
