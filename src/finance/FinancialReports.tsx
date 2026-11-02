import { Link, useNavigate } from "@tanstack/react-router";
import { Download, FilePlus2, X } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  exportVisibleFinancialCsv,
  FinanceDates,
  FinanceFetchState,
  FinanceQuality,
  reportMoney,
} from "@/finance/finance-ui";
import { humanize, sourceLabel, useBranchName } from "@/finance/finance-labels";
import {
  useFinancePeriod,
  useFinanceReport,
  type FinanceLedger,
  type FinanceStatement,
  type PayableReport,
  type ReceivableReport,
} from "@/finance/use-finance-report";
import { useAppContext } from "@/lib/app-context";
import { majorFromMinor, minorDigits } from "@/payments/money";
import { permissions } from "@/platform/permissions";

const headerClass = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
const cellClass = "border-t border-border px-3 py-2.5 text-[12px]";
const numClass = cellClass + " text-right tabular-nums";

function plainAmount(minor: number, currency: string) {
  return majorFromMinor(minor, currency).toFixed(minorDigits(currency));
}

function Pager({
  page,
  hasMore,
  onPage,
}: {
  page: number;
  hasMore: boolean;
  onPage: (page: number) => void;
}) {
  if (page === 0 && !hasMore) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border p-3">
      <Btn disabled={page === 0} onClick={() => onPage(page - 1)}>
        Previous
      </Btn>
      <span className="text-[12px]">Page {page + 1}</span>
      <Btn disabled={!hasMore} onClick={() => onPage(page + 1)}>
        Next
      </Btn>
    </div>
  );
}

