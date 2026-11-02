import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Btn, Panel, Status } from "@/components/app/ui";
import { formatMinor as formatCurrencyMinor } from "@/payments/money";
import { activeLocale } from "@/lib/currency";
import type { FinancialIssue } from "@/finance/use-finance-report";
import { financeIssueGuidance } from "@/finance/finance-issue-guidance";
import { closeBlocker } from "@/finance/finance-labels";

export function reportMoney(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, activeLocale());
}

export function FinanceDates({
  from,
  to,
  setFrom,
  setTo,
  refresh,
}: {
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  refresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
      <label className="grid gap-1 text-[12px] font-medium">
        From
        <input
          className="h-9 rounded border border-border bg-background px-3"
          type="date"
          value={from}
          max={to}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-[12px] font-medium">
        Through
        <input
          className="h-9 rounded border border-border bg-background px-3"
          type="date"
          value={to}
          min={from}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      <Btn onClick={refresh}>Refresh</Btn>
    </div>
  );
}

export function FinanceFetchState({
  status,
  error,
  retry,
}: {
  status: "loading" | "ready" | "error" | "denied";
  error: string;
  retry: () => void;
}) {
  if (status === "ready") {
    // Figures stay on screen when a background refresh fails.
    if (!error) return null;
    return (
      <p
        role="status"
        className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground"
      >
        {error} The figures shown may be out of date.
        <button type="button" className="font-semibold text-foreground underline" onClick={retry}>
          Retry
        </button>
      </p>
    );
  }
  return (
    <Panel className="mt-4 p-5">
      <p className="text-[13px] font-semibold">
        {status === "loading"
          ? "Loading…"
          : status === "denied"
            ? "You don't have access to accounting reports. Ask an owner or manager."
            : "Couldn't load this report"}
      </p>
      {status === "error" && (
        <>
          <p role="alert" className="mt-2 text-[12px] text-danger">
            {error}
          </p>
          <Btn className="mt-3" onClick={retry}>
            Retry
          </Btn>
        </>
      )}
    </Panel>
  );
}

export function FinanceQuality({
  issues,
  quality,
}: {
  issues: FinancialIssue[];
  quality: "INCOMPLETE" | "RECONCILED";
}) {
  return (
    <Panel className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Data checks</h3>
        <Status>{quality === "RECONCILED" ? "All checks passed" : "Needs attention"}</Status>
      </div>
      {issues.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Posted figures passed every automatic check. Bank and supplier statements still need your
          own review.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-md border border-warning/40">
          {issues.map((issue) => {
            const guidance = financeIssueGuidance(issue.code);
            return (
              <li key={issue.code} className="text-[12px]">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
                    <span className="min-w-0 flex-1">
                      {guidance.title}
                      {issue.count > 1 && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          ({issue.count})
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] font-medium text-muted-foreground group-open:hidden">
                      What to do
                    </span>
                  </summary>
                  <p className="px-3 pb-3 pl-9">{guidance.nextStep}</p>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link
          className="font-semibold text-primary hover:underline"
          to="/payment-control"
          search={{ tab: "bank" }}
        >
          Review unmatched records
        </Link>
        {issues.some((issue) =>
          ["CHART_OF_ACCOUNTS_MISSING", "CASH_ACCOUNT_CLASSIFICATION_MISSING"].includes(issue.code),
        ) && (
          <Link
            className="font-semibold text-primary hover:underline"
            to="/seramet-setup"
            search={{ section: "ACCOUNTING" }}
          >
            Set up accounts in Setup Centre
          </Link>
        )}
      </div>
    </Panel>
  );
}

function safeCsv(value: unknown) {
  const text = String(value ?? "");
  const guarded = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + guarded.replaceAll('"', '""') + '"';
}

export function exportVisibleFinancialCsv(
  filename: string,
  columns: string[],
  records: unknown[][],
) {
  const content = [columns, ...records].map((row) => row.map(safeCsv).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Tabs whose selection lives in the page address, so links and bookmarks open the right one. */
export function PageTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border p-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onSelect(tab.id)}
          className={
            "h-9 shrink-0 rounded-md px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
            (tab.id === active ? "bg-primary text-primary-foreground" : "hover:bg-secondary")
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** One label/amount line in a statement. */
export function StatementRow({
  label,
  amount,
  currency,
  strong,
  compare,
  indent,
}: {
  label: string;
  amount: number;
  currency: string;
  strong?: boolean;
  compare?: number | undefined;
  indent?: boolean;
}) {
  return (
    <div
      className={
        "flex items-baseline justify-between gap-4 px-4 py-2.5 text-[13px] " +
        (strong ? "border-t border-border font-bold" : "")
      }
    >
      <span className={indent ? "pl-4 text-muted-foreground" : ""}>{label}</span>
      <span className="flex gap-6 tabular-nums">
        {compare !== undefined && (
          <span className="w-32 text-right text-muted-foreground">
            {reportMoney(compare, currency)}
          </span>
        )}
        <span className="w-32 text-right">{reportMoney(amount, currency)}</span>
      </span>
    </div>
  );
}

/** Open period-close blockers, each linked to the page where it is fixed. */
export function NeedsAttention({
  blockers,
  empty,
}: {
  blockers: ReadonlyArray<{ code: string; count: number; severity: string }>;
  empty: string;
}) {
  if (!blockers.length) return <p className="p-4 text-[12px] text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {blockers.map((blocker) => {
        const { label, link } = closeBlocker(blocker.code);
        const content = (
          <>
            <AlertTriangle
              aria-hidden="true"
              className={
                "h-4 w-4 shrink-0 " +
                (["HIGH", "CRITICAL"].includes(blocker.severity)
                  ? "text-destructive"
                  : "text-warning")
              }
            />
            <span className="min-w-0 flex-1">{label}</span>
            <span className="tabular-nums font-semibold">{blocker.count}</span>
          </>
        );
        return (
          <li key={blocker.code} className="text-[13px]">
            {link ? (
              <Link {...link} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/50">
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
