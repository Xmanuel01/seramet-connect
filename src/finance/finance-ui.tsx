import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Btn, Panel, Status } from "@/components/app/ui";
import { formatMinor as formatCurrencyMinor } from "@/payments/money";
import type { FinancialIssue } from "@/finance/use-finance-report";
import { financeIssueGuidance } from "@/finance/finance-issue-guidance";

export function reportMoney(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, "en-KE");
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
      <Btn onClick={refresh}>Refresh authorized records</Btn>
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
  if (status === "ready") return null;
  return (
    <Panel className="mt-4 p-5">
      <p className="text-[13px] font-semibold">
        {status === "loading"
          ? "Loading authorized accounting records..."
          : status === "denied"
            ? "Accounting reporting permission required"
            : "Financial data could not be verified"}
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
                    <span className="min-w-0 flex-1">{guidance.title}</span>
                    <span className="text-[11px] font-medium text-muted-foreground group-open:hidden">
                      What to do
                    </span>
                  </summary>
                  <div className="space-y-2 px-3 pb-3 pl-9 text-muted-foreground">
                    <p>{issue.detail}</p>
                    {guidance.nextStep && <p className="text-foreground">{guidance.nextStep}</p>}
                    <p className="break-words text-[11px]">
                      Reference: {issue.code} ({issue.count})
                    </p>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Link className="font-semibold text-primary hover:underline" to="/reconciliation">
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
