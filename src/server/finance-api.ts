import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { FinancialLedgerService, type FinanceWindow } from "@/finance/financial-ledger-service";
import { ServerOperationError } from "@/server/errors";
import { authoritativeBusinessDate } from "@/server/business-date";
import type { D1Database } from "@/server/database/d1";

const BASE_PATH = "/api/seramet/finance/reports/";

function validatedDate(input: string | null, fallback: string) {
  const value = input ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SerametHttpError(400, "Report dates must use YYYY-MM-DD");
  }
  return value;
}

export async function financeDefaultWindow(
  db: D1Database,
  actor: ServerActor,
  requestedBranchId?: string,
  now = new Date(),
) {
  const effectiveBranchId =
    requestedBranchId ?? (actor.branchScope.type === "BRANCH" ? actor.branchId : undefined);
  let contexts: Array<{ timezone: string; business_day_cutoff_minutes: number }>;
  if (effectiveBranchId) {
    authorizeBranchRead(actor, actor.tenantId, effectiveBranchId);
    const branch = await db
      .prepare(
        `SELECT timezone,business_day_cutoff_minutes FROM branches
         WHERE tenant_id=? AND id=? AND active=1`,
      )
      .bind(actor.tenantId, effectiveBranchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    if (!branch) throw new SerametHttpError(404, "Branch was not found");
    contexts = [branch];
  } else {
    const result = await db
      .prepare(
        `SELECT DISTINCT timezone,business_day_cutoff_minutes FROM branches
         WHERE tenant_id=? AND active=1`,
      )
      .bind(actor.tenantId)
      .all<{ timezone: string; business_day_cutoff_minutes: number }>();
    contexts = result.results ?? [];
    if (contexts.length === 0) throw new SerametHttpError(404, "No active branch was found");
    if (contexts.length > 1) {
      throw new SerametHttpError(
        400,
        "from and to are required when branches use different accounting calendars",
      );
    }
  }
  const context = contexts[0]!;
  const businessDate = authoritativeBusinessDate({
    occurredAt: now.toISOString(),
    timezone: context.timezone,
    cutoffMinutes: Number(context.business_day_cutoff_minutes),
  });
  return { from: businessDate.slice(0, 8) + "01", to: businessDate };
}

export async function handleFinanceApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE_PATH)) return null;
  if (request.method !== "GET") throw new SerametHttpError(405, "Finance reporting is read-only");
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      "Authoritative finance database unavailable",
    );
  }
  const service = new FinancialLedgerService(env.SERAMET_DB, actor);
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  const requestedFrom = url.searchParams.get("from");
  const requestedTo = url.searchParams.get("to");
  const defaults =
    requestedFrom && requestedTo
      ? { from: requestedFrom, to: requestedTo }
      : await financeDefaultWindow(env.SERAMET_DB, actor, branchId);
  const opts: FinanceWindow = {
    ...(branchId ? { branchId } : {}),
    from: validatedDate(requestedFrom, defaults.from),
    to: validatedDate(requestedTo, defaults.to),
  };
  let report: unknown;
  switch (url.pathname.slice(BASE_PATH.length)) {
    case "statement":
      report = await service.statement(opts);
      break;
    case "ledger": {
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const accountId = url.searchParams.get("accountId")?.trim() || undefined;
      const accountType = url.searchParams.get("accountType")?.trim() || undefined;
      report = await service.ledger({
        ...opts,
        limit,
        offset,
        ...(accountId ? { accountId } : {}),
        ...(accountType ? { accountType } : {}),
      });
      break;
    }
    case "receivables":
      report = await service.receivables(opts);
      break;
    case "payables":
      report = await service.payables(opts);
      break;
    default:
      return null;
  }
  return new Response(JSON.stringify({ ok: true, report }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
