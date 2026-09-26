import { authenticateSerametRequest, SerametHttpError, type SerametEnv } from "@/lib/seramet-auth";
import { FinancialLedgerService, type FinanceWindow } from "@/finance/financial-ledger-service";
import { ServerOperationError } from "@/server/errors";

const BASE_PATH = "/api/seramet/finance/reports/";

function validatedDate(input: string | null, fallback: string) {
  const value = input ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SerametHttpError(400, "Report dates must use YYYY-MM-DD");
  }
  return value;
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
    throw new ServerOperationError("DATABASE_UNAVAILABLE", 503, "Authoritative finance database unavailable");
  }
  const service = new FinancialLedgerService(env.SERAMET_DB, actor);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + "01";
  const branchId = url.searchParams.get("branchId")?.trim() || undefined;
  const opts: FinanceWindow = {
    ...(branchId ? { branchId } : {}),
    from: validatedDate(url.searchParams.get("from"), monthStart),
    to: validatedDate(url.searchParams.get("to"), today),
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
      report = await service.ledger({ ...opts, limit, offset, ...(accountId ? { accountId } : {}), ...(accountType ? { accountType } : {}) });
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
