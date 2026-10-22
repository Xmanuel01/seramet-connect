import type { SerametEnv } from "@/lib/seramet-auth";

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
    const config = Object.hasOwn(values, tenantId) ? values[tenantId] : null;
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
};
type Evidence = {
  email?: PdfEmail & {
    provider: "BREVO";
    sender: { email: string; name?: string };
    outcome: "READY" | "IN_FLIGHT" | "RATE_LIMITED" | "UNKNOWN" | "REJECTED" | "ACCEPTED";
  };
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
  if (
    !pdf.length ||
    pdf.length > 1024 * 1024 ||
    (await pdfDigest(pdf)) !== message.sha256 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to.email) ||
    /[\r\n]/.test(message.subject) ||
    !message.subject ||
    message.subject.length > 300 ||
    /[\r\n]/.test(message.to.name ?? "") ||
    !/^[\w.-]+\.pdf$/.test(message.filename)
  )
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DOCUMENT_INVALID");
  if (evidence.email) {
    const prior = evidence.email;
    if (
      JSON.stringify(prior.to) !== JSON.stringify(message.to) ||
      prior.subject !== message.subject ||
      prior.text !== message.text ||
      prior.filename !== message.filename ||
      prior.sha256 !== message.sha256 ||
      JSON.stringify(prior.sender) !== JSON.stringify(config.sender) ||
      prior.provider !== "BREVO"
    )
      throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_PREPARED_MESSAGE_CHANGED");
  }
  if (evidence.email && !["READY", "RATE_LIMITED"].includes(evidence.email.outcome))
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  evidence = {
    ...evidence,
    email: { ...message, provider: "BREVO", sender: config.sender, outcome: "IN_FLIGHT" },
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
  const outcome = async (value: NonNullable<Evidence["email"]>["outcome"]) =>
    persist({ ...evidence, email: { ...evidence.email!, outcome: value } });
  let response: Response;
  try {
    response = await transport("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: config.sender,
        to: [message.to],
        subject: message.subject,
        textContent: message.text,
        attachment: [{ name: message.filename, content: pdfBase64(pdf) }],
        tags: ["seramet-transactional"],
      }),
    });
  } catch {
    await outcome("UNKNOWN");
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  }
  if (response.status === 429) {
    await outcome("RATE_LIMITED");
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_RATE_LIMITED", true);
  }
  if (!response.ok) {
    const uncertain = response.status >= 500 || [408, 409].includes(response.status);
    await outcome(uncertain ? "UNKNOWN" : "REJECTED");
    throw new TransactionalEmailError(
      uncertain
        ? "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED"
        : "TRANSACTIONAL_EMAIL_PROVIDER_REJECTED",
    );
  }
  const result = (await response.json().catch(() => null)) as { messageId?: unknown } | null;
  if (typeof result?.messageId !== "string" || !/^<[^\s<>]{1,250}>$/.test(result.messageId)) {
    await outcome("UNKNOWN");
    throw new TransactionalEmailError("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
  }
  await persist({
    ...evidence,
    email: { ...evidence.email!, outcome: "ACCEPTED" },
    acceptedByProvider: true,
    providerMessageId: result.messageId,
    acceptedAt: new Date().toISOString(),
  });
}
