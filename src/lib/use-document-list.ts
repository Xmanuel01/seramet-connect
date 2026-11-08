import { useCallback, useEffect } from "react";
import { changesRecords } from "@/lib/realtime-relevance";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAppContext } from "@/lib/app-context";
import { isAbort, RequestError, userMessage } from "@/lib/user-facing-error";
import type { BillingRecord, ReceiptRecord } from "@/lib/transaction-engine";

// Invoice and receipt history for one date range, straight from the server, so
// a list can show before the till's full local copy has loaded.

export type DocumentKind = "invoices" | "receipts";
export type InvoiceListStatus = "all" | "unpaid" | "paid" | "pending";
type Row<K extends DocumentKind> = K extends "invoices" ? BillingRecord : ReceiptRecord;

export type DocumentListRequest = {
  tenantId: string;
  /** The signed-in user: what one person may see is never served to the next. */
  userId: string;
  /** Omitted for "all branches". */
  branchId?: string;
  kind: DocumentKind;
  date: string;
  status?: InvoiceListStatus;
  limit?: number;
};

export const documentQueryRoot = "document-list";
/** Pages fetched for one day before the list relies on the till's own copy. */
export const MAX_DOCUMENT_PAGES = 10;
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchDocuments<T>(path: string, signal: AbortSignal) {
  const response = await authenticatedFetch(path, {
    credentials: "same-origin",
    signal,
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    rows?: T[];
    hasMore?: boolean;
    message?: string;
  };
  if (!response.ok || !body.ok || !Array.isArray(body.rows))
    throw new RequestError(response.ok ? 502 : response.status, body.message ?? "");
  return { rows: body.rows, hasMore: body.hasMore === true };
}

export function documentQueryOptions<T>(
  request: DocumentListRequest,
  fetchPage: (
    path: string,
    signal: AbortSignal,
  ) => Promise<{ rows: T[]; hasMore: boolean }> = fetchDocuments,
) {
  const { tenantId, userId, branchId, kind, date, status = "all", limit = 200 } = request;
  return queryOptions({
    queryKey: [documentQueryRoot, tenantId, userId, branchId ?? "ALL", kind, date, status, limit],
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failures, error) => {
      const httpStatus = error instanceof RequestError ? error.httpStatus : undefined;
      return failures < 1 && (httpStatus === undefined || httpStatus >= 500);
    },
    queryFn: async ({ signal }) => {
      // A stalled connection gives up, so the page can say so and offer a retry.
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
      const rows: T[] = [];
      let hasMore = true;
      try {
        // A busy day can run past one page; read on until the day is complete.
        for (let page = 0; hasMore && page < MAX_DOCUMENT_PAGES; page++) {
          const search = new URLSearchParams({
            from: date,
            to: date,
            limit: String(limit),
            offset: String(page * limit),
          });
          if (branchId) search.set("branchId", branchId);
          if (kind === "invoices") search.set("status", status);
          const result = await fetchPage(`/api/seramet/documents/${kind}?${search}`, deadline);
          rows.push(...result.rows);
          hasMore = result.hasMore;
        }
      } catch (error) {
        if (!isAbort(error)) console.error(error);
        throw error;
      }
      return { rows, hasMore };
    },
  });
}

let liveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleDocumentRefresh(queryClient: QueryClient) {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = undefined;
    void queryClient.invalidateQueries({ queryKey: [documentQueryRoot], refetchType: "active" });
  }, 1_000);
}

/**
 * Server rows for one business date, plus the till's own copies of the same
 * records, newest first.
 */
export function mergeDocuments<T extends { id: string; issuedAt?: string }>(
  server: T[] | undefined,
  local: T[],
) {
  if (!server) return local;
  const byId = new Map(server.map((row) => [row.id, row]));
  // The till's copy wins: it may hold changes not yet on the server, or made offline.
  for (const row of local) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
}

/**
 * One business date of invoices or receipts. Disabled when `date` is empty
 * ("all dates"), which only the till's local copy can answer.
 */
export function useDocumentList<K extends DocumentKind>(
  kind: K,
  date: string,
  options: { status?: InvoiceListStatus; enabled?: boolean } = {},
) {
  const { activeTenantId, branchId, currentUser, isAllBranches } = useAppContext();
  const queryClient = useQueryClient();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const query = useQuery({
    ...documentQueryOptions<Row<K>>({
      tenantId: activeTenantId,
      userId: currentUser.id,
      ...(isAllBranches ? {} : { branchId }),
      kind,
      date,
      ...(options.status ? { status: options.status } : {}),
    }),
    enabled: valid && options.enabled !== false,
    // Live events cover the branch this device follows; other branches in an
    // all-branches view are checked on a timer instead.
    refetchInterval: isAllBranches ? 30_000 : false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => scheduleDocumentRefresh(queryClient);
    const live = (event: Event) => {
      if (changesRecords((event as CustomEvent).detail)) refresh();
    };
    window.addEventListener("seramet:realtime", live);
    window.addEventListener("seramet:refresh", refresh);
    return () => {
      window.removeEventListener("seramet:realtime", live);
      window.removeEventListener("seramet:refresh", refresh);
    };
  }, [queryClient]);

  const { refetch } = query;
  return {
    rows: valid ? query.data?.rows : undefined,
    hasMore: query.data?.hasMore ?? false,
    error: query.isError
      ? userMessage(query.error, "Couldn't load this day's documents. Try again.")
      : "",
    refresh: useCallback(() => void refetch(), [refetch]),
  };
}
