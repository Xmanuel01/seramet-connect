import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  exportVisibleFinancialCsv, FinanceDates, FinanceFetchState,
  FinanceQuality, reportMoney,
} from "@/finance/finance-ui";
import {
  useFinancePeriod, useFinanceReport,
  type FinanceStatement, type FinanceLedger, type ReceivableReport, type PayableReport,
} from "@/finance/use-finance-report";
import { useAppContext } from "@/lib/app-context";

const headerClass = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
const cellClass = "border-t border-border px-3 py-3 text-[12px]";
const numClass = cellClass + " text-right tabular-nums";

function JournalLines({ report }: { report: FinanceLedger }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead>
          <tr>
            {["Posted date", "Voucher", "Source", "Account", "Branch", "Debit", "Credit"].map((name) => (
              <th className={headerClass} key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.voucher_id + ":" + row.line_number}>
              <td className={cellClass}>{row.business_date}</td>
              <td className={cellClass}>{row.voucher_id}</td>
              <td className={cellClass}>
                {row.source_type}<span className="block text-muted-foreground">{row.source_id}</span>
              </td>
              <td className={cellClass}><strong>{row.account_code}</strong> {row.account_name}</td>
              <td className={cellClass}>{row.branch_id}</td>
              <td className={numClass}>{row.debit_minor ? reportMoney(row.debit_minor, row.currency) : "—"}</td>
              <td className={numClass}>{row.credit_minor ? reportMoney(row.credit_minor, row.currency) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length === 0 && (
        <p className="p-5 text-[12px] text-muted-foreground">
          No posted journals match this period and branch. Draft documents are not represented here.
        </p>
      )}
    </div>
  );
}

export function GeneralLedgerPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const [page, setPage] = useState(0);
  const ledger = useFinanceReport<FinanceLedger>("ledger", dates.from, dates.to, page);
  const statement = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  function exportPage() {
    if (!ledger.report) return;
    exportVisibleFinancialCsv("seramet-posted-ledger-page-" + (page + 1) + ".csv",
      ["Date", "Voucher", "Line", "Source type", "Source ID", "Account code", "Account name", "Branch", "Currency", "Debit minor", "Credit minor"],
      ledger.report.rows.map((row) => [
        row.business_date, row.voucher_id, row.line_number, row.source_type, row.source_id,
        row.account_code, row.account_name, row.branch_id, row.currency, row.debit_minor, row.credit_minor,
      ]),
    );
  }
  return (
    <AppShell title="General ledger" subtitle={"Posted, traceable vouchers — " + branchLabel}>
      <FinanceDates {...dates} refresh={() => { setPage(0); ledger.refresh(); statement.refresh(); }} />
      <FinanceFetchState status={ledger.status} error={ledger.error} retry={ledger.refresh} />
      <FinanceFetchState status={statement.status} error={statement.error} retry={statement.refresh} />
      {statement.report && <FinanceQuality quality={statement.report.quality} issues={statement.report.issues} />}
      {ledger.report && statement.report && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Period debit (base currency)" value={reportMoney(statement.report.trial.periodDebitMinor, statement.report.scope.currency)} />
            <Metric label="Period credit (base currency)" value={reportMoney(statement.report.trial.periodCreditMinor, statement.report.scope.currency)} />
            <Metric label="Accounting status" value={statement.report.trial.balanced ? "Trial balance matches" : "Review required"} />
          </div>
          <Panel className="mt-4">
            <PanelHead title="Posted journal lines"
              sub="Pagination is server-side. CSV exports the current verified page only."
              right={<Btn onClick={exportPage}>Export visible page</Btn>} />
            <JournalLines report={ledger.report} />
            <div className="flex items-center justify-between gap-2 border-t border-border p-3">
              <Btn disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Btn>
              <span className="text-[12px]">Page {page + 1}</span>
              <Btn disabled={!ledger.report.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Btn>
            </div>
          </Panel>
          <Panel className="mt-4">
            <PanelHead title="Configured chart of accounts"
              sub="Tenant accounts with posted balances; branch-specific accounts are access controlled." />
            <div className="grid gap-2 p-4 md:grid-cols-2">
              {statement.report.lines.map((account) => (
                <div key={account.accountId} className="rounded border border-border p-3 text-[12px]">
                  <strong>{account.code} {account.name}</strong>
                  <span className="block text-muted-foreground">{account.type} · {account.currency}</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function TrialBalancePage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Trial balance" subtitle={"Opening, movement and closing from posted journals — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Period debit" value={reportMoney(data.trial.periodDebitMinor, data.scope.currency)} />
            <Metric label="Period credit" value={reportMoney(data.trial.periodCreditMinor, data.scope.currency)} />
            <Metric label="Trial balance check" value={data.trial.balanced ? "Balanced" : "Review required"} />
          </div>
          <FinanceQuality quality={data.quality} issues={data.issues} />
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead title="Account-level trial balance" sub="All amounts shown in the account's currency. The branch scope is enforced by the server." />
            <table className="w-full min-w-[760px]">
              <thead><tr>
                {["Code", "Account", "Type", "Currency", "Opening debit / (credit)", "Period debit", "Period credit", "Closing debit / (credit)"].map((name) =>
                  <th key={name} className={headerClass}>{name}</th>)}
              </tr></thead>
              <tbody>
                {data.lines.map((row) => (
                  <tr key={row.accountId}>
                    <td className={cellClass}>{row.code}</td>
                    <td className={cellClass}>{row.name}</td>
                    <td className={cellClass}>{row.type}</td>
                    <td className={cellClass}>{row.currency}</td>
                    <td className={numClass}>{reportMoney(row.openingDebitMinor - row.openingCreditMinor, row.currency)}</td>
                    <td className={numClass}>{reportMoney(row.periodDebitMinor, row.currency)}</td>
                    <td className={numClass}>{reportMoney(row.periodCreditMinor, row.currency)}</td>
                    <td className={numClass}>{reportMoney(row.closingSignedMinor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function BalanceSheetPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  const groups = data ? [
    ["Assets", data.balanceSheet.assetsMinor],
    ["Liabilities", data.balanceSheet.liabilitiesMinor],
    ["Recorded equity", data.balanceSheet.equityMinor],
    ["Unclosed earnings (lifetime)", data.balanceSheet.unclosedEarningsMinor],
    ["Difference", data.balanceSheet.differenceMinor],
  ] as const : [];
  return (
    <AppShell title="Balance sheet" subtitle={"Posted chart-of-accounts balances — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <FinanceQuality quality={data.quality} issues={data.issues} />
          <Panel className="mt-4">
            <PanelHead title="Statement of financial position"
              sub={"As of " + data.scope.to + ". Base currency only; incomplete source posting prevents certification."}
              right={<Status>{data.quality}</Status>} />
            <div className="divide-y divide-border">
              {groups.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 p-4 text-[13px]">
                  <span>{label}</span><strong>{reportMoney(value, data.scope.currency)}</strong>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function CashFlowPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Cash movement" subtitle={"Posted cash/bank account activity — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <FinanceQuality quality={data.quality} issues={data.issues} />
          {data.cashMovement ? (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Metric label="Opening recorded cash/bank" value={reportMoney(data.cashMovement.openingMinor, data.scope.currency)} />
              <Metric label="Net posted cash movement" value={reportMoney(data.cashMovement.periodMinor, data.scope.currency)} />
              <Metric label="Closing recorded cash/bank" value={reportMoney(
                data.cashMovement.openingMinor + data.cashMovement.periodMinor, data.scope.currency,
              )} />
            </div>
          ) : (
            <Panel className="mt-4 p-5 text-[13px]">
              An accurate cash-flow statement is unavailable: explicitly classify real cash and bank
              ledger accounts, then verify payment and statement reconciliation. No simulated
              operating, investing or financing totals will be displayed.
            </Panel>
          )}
          <Panel className="mt-4 p-4 text-[12px] text-muted-foreground">
            Operating, investing and financing classification requires approved transaction-level
            mappings and reconciled banking evidence. This view reports recorded movement only.
            <Link to="/reconciliation" className="ml-1 underline">Open reconciliation</Link>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function IncomeStatementPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Posted profit and loss" subtitle={"Accrual ledger view, distinct from management flash sales — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <FinanceQuality quality={data.quality} issues={data.issues} />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Posted income" value={reportMoney(data.incomeStatement.incomeMinor, data.scope.currency)} />
            <Metric label="Posted expenses and COGS" value={reportMoney(data.incomeStatement.expenseMinor, data.scope.currency)} />
            <Metric label="Posted period result" value={reportMoney(data.incomeStatement.netResultMinor, data.scope.currency)} />
          </div>
          <Panel className="mt-4">
            <PanelHead title="Account-level income statement"
              sub="Only posted revenue, expense and cost-of-goods accounts; unposted POS revenue is explicitly flagged." />
            <div className="divide-y divide-border">
              {data.lines.filter((line) => ["INCOME","REVENUE","EXPENSE","COGS","COST_OF_GOODS_SOLD"].includes(line.type))
                .map((line) => (
                  <div key={line.accountId} className="flex justify-between gap-4 p-3 text-[12px]">
                    <span>{line.code} {line.name} ({line.type})</span>
                    <span className="tabular-nums">{reportMoney(
                      ["INCOME","REVENUE"].includes(line.type)
                        ? line.periodCreditMinor - line.periodDebitMinor
                        : line.periodDebitMinor - line.periodCreditMinor,
                      line.currency,
                    )}</span>
                  </div>
                ))}
            </div>
          </Panel>
          <p className="mt-3 text-[12px] text-muted-foreground">
            <Link to="/finance" className="underline">View daily management flash P&L</Link>.
            Flash operating metrics and posted accrual accounts can differ pending complete source posting.
          </p>
        </>
      )}
    </AppShell>
  );
}

export function ReceivablesPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<ReceivableReport>("receivables", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Accounts receivable" subtitle={"Authoritative unpaid POS invoice register — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <Panel className="mt-4 p-4 text-[12px]">
            {data.note} Marketplace receivable settlement reports are accessed separately through{" "}
            <Link to="/reconciliation" className="underline">Reconciliation</Link>.
            Invoice due dates are not yet stored in the authoritative POS invoice register;
            this page cannot claim verified customer overdue ageing.
          </Panel>
          {data.truncated && <p className="mt-2 text-warning">More than 200 open invoices: use a narrower period; no partial sum is represented as a total.</p>}
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead title="Open POS invoices" sub="Invoice-level total and paid amount are persisted server-side." />
            <table className="w-full min-w-[700px]">
              <thead><tr>{["Invoice", "Business date", "Branch", "Status", "Currency", "Total", "Paid", "Remaining"].map((label) =>
                <th key={label} className={headerClass}>{label}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={cellClass}>{row.invoice_number}</td>
                    <td className={cellClass}>{row.business_date}</td>
                    <td className={cellClass}>{row.branch_id}</td>
                    <td className={cellClass}>{row.status}</td>
                    <td className={cellClass}>{row.currency}</td>
                    <td className={numClass}>{reportMoney(Number(row.total_minor), row.currency)}</td>
                    <td className={numClass}>{reportMoney(Number(row.paid_minor), row.currency)}</td>
                    <td className={numClass}>{reportMoney(
                      Number(row.total_minor) - Number(row.paid_minor), row.currency,
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && <p className="p-5 text-[12px]">No unpaid POS invoices in the authorized scope.</p>}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function PayablesPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<PayableReport>("payables", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Accounts payable" subtitle={"Recorded supplier bill register — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <Panel className="mt-4 p-4 text-[12px] text-warning">
            {data.note} Payment run, exact outstanding totals and ageing are intentionally unavailable
            until supplier payment allocation is implemented and reconciled. The totals below
            are original invoice amounts, not asserted debt.
            <Link to="/procurement" className="ml-1 underline">Review source procurement records</Link>.
          </Panel>
          {data.truncated && <p className="mt-2 text-warning">The register exceeded 200 records. Filter to review more.</p>}
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead title="Recorded supplier invoices" sub="Status and journal links come directly from procurement." />
            <table className="w-full min-w-[790px]">
              <thead><tr>{["Supplier", "Invoice", "Date", "Due date", "Branch", "Amount", "Status", "Journal"].map((label) =>
                <th key={label} className={headerClass}>{label}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className={cellClass}>{row.supplier_name}</td>
                    <td className={cellClass}>{row.invoice_number}</td>
                    <td className={cellClass}>{row.invoice_date}</td>
                    <td className={cellClass}>{row.due_date || "Not recorded"}</td>
                    <td className={cellClass}>{row.branch_id}</td>
                    <td className={numClass}>{reportMoney(Number(row.total_minor), row.currency)}</td>
                    <td className={cellClass}>{row.status}</td>
                    <td className={cellClass}>{row.journal_entry_id || "Not posted"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.rows.length && <p className="p-5 text-[12px]">No recorded non-draft supplier invoices.</p>}
          </Panel>
        </>
      )}
    </AppShell>
  );
}

export function ExpensesPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const [page, setPage] = useState(0);
  const entries = useFinanceReport<FinanceLedger>("ledger", dates.from, dates.to, page, 100, "EXPENSE");
  const statement = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const expenseMinor = statement.report?.lines
    .filter((line) => line.type === "EXPENSE" && line.currency === statement.report?.scope.currency)
    .reduce((sum, line) => sum + line.periodDebitMinor - line.periodCreditMinor, 0);
  return (
    <AppShell title="Posted operating expenses" subtitle={"Recorded accounting expense entries — " + branchLabel}>
      <FinanceDates {...dates} refresh={() => { setPage(0); entries.refresh(); statement.refresh(); }} />
      <FinanceFetchState status={entries.status} error={entries.error} retry={entries.refresh} />
      <FinanceFetchState status={statement.status} error={statement.error} retry={statement.refresh} />
      {statement.report && (
        <>
          <FinanceQuality issues={statement.report.issues} quality={statement.report.quality} />
          <div className="mt-4"><Metric label="Posted operating expenses" value={reportMoney(expenseMinor ?? 0, statement.report.scope.currency)} /></div>
        </>
      )}
      <Panel className="mt-4 p-4 text-[12px] text-muted-foreground">
        This register reflects posted GL expenses, not unsubmitted employee reimbursement claims.
        Submit supplier bills through <Link className="underline" to="/procurement">Procurement</Link>;
        claim approvals require their own authorized accounting workflow.
      </Panel>
      {entries.report && (
        <Panel className="mt-4">
          <PanelHead title="Expense GL source vouchers" />
          <JournalLines report={entries.report} />
          <div className="flex justify-between border-t border-border p-3">
            <Btn disabled={page === 0} onClick={() => setPage((value) => value - 1)}>Previous</Btn>
            <span className="text-[12px]">Page {page + 1}</span>
            <Btn disabled={!entries.report.hasMore} onClick={() => setPage((value) => value + 1)}>Next</Btn>
          </div>
        </Panel>
      )}
    </AppShell>
  );
}

export function TaxCentrePage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Tax control" subtitle={"Posted tax ledger evidence — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && <FinanceQuality quality={data.quality} issues={data.issues} />}
      <Panel className="mt-4 p-5 text-[13px]">
        <strong>Tax return preparation is not configured</strong>
        <p className="mt-2 text-[12px] text-muted-foreground">
          No validated, jurisdiction-specific tax ledger mappings, return period rules,
          statutory deadlines or reconciled supplier input-tax evidence have been verified.
          Zero must not be interpreted as a filed return or absence of tax obligations.
          Configure and audit those inputs before activating tax calculation or filing.
        </p>
        <Link to="/general-ledger" className="mt-3 inline-block text-[12px] underline">
          Inspect actual posted tax-related journal descriptions
        </Link>
      </Panel>
    </AppShell>
  );
}

export function DailySalesJournalPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  return (
    <AppShell title="Daily sales journal control" subtitle={"Verify posted Z-report coverage — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && <FinanceQuality quality={data.quality} issues={data.issues} />}
      <Panel className="mt-4 p-5 text-[13px]">
        <strong>Never manually post synthetic sales</strong>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Each day's settled POS payments, tax, refunds, discounts, marketplace clearing
          and cash variance must be reconciled to configured journal accounts using an
          idempotent source-ledger posting. Until a genuine daily journal bridge is verified,
          the system will not offer a button that pretends to post a balanced Z-report.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
          <Link className="underline" to="/reconciliation">Review genuine day-end reconciliation</Link>
          <Link className="underline" to="/general-ledger">Review posted journals</Link>
          <Link className="underline" to="/invoices">Review actual customer invoices</Link>
        </div>
      </Panel>
    </AppShell>
  );
}

export function AccountingHubPage() {
  const { branchLabel } = useAppContext();
  const dates = useFinancePeriod();
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const data = result.report;
  const destinations = [
    ["/general-ledger", "General ledger", "Actual posted journals and account master"],
    ["/trial-balance", "Trial balance", "Real account opening balances and period movement"],
    ["/balance-sheet", "Balance sheet", "Reported posted balances with completeness warnings"],
    ["/profit-loss", "Posted profit and loss", "Account-based accrual view"],
    ["/cash-flow", "Cash movement", "Requires classified bank and cash accounts"],
    ["/receivables", "Customer receivables", "Unpaid server invoices; marketplace separate"],
    ["/payables", "Supplier invoice register", "Payment allocation not yet verified"],
    ["/expenses", "Posted expense register", "Only actual posted operating expenses"],
    ["/period-close", "Period close readiness", "Live management controls; cannot close books itself"],
    ["/tax-centre", "Tax controls", "Tax configuration and filing not yet verified"],
  ] as const;
  return (
    <AppShell title="Accounting hub" subtitle={"Source-to-ledger control centre — " + branchLabel}>
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {data && (
        <>
          <FinanceQuality quality={data.quality} issues={data.issues} />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Metric label="Period posted debit" value={reportMoney(data.trial.periodDebitMinor, data.scope.currency)} />
            <Metric label="Period posted credit" value={reportMoney(data.trial.periodCreditMinor, data.scope.currency)} />
            <Metric label="Reporting coverage" value={data.quality === "RECONCILED" ? "GL checks pass" : "Action required"} />
          </div>
        </>
      )}
      <Panel className="mt-4">
        <PanelHead title="Financial workflows" sub="Every link shows real records or explicitly explains missing integrations." />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map(([to, label, description]) => (
            <Link key={to} to={to} className="rounded-lg border border-border p-3 hover:bg-secondary/50">
              <strong className="text-[13px]">{label}</strong>
              <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
            </Link>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
