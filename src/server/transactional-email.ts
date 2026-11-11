import type { SerametEnv } from "@/lib/seramet-auth";
import { recordEmailAttempt, type DeliveryStatus } from "@/server/email/delivery-log";
import {
  isEmailCategory,
  isSafeMailbox,
  resolveSender,
  type EmailCategory,
  type Mailbox,
} from "@/server/email/senders";

export function documentEmailStatus(row: {
  status: string;
  result_json: string;
  last_error?: string | null;
}) {
  const evidence = JSON.parse(row.result_json);
  if (evidence.acceptedByProvider) return "PROVIDER_ACCEPTED";
  if (
    evidence.email?.outcome === "UNKNOWN" ||
    (evidence.email?.outcome === "IN_FLIGHT" && row.status !== "RUNNING") ||
    (evidence.prepared && !evidence.acceptedByProvider)
  )
    return "RECONCILIATION_REQUIRED";
  if (row.last_error === "TRANSACTIONAL_EMAIL_CONFIGURATION_REQUIRED")
    return "CONFIGURATION_REQUIRED";
  if (["DEAD_LETTER", "FAILED"].includes(row.status)) return "DELIVERY_FAILED";
  return "QUEUED";
}

export class TransactionalEmailError extends Error {
  constructor(
    code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}
export function transactionalEmailConfiguration(env: SerametEnv, tenantId: string) {
  try {
    const values = JSON.parse(env.SERAMET_TRANSACTIONAL_EMAIL_CONFIG ?? "{}");
    // {apiKey, from} serves every business on the platform. A business id key can
    // override it for one business; nothing has to be added when a restaurant signs up.
    const config =
      values && Object.hasOwn(values, tenantId)
        ? values[tenantId]
        : typeof values?.apiKey === "string"
          ? values
          : null;
    if (
      typeof config?.apiKey !== "string" ||
      config.apiKey.length < 16 ||
      /[\r\n]/.test(config.apiKey) ||
      typeof config.from !== "string" ||
      /[\r\n]/.test(config.from)
    )
      throw new Error();
    const email = config.from.match(/<([^<>]+)>$/)?.[1] ?? config.from;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error();
    return {
      apiKey: config.apiKey as string,
      sender: {
        email,
        ...(config.from.includes("<")
          ? { name: config.from.slice(0, config.from.lastIndexOf("<")).trim() }
          : {}),
      },
    };
  } catch {
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_CONFIGURATION_REQUIRED", true);
  }
}
export function pdfBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}
export async function pdfDigest(pdf: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(pdf))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export type PdfEmail = {
  to: { email: string; name?: string };
  subject: string;
  text: string;
  filename: string;
  sha256: string;
  /**
   * Decides the departmental sender. Emails queued before categories existed have none and
   * keep the original behaviour: the configured sender, plain text only.
   */
  category?: EmailCategory;
  /** Branded HTML version; only its digest is kept in the job evidence. */
  html?: string;
  /** For a restaurant's own documents: its name, and where customer replies should go. */
  merchant?: { name?: string; replyTo?: string };
};
type PreparedEmail = Omit<PdfEmail, "html"> & {
  provider: "BREVO";
  sender: Mailbox;
  replyTo?: Mailbox;
  identity?: string;
  htmlSha256?: string;
  outcome: "READY" | "IN_FLIGHT" | "RATE_LIMITED" | "UNKNOWN" | "REJECTED" | "ACCEPTED";
};
type Evidence = {
  email?: PreparedEmail;
  prepared?: unknown;
  acceptedByProvider?: boolean;
  providerMessageId?: string;
  acceptedAt?: string;
};

