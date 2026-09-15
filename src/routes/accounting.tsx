import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting Hub - Seramet" },
      {
        name: "description",
        content:
          "Restaurant accounting hub: daily sales journal, ledger, taxes, budgets, prime cost and period close.",
      },
      { property: "og:title", content: "Accounting Hub - Seramet" },
      {
        property: "og:description",
        content: "Double-entry restaurant accounting from POS to statutory statements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountingHub,
});

const modules: { to: string; label: string; sub: string }[] = [
  {
    to: "/daily-sales-journal",
    label: "Daily sales journal",
    sub: "Z-report posted to the ledger each trading day",
  },
  { to: "/general-ledger", label: "General ledger", sub: "Chart of accounts and journal vouchers" },
  {
    to: "/trial-balance",
    label: "Trial balance",
    sub: "Debits and credits by account, per period",
  },
  {
    to: "/prime-cost",
    label: "Prime cost",
    sub: "COGS + labour against sales, the restaurant KPI",
  },
  { to: "/budgets", label: "Budgets", sub: "Branch budget vs actual with variance" },
  {
    to: "/cost-centres",
    label: "Cost centres",
    sub: "Kitchen, bar, delivery and front of house P&L",
  },
  { to: "/tax-centre", label: "Tax centre", sub: "VAT, catering levy, withholding and PAYE" },
  {
    to: "/credit-notes",
    label: "Credit & debit notes",
    sub: "Adjustments against invoices and supplier bills",
  },
  { to: "/depreciation", label: "Depreciation", sub: "Fixed asset schedules and monthly charge" },
  { to: "/period-close", label: "Period close", sub: "Day-end, month-end checklist and lock" },
  { to: "/profit-loss", label: "Profit & loss", sub: "Income statement by branch and period" },
  { to: "/balance-sheet", label: "Balance sheet", sub: "Assets, liabilities and equity" },
];

const postings = [
  [
    "POS settlement",
    "Cash / M-Pesa / card -> Sales revenue, VAT payable",
    "Automatic, per trading day",
  ],
  ["Goods received", "Inventory -> Accounts payable", "On GRN post"],
  ["Recipe consumption", "Cost of sales -> Inventory", "On production and sale"],
  ["Wastage & breakage", "Wastage expense -> Inventory", "On approved log"],
  ["Payroll run", "Wages expense -> Payroll liabilities, PAYE, NSSF, NHIF", "On payroll approval"],
  ["Supplier payment", "Accounts payable -> Bank / cash", "On payment"],
  ["Refund / void", "Sales revenue, VAT payable -> Cash", "On approved refund"],
];

function AccountingHub() {
  const { branchLabel } = useAppContext();
  return (
    <AppShell
      title="Accounting"
      subtitle={`Restaurant accounting control panel  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Export ledger</Btn>
          <Btn variant="primary">Run period close</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Revenue MTD" value={4128600} money />
        <Metric label="Prime cost" value={58.4} suffix="%" invert />
        <Metric label="Out of balance" value={0} money />
        <Metric label="Unposted vouchers" value={2} invert />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Accounting modules"
          sub="Every restaurant transaction has a ledger home"
        />
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link
              key={module.to}
              to={module.to}
              className="rounded-lg border border-border px-3 py-3 transition-colors hover:bg-secondary/50"
            >
              <div className="text-[13px] font-semibold">{module.label}</div>
              <div className="text-[12px] text-muted-foreground">{module.sub}</div>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel className="mt-4">
        <PanelHead
          title="Posting rules"
          sub="How operational events become double-entry journals"
          right={<Status>Active</Status>}
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Event</TH>
              <TH>Journal</TH>
              <TH>Trigger</TH>
            </tr>
          </thead>
          <tbody>
            {postings.map(([event, journal, trigger]) => (
              <tr key={event} className="hover:bg-secondary/40">
                <TD className="font-semibold">{event}</TD>
                <TD className="text-muted-foreground">{journal}</TD>
                <TD className="text-muted-foreground">{trigger}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="mt-4">
        <PanelHead title="Month to date summary" sub="Accrual basis, all posted vouchers" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Line</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">% of sales</TH>
            </tr>
          </thead>
          <tbody>
            {[
              ["Food & beverage sales", 4128600, 100],
              ["Cost of sales", 1362400, 33],
              ["Gross profit", 2766200, 67],
              ["Labour cost", 1048900, 25.4],
              ["Operating expenses", 704300, 17.1],
              ["Net profit", 1013000, 24.5],
            ].map(([line, amount, pct]) => (
              <tr key={String(line)} className="hover:bg-secondary/40">
                <TD className="font-semibold">{line}</TD>
                <TD className="num text-right font-semibold">{ksh(Number(amount))}</TD>
                <TD className="num text-right text-muted-foreground">{pct}%</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
