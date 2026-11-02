import { Link, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, Status } from "@/components/app/ui";
import {
  exportVisibleFinancialCsv,
  FinanceDates,
  FinanceFetchState,
  FinanceQuality,
  PageTabs,
  reportMoney,
  StatementRow,
} from "@/finance/finance-ui";
import { accountTypeLabel, ASSET_TYPES, COST_TYPES, INCOME_TYPES } from "@/finance/finance-labels";
import {
  type FinancialAccountRow,
  financePeriodProblem,
  type FinanceStatement,
  useFinancePeriod,
  useFinanceReport,
} from "@/finance/use-finance-report";
import { useAppContext } from "@/lib/app-context";
import { majorFromMinor, minorDigits } from "@/payments/money";

export const statementTabs = [
  { id: "profit-loss", label: "Profit & Loss" },
  { id: "balance-sheet", label: "Balance Sheet" },
  { id: "cash-flow", label: "Cash Flow" },
  { id: "trial-balance", label: "Trial Balance" },
] as const;
export type StatementTab = (typeof statementTabs)[number]["id"];

export function isStatementTab(value: unknown): value is StatementTab {
  return statementTabs.some((tab) => tab.id === value);
}

/** The period of the same length that ends the day before `from`; null for an invalid range. */
export function previousPeriod(from: string, to: string) {
  if (financePeriodProblem(from, to)) return null;
  const day = 86_400_000;
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const length = Math.round((end - start) / day);
  const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
  return { from: iso(start - (length + 1) * day), to: iso(start - day) };
}

type Line = { account: FinancialAccountRow; amount: number };

/** Income and liability-side accounts read naturally as credit minus debit. */
function periodAmount(account: FinancialAccountRow) {
  const credit = account.periodCreditMinor - account.periodDebitMinor;
  return INCOME_TYPES.includes(account.type) ? credit : -credit;
}

export function profitAndLoss(statement: FinanceStatement) {
  const base = statement.lines.filter((line) => line.currency === statement.scope.currency);
  const group = (types: string[]): Line[] =>
    base
      .filter((account) => types.includes(account.type))
      .map((account) => ({ account, amount: periodAmount(account) }))
      .filter((line) => line.amount !== 0);
  const total = (lines: Line[]) => lines.reduce((sum, line) => sum + line.amount, 0);
  const income = group(INCOME_TYPES);
  const costOfSales = group(COST_TYPES);
  const expenses = group(["EXPENSE"]);
  const grossProfit = total(income) - total(costOfSales);
  return {
    income,
    costOfSales,
    expenses,
    totals: {
      income: total(income),
      costOfSales: total(costOfSales),
      grossProfit,
      expenses: total(expenses),
      netResult: grossProfit - total(expenses),
    },
  };
}

export function balanceSheet(statement: FinanceStatement) {
  const base = statement.lines.filter((line) => line.currency === statement.scope.currency);
  const group = (types: readonly string[], sign: 1 | -1): Line[] =>
    base
      .filter((account) => types.includes(account.type))
      .map((account) => ({ account, amount: sign * account.closingSignedMinor }))
      .filter((line) => line.amount !== 0);
  return {
    // Cash and bank accounts are assets too, as the server's totals count them.
    assets: group(ASSET_TYPES, 1),
    liabilities: group(["LIABILITY"], -1),
    equity: group(["EQUITY"], -1),
  };
}

function AccountLink({ account }: { account: FinancialAccountRow }) {
  return (
    <Link
      to="/general-ledger"
      search={{ account: account.accountId }}
      className="hover:text-primary hover:underline"
    >
      {account.code} {account.name}
    </Link>
  );
}

function Section({
  title,
  lines,
  total,
  currency,
  compare,
  compareTotal,
}: {
  title: string;
  lines: Line[];
  total: number;
  currency: string;
  compare?: Map<string, number> | undefined;
  compareTotal?: number | undefined;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </div>
      {lines.map(({ account, amount }) => (
        <div
          key={account.accountId}
          className="flex items-baseline justify-between gap-4 px-4 py-2 pl-8 text-[13px]"
        >
          <AccountLink account={account} />
          <span className="flex gap-6 tabular-nums">
            {compare && (
              <span className="w-32 text-right text-muted-foreground">
                {reportMoney(compare.get(account.accountId) ?? 0, currency)}
              </span>
            )}
            <span className="w-32 text-right">{reportMoney(amount, currency)}</span>
          </span>
        </div>
      ))}
      {lines.length === 0 && (
        <p className="px-8 py-2 text-[12px] text-muted-foreground">Nothing recorded.</p>
      )}
      <StatementRow
        label={`Total ${title.toLowerCase()}`}
        amount={total}
        currency={currency}
        strong
        compare={compareTotal}
      />
    </div>
  );
}