function JournalLines({ report, empty }: { report: FinanceLedger; empty: string }) {
  const branchName = useBranchName();
  const { isAllBranches } = useAppContext();
  const columns = [
    "Date",
    "Entry",
    "Account",
    ...(isAllBranches ? ["Branch"] : []),
    "Debit",
    "Credit",
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px]">
        <thead>
          <tr>
            {columns.map((name) => (
              <th
                className={headerClass + (["Debit", "Credit"].includes(name) ? " text-right" : "")}
                key={name}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.voucher_id + ":" + row.line_number}>
              <td className={cellClass + " whitespace-nowrap"}>{row.business_date}</td>
              <td className={cellClass}>
                {sourceLabel(row.source_type)}
                {row.description && (
                  <span className="block text-muted-foreground">{row.description}</span>
                )}
              </td>
              <td className={cellClass}>
                {row.account_code} {row.account_name}
              </td>
              {isAllBranches && <td className={cellClass}>{branchName(row.branch_id)}</td>}
              <td className={numClass}>
                {row.debit_minor ? reportMoney(row.debit_minor, row.currency) : ""}
              </td>
              <td className={numClass}>
                {row.credit_minor ? reportMoney(row.credit_minor, row.currency) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length === 0 && <p className="p-5 text-[12px] text-muted-foreground">{empty}</p>}
    </div>
  );
}

function exportLedger(name: string, report: FinanceLedger, branchName: (id: string) => string) {
  exportVisibleFinancialCsv(
    name,
    [
      "Date",
      "Entry",
      "Description",
      "Account code",
      "Account",
      "Branch",
      "Currency",
      "Debit",
      "Credit",
    ],
    report.rows.map((row) => [
      row.business_date,
      sourceLabel(row.source_type),
      row.description,
      row.account_code,
      row.account_name,
      branchName(row.branch_id),
      row.currency,
      plainAmount(row.debit_minor, row.currency),
      plainAmount(row.credit_minor, row.currency),
    ]),
  );
}

export function GeneralLedgerPage({ account, source }: { account?: string; source?: "sales" }) {
  const { branchLabel } = useAppContext();
  const navigate = useNavigate();
  const branchName = useBranchName();
  const dates = useFinancePeriod();
  const filterKey = [dates.from, dates.to, account, source].join(":");
  const [pageState, setPageState] = useState({ key: filterKey, page: 0 });
  const page = pageState.key === filterKey ? pageState.page : 0;
  const ledger = useFinanceReport<FinanceLedger>("ledger", dates.from, dates.to, {
    page,
    ...(account ? { accountId: account } : {}),
    ...(source === "sales" ? { source: "SALES" as const } : {}),
  });
  const statement = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const accounts = statement.report?.lines ?? [];
  const setFilters = (next: { account?: string | undefined; source?: "sales" | undefined }) =>
    void navigate({
      to: "/general-ledger",
      search: {
        ...(next.account ? { account: next.account } : {}),
        ...(next.source ? { source: next.source } : {}),
      },
    });
  return (
    <AppShell
      title="General Ledger"
      subtitle={branchLabel}
      actions={
        ledger.report && (
          <Btn
            onClick={() =>
              exportLedger(
                `ledger-${dates.from}-to-${dates.to}-page-${page + 1}.csv`,
                ledger.report!,
                branchName,
              )
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Btn>
        )
      }
    >
      <FinanceDates {...dates} refresh={ledger.refresh} />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="grid gap-1 text-[12px] font-medium">
          <label htmlFor="ledger-source">Show</label>
          <select
            id="ledger-source"
            className="h-9 rounded border border-border bg-background px-3"
            value={source ?? ""}
            onChange={(event) =>
              setFilters({ account, source: event.target.value === "sales" ? "sales" : undefined })
            }
          >
            <option value="">All entries</option>
            <option value="sales">Sales journal</option>
          </select>
        </div>
        <div className="grid min-w-[220px] gap-1 text-[12px] font-medium">
          <label htmlFor="ledger-account">Account</label>
          <select
            id="ledger-account"
            className="h-9 rounded border border-border bg-background px-3"
            value={account ?? ""}
            onChange={(event) => setFilters({ account: event.target.value || undefined, source })}
          >
            <option value="">All accounts</option>
            {accounts.map((row) => (
              <option key={row.accountId} value={row.accountId}>
                {row.code} {row.name}
              </option>
            ))}
          </select>
        </div>
        {(account || source) && (
          <Btn onClick={() => setFilters({})}>
            <X className="h-4 w-4" /> Clear filters
          </Btn>
        )}
      </div>
      <FinanceFetchState status={ledger.status} error={ledger.error} retry={ledger.refresh} />
      {ledger.report && (
        <Panel className="mt-4">
          <JournalLines
            report={ledger.report}
            empty={
              source === "sales"
                ? "No sales were posted in this period."
                : "Nothing was posted in this period."
            }
          />
          <Pager
            page={page}
            hasMore={ledger.report.hasMore}
            onPage={(next) => setPageState({ key: filterKey, page: next })}
          />
        </Panel>
      )}
      {statement.report && statement.report.quality !== "RECONCILED" && (
        <FinanceQuality quality={statement.report.quality} issues={statement.report.issues} />
      )}
    </AppShell>
  );
}

export function ReceivablesPage() {
  const { branchLabel, isAllBranches } = useAppContext();
  const branchName = useBranchName();
  const dates = useFinancePeriod();
  const result = useFinanceReport<ReceivableReport>("receivables", dates.from, dates.to);
  const data = result.report;
  const total = data?.rows
    .filter((row) => row.currency === data.currency)
    .reduce((sum, row) => sum + Number(row.total_minor) - Number(row.paid_minor), 0);
  return (
    <AppShell title="Receivables" subtitle={branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Unpaid invoices" value={data.rows.length} />
            <Metric label="Balance owed" value={reportMoney(total ?? 0, data.currency)} />
          </div>
          {data.truncated && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Showing the first 200 unpaid invoices. Choose a shorter period to see the rest.
            </p>
          )}
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Unpaid invoices"
              sub={`Dated up to ${dates.to}. Balances are as they stand today.`}
            />
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  {[
                    "Invoice",
                    "Date",
                    ...(isAllBranches ? ["Branch"] : []),
                    "Status",
                    "Total",
                    "Paid",
                    "Balance",
                  ].map((label) => (
                    <th
                      key={label}
                      className={
                        headerClass +
                        (["Total", "Paid", "Balance"].includes(label) ? " text-right" : "")
                      }
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={cellClass + " font-semibold"}>{row.invoice_number}</td>
                    <td className={cellClass}>{row.business_date}</td>
                    {isAllBranches && <td className={cellClass}>{branchName(row.branch_id)}</td>}
                    <td className={cellClass}>
                      <Status>{humanize(row.status)}</Status>
                    </td>
                    <td className={numClass}>
                      {reportMoney(Number(row.total_minor), row.currency)}
                    </td>
                    <td className={numClass}>
                      {reportMoney(Number(row.paid_minor), row.currency)}
                    </td>
                    <td className={numClass + " font-semibold"}>
                      {reportMoney(Number(row.total_minor) - Number(row.paid_minor), row.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="p-5 text-[12px] text-muted-foreground">No unpaid invoices.</p>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function PayablesPage() {
  const { branchLabel, isAllBranches, hasPermission } = useAppContext();
  const branchName = useBranchName();
  const dates = useFinancePeriod();
  const result = useFinanceReport<PayableReport>("payables", dates.from, dates.to);
  const data = result.report;
  const open = data?.rows.filter((row) => !["PAID", "CANCELLED", "VOID"].includes(row.status));
  const total = open
    ?.filter((row) => row.currency === data?.currency)
    .reduce((sum, row) => sum + Number(row.total_minor), 0);
  const notPosted = data?.rows.filter((row) => !row.journal_entry_id).length ?? 0;
  return (
    <AppShell
      title="Payables"
      subtitle={branchLabel}
      actions={
        hasPermission(permissions.procurementView) && (
          <Link to="/supplier-bills">
            <Btn variant="primary">
              <FilePlus2 className="h-4 w-4" /> Enter a bill
            </Btn>
          </Link>
        )
      }
    >
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Open bills" value={open?.length ?? 0} />
            <Metric label="Amount on open bills" value={reportMoney(total ?? 0, data.currency)} />
            <Metric label="Not posted" value={notPosted} invert={notPosted > 0} />
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Amounts are bill totals. Part-payments to suppliers aren&apos;t deducted yet.
            {data.truncated &&
              " Showing the first 200 bills; choose a shorter period to see the rest."}
          </p>
          <Panel className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr>
                  {[
                    "Supplier",
                    "Bill",
                    "Date",
                    "Due",
                    ...(isAllBranches ? ["Branch"] : []),
                    "Amount",
                    "Status",
                  ].map((label) => (
                    <th
                      key={label}
                      className={headerClass + (label === "Amount" ? " text-right" : "")}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={cellClass + " font-semibold"}>{row.supplier_name}</td>
                    <td className={cellClass}>{row.invoice_number}</td>
                    <td className={cellClass}>{row.invoice_date}</td>
                    <td className={cellClass}>{row.due_date || "—"}</td>
                    {isAllBranches && <td className={cellClass}>{branchName(row.branch_id)}</td>}
                    <td className={numClass}>
                      {reportMoney(Number(row.total_minor), row.currency)}
                    </td>
                    <td className={cellClass}>
                      <Status>{row.journal_entry_id ? humanize(row.status) : "Not posted"}</Status>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && (
              <p className="p-5 text-[12px] text-muted-foreground">
                No supplier bills in this period.
              </p>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function ExpensesPage() {
  const { branchLabel } = useAppContext();
  const branchName = useBranchName();
  const dates = useFinancePeriod();
  const periodKey = dates.from + ":" + dates.to;
  const [pageState, setPageState] = useState({ key: periodKey, page: 0 });
  const page = pageState.key === periodKey ? pageState.page : 0;
  const entries = useFinanceReport<FinanceLedger>("ledger", dates.from, dates.to, {
    page,
    accountType: "EXPENSE",
  });
  const statement = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const report = statement.report;
  const byAccount = (report?.lines ?? [])
    .filter((line) => line.type === "EXPENSE" && line.currency === report?.scope.currency)
    .map((line) => ({ line, amount: line.periodDebitMinor - line.periodCreditMinor }))
    .filter((item) => item.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  const total = byAccount.reduce((sum, item) => sum + item.amount, 0);
  return (
    <AppShell
      title="Expenses"
      subtitle={branchLabel}
      actions={
        entries.report && (
          <Btn
            onClick={() =>
              exportLedger(`expenses-${dates.from}-to-${dates.to}.csv`, entries.report!, branchName)
            }
          >
            <Download className="h-4 w-4" /> Export CSV
          </Btn>
        )
      }
    >
      <FinanceDates {...dates} refresh={entries.refresh} />
      <FinanceFetchState
        status={statement.status}
        error={statement.error}
        retry={statement.refresh}
      />
      {report && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Panel>
            <PanelHead title="By account" />
            <div className="divide-y divide-border">
              {byAccount.map(({ line, amount }) => (
                <Link
                  key={line.accountId}
                  to="/general-ledger"
                  search={{ account: line.accountId }}
                  className="flex justify-between gap-3 px-4 py-2.5 text-[12px] hover:bg-secondary/50"
                >
                  <span>{line.name}</span>
                  <span className="tabular-nums">{reportMoney(amount, report.scope.currency)}</span>
                </Link>
              ))}
              {byAccount.length === 0 && (
                <p className="p-4 text-[12px] text-muted-foreground">No expenses this period.</p>
              )}
              <div className="flex justify-between gap-3 px-4 py-2.5 text-[13px] font-bold">
                <span>Total</span>
                <span className="tabular-nums">{reportMoney(total, report.scope.currency)}</span>
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHead title="Entries" />
            <FinanceFetchState
              status={entries.status}
              error={entries.error}
              retry={entries.refresh}
            />
            {entries.report && (
              <>
                <JournalLines
                  report={entries.report}
                  empty="No expenses were posted in this period."
                />
                <Pager
                  page={page}
                  hasMore={entries.report.hasMore}
                  onPage={(next) => setPageState({ key: periodKey, page: next })}
                />
              </>
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
