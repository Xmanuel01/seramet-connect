import { useCallback, useEffect } from "react";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAppContext } from "@/lib/app-context";
import { isAbort, RequestError, userMessage } from "@/lib/user-facing-error";
import type { BillingRecord, ReceiptRecord } from "@/lib/transaction-engine";

// Invoice and receipt history for one date range, straight from the server, so
// a list can show before the till's full local copy has loaded.

export type DocumentKind = "invoices" | "receipts";
export type InvoiceListStatus = "all" | "open" | "paid" | "pending";
type Row<K extends DocumentKind> = K extends "invoices" ? BillingRecord : ReceiptRecord;

export type DocumentListRequest = {
  tenantId: string;
  /** Omitted for "all branches". */
  branchId?: string;
  kind: DocumentKind;
  date: string;
  status?: InvoiceListStatus;
  page?: number;
  limit?: number;
};

export const documentQueryRoot = "document-list";

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
  const { tenantId, branchId, kind, date, status = "all", page = 0, limit = 200 } = request;
  return queryOptions({
    queryKey: [documentQueryRoot, tenantId, branchId ?? "ALL", kind, date, status, page, limit],
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failures, error) => {
      const httpStatus = error instanceof RequestError ? error.httpStatus : undefined;
      return failures < 1 && (httpStatus === undefined || httpStatus >= 500);
    },
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({
        from: date,
        to: date,
        limit: String(limit),
        offset: String(page * limit),
      });
      if (branchId) search.set("branchId", branchId);
      if (kind === "invoices") search.set("status", status);
      try {
        return await fetchPage(`/api/seramet/documents/${kind}?${search}`, signal);
      } catch (error) {
        if (!isAbort(error)) console.error(error);
        throw error;
      }
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

/** Server rows for one business date, plus the till's own copies of the same records. */
export function mergeDocuments<T extends { id: string }>(server: T[] | undefined, local: T[]) {
  if (!server) return local;
  const byId = new Map(server.map((row) => [row.id, row]));
  // The till's copy wins: it may hold changes not yet on the server, or made offline.
  for (const row of local) byId.set(row.id, row);
  return [...byId.values()];
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
  const { activeTenantId, branchId, isAllBranches } = useAppContext();
  const queryClient = useQueryClient();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const query = useQuery({
    ...documentQueryOptions<Row<K>>({
      tenantId: activeTenantId,
      ...(isAllBranches ? {} : { branchId }),
      kind,
      date,
      ...(options.status ? { status: options.status } : {}),
    }),
    enabled: valid && options.enabled !== false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => scheduleDocumentRefresh(queryClient);
    window.addEventListener("seramet:realtime", refresh);
    window.addEventListener("seramet:refresh", refresh);
    return () => {
      window.removeEventListener("seramet:realtime", refresh);
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
