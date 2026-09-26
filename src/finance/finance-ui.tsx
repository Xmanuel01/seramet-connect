import { Link } from "@tanstack/react-router";
import { Btn, Panel, Status } from "@/components/app/ui";
import { formatMinor as formatCurrencyMinor } from "@/payments/money";
import type { FinancialIssue } from "@/finance/use-finance-report";

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
  from: string; to: string; setFrom: (value: string) => void;
  setTo: (value: string) => void; refresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
      <label className="grid gap-1 text-[12px] font-medium">
        From
        <input className="h-9 rounded border border-border bg-background px-3" type="date"
          value={from} max={to} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label className="grid gap-1 text-[12px] font-medium">
        Through
        <input className="h-9 rounded border border-border bg-background px-3" type="date"
          value={to} min={from} onChange={(event) => setTo(event.target.value)} />
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
  status: "loading" | "ready" | "error" | "denied"; error: string; retry: () => void;
}) {
  if (status === "ready") return null;
  return (
    <Panel className="mt-4 p-5">
      <p className="text-[13px] font-semibold">
        {status === "loading" ? "Loading authorized accounting records..." :
          status === "denied" ? "Accounting reporting permission required" :
            "Financial data could not be verified"}
      </p>
      {status === "error" && (
        <>
          <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>
          <Btn className="mt-3" onClick={retry}>Retry</Btn>
        </>
      )}
    </Panel>
  );
}

export function FinanceQuality({ issues, quality }: {
  issues: FinancialIssue[];
  quality: "INCOMPLETE" | "RECONCILED";
}) {
  return (
    <Panel className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ledger integrity and reporting coverage</h3>
        <Status>{quality === "RECONCILED" ? "GL checks reconciled" : "Incomplete"}</Status>
      </div>
      {issues.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          The available posted ledger passed the automated reporting integrity checks.
          Reconciliation and completeness of external bank or supplier statements require separate review.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {issues.map((issue) => (
            <p key={issue.code} className="rounded border border-warning/50 p-3 text-[12px]">
              <strong>{issue.code.replaceAll("_", " ")}</strong>
              {" (" + issue.count + "): "}{issue.detail}
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        These are derived from posted journals only. Drafts and unreconciled source documents
        are never counted as if they were posted. Review unmatched source records in{" "}
        <Link className="underline" to="/reconciliation">Reconciliation</Link>.
      </p>
    </Panel>
  );
}

function safeCsv(value: unknown) {
  const text = String(value ?? "");
  const guarded = /^[\s]*[=+@\-]/.test(text) ? "'" + text : text;
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
