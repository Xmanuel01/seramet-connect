import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useManagementIntelligence } from "@/management/use-management-intelligence";
import type { FinancialSummary } from "@/management/types";

export const Route = createFileRoute("/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting Hub - Seramet" },
      {
        name: "description",
        content: "Restaurant accounting hub: daily sales journal, ledger, taxes, budgets, prime cost and period close.",
      },
      { property: "og:title", content: "Accounting Hub - Seramet" },
      { property: "og:description", content: "Double-entry restaurant accounting from POS to statutory statements." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountingHub,
});

const modules: { to: string; label: string; sub: string }[] = [
  { to: "/daily-sales-journal", label: "Daily sales journal", sub: "Z-report posted to the ledger each trading day" },
  { to: "/general-ledger", label: "General ledger", sub: "Chart of accounts and journal vouchers" },
  { to: "/trial-balance", label: "Trial balance", sub: "Debits and credits by account, per period" },
  { to: "/prime-cost", label: "Prime cost", sub: "COGS + labour against sales, the restaurant KPI" },
  { to: "/budgets", label: "Budgets", sub: "Branch budget vs actual with variance" },
  { to: "/cost-centres", label: "Cost centres", sub: "Kitchen, bar, delivery and front of house P&L" },
  { to: "/tax-centre", label: "Tax centre", sub: "VAT, catering levy, withholding and PAYE" },
  { to: "/credit-notes", label: "Credit & debit notes", sub: "Adjustments against invoices and supplier bills" },
  { to: "/depreciation", label: "Depreciation", sub: "Fixed asset schedules and monthly charge" },
  { to: "/period-close", label: "Period close", sub: "Day-end, month-end checklist and lock" },
  { to: "/profit-loss", label: "Profit & loss", sub: "Income statement by branch and period" },
  { to: "/balance-sheet", label: "Balance sheet", sub: "Assets, liabilities and equity" },
];

const postingExamples = [
  ["POS settlement", "Cash / M-Pesa / card → Sales revenue, VAT payable", "After verified settlement and posting"],
  ["Goods received", "Inventory → Accounts payable", "On GRN post"],
  ["Recipe consumption", "Cost of sales → Inventory", "On production and sale"],
  ["Wastage & breakage", "Wastage expense → Inventory", "On approved log"],
  ["Payroll run", "Wages expense → Payroll liabilities", "On payroll approval"],
  ["Supplier payment", "Accounts payable → Bank / cash", "On payment"],
  ["Refund / void", "Sales revenue, VAT payable → Cash", "On approved refund"],
];

// Only combine authoritative read models for the same month and currency. These are
// operational flash figures, not posted journal/ledger balances.
function combineMonthToDate(summaries: FinancialSummary[]): FinancialSummary | null {
  if (!summaries.length || summaries.some((summary) => summary.periodType !== "MONTH_TO_DATE")) return null;
  const first = summaries[0]!;
  if (summaries.some((summary) => summary.currency !== first.currency || summary.periodStart !== first.periodStart || summary.periodEnd !== first.periodEnd)) return null;
  const sum = (field: "netSalesMinor" | "cogsMinor" | "grossProfitMinor" | "labourCostMinor" | "operatingExpensesMinor" | "flashOperatingResultMinor") =>
    summaries.reduce((total, summary) => total + summary[field], 0);
  return {
    ...first,
    netSalesMinor: sum("netSalesMinor"),
    cogsMinor: sum("cogsMinor"),
    grossProfitMinor: sum("grossProfitMinor"),
    labourCostMinor: sum("labourCostMinor"),
    operatingExpensesMinor: sum("operatingExpensesMinor"),
    flashOperatingResultMinor: sum("flashOperatingResultMinor"),
    quality: summaries.some((summary) => summary.quality === "INSUFFICIENT_DATA")
      ? "INSUFFICIENT_DATA"
      : summaries.some((summary) => summary.quality === "PARTIAL") ? "PARTIAL" : "COMPLETE",
    qualityReasons: summaries.flatMap((summary) => summary.qualityReasons),
  };
}

function AccountingHub() {
  const { branchLabel } = useAppContext();
  const management = useManagementIntelligence();
  const summaries = management.controls.map((control) => control.flashPnl).filter((summary): summary is FinancialSummary => summary !== null);
  const flash = management.status === "ready" && summaries.length === management.controls.length
    ? combineMonthToDate(summaries)
    : null;
  const entries: Array<[string, number]> = flash ? [
    ["Operational net sales", flash.netSalesMinor],
    ["Cost of sales", flash.cogsMinor],
    ["Operational gross profit", flash.grossProfitMinor],
    ["Labour cost", flash.labourCostMinor],
    ["Operating expenses", flash.operatingExpensesMinor],
    ["Flash operating result", flash.flashOperatingResultMinor],
  ] : [];
  const value = (minor: number | undefined) => minor === undefined ? "Not available" : ksh(minor / 100);

  return (
    <AppShell title="Accounting" subtitle={`Restaurant accounting control panel - ${branchLabel}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Operational net sales MTD" value={value(flash?.netSalesMinor)} />
        <Metric label="Operational gross profit MTD" value={value(flash?.grossProfitMinor)} />
        <Metric label="Flash operating result MTD" value={value(flash?.flashOperatingResultMinor)} />
        <Metric label="Posted ledger revenue" value="Not available" />
      </div>
      <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
        {management.status === "error"
          ? `Financial read model unavailable: ${management.error}`
          : !flash
            ? "No comparable month-to-date financial read model is available for this branch and currency. No sample figures are shown."
            : `Operational flash figures (${flash.periodStart} to ${flash.periodEnd}, ${flash.currency}); quality: ${flash.quality}. These are not posted ledger balances or a statutory Profit & Loss statement.`}
      </div>
      <Panel className="mt-4">
        <PanelHead title="Accounting modules" sub="Open the relevant module to inspect its own authoritative records" />
        <div className="grid gap-2 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((module) => (
            <Link key={module.to} to={module.to} className="rounded-lg border border-border px-3 py-3 transition-colors hover:bg-secondary/50">
              <div className="text-[13px] font-semibold">{module.label}</div>
              <div className="text-[12px] text-muted-foreground">{module.sub}</div>
            </Link>
          ))}
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Posting reference" sub="Illustrative journal mappings; verify actual postings in General Ledger" right={<Status>Reference</Status>} />
        <table className="w-full">
          <thead><tr><TH>Event</TH><TH>Journal</TH><TH>Trigger</TH></tr></thead>
          <tbody>
            {postingExamples.map(([event, journal, trigger]) => (
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
        <PanelHead title="Month-to-date operational flash summary" sub="Management read model; not a posted-voucher statement" />
        {!entries.length ? (
          <div className="p-4 text-sm text-muted-foreground">No authoritative month-to-date summary is available.</div>
        ) : (
          <table className="w-full">
            <thead><tr><TH>Line</TH><TH className="text-right">Amount ({flash?.currency})</TH><TH className="text-right">% of net sales</TH></tr></thead>
            <tbody>
              {entries.map(([line, amount]) => (
                <tr key={line} className="hover:bg-secondary/40">
                  <TD className="font-semibold">{line}</TD>
                  <TD className="num text-right font-semibold">{ksh(amount / 100)}</TD>
                  <TD className="num text-right text-muted-foreground">
                    {flash && flash.netSalesMinor !== 0 ? `${(amount / flash.netSalesMinor * 100).toFixed(1)}%` : "—"}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </AppShell>
  );
}