function ProfitAndLoss({
  statement,
  previous,
}: {
  statement: FinanceStatement;
  previous: FinanceStatement | null;
}) {
  const currency = statement.scope.currency;
  const current = profitAndLoss(statement);
  const before = previous ? profitAndLoss(previous) : null;
  const priorByAccount = before
    ? new Map(
        [...before.income, ...before.costOfSales, ...before.expenses].map((line) => [
          line.account.accountId,
          line.amount,
        ]),
      )
    : undefined;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        <Metric label="Income" value={reportMoney(current.totals.income, currency)} />
        <Metric label="Gross profit" value={reportMoney(current.totals.grossProfit, currency)} />
        <Metric label="Expenses" value={reportMoney(current.totals.expenses, currency)} />
        <Metric label="Net result" value={reportMoney(current.totals.netResult, currency)} />
      </div>
      {before && (
        <div className="flex justify-end gap-6 px-4 text-[11px] font-semibold uppercase text-muted-foreground">
          <span className="w-32 text-right">Previous period</span>
          <span className="w-32 text-right">This period</span>
        </div>
      )}
      <Section
        title="Income"
        lines={current.income}
        total={current.totals.income}
        currency={currency}
        compare={priorByAccount}
        compareTotal={before?.totals.income}
      />
      <Section
        title="Cost of sales"
        lines={current.costOfSales}
        total={current.totals.costOfSales}
        currency={currency}
        compare={priorByAccount}
        compareTotal={before?.totals.costOfSales}
      />
      <StatementRow
        label="Gross profit"
        amount={current.totals.grossProfit}
        currency={currency}
        strong
        compare={before?.totals.grossProfit}
      />
      <Section
        title="Expenses"
        lines={current.expenses}
        total={current.totals.expenses}
        currency={currency}
        compare={priorByAccount}
        compareTotal={before?.totals.expenses}
      />
      <StatementRow
        label="Net result"
        amount={current.totals.netResult}
        currency={currency}
        strong
        compare={before?.totals.netResult}
      />
    </>
  );
}

function BalanceSheet({ statement }: { statement: FinanceStatement }) {
  const currency = statement.scope.currency;
  const sheet = balanceSheet(statement);
  const sum = (lines: Line[]) => lines.reduce((total, line) => total + line.amount, 0);
  const profit = statement.balanceSheet.unclosedEarningsMinor;
  return (
    <>
      <p className="px-4 pt-3 text-[12px] text-muted-foreground">As at {statement.scope.to}</p>
      <Section title="Assets" lines={sheet.assets} total={sum(sheet.assets)} currency={currency} />
      <Section
        title="Liabilities"
        lines={sheet.liabilities}
        total={sum(sheet.liabilities)}
        currency={currency}
      />
      <Section title="Equity" lines={sheet.equity} total={sum(sheet.equity)} currency={currency} />
      <StatementRow label="Profit not yet closed" amount={profit} currency={currency} />
      <StatementRow
        label="Total liabilities and equity"
        amount={sum(sheet.liabilities) + sum(sheet.equity) + profit}
        currency={currency}
        strong
      />
      {statement.balanceSheet.differenceMinor !== 0 && (
        <p className="m-4 rounded-md bg-warning-soft p-3 text-[12px]">
          Out of balance by {reportMoney(statement.balanceSheet.differenceMinor, currency)}. See the
          checks below.
        </p>
      )}
    </>
  );
}

function CashFlow({ statement }: { statement: FinanceStatement }) {
  const currency = statement.scope.currency;
  const cash = statement.cashMovement;
  if (!cash)
    return (
      <p className="p-4 text-[13px]">
        Mark your cash and bank accounts to see cash flow.{" "}
        <Link
          to="/seramet-setup"
          search={{ section: "ACCOUNTING" }}
          className="font-semibold text-primary hover:underline"
        >
          Open Setup Centre → Accounting
        </Link>
      </p>
    );
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
      <Metric label="Opening cash and bank" value={reportMoney(cash.openingMinor, currency)} />
      <Metric label="Net movement" value={reportMoney(cash.periodMinor, currency)} />
      <Metric
        label="Closing cash and bank"
        value={reportMoney(cash.openingMinor + cash.periodMinor, currency)}
      />
    </div>
  );
}

