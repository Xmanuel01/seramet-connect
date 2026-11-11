import type { D1Database } from "@/server/database/d1";

/**
 * One row per outbound email job: who it went to, which sender and category, what Brevo said
 * and, once Brevo's webhook reports it, whether it was delivered, bounced or blocked.
 *
 * The job itself (attempts, leases, retry schedule) stays in worker_jobs; this table is the
 * searchable record for diagnosis. It never holds message bodies, attachments, passwords,
 * one-time codes or links.
 *
 * Writes are best-effort: a logging failure must never change whether an email is sent.
 */

export type DeliveryStatus =
  | "SENDING"
  | "ACCEPTED"
  | "DELIVERED"
  | "DEFERRED"
  | "BOUNCED"
  | "BLOCKED"
  | "COMPLAINED"
  | "RATE_LIMITED"
  | "REJECTED"
  | "UNKNOWN";

export async function recordEmailAttempt(
  db: D1Database,
  entry: {
    tenantId: string;
    jobId: string;
    category: string;
    senderIdentity: string;
    senderEmail: string;
    recipientEmail: string;
    subject: string;
    attemptCount: number;
    status: DeliveryStatus;
    providerMessageId?: string;
    failureReason?: string;
  },
  at = new Date().toISOString(),
) {
  try {
    await db
      .prepare(
        `INSERT INTO email_delivery_log
          (tenant_id,job_id,category,sender_identity,sender_email,recipient_email,subject,provider,
           provider_message_id,status,attempt_count,created_at,last_attempt_at,accepted_at,failure_reason)
         VALUES (?,?,?,?,?,?,?,'BREVO',?,?,?,?,?,?,?)
         ON CONFLICT(tenant_id,job_id) DO UPDATE SET
           provider_message_id=COALESCE(excluded.provider_message_id,email_delivery_log.provider_message_id),
           status=excluded.status,
           attempt_count=excluded.attempt_count,
           last_attempt_at=excluded.last_attempt_at,
           accepted_at=COALESCE(email_delivery_log.accepted_at,excluded.accepted_at),
           failure_reason=excluded.failure_reason`,
      )
      .bind(
        entry.tenantId,
        entry.jobId,
        entry.category,
        entry.senderIdentity,
        entry.senderEmail,
        entry.recipientEmail.toLowerCase(),
        entry.subject.slice(0, 300),
        entry.providerMessageId ?? null,
        entry.status,
        entry.attemptCount,
        at,
        at,
        entry.status === "ACCEPTED" ? at : null,
        entry.failureReason?.slice(0, 200) ?? null,
      )
      .run();
  } catch {
    // Diagnosis only; the job's own evidence in worker_jobs remains authoritative.
  }
}

/** Brevo webhook event names mapped onto delivery status. Opens and clicks are not tracked. */
const brevoEvents: Record<string, DeliveryStatus> = {
  delivered: "DELIVERED",
  deferred: "DEFERRED",
  soft_bounce: "DEFERRED",
  hard_bounce: "BOUNCED",
  invalid_email: "BOUNCED",
  blocked: "BLOCKED",
  error: "BLOCKED",
  spam: "COMPLAINED",
  complaint: "COMPLAINED",
};

export const deliveryStatusForBrevoEvent = (event: string) =>
  Object.hasOwn(brevoEvents, event) ? brevoEvents[event] : null;

// A later event never downgrades a final outcome (a "deferred" arriving after "delivered").
const finality: Record<DeliveryStatus, number> = {
  SENDING: 0,
  RATE_LIMITED: 0,
  UNKNOWN: 0,
  ACCEPTED: 1,
  DEFERRED: 2,
  DELIVERED: 3,
  REJECTED: 3,
  BOUNCED: 4,
  BLOCKED: 4,
  COMPLAINED: 5,
};

export async function applyProviderEvent(
  db: D1Database,
  event: { providerMessageId: string; status: DeliveryStatus; occurredAt: string; reason?: string },
) {
  const row = await db
    .prepare(
      "SELECT tenant_id,job_id,status FROM email_delivery_log WHERE provider_message_id=? LIMIT 1",
    )
    .bind(event.providerMessageId)
    .first<{ tenant_id: string; job_id: string; status: DeliveryStatus }>();
  if (!row) return false;
  const keep = (finality[row.status] ?? 0) > finality[event.status];
  await db
    .prepare(
      `UPDATE email_delivery_log SET last_event=?,last_event_at=?,
         status=?,delivered_at=CASE WHEN ?='DELIVERED' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
         failure_reason=CASE WHEN ? IN ('BOUNCED','BLOCKED','COMPLAINED','DEFERRED') THEN ? ELSE failure_reason END
       WHERE tenant_id=? AND job_id=?`,
    )
    .bind(
      event.status,
      event.occurredAt,
      keep ? row.status : event.status,
      event.status,
      event.occurredAt,
      event.status,
      event.reason?.slice(0, 200) ?? null,
      row.tenant_id,
      row.job_id,
    )
    .run();
  return true;
}

/** Retention: delivery records older than 400 days are removed in batches. */
export async function pruneEmailDeliveryLog(db: D1Database, at = new Date(), batch = 5_000) {
  const cutoff = new Date(at.getTime() - 400 * 24 * 60 * 60 * 1_000).toISOString();
  const result = await db
    .prepare(
      `DELETE FROM email_delivery_log WHERE (tenant_id,job_id) IN (
         SELECT tenant_id,job_id FROM email_delivery_log WHERE created_at<? LIMIT ${batch})`,
    )
    .bind(cutoff)
    .run();
  return result.meta?.changes ?? 0;
}
