import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/balance-sheet")({
  head: () => ({ meta: [{ title: "Balance Sheet - Seramet" }] }),
  component: BalanceSheet,
});

const rows = emptyRecords();

function BalanceSheet() {
  return (
    <AppShell
      title="Balance sheet"
      subtitle="Current reporting period - all authorized branches"
      actions={
        <>
          <Btn>Compare</Btn>
          <Btn>Export</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Assets" value={0} money />
        <Metric label="Liabilities" value={0} money />
        <Metric label="Equity" value={0} money />
        <Metric label="Current ratio" value="Not available" />
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
