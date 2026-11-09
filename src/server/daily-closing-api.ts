import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
} from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { businessDateForTimestamp } from "@/lib/business-date";
import { documentEmailStatus, transactionalEmailConfiguration } from "@/server/transactional-email";

export async function handleDailyClosingApi(
  request: Request,
  env: SerametEnv,
  repository: TransactionRepository,
) {
  const notifications = /^\/api\/seramet\/daily-closing\/notifications\/([^/]+)$/.exec(
    new URL(request.url).pathname,
  );
  if (notifications) {
    if (request.method !== "GET") throw new SerametHttpError(405, "Read-only notification status");
    const actor = await authenticateSerametRequest(request, env);
    if (!actor.permissions.includes(permissions.reconciliationView))
      throw new SerametHttpError(403, "Reconciliation view permission is required");
    const state = await repository.loadState(actor.tenantId);
    const day = state.paymentOperations?.dayCloses.find(
      (d) => d.id === decodeURIComponent(notifications[1]!) && d.tenantId === actor.tenantId,
    );
    if (!day) throw new SerametHttpError(404, "Closing report was not found");
    authorizeBranchRead(actor, actor.tenantId, day.branchId);
    const revision = Number(
      new URL(request.url).searchParams.get("revision") ?? day.snapshot?.revision,
    );
    if (!Number.isSafeInteger(revision) || !day.snapshots.some((s) => s.revision === revision))
      throw new SerametHttpError(404, "Closing revision was not found");
    if (!env.SERAMET_DB) throw new SerametHttpError(503, "Durable email status is unavailable");
    const jobs = await env.SERAMET_DB.prepare(
      "SELECT status,attempt_count,payload_json,result_json,last_error FROM worker_jobs WHERE tenant_id=? AND branch_id=? AND job_type='DAILY_CLOSING_EMAIL' AND idempotency_key LIKE ? LIMIT 20",
    )
      .bind(actor.tenantId, day.branchId, `daily-closing:${day.id}:r${revision}:%`)
      .all<{
        status: string;
        attempt_count: number;
        payload_json: string;
        result_json: string;
        last_error: string | null;
      }>();
    const deliveries = (jobs.results ?? []).flatMap((job) => {
      const payload = JSON.parse(job.payload_json) as {
        dayCloseId: string;
        revision: number;
        recipientUserId: string;
      };
      if (payload.dayCloseId !== day.id || payload.revision !== revision) return [];
      return [
        {
          revision: payload.revision,
          recipientUserId: payload.recipientUserId,
          attempts: job.attempt_count,
          status: documentEmailStatus(job),
        },
      ];
    });
    return Response.json(
      { closureStatus: day.status, reportAvailable: !!day.snapshot?.dailyReport, deliveries },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (new URL(request.url).pathname === "/api/seramet/daily-closing/summary-emails/send") {
    if (request.method !== "POST") throw new SerametHttpError(405, "Send uses POST");
    const actor = await authenticateSerametRequest(request, env);
    if (!actor.permissions.includes(permissions.reconciliationView))
      throw new SerametHttpError(403, "Report access is required");
    authorizeBranchRead(actor, actor.tenantId, actor.branchId);
    if (!env.SERAMET_DB) throw new SerametHttpError(503, "Email is unavailable right now");
    try {
      transactionalEmailConfiguration(env, actor.tenantId);
    } catch {
      throw new SerametHttpError(503, "Email isn't set up yet. Contact Seramet support.");
    }
    const body = (await request.json().catch(() => null)) as {
      recipientUserIds?: unknown;
      day?: unknown;
    } | null;
    const ids = Array.isArray(body?.recipientUserIds)
      ? body.recipientUserIds.filter((id): id is string => typeof id === "string")
      : [];
    const day = body?.day === "yesterday" ? "yesterday" : "today";
    const businessDate =
      typeof (body as { businessDate?: unknown } | null)?.businessDate === "string"
        ? (body as { businessDate: string }).businessDate
        : undefined;
    const { queueManualDailySummary } = await import("@/server/daily-summary-email");
    try {
      const result = await queueManualDailySummary(env, {
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        requestedBy: actor.id,
        recipientUserIds: ids,
        day,
        businessDate,
      });
      return Response.json({ ok: true, ...result });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "DAILY_SUMMARY_DATE_INVALID")
        throw new SerametHttpError(400, "That day can't be sent.");
      if (code === "DAILY_SUMMARY_RECIPIENTS_INVALID")
        throw new SerametHttpError(400, "Choose who should get the report.");
      if (code === "DAILY_SUMMARY_RECIPIENT_NOT_AUTHORIZED")
        throw new SerametHttpError(
          400,
          "Someone you chose has no email or no report access at this branch.",
        );
      throw error;
    }
  }
  if (new URL(request.url).pathname === "/api/seramet/daily-closing/summary-emails") {
    if (request.method !== "GET") throw new SerametHttpError(405, "Read-only email status");
    const actor = await authenticateSerametRequest(request, env);
    if (!actor.permissions.includes(permissions.reconciliationView))
      throw new SerametHttpError(403, "Reconciliation view permission is required");
    if (!env.SERAMET_DB) throw new SerametHttpError(503, "Durable email status is unavailable");
    let emailConfigured = true;
    try {
      transactionalEmailConfiguration(env, actor.tenantId);
    } catch {
      emailConfigured = false;
    }
    const jobs = await env.SERAMET_DB.prepare(
      "SELECT status,payload_json,result_json,last_error,updated_at FROM worker_jobs WHERE tenant_id=? AND branch_id=? AND job_type='DAILY_SUMMARY_EMAIL' ORDER BY created_at DESC LIMIT 10",
    )
      .bind(actor.tenantId, actor.branchId)
      .all<{
        status: string;
        payload_json: string;
        result_json: string;
        last_error: string | null;
        updated_at: string;
      }>();
    const deliveries = (jobs.results ?? []).map((job) => {
      const payload = JSON.parse(job.payload_json) as {
        businessDate: string;
        recipientUserId: string;
      };
      const evidence = JSON.parse(job.result_json || "{}") as { acceptedByProvider?: boolean };
      return {
        businessDate: payload.businessDate,
        recipientUserId: payload.recipientUserId,
        updatedAt: job.updated_at,
        // A finished job with nothing sent was skipped: the day was closed, or the person
        // was taken off the list after the email was queued.
        status:
          job.status === "SUCCEEDED" && !evidence.acceptedByProvider
            ? "SKIPPED"
            : documentEmailStatus({ ...job, result_json: job.result_json || "{}" }),
      };
    });
    return Response.json(
      { emailConfigured, deliveries },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (new URL(request.url).pathname === "/api/seramet/daily-closing/context") {
    if (request.method !== "GET") throw new SerametHttpError(405, "Read-only closing context");
    const actor = await authenticateSerametRequest(request, env);
    if (
      !actor.permissions.includes(permissions.reconciliationView) &&
      !actor.permissions.includes(permissions.cashClose)
    )
      throw new SerametHttpError(403, "Closing review permission is required");
    const configuration = getConfigurationRepository();
    const branch = configuration.getBranch(actor.tenantId, actor.branchId);
    const timezone = branch.timezone ?? configuration.getTenant(actor.tenantId).timezone;
    const cutoffMinutes = Number(branch.metadata["businessDayCutoffMinutes"] ?? 0);
    return Response.json(
      {
        branchId: branch.id,
        businessDate: businessDateForTimestamp(new Date(), timezone, cutoffMinutes),
        timezone,
        cutoffMinutes,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const route = /^\/api\/seramet\/daily-closing\/reports\/([^/]+)\/(\d+)\.pdf$/.exec(
    new URL(request.url).pathname,
  );
  if (!route) return null;
  if (request.method !== "GET") throw new SerametHttpError(405, "Read-only report route");
  const actor = await authenticateSerametRequest(request, env);
  if (!actor.permissions.includes(permissions.reconciliationView))
    throw new SerametHttpError(403, "Reconciliation view permission is required");
  const state = await repository.loadState(actor.tenantId);
  const day = state.paymentOperations?.dayCloses.find(
    (d) => d.id === decodeURIComponent(route[1]!) && d.tenantId === actor.tenantId,
  );
  if (!day) throw new SerametHttpError(404, "Closing report was not found");
  authorizeBranchRead(actor, actor.tenantId, day.branchId);
  const snapshot = day.snapshots.find((s) => s.revision === Number(route[2]));
  if (!snapshot?.dailyReport) throw new SerametHttpError(404, "Report revision was not found");
  const { renderDailyClosingPdf } = await import("@/server/daily-closing-report");
  const pdf = await renderDailyClosingPdf(snapshot);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="daily-closing-${snapshot.businessDate}-r${snapshot.revision}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
