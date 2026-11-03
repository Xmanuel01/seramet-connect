import { useCallback, useEffect, useState } from "react";
import { type QueryClient, queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { RequestError, isAbort, userMessage } from "@/lib/user-facing-error";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { scopedFinancePeriod } from "@/finance/finance-period-state";

export type FinancialIssue = { code: string; count: number; detail: string };
export type FinancialAccountRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  openingDebitMinor: number;
  openingCreditMinor: number;
  periodDebitMinor: number;
  periodCreditMinor: number;
  debitMinor: number;
  creditMinor: number;
  closingSignedMinor: number;
};
export type FinanceStatement = {
  scope: { from: string; to: string; branchIds: string[]; currency: string };
  quality: "INCOMPLETE" | "RECONCILED";
  issues: FinancialIssue[];
  lines: FinancialAccountRow[];
  trial: { periodDebitMinor: number; periodCreditMinor: number; balanced: boolean };
  balanceSheet: {
    assetsMinor: number;
    liabilitiesMinor: number;
    equityMinor: number;
    unclosedEarningsMinor: number;
    differenceMinor: number;
  };
  incomeStatement: { incomeMinor: number; expenseMinor: number; netResultMinor: number };
  cashMovement: { openingMinor: number; periodMinor: number } | null;
};
export type LedgerLine = {
  voucher_id: string;
  business_date: string;
  source_type: string;
  source_id: string;
  description: string;
  branch_id: string;
  line_number: number;
  account_id: string;
  account_code: string;
  account_name: string;
  currency: string;
  debit_minor: number;
  credit_minor: number;
  account_type: string;
};
export type FinanceLedger = {
  scope: FinanceStatement["scope"];
  rows: LedgerLine[];
  hasMore: boolean;
  offset: number;
  limit: number;
};
export type ReceivableReport = {
  currency: string;
  rows: Array<{
    id: string;
    branch_id: string;
    invoice_number: string;
    status: string;
    business_date: string;
    currency: string;
    total_minor: number;
    paid_minor: number;
  }>;
  truncated: boolean;
  note: string;
};
export type PayableReport = {
  currency: string;
  rows: Array<{
    id: string;
    branch_id: string;
    invoice_number: string;
    invoice_date: string;
    due_date: string | null;
    currency: string;
    total_minor: number;
    status: string;
    journal_entry_id: string | null;
    supplier_name: string;
  }>;
  truncated: boolean;
  allocationVerified: boolean;
  note: string;
};

export function useFinancePeriod() {
  const { activeTenantId, branchId, platformState } = useAppContext();
  const branch = platformState.branches.find(
    (item) => item.tenantId === activeTenantId && item.id === branchId,
  );
  const zone =
    branch?.timezone ??
    platformState.tenants.find((item) => item.id === activeTenantId)?.timezone ??
    "UTC";
  const cutoff = Number(branch?.metadata?.["businessDayCutoffMinutes"] ?? 240);
  // Keep user-edited dates for the current scope. When the user changes tenant,
  // branch, timezone, or business-day cutoff, do not reuse another branch's period.
  const scopeKey = [activeTenantId, branchId, zone, cutoff].join(":");
  const [saved, setSaved] = useState(() =>
    scopedFinancePeriod(null, scopeKey, new Date(), zone, cutoff),
  );
  const dates = scopedFinancePeriod(saved, scopeKey, new Date(), zone, cutoff);
  const update = (field: "from" | "to", value: string) =>
    setSaved((previous) => ({
      ...scopedFinancePeriod(previous, scopeKey, new Date(), zone, cutoff),
      [field]: value,
    }));
  return {
    from: dates.from,
    to: dates.to,
    setFrom: (from: string) => update("from", from),
    setTo: (to: string) => update("to", to),
  };
}

export type FinanceReportKind = "statement" | "ledger" | "receivables" | "payables";

// Till commands that never move money. Every other command, and any event this
// list does not know, refreshes the figures: a needless background refresh is
// cheap, stale accounts are not.
const NON_FINANCIAL_COMMANDS = new Set([
  "addRider",
  "assignDeliveryRider",
  "claimKitchenPrintObligation",
  "claimKitchenPrintObligations",
  "recallProductionStation",
  "requestKitchenReprint",
  "reviewKitchenPrintObligation",
  "setDeliveryStatus",
  "setProductionStationStatus",
  "settleKitchenPrintObligation",
  "upsertOrderDraft",
]);
const FINANCIAL_JOBS = /CLOSING|LEDGER|JOURNAL|POST|SETTLE|PAYMENT|BANK|RECONCIL/;

/** Whether a live event can change accounting figures. */
export function affectsFinance(event: unknown): boolean {
  if (!event || typeof event !== "object") return true;
  const { topic, eventType } = event as { topic?: unknown; eventType?: unknown };
  const type = typeof eventType === "string" ? eventType : "";
  if (topic === "transactions") return !NON_FINANCIAL_COMMANDS.has(type);
  if (topic === "workers") return FINANCIAL_JOBS.test(type);
  return true;
}

export const financeQueryRoot = "finance-report";

/** Why a period can't be reported on, in words, or null when it can. */
export function financePeriodProblem(from: string, to: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!date.test(from) || !date.test(to)) return "Choose a start and end date.";
  if (from > to) return "Choose a start date on or before the end date.";
  return null;
}
// Bursts of events (a busy service) become one refresh shortly after the last.
const LIVE_REFRESH_DELAY_MS = 1_000;
let liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Refreshes on-screen finance reports once, shortly after the last of a burst of calls. */
const listening = new WeakSet<QueryClient>();

