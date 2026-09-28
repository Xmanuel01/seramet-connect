import { useCallback, useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";
import { financeDefaultDates } from "@/finance/finance-business-date";

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
  const [dates, setDates] = useState(() => financeDefaultDates(new Date(), zone, cutoff));
  return {
    ...dates,
    setFrom: (from: string) => setDates((prev) => ({ ...prev, from })),
    setTo: (to: string) => setDates((prev) => ({ ...prev, to })),
  };
}

export function useFinanceReport<T>(
  kind: "statement" | "ledger" | "receivables" | "payables",
  from: string,
  to: string,
  page = 0,
  limit = 100,
  accountType = "",
) {
  const { activeTenantId, branchId, isAllBranches, hasPermission } = useAppContext();
  const allowed =
    hasPermission(permissions.accountingView) ||
    hasPermission(permissions.financeJournalView) ||
    hasPermission(permissions.financeView);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    status: "loading" | "ready" | "error";
    report: T | null;
    error: string;
  }>({ key: "", status: "loading", report: null, error: "" });
  const key = useMemo(
    () =>
      [
        activeTenantId,
        isAllBranches ? "ALL" : branchId,
        kind,
        from,
        to,
        page,
        limit,
        accountType,
      ].join(":"),
    [activeTenantId, isAllBranches, branchId, kind, from, to, page, limit, accountType],
  );
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setState({ key, status: "loading", report: null, error: "" });
    const query = new URLSearchParams({ from, to });
    if (!isAllBranches) query.set("branchId", branchId);
    if (kind === "ledger") {
      query.set("limit", String(limit));
      query.set("offset", String(page * limit));
      if (accountType) query.set("accountType", accountType);
    }
    void authenticatedFetch("/api/seramet/finance/reports/" + kind + "?" + query, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          report?: T;
          message?: string;
          error?: string;
        };
        if (!response.ok || !body.ok || !body.report) {
          throw new Error(
            body.message ||
              body.error ||
              "Finance report could not be loaded (" + response.status + ")",
          );
        }
        if (!controller.signal.aborted)
          setState({ key, status: "ready", report: body.report, error: "" });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            status: "error",
            report: null,
            error: cause instanceof Error ? cause.message : "Finance report unavailable",
          });
      });
    return () => controller.abort();
  }, [key, allowed, isAllBranches, branchId, kind, from, to, page, limit, accountType, revision]);
  // Finance pages must refresh after cash settlement or any authoritative
  // real-time event, without requiring the operator to manually reload.
  useEffect(() => {
    if (!allowed || typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setRevision((value) => value + 1), 250);
    };
    window.addEventListener("seramet:refresh", schedule);
    window.addEventListener("seramet:realtime", schedule);
    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("seramet:refresh", schedule);
      window.removeEventListener("seramet:realtime", schedule);
    };
  }, [allowed]);

  const current = allowed && state.key === key ? state : null;
  return {
    status: !allowed ? ("denied" as const) : (current?.status ?? "loading"),
    report: current?.status === "ready" ? current.report : null,
    error: current?.error ?? "",
    refresh: useCallback(() => setRevision((value) => value + 1), []),
  };
}
