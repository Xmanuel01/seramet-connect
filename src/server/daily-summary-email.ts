import type { SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { closingPolicy, dueSummaryDate, summarizeBusinessDay } from "@/payments/daily-closing";
import { deliverPdfEmail, pdfDigest, TransactionalEmailError } from "@/server/transactional-email";

export const DAILY_SUMMARY_EMAIL = "DAILY_SUMMARY_EMAIL";

async function sha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Runs hourly. For each branch whose business day has ended, queues one email per chosen
 * recipient for that day. The idempotency key makes this safe to run any number of times.
 */
export async function queueDailySummaryEmails(env: SerametEnv, tenantId: string, now = new Date()) {
  const db = env.SERAMET_DB;
  if (!db) throw new Error("DAILY_SUMMARY_DATABASE_REQUIRED");
  const state = await new D1AuthoritativeTransactionRepository(db).loadState(tenantId);
  const branches = getConfigurationRepository().listBranches(tenantId);
  const stamp = now.toISOString();
  let queued = 0;
  for (const branch of branches) {
    const policy = closingPolicy(state, tenantId, branch.id);
    const recipients = policy.recipientUserIds;
    if (!recipients.length) continue;
    const businessDate = dueSummaryDate(tenantId, branch.id, policy.summarySendMinutes, now);
    if (!businessDate) continue; // Not the chosen send time yet.
    for (const recipientUserId of new Set(recipients)) {
      const key = `daily-summary:${branch.id}:${businessDate}:${recipientUserId}`;
      const result = await db
        .prepare(
          `INSERT INTO worker_jobs
            (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,status,
             attempt_count,max_attempts,scheduled_at,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,'PENDING',0,8,?,?,?)
           ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
        )
        .bind(
          tenantId,
          `daily-summary-${await sha256(key)}`,
          branch.id,
          DAILY_SUMMARY_EMAIL,
          JSON.stringify({ businessDate, recipientUserId }),
          key,
          crypto.randomUUID(),
          stamp,
          stamp,
          stamp,
        )
        .run();
      queued += result.meta?.changes ?? 0;
    }
  }
  return { queued };
}

/** Sends one recipient the PDF summary of a day, unless the day was closed meanwhile. */
export async function deliverDailySummaryEmail(env: SerametEnv, tenantId: string, jobId: string) {
  const db = env.SERAMET_DB;
  if (!db) throw new Error("DAILY_SUMMARY_DATABASE_REQUIRED");
  const job = await db
    .prepare(
      "SELECT branch_id,payload_json,created_at FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type=? AND status='RUNNING'",
    )
    .bind(tenantId, jobId, DAILY_SUMMARY_EMAIL)
    .first<{ branch_id: string; payload_json: string; created_at: string }>();
  if (!job) throw new TransactionalEmailError("DAILY_SUMMARY_AUTHORIZED_JOB_REQUIRED");
  const payload = JSON.parse(job.payload_json) as {
    businessDate: string;
    recipientUserId: string;
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate))
    throw new TransactionalEmailError("DAILY_SUMMARY_DATE_INVALID");
  // Same rule as the closing report: an active user with this branch and report access.
  const recipient = await db
    .prepare(
      `SELECT u.email,u.name FROM users u JOIN user_branches b ON b.tenant_id=u.tenant_id AND b.user_id=u.id
       WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND b.branch_id=? AND EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1
         JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rp.permission_code=?)`,
    )
    .bind(tenantId, payload.recipientUserId, job.branch_id, permissions.reconciliationView)
    .first<{ email: string | null; name: string | null }>();
  if (!recipient?.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email))
    throw new TransactionalEmailError("DAILY_SUMMARY_RECIPIENT_NOT_AUTHORIZED");
  const state = await new D1AuthoritativeTransactionRepository(db).loadState(tenantId);
  if (
    !closingPolicy(state, tenantId, job.branch_id).recipientUserIds.includes(
      payload.recipientUserId,
    )
  )
    return; // Removed from the list since the email was queued: send nothing.
  const closed = state.paymentOperations?.dayCloses.some(
    (day) =>
      day.tenantId === tenantId &&
      day.branchId === job.branch_id &&
      day.businessDate === payload.businessDate &&
      day.status === "CLOSED",
  );
  if (closed) return; // The official closing report has already gone to the same people.
  const snapshot = summarizeBusinessDay(state, {
    tenantId,
    branchId: job.branch_id,
    businessDate: payload.businessDate,
    recipientUserIds: [payload.recipientUserId],
    // The queued time, so a retried send renders the identical PDF.
    preparedAt: job.created_at,
  });
  const { renderDailyClosingPdf } = await import("@/server/daily-closing-report");
  const pdf = await renderDailyClosingPdf(snapshot);
  const branch = snapshot.dailyReport!.branch;
  await deliverPdfEmail(
    env,
    tenantId,
    jobId,
    {
      to: { email: recipient.email },
      subject: `Daily summary - ${payload.businessDate} - ${branch}`,
      text: `Here is ${branch}'s summary for ${payload.businessDate}: sales, payments and anything still open. The day hasn't been closed in Seramet; when a supervisor closes it, the official closing report follows.`,
      filename: `daily-summary-${payload.businessDate}.pdf`,
      sha256: await pdfDigest(pdf),
    },
    pdf,
  );
}
