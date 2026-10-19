import type { SerametEnv } from "@/lib/seramet-auth";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { permissions } from "@/platform/permissions";

type PreparedEmail = {
  preparedAt: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments: Array<{ filename: string; sha256: string }>;
};
type DeliveryEvidence = {
  prepared?: PreparedEmail;
  acceptedByProvider?: boolean;
  providerMessageId?: string;
  acceptedAt?: string;
};
type EmailJob = {
  tenant_id: string;
  id: string;
  branch_id: string;
  payload_json: string;
  result_json: string;
  attempt_count: number;
  max_attempts: number;
};

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

// Called only after the existing worker lease has been claimed. All recipient authorization
// is re-read from the database, not inferred from a queue message or cached UI configuration.
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
      "SELECT tenant_id,id,branch_id,payload_json,result_json,attempt_count,max_attempts FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type='DAILY_CLOSING_EMAIL' AND status='RUNNING'",
    )
    .bind(tenantId, jobId)
    .first<EmailJob>();
  if (!job) throw new Error("CLOSING_EMAIL_AUTHORIZED_JOB_REQUIRED");
  if (job.attempt_count > Math.min(job.max_attempts, 8))
    throw new Error("CLOSING_EMAIL_ATTEMPT_LIMIT_REACHED");
  const payload = JSON.parse(job.payload_json) as {
    dayCloseId: string;
    revision: number;
    recipientUserId: string;
  };
  let evidence = JSON.parse(job.result_json) as DeliveryEvidence;
  if (evidence.acceptedByProvider && evidence.providerMessageId) return;
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
    throw new Error("CLOSING_EMAIL_RECIPIENT_NOT_AUTHORIZED");
  if (
    !env.SERAMET_CLOSING_EMAIL_API_KEY ||
    !env.SERAMET_CLOSING_EMAIL_FROM ||
    /[\r\n]/.test(env.SERAMET_CLOSING_EMAIL_FROM)
  )
    throw new Error("CLOSING_EMAIL_CONFIGURATION_REQUIRED");
  const state = await new D1AuthoritativeTransactionRepository(db).loadState(tenantId);
  const day = state.paymentOperations?.dayCloses.find(
    (d) => d.id === payload.dayCloseId && d.branchId === job.branch_id && d.tenantId === tenantId,
  );
  const snapshot = day?.snapshots.find((s) => s.revision === payload.revision);
  if (!snapshot?.dailyReport?.recipientUserIds.includes(payload.recipientUserId))
    throw new Error("CLOSING_EMAIL_SNAPSHOT_SCOPE_INVALID");
  if (day?.status !== "CLOSED" || day.snapshot?.revision !== payload.revision)
    throw new Error("CLOSING_EMAIL_PERIOD_REOPENED");
  const { renderDailyClosingPdf } = await import("@/server/daily-closing-report");
  const pdf = await renderDailyClosingPdf(snapshot);
  if (pdf.length > 10 * 1024 * 1024) throw new Error("CLOSING_EMAIL_REPORT_TOO_LARGE");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(pdf));
  const sha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  if (!evidence.prepared) {
    const prepared: PreparedEmail = {
      preparedAt: new Date().toISOString(),
      from: env.SERAMET_CLOSING_EMAIL_FROM,
      to: [recipient.email],
      subject: `Daily Closing Report - ${snapshot.businessDate} - ${snapshot.dailyReport.branch}`,
      text: `The business day has closed. Attached is immutable report ${snapshot.dailyReport.reference}. Financial closure is independent of email delivery.`,
      attachments: [
        {
          filename: `daily-closing-${snapshot.businessDate}-r${snapshot.revision}.pdf`,
          sha256,
        },
      ],
    };
    await db
      .prepare(
        "UPDATE worker_jobs SET result_json=? WHERE tenant_id=? AND id=? AND status='RUNNING' AND result_json='{}'",
      )
      .bind(JSON.stringify({ prepared }), tenantId, jobId)
      .run();
    const persisted = await db
      .prepare("SELECT result_json FROM worker_jobs WHERE tenant_id=? AND id=?")
      .bind(tenantId, jobId)
      .first<{ result_json: string }>();
    evidence = JSON.parse(persisted?.result_json ?? "{}") as DeliveryEvidence;
  }
  const prepared = evidence.prepared;
  if (!prepared || prepared.to.length !== 1 || prepared.to[0] !== recipient.email)
    throw new Error("CLOSING_EMAIL_PREPARED_RECIPIENT_CHANGED");
  if (prepared.attachments.length !== 1 || prepared.attachments[0]!.sha256 !== sha256)
    throw new Error("CLOSING_EMAIL_REPORT_BYTES_CHANGED");
  const age = Date.now() - Date.parse(prepared.preparedAt);
  // Resend retains idempotency keys for 24 hours. Ambiguous sends outside that window
  // require operator/provider reconciliation, never a fresh automatic send.
  if (!Number.isFinite(age) || age < 0 || age >= 23 * 60 * 60 * 1000)
    throw new Error("CLOSING_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  const body = {
    from: prepared.from,
    to: prepared.to,
    subject: prepared.subject,
    text: prepared.text,
    attachments: [{ filename: prepared.attachments[0]!.filename, content: base64(pdf) }],
  };
  let response: Response;
  try {
    response = await transport("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${env.SERAMET_CLOSING_EMAIL_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": jobId,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("CLOSING_EMAIL_PROVIDER_UNAVAILABLE");
  }
  if (!response.ok)
    throw new Error(
      `CLOSING_EMAIL_PROVIDER_HTTP_${response.status >= 500 ? "5XX" : response.status === 429 ? "429" : "4XX"}`,
    );
  const result = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (
    typeof result?.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.id)
  )
    throw new Error("CLOSING_EMAIL_PROVIDER_RESPONSE_UNVERIFIED");
  const acceptedAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE worker_jobs SET result_json=? WHERE tenant_id=? AND id=? AND status='RUNNING'",
      )
      .bind(
        JSON.stringify({
          ...evidence,
          acceptedByProvider: true,
          providerMessageId: result.id,
          acceptedAt,
        }),
        tenantId,
        jobId,
      ),
    db
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
      VALUES (?,?,?,'system:daily-closing','CLOSING_EMAIL_PROVIDER_ACCEPTED','DayClose',?,'Provider acceptance is not inbox delivery',?,'{}',?) ON CONFLICT(tenant_id,id) DO NOTHING`,
      )
      .bind(tenantId, jobId, job.branch_id, payload.dayCloseId, jobId, acceptedAt),
  ]);
}