/**
 * Subscribes once per app to live events. It stays subscribed after finance
 * pages close: invalidation marks every cached report stale (refetching only
 * those on screen), so a report reopened later never shows figures from
 * before an event it missed.
 */
export function listenForFinanceEvents(queryClient: QueryClient) {
  if (typeof window === "undefined" || listening.has(queryClient)) return;
  listening.add(queryClient);
  window.addEventListener("seramet:realtime", (event) => {
    if (affectsFinance((event as CustomEvent).detail)) scheduleFinanceRefresh(queryClient);
  });
  window.addEventListener("seramet:refresh", () => scheduleFinanceRefresh(queryClient));
}

export function scheduleFinanceRefresh(queryClient: QueryClient) {
  if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = undefined;
    // Only reports on screen refetch now; the rest refetch when next opened.
    void queryClient.invalidateQueries({ queryKey: [financeQueryRoot], refetchType: "active" });
  }, LIVE_REFRESH_DELAY_MS);
}

/** How long a report may take before the page offers to try again. */
const REPORT_TIMEOUT_MS = 20_000;

/** Cancels when the page moves on, or when the report takes too long. */
export function withDeadline(signal: AbortSignal, ms = REPORT_TIMEOUT_MS) {
  return typeof AbortSignal.any === "function" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.any([signal, AbortSignal.timeout(ms)])
    : signal;
}

async function fetchFinanceReport<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await authenticatedFetch(path, {
    credentials: "same-origin",
    signal: withDeadline(signal),
    headers: { Accept: "application/json" },
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    report?: T;
    message?: string;
  };
  if (!response.ok || !body.ok || !body.report)
    throw new RequestError(response.ok ? 502 : response.status, body.message ?? "");
  return body.report;
}

export type FinanceReportRequest = {
  tenantId: string;
  /** Omitted for "all branches". */
  branchId?: string;
  kind: FinanceReportKind;
  from: string;
  to: string;
} & FinanceLedgerFilters;

/** Ledger paging and filters; ignored by the other reports. */
export type FinanceLedgerFilters = {
  page?: number;
  limit?: number;
  accountType?: string;
  accountId?: string;
  /** "SALES" for the daily sales journal. */
  source?: "SALES";
};

/** How a finance report is cached, shared, retried and fetched. */
export function financeQueryOptions<T>(
  request: FinanceReportRequest,
  fetchReport: (path: string, signal: AbortSignal) => Promise<T> = fetchFinanceReport,
) {
  const {
    tenantId,
    branchId,
    kind,
    from,
    to,
    page = 0,
    limit = 100,
    accountType = "",
    accountId = "",
    source = "",
  } = request;
  const ledger = kind === "ledger";
  return queryOptions({
    // Pages asking for the same report share one request and one cached copy.
    queryKey: [
      financeQueryRoot,
      tenantId,
      branchId ?? "ALL",
      kind,
      from,
      to,
      ...(ledger ? [page, limit, accountType, accountId, source] : []),
    ],
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Retry once for network and server faults; a refusal or a bad date range won't change.
    retry: (failures, error) => {
      const status = error instanceof RequestError ? error.httpStatus : undefined;
      return failures < 1 && (status === undefined || status >= 500);
    },
    queryFn: async ({ signal }) => {
      const search = new URLSearchParams({ from, to });
      if (branchId) search.set("branchId", branchId);
      if (ledger) {
        search.set("limit", String(limit));
        search.set("offset", String(page * limit));
        if (accountType) search.set("accountType", accountType);
        if (accountId) search.set("accountId", accountId);
        if (source) search.set("source", source);
      }
      try {
        return await fetchReport(`/api/seramet/finance/reports/${kind}?${search}`, signal);
      } catch (error) {
        if (!isAbort(error)) console.error(error);
        throw error;
      }
    },
  });
}

export function useFinanceReport<T>(
  kind: FinanceReportKind,
  from: string,
  to: string,
  { enabled = true, ...filters }: FinanceLedgerFilters & { enabled?: boolean } = {},
) {
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const queryClient = useQueryClient();
  const allowed =
    hasPermission(permissions.accountingView) ||
    hasPermission(permissions.financeJournalView) ||
    hasPermission(permissions.financeView);
  // A half-typed date never reaches the server; the page says what to fix instead.
  const periodProblem = financePeriodProblem(from, to);
  const query = useQuery({
    ...financeQueryOptions<T>({
      tenantId: activeTenantId,
      branchId: isAllBranches ? undefined : branchId,
      kind,
      from,
      to,
      ...filters,
    }),
    enabled: allowed && enabled && !periodProblem,
  });

  // Live updates refresh in the background: figures already on screen stay
  // until the new ones arrive, so the page never blanks during service.
  useEffect(() => {
    if (allowed) listenForFinanceEvents(queryClient);
  }, [allowed, queryClient]);

  const { refetch } = query;
  const hasData = !periodProblem && query.data !== undefined;
  return {
    status: !allowed
      ? ("denied" as const)
      : periodProblem
        ? ("error" as const)
        : hasData
          ? ("ready" as const)
          : query.isError
            ? ("error" as const)
            : ("loading" as const),
    report: (hasData ? query.data : null) as T | null,
    // With figures on screen, a failed refresh keeps them and says they may be out of date.
    error: periodProblem
      ? periodProblem
      : query.isError
        ? userMessage(query.error, "Something went wrong on our side. Try again in a moment.")
        : "",
    refreshing: hasData && query.isFetching,
    updatedAt: query.dataUpdatedAt,
    refresh: useCallback(() => {
      if (!periodProblem) void refetch();
    }, [periodProblem, refetch]),
  };
}
