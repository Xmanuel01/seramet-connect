import {
  authenticateSerametRequest,
  authorizeBranchRead,
  SerametHttpError,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { ServerOperationError } from "@/server/errors";
import type { D1Database } from "@/server/database/d1";
import type { BillingRecord, ReceiptRecord } from "@/lib/transaction-engine";

// Invoice and receipt history by date, a page at a time, read from the
// relational tables the transaction repository keeps beside its snapshot.
// Back-office lists use this instead of the whole tenant history.

const BASE_PATH = "/api/seramet/documents/";
export const INVOICE_STATUS_FILTERS = ["all", "unpaid", "paid", "pending"] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export type DocumentWindow = {
  from: string;
  to: string;
  branchId?: string;
  limit?: number;
  offset?: number;
};

export type DocumentPage<T> = { rows: T[]; hasMore: boolean; offset: number; limit: number };

function isoDate(value: string, label: string) {
  // Round-trip the date so 2026-02-31 is refused rather than read as 3 March.
  const parsed = new Date(value + "T00:00:00Z");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new SerametHttpError(400, `Choose a valid ${label} date.`);
  return value;
}

type DocumentRow = { payload_json: string; business_date: string };

function parsePayload<T>(json: string): T | null {
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

export class DocumentListService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  private require(permission: string) {
    if (!this.actor.permissions.includes(permission))
      throw new SerametHttpError(403, "You don't have access to these documents.");
  }

  private async window(input: DocumentWindow) {
    const from = isoDate(input.from, "start");
    const to = isoDate(input.to, "end");
    const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000;
    if (days < 0) throw new SerametHttpError(400, "Choose a start date on or before the end date.");
    if (days > 366) throw new SerametHttpError(400, "Choose a period of a year or less.");
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
      throw new SerametHttpError(400, "Invalid page size.");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000)
      throw new SerametHttpError(400, "Invalid page.");
    let branchIds: string[];
    if (input.branchId) {
      authorizeBranchRead(this.actor, this.actor.tenantId, input.branchId);
      branchIds = [input.branchId];
    } else if (this.actor.branchScope.type === "BRANCH") {
      if (!this.actor.branchId) throw new SerametHttpError(403, "Choose a branch first.");
      branchIds = [this.actor.branchId];
    } else {
      if (!this.actor.permissions.includes(permissions.tenantScopeAllBranches))
        throw new SerametHttpError(403, "You don't have access to all branches.");
      // Closed branches keep their history, as they do in the till's own copy.
      const result = await this.db
        .prepare("SELECT id FROM branches WHERE tenant_id=? ORDER BY id")
        .bind(this.actor.tenantId)
        .all<{ id: string }>();
      branchIds = (result.results ?? []).map((branch) => branch.id);
    }
    if (!branchIds.length) throw new SerametHttpError(409, "No branch is set up yet.");
    return {
      from,
      to,
      limit,
      offset,
      branchIds,
      branches: `branch_id IN (${branchIds.map(() => "?").join(",")})`,
    };
  }

  async invoices(
    input: DocumentWindow & { status?: InvoiceStatusFilter },
  ): Promise<DocumentPage<BillingRecord>> {
    this.require(permissions.invoicesView);
    const scope = await this.window(input);
    const status = input.status ?? "all";
    if (!INVOICE_STATUS_FILTERS.includes(status))
      throw new SerametHttpError(400, "Unsupported invoice filter.");
    // Same meaning as the Invoices page filters; merged and split bills are replaced by others.
    const statusCondition = {
      all: "",
      unpaid: "AND paid_minor<total_minor",
      paid: "AND paid_minor>=total_minor",
      pending: "AND (status='PENDING' OR paid_minor=0)",
    }[status];
    const result = await this.db
      .prepare(
        [
          "SELECT payload_json, business_date FROM invoices WHERE tenant_id=? AND business_date BETWEEN ? AND ?",
          "AND",
          scope.branches,
          "AND status NOT IN ('MERGED','SPLIT')",
          statusCondition,
          "ORDER BY business_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?",
        ].join(" "),
      )
      .bind(
        this.actor.tenantId,
        scope.from,
        scope.to,
        ...scope.branchIds,
        scope.limit + 1,
        scope.offset,
      )
      .all<DocumentRow>();
    return this.page(result.results ?? [], scope);
  }

  async receipts(input: DocumentWindow): Promise<DocumentPage<ReceiptRecord>> {
    this.require(permissions.receiptsView);
    const scope = await this.window(input);
    const result = await this.db
      .prepare(
        [
          "SELECT payload_json, business_date FROM receipts WHERE tenant_id=? AND business_date BETWEEN ? AND ?",
          "AND",
          scope.branches,
          "ORDER BY business_date DESC, created_at DESC, id DESC LIMIT ? OFFSET ?",
        ].join(" "),
      )
      .bind(
        this.actor.tenantId,
        scope.from,
        scope.to,
        ...scope.branchIds,
        scope.limit + 1,
        scope.offset,
      )
      .all<DocumentRow>();
    return this.page(result.results ?? [], scope);
  }

  private page<T extends { businessDate?: string }>(
    rows: DocumentRow[],
    scope: { limit: number; offset: number },
  ): DocumentPage<T> {
    return {
      rows: rows.slice(0, scope.limit).flatMap((row): T[] => {
        const payload = parsePayload<T>(row.payload_json);
        // Older payloads lack the business date; the column holds the
        // cutoff-adjusted day the record was selected by.
        return payload
          ? [{ ...payload, businessDate: payload.businessDate || row.business_date }]
          : [];
      }),
      hasMore: rows.length > scope.limit,
      offset: scope.offset,
      limit: scope.limit,
    };
  }
}

export async function handleDocumentsApi(
  request: Request,
  env: SerametEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(BASE_PATH)) return null;
  if (request.method !== "GET") throw new SerametHttpError(405, "Documents are read-only here.");
  const actor = await authenticateSerametRequest(request, env);
  if (!env.SERAMET_DB)
    throw new ServerOperationError("DATABASE_UNAVAILABLE", 503, "Document database unavailable");
  const service = new DocumentListService(env.SERAMET_DB, actor);
  const param = (name: string) => url.searchParams.get(name)?.trim() || undefined;
  const branchId = param("branchId");
  const window: DocumentWindow = {
    from: param("from") ?? "",
    to: param("to") ?? "",
    ...(branchId ? { branchId } : {}),
    limit: Number(param("limit") ?? "100"),
    offset: Number(param("offset") ?? "0"),
  };
  let page: DocumentPage<unknown>;
  switch (url.pathname.slice(BASE_PATH.length)) {
    case "invoices":
      page = await service.invoices({
        ...window,
        status: (param("status") ?? "all") as InvoiceStatusFilter,
      });
      break;
    case "receipts":
      page = await service.receipts(window);
      break;
    default:
      throw new SerametHttpError(404, "Unknown document list");
  }
  return new Response(JSON.stringify({ ok: true, ...page }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
