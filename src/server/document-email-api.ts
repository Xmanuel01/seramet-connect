import { z } from "zod";
import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
} from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { permissions } from "@/platform/permissions";
import { SerametPrintService } from "@/lib/seramet-print-service";
import { billingDocumentToPrintOrder, receiptRecordToPrintOrder } from "@/lib/print-order-adapter";
import { DatabaseRateLimiter } from "@/server/rate-limit";
import { validateDocumentRecipient } from "@/lib/document-email";
import {
  deliverPdfEmail,
  pdfDigest,
  pdfBase64,
  transactionalEmailConfiguration,
  TransactionalEmailError,
  type PdfEmail,
  documentEmailStatus,
} from "@/server/transactional-email";

export { documentEmailStatus } from "@/server/transactional-email";

const inputSchema = z
  .object({
    documentType: z.enum(["INVOICE", "RECEIPT"]),
    recordId: z.string().min(1).max(128),
    recipient: z.object({ name: z.string().max(120), email: z.string().max(254) }).strict(),
  })
  .strict();
type Payload = {
  actorId: string;
  documentType: "INVOICE" | "RECEIPT";
  recordId: string;
  requestHash: string;
  message: PdfEmail;
  pdf: string;
};

export async function handleDocumentEmailApi(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
) {
  const route = /^\/api\/seramet\/document-emails(?:\/([\w-]+))?$/.exec(
    new URL(request.url).pathname,
  );
  if (!route) return null;
  if (!env.SERAMET_DB) throw new SerametHttpError(503, "Document delivery is unavailable");
  const db = env.SERAMET_DB;
  const actor = await authenticateSerametRequest(request, env);
  if (request.method === "GET" && route[1]) {
    const row = await db
      .prepare(
        "SELECT branch_id,payload_json,status,result_json,last_error FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type='CUSTOMER_DOCUMENT_EMAIL'",
      )
      .bind(actor.tenantId, route[1])
      .first<{
        branch_id: string;
        payload_json: string;
        status: string;
        result_json: string;
        last_error: string | null;
      }>();
    if (!row) throw new SerametHttpError(404, "Email request not found");
    authorizeBranchRead(actor, actor.tenantId, row.branch_id);
    const payload: Payload = JSON.parse(row.payload_json);
    if (
      payload.actorId !== actor.id ||
      !actor.permissions.includes(
        payload.documentType === "INVOICE" ? permissions.invoicesView : permissions.receiptsView,
      )
    )
      throw new SerametHttpError(403, "Document delivery permission required");
    return Response.json(
      { jobId: route[1], status: documentEmailStatus(row) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (request.method !== "POST" || route[1])
    throw new SerametHttpError(405, "Unsupported email operation");
  if (Number(request.headers.get("content-length") ?? 0) > 4096)
    throw new SerametHttpError(413, "Email request too large");
  let raw = "",
    size = 0;
  const reader = request.body?.getReader(),
    decoder = new TextDecoder();
  if (reader)
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        throw new SerametHttpError(413, "Email request too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
  raw += decoder.decode();
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new SerametHttpError(400, "Invalid email request");
  }
  const parsed = inputSchema.safeParse(decoded);
  if (!parsed.success) throw new SerametHttpError(400, "Invalid email request");
  const input = parsed.data;
  let recipient;
  try {
    recipient = validateDocumentRecipient(input.recipient);
  } catch {
    throw new SerametHttpError(400, "Enter a valid recipient name and email");
  }
  const permission =
    input.documentType === "INVOICE" ? permissions.invoicesView : permissions.receiptsView;
  if (!actor.permissions.includes(permission))
    throw new SerametHttpError(403, "Document delivery permission required");
  const key = request.headers.get("Idempotency-Key") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(key))
    throw new SerametHttpError(400, "A valid idempotency key is required");
  const idempotency = `document-email:${actor.id}:${key}`;
  const hash = await pdfDigest(
    new TextEncoder().encode(
      JSON.stringify([actor.id, actor.branchId, input.documentType, input.recordId, recipient]),
    ),
  );
  const existing = async () =>
    db
      .prepare(
        "SELECT id,branch_id,payload_json,status,result_json,last_error FROM worker_jobs WHERE tenant_id=? AND idempotency_key=?",
      )
      .bind(actor.tenantId, idempotency)
      .first<{
        id: string;
        branch_id: string;
        payload_json: string;
        status: string;
        result_json: string;
        last_error: string | null;
      }>();
  const respond = (row: NonNullable<Awaited<ReturnType<typeof existing>>>) => {
    if (row.branch_id !== actor.branchId || JSON.parse(row.payload_json).requestHash !== hash)
      throw new SerametHttpError(
        409,
        "The email request key was already used for different details",
      );
    return Response.json(
      { jobId: row.id, status: documentEmailStatus(row) },
      { status: 202, headers: { "Cache-Control": "private, no-store" } },
    );
  };
  const prior = await existing();
  if (prior) return respond(prior);
  try {
    transactionalEmailConfiguration(env, actor.tenantId);
  } catch {
    throw new SerametHttpError(503, "Brevo document email is not configured for this restaurant");
  }
  await new DatabaseRateLimiter(db).consume(`${actor.tenantId}:${actor.id}`, {
    bucket: "document-email",
    limit: 10,
    windowSeconds: 300,
  });
  const state = await repository.loadState(actor.tenantId);
  const record =
    input.documentType === "INVOICE"
      ? state.bills.find(
          (b) =>
            b.id === input.recordId &&
            b.tenantId === actor.tenantId &&
            b.branchId === actor.branchId,
        )
      : state.receipts.find(
          (r) =>
            r.id === input.recordId &&
            r.tenantId === actor.tenantId &&
            r.branchId === actor.branchId,
        );
  if (!record) throw new SerametHttpError(404, "Document not found in the selected branch");
  authorizeBranchRead(actor, actor.tenantId, actor.branchId);
  const source =
    input.documentType === "INVOICE"
      ? billingDocumentToPrintOrder(
          state.bills.find((b) => b.id === record.id)!,
          state,
          "INVOICE",
        )
      : receiptRecordToPrintOrder(
          state.receipts.find((r) => r.id === record.id)!,
          state,
        );
  if (!source) throw new SerametHttpError(409, "The authoritative document is not available");
  const job = SerametPrintService.createDocumentJob(
    SerametPrintService.getBranchHardwareProfile(record.branch),
    source,
    input.documentType,
  );
  const { renderCustomerDocumentPdf } = await import("@/server/customer-document-pdf");
  const pdf = await renderCustomerDocumentPdf(job.content, record.issuedAt);
  if (pdf.length > 1024 * 1024)
    throw new SerametHttpError(413, "The document is too large for email");
  const jobId = crypto.randomUUID(),
    stamp = new Date().toISOString();
  const payload: Payload = {
    actorId: actor.id,
    documentType: input.documentType,
    recordId: record.id,
    requestHash: hash,
    pdf: pdfBase64(pdf),
    message: {
      to: recipient,
      subject: `${input.documentType === "INVOICE" ? "Invoice" : "Receipt"} ${record.id}`,
      text: `Hello ${recipient.name},\n\nYour ${input.documentType.toLowerCase()} ${record.id} is attached as a PDF.\n\nThank you.`,
      filename: `${input.documentType.toLowerCase()}-${record.id.replace(/[^\w.-]/g, "-")}.pdf`,
      sha256: await pdfDigest(pdf),
    },
  };
  await db.batch([
    db
      .prepare(
        `INSERT INTO worker_jobs (tenant_id,id,branch_id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,max_attempts,scheduled_at,created_at,updated_at)
      VALUES (?,?,?,'CUSTOMER_DOCUMENT_EMAIL',?,?,?,'PENDING',0,8,?,?,?) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
      )
      .bind(
        actor.tenantId,
        jobId,
        actor.branchId,
        JSON.stringify(payload),
        idempotency,
        jobId,
        stamp,
        stamp,
        stamp,
      ),
    db
      .prepare(
        `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at) SELECT ?,?,?,?,'DOCUMENT_EMAIL_QUEUED',?,?,'Operator requested PDF email',?,'{}',? WHERE EXISTS (SELECT 1 FROM worker_jobs WHERE tenant_id=? AND id=?)`,
      )
      .bind(
        actor.tenantId,
        jobId,
        actor.branchId,
        actor.id,
        input.documentType,
        record.id,
        jobId,
        stamp,
        actor.tenantId,
        jobId,
      ),
  ]);
  const saved = await existing();
  if (!saved) throw new SerametHttpError(503, "Email request could not be persisted");
  if (saved.id === jobId) {
    // The existing scheduler recovers a persisted obligation if queue dispatch fails.
    await env.SERAMET_WORK_QUEUE?.send({
      kind: "worker-job",
      tenantId: actor.tenantId,
      jobId,
      correlationId: jobId,
    }).catch(() => undefined);
  }
  return respond(saved);
}

export async function deliverCustomerDocumentEmail(
  env: SerametEnv,
  tenantId: string,
  jobId: string,
  transport: typeof fetch = fetch,
) {
  const db = env.SERAMET_DB;
  if (!db) throw new TransactionalEmailError("DOCUMENT_EMAIL_DATABASE_REQUIRED");
  const job = await db
    .prepare(
      "SELECT branch_id,payload_json FROM worker_jobs WHERE tenant_id=? AND id=? AND job_type='CUSTOMER_DOCUMENT_EMAIL' AND status='RUNNING'",
    )
    .bind(tenantId, jobId)
    .first<{ branch_id: string; payload_json: string }>();
  if (!job) throw new TransactionalEmailError("DOCUMENT_EMAIL_AUTHORIZED_JOB_REQUIRED");
  const payload: Payload = JSON.parse(job.payload_json);
  const permission =
    payload.documentType === "INVOICE" ? permissions.invoicesView : permissions.receiptsView;
  const allowed = await db
    .prepare(
      `SELECT u.id FROM users u JOIN user_branches b ON b.tenant_id=u.tenant_id AND b.user_id=u.id WHERE u.tenant_id=? AND u.id=? AND u.active=1 AND b.branch_id=? AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.tenant_id=ur.tenant_id AND r.id=ur.role_id AND r.active=1 JOIN role_permissions rp ON rp.tenant_id=r.tenant_id AND rp.role_id=r.id WHERE ur.tenant_id=u.tenant_id AND ur.user_id=u.id AND rp.permission_code=?)`,
    )
    .bind(tenantId, payload.actorId, job.branch_id, permission)
    .first();
  if (!allowed) throw new TransactionalEmailError("DOCUMENT_EMAIL_OPERATOR_NOT_AUTHORIZED");
  const pdf = Uint8Array.from(atob(payload.pdf), (c) => c.charCodeAt(0));
  await deliverPdfEmail(env, tenantId, jobId, payload.message, pdf, transport);
  await db
    .prepare(
      `INSERT INTO audit_events (tenant_id,id,branch_id,actor_id,action,entity_type,entity_id,reason,correlation_id,metadata_json,created_at)
    VALUES (?,?,?,'system:document-email','DOCUMENT_EMAIL_PROVIDER_ACCEPTED',?,?,'Provider acceptance is not inbox delivery',?,'{}',?) ON CONFLICT(tenant_id,id) DO NOTHING`,
    )
    .bind(
      tenantId,
      `accepted:${jobId}`,
      job.branch_id,
      payload.documentType,
      payload.recordId,
      jobId,
      new Date().toISOString(),
    )
    .run();
}