function TrialBalance({ statement }: { statement: FinanceStatement }) {
  const rows = statement.lines.filter(
    (row) =>
      row.openingDebitMinor ||
      row.openingCreditMinor ||
      row.periodDebitMinor ||
      row.periodCreditMinor ||
      row.closingSignedMinor,
  );
  const head = "px-3 py-2 text-left text-[11px] font-semibold uppercase text-muted-foreground";
  const cell = "border-t border-border px-3 py-2.5 text-[12px]";
  const num = cell + " text-right tabular-nums";
  const currency = statement.scope.currency;
  if (rows.length === 0)
    return (
      <p className="p-4 text-[12px] text-muted-foreground">Nothing recorded in this period.</p>
    );
  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-2 p-4 pb-2 text-[12px]">
        <Status>{statement.trial.balanced ? "Balanced" : "Out of balance"}</Status>
      </div>
      <table className="w-full min-w-[760px]">
        <thead>
          <tr>
            {["Account", "Type", "Opening", "Debit", "Credit", "Closing"].map((name, index) => (
              <th key={name} className={head + (index > 1 ? " text-right" : "")}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.accountId}>
              <td className={cell}>
                <AccountLink account={row} />
              </td>
              <td className={cell}>{accountTypeLabel(row.type)}</td>
              <td className={num}>
                {reportMoney(row.openingDebitMinor - row.openingCreditMinor, row.currency)}
              </td>
              <td className={num}>{reportMoney(row.periodDebitMinor, row.currency)}</td>
              <td className={num}>{reportMoney(row.periodCreditMinor, row.currency)}</td>
              <td className={num}>{reportMoney(row.closingSignedMinor, row.currency)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cell} colSpan={3}>
              Total
            </td>
            <td className={num}>{reportMoney(statement.trial.periodDebitMinor, currency)}</td>
            <td className={num}>{reportMoney(statement.trial.periodCreditMinor, currency)}</td>
            <td className={cell} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function exportStatement(tab: StatementTab, statement: FinanceStatement) {
  const currency = statement.scope.currency;
  const money = (minor: number) => majorFromMinor(minor, currency).toFixed(minorDigits(currency));
  const name = `${tab}-${statement.scope.from}-to-${statement.scope.to}.csv`;
  if (tab === "profit-loss") {
    const pnl = profitAndLoss(statement);
    exportVisibleFinancialCsv(
      name,
      ["Section", "Account", "Amount"],
      [
        ...pnl.income.map((l) => [
          "Income",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ...pnl.costOfSales.map((l) => [
          "Cost of sales",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ...pnl.expenses.map((l) => [
          "Expenses",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ["", "Net result", money(pnl.totals.netResult)],
      ],
    );
    return;
  }
  if (tab === "balance-sheet") {
    const sheet = balanceSheet(statement);
    exportVisibleFinancialCsv(
      name,
      ["Section", "Account", "Amount"],
      [
        ...sheet.assets.map((l) => [
          "Assets",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ...sheet.liabilities.map((l) => [
          "Liabilities",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ...sheet.equity.map((l) => [
          "Equity",
          `${l.account.code} ${l.account.name}`,
          money(l.amount),
        ]),
        ["Equity", "Profit not yet closed", money(statement.balanceSheet.unclosedEarningsMinor)],
      ],
    );
    return;
  }
  exportVisibleFinancialCsv(
    name,
    ["Code", "Account", "Type", "Currency", "Opening", "Debit", "Credit", "Closing"],
    statement.lines.map((row) => [
      row.code,
      row.name,
      accountTypeLabel(row.type),
      row.currency,
      money(row.openingDebitMinor - row.openingCreditMinor),
      money(row.periodDebitMinor),
      money(row.periodCreditMinor),
      money(row.closingSignedMinor),
    ]),
  );
}

export function StatementsPage({ tab }: { tab: StatementTab }) {
  const { branchLabel } = useAppContext();
  const navigate = useNavigate();
  const dates = useFinancePeriod();
  const [compare, setCompare] = useState(false);
  const result = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const prior = previousPeriod(dates.from, dates.to);
  const previous = useFinanceReport<FinanceStatement>(
    "statement",
    prior?.from ?? "",
    prior?.to ?? "",
    {
      enabled: Boolean(prior) && compare && tab === "profit-loss",
    },
  );
  const statement = result.report;
  return (
    <AppShell
      title="Statements"
      subtitle={branchLabel}
      actions={
        statement && (
          <Btn onClick={() => exportStatement(tab, statement)}>
            <Download className="h-4 w-4" /> Export CSV
          </Btn>
        )
      }
    >
      <FinanceDates {...dates} refresh={result.refresh} />
      <FinanceFetchState status={result.status} error={result.error} retry={result.refresh} />
      {statement && (
        <>
          <Panel className="mt-4 overflow-hidden">
            <PageTabs
              tabs={statementTabs}
              active={tab}
              onSelect={(next) => void navigate({ to: "/statements", search: { tab: next } })}
            />
            {tab === "profit-loss" && (
              <>
                {prior && (
                  <label className="flex items-center justify-end gap-2 px-4 pt-3 text-[12px]">
                    <input
                      type="checkbox"
                      checked={compare}
                      onChange={(event) => setCompare(event.target.checked)}
                    />
                    Compare with {prior.from} – {prior.to}
                  </label>
                )}
                <ProfitAndLoss statement={statement} previous={compare ? previous.report : null} />
              </>
            )}
            {tab === "balance-sheet" && <BalanceSheet statement={statement} />}
            {tab === "cash-flow" && <CashFlow statement={statement} />}
            {tab === "trial-balance" && <TrialBalance statement={statement} />}
          </Panel>
          {statement.quality !== "RECONCILED" && (
            <FinanceQuality quality={statement.quality} issues={statement.issues} />
          )}
        </>
      )}
    </AppShell>
  );
}