// Persist intent before any external request. An interrupted/ambiguous send is never replayed.
export async function deliverPdfEmail(
  env: SerametEnv,
  tenantId: string,
  jobId: string,
  message: PdfEmail,
  pdf: Uint8Array,
  transport: typeof fetch = fetch,
) {
  const db = env.SERAMET_DB;
  if (!db) throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DATABASE_REQUIRED");
  const row = await db
    .prepare(
      "SELECT result_json,attempt_count,max_attempts FROM worker_jobs WHERE tenant_id=? AND id=? AND status='RUNNING'",
    )
    .bind(tenantId, jobId)
    .first<{ result_json: string; attempt_count: number; max_attempts: number }>();
  if (!row || row.attempt_count > Math.min(row.max_attempts, 8))
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_AUTHORIZED_JOB_REQUIRED");
  let raw = row.result_json;
  let evidence: Evidence = JSON.parse(raw);
  if (evidence.acceptedByProvider && evidence.providerMessageId) return;
  if (evidence.prepared)
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_LEGACY_SEND_RECONCILIATION_REQUIRED");
  const config = transactionalEmailConfiguration(env, tenantId);
  // A job first prepared before categories existed finishes exactly as it was prepared: the
  // stored plain-text message, the configured sender, no HTML. Recipient and PDF must match.
  if (evidence.email && !evidence.email.category && message.category)
    message = {
      to: message.to,
      subject: evidence.email.subject,
      text: evidence.email.text,
      filename: message.filename,
      sha256: message.sha256,
    };
  if (
    !pdf.length ||
    pdf.length > 1024 * 1024 ||
    (await pdfDigest(pdf)) !== message.sha256 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to.email) ||
    /[\r\n]/.test(message.subject) ||
    !message.subject ||
    message.subject.length > 300 ||
    /[\r\n]/.test(message.to.name ?? "") ||
    !/^[\w.-]+\.pdf$/.test(message.filename) ||
    (message.category !== undefined && !isEmailCategory(message.category)) ||
    (message.html !== undefined && (!message.html || message.html.length > 200_000))
  )
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DOCUMENT_INVALID");
  const { html, ...plain } = message;
  const htmlSha256 =
    html === undefined ? undefined : await pdfDigest(new TextEncoder().encode(html));
  // The server picks the sender from the category; nothing in the request can choose it.
  let route: { sender: Mailbox; replyTo?: Mailbox; identity?: string };
  try {
    route = message.category
      ? resolveSender(env, message.category, config.sender, message.merchant)
      : { sender: config.sender };
  } catch {
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DOCUMENT_INVALID");
  }
  if (evidence.email) {
    const prior = evidence.email;
    if (
      JSON.stringify(prior.to) !== JSON.stringify(message.to) ||
      prior.subject !== message.subject ||
      prior.text !== message.text ||
      prior.filename !== message.filename ||
      prior.sha256 !== message.sha256 ||
      prior.category !== message.category ||
      // The HTML is a server rendering of the same content; a footer that changed because a
      // forwarding route went live must not strand a retry, so its digest is recorded, not pinned.
      // Uncategorised (older) emails must keep the exact configured sender.
      (!message.category && JSON.stringify(prior.sender) !== JSON.stringify(config.sender)) ||
      prior.provider !== "BREVO"
    )
      throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_PREPARED_MESSAGE_CHANGED");
    // A retry keeps the sender chosen when the email was first prepared, even if the list of
    // active senders changed in between: it was verified then, and the message stays identical.
    route = {
      sender: prior.sender,
      ...(prior.replyTo ? { replyTo: prior.replyTo } : {}),
      ...(prior.identity ? { identity: prior.identity } : {}),
    };
  }
  if (!isSafeMailbox(route.sender) || (route.replyTo && !isSafeMailbox(route.replyTo)))
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DOCUMENT_INVALID");
  if (evidence.email && !["READY", "RATE_LIMITED"].includes(evidence.email.outcome))
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  evidence = {
    ...evidence,
    email: {
      ...plain,
      provider: "BREVO",
      sender: route.sender,
      ...(route.replyTo ? { replyTo: route.replyTo } : {}),
      ...(route.identity ? { identity: route.identity } : {}),
      ...(htmlSha256 ? { htmlSha256 } : {}),
      outcome: "IN_FLIGHT",
    },
  };
  const persist = async (next: Evidence) => {
    const encoded = JSON.stringify(next);
    const result = await db
      .prepare(
        "UPDATE worker_jobs SET result_json=? WHERE tenant_id=? AND id=? AND status='RUNNING' AND result_json=?",
      )
      .bind(encoded, tenantId, jobId, raw)
      .run();
    if (result.meta?.changes !== 1)
      throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_CONCURRENT_SEND_REJECTED");
    raw = encoded;
    evidence = next;
  };
  await persist(evidence);
  const log = (
    status: DeliveryStatus,
    extra: { providerMessageId?: string; failureReason?: string } = {},
  ) =>
    recordEmailAttempt(db, {
      tenantId,
      jobId,
      category: message.category ?? "UNCATEGORISED",
      senderIdentity: route.identity ?? "CONFIGURED",
      senderEmail: route.sender.email,
      recipientEmail: message.to.email,
      subject: message.subject,
      attemptCount: row.attempt_count,
      status,
      ...extra,
    });
  await log("SENDING");
  const outcome = async (value: PreparedEmail["outcome"], failureReason: string) => {
    await persist({ ...evidence, email: { ...evidence.email!, outcome: value } });
    await log(value === "REJECTED" || value === "RATE_LIMITED" ? value : "UNKNOWN", {
      failureReason,
    });
  };
  let response: Response;
  try {
    response = await transport("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      redirect: "manual", // Workers throws on "error"; a 3xx is treated as a rejection.
      signal: AbortSignal.timeout(15000),
      headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: route.sender,
        ...(route.replyTo ? { replyTo: route.replyTo } : {}),
        to: [message.to],
        subject: message.subject,
        textContent: message.text,
        ...(html ? { htmlContent: html } : {}),
        attachment: [{ name: message.filename, content: pdfBase64(pdf) }],
        tags: [
          "seramet-transactional",
          ...(message.category ? [`category-${message.category.toLowerCase()}`] : []),
        ],
      }),
    });
  } catch {
    await outcome("UNKNOWN", "No response from Brevo");
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  }
  // 429 is a rate limit; 402 is an exhausted plan quota (300 a day on Brevo's free plan).
  // Neither accepted the message, so a later retry is safe.
  if (response.status === 429 || response.status === 402) {
    await outcome(
      "RATE_LIMITED",
      response.status === 402 ? "Brevo sending quota exhausted" : "Brevo rate limit",
    );
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_RATE_LIMITED", true);
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || [408, 409].includes(response.status);
    await outcome(uncertain ? "UNKNOWN" : "REJECTED", `Brevo HTTP ${response.status}`);
    throw new TransactionalEmailError(
      uncertain
        ? "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED"
        : "TRANSACTIONAL_EMAIL_PROVIDER_REJECTED",
    );
  }
  const result = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
  if (typeof result?.messageId !== "string" || !/^<[^\s<>]{1,250}>$/.test(result.messageId)) {
    await outcome("UNKNOWN", "Brevo response had no message id");
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  }
  await persist({
    ...evidence,
    email: { ...evidence.email!, outcome: "ACCEPTED" },
    acceptedByProvider: true,
    providerMessageId: result.messageId,
    acceptedAt: new Date().toISOString(),
  });
  await log("ACCEPTED", { providerMessageId: result.messageId });
}
