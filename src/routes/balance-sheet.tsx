import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet - Seramet" }] }),
  component: BalanceSheet,
});

const rows = [
  ["Assets", 2386400, 2210000, true],
  ["Cash and bank", 486420, 412100, false],
  ["Inventory", 1284600, 1322000, false],
  ["Receivables", 312800, 341900, false],
  ["Fixed assets", 302580, 134000, false],
  ["Liabilities", 944200, 902400, true],
  ["Accounts payable", 299000, 274200, false],
  ["Payroll liabilities", 118600, 110800, false],
  ["Loans and accruals", 526600, 517400, false],
  ["Equity", 1442200, 1307600, true],
  ["Retained earnings", 484900, 421000, false],
  ["Current year profit", 957300, 886600, false],
];

function BalanceSheet() {
  return (
    <AppShell
      title="Balance sheet"
      subtitle="As at 12 August 2026 - all branches"
      actions={
        <>
          <Btn>Compare</Btn>
          <Btn>Export</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Assets" value={2386400} money />
        <Metric label="Liabilities" value={944200} money />
        <Metric label="Equity" value={1442200} money />
        <Metric label="Current ratio" value="2.5x" />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Statement of financial position"
          sub="Expandable groups with previous-period comparison"
        />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Account group</TH>
              <TH className="text-right">Current</TH>
              <TH className="text-right">Previous</TH>
              <TH className="text-right">Variance</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, current, previous, group]) => (
              <tr
                key={String(label)}
                className={group ? "bg-secondary/50" : "hover:bg-secondary/40"}
              >
                <TD className={group ? "font-bold" : "pl-7 text-muted-foreground"}>{label}</TD>
                <TD className="num text-right font-semibold">{ksh(Number(current))}</TD>
                <TD className="num text-right text-muted-foreground">{ksh(Number(previous))}</TD>
                <TD className="num text-right font-semibold">
                  {ksh(Number(current) - Number(previous))}
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
