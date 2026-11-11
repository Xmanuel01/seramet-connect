import type { SerametEnv } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import {
  closingPolicy,
  currentBusinessDate,
  dueSummaryDate,
  lastEndedBusinessDate,
  summarizeBusinessDay,
} from "@/payments/daily-closing";
import { deliverPdfEmail, pdfDigest, TransactionalEmailError } from "@/server/transactional-email";
import { dailySummaryEmail, emailContext, reportFactsFromSnapshot } from "@/server/email/templates";

export const DAILY_SUMMARY_EMAIL = "DAILY_SUMMARY_EMAIL";

async function sha256(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

const RECIPIENT_SQL = `SELECT u.email,u.name FROM users u JOIN user_branches b ON b.tenant_id=u.tenant_id AND b.user_id=u.id
       WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND b.branch_id=? AND EXISTS (
         SELECT 1 FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1
         JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id
         WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rp.permission_code=?)`;

/**
 * "Send now": queues the summary for today so far (or yesterday) to people with report
 * access at this branch. The worker picks it up within a minute.
 */
export async function queueManualDailySummary(
  env: SerametEnv,
  input: {
    tenantId: string;
    branchId: string;
    requestedBy: string;
    recipientUserIds: string[];
    day: "today" | "yesterday";
    /** Resend a past day from the history; never a day that hasn't started. */
    businessDate?: string;
  },
  now = new Date(),
) {
  const db = env.SERAMET_DB;
  if (!db) throw new Error("DAILY_SUMMARY_DATABASE_REQUIRED");
  const recipients = [...new Set(input.recipientUserIds)];
  if (!recipients.length || recipients.length > 20)
    throw new Error("DAILY_SUMMARY_RECIPIENTS_INVALID");
  for (const id of recipients) {
    const row = await db
      .prepare(RECIPIENT_SQL)
      .bind(input.tenantId, id, input.branchId, permissions.reconciliationView)
      .first<{ email: string | null }>();
    if (!row?.email) throw new Error("DAILY_SUMMARY_RECIPIENT_NOT_AUTHORIZED");
  }
  const today = currentBusinessDate(input.tenantId, input.branchId, now);
  if (
    input.businessDate !== undefined &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) || input.businessDate > today)
  )
    throw new Error("DAILY_SUMMARY_DATE_INVALID");
  const businessDate =
    input.businessDate ??
    (input.day === "today" ? today : lastEndedBusinessDate(input.tenantId, input.branchId, now));
  const stamp = now.toISOString();
  let queued = 0;
  for (const recipientUserId of recipients) {
    // One per person per minute, so a double click doesn't send twice.
    const key = `daily-summary-now:${input.branchId}:${businessDate}:${recipientUserId}:${stamp.slice(0, 16)}`;
    const result = await db
      .prepare(
        `INSERT INTO worker_jobs
          (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,status,
           attempt_count,max_attempts,scheduled_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,'PENDING',0,8,?,?,?)
         ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        input.tenantId,
        `daily-summary-${await sha256(key)}`,
        input.branchId,
        DAILY_SUMMARY_EMAIL,
        JSON.stringify({ businessDate, recipientUserId, requestedBy: input.requestedBy }),
        key,
        crypto.randomUUID(),
        stamp,
        stamp,
        stamp,
      )
      .run();
    queued += result.meta?.changes ?? 0;
  }
  return { queued, businessDate };
}

/**
 * Runs every few minutes. For each branch whose send time has passed, queues one email per
 * chosen recipient for the ended day. The idempotency key makes repeated runs harmless.
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
    requestedBy?: string;
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.businessDate))
    throw new TransactionalEmailError("DAILY_SUMMARY_DATE_INVALID");
  // Same rule as the closing report: an active user with this branch and report access.
  const recipient = await db
    .prepare(RECIPIENT_SQL)
    .bind(tenantId, payload.recipientUserId, job.branch_id, permissions.reconciliationView)
    .first<{ email: string | null; name: string | null }>();
  if (!recipient?.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient.email))
    throw new TransactionalEmailError("DAILY_SUMMARY_RECIPIENT_NOT_AUTHORIZED");
  const state = await new D1AuthoritativeTransactionRepository(db).loadState(tenantId);
  // A "send now" request goes regardless; the automatic one respects the list and the close.
  if (!payload.requestedBy) {
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
  }
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
  const email = dailySummaryEmail(
    reportFactsFromSnapshot(snapshot, recipient.name),
    emailContext(env),
  );
  await deliverPdfEmail(
    env,
    tenantId,
    jobId,
    {
      to: { email: recipient.email },
      subject: email.subject,
      text: email.text,
      html: email.html,
      category: email.category,
      filename: `daily-summary-${payload.businessDate}.pdf`,
      sha256: await pdfDigest(pdf),
    },
    pdf,
  );
}
