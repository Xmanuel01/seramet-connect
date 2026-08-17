import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/budgets")({
  head: () => ({
    meta: [
      { title: "Budgets - Seramet" },
      {
        name: "description",
        content: "Annual and monthly restaurant budgets by branch with actual spend and variance tracking.",
      },
      { property: "og:title", content: "Budgets - Seramet" },
      { property: "og:description", content: "Budget vs actual for revenue, cost of sales, labour and overheads." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Budgets,
});

type Line = { account: string; group: string; budget: number; actual: number };

const lines: Line[] = [
  { account: "Food sales", group: "Revenue", budget: 3600000, actual: 3428900 },
  { account: "Beverage sales", group: "Revenue", budget: 720000, actual: 699700 },
  { account: "Cost of sales - food", group: "Cost of sales", budget: 1188000, actual: 1131500 },
  { account: "Cost of sales - beverage", group: "Cost of sales", budget: 172800, actual: 165100 },
  { account: "Wages and salaries", group: "Labour", budget: 980000, actual: 1048900 },
  { account: "Casual labour", group: "Labour", budget: 120000, actual: 96400 },
  { account: "Rent", group: "Overheads", budget: 360000, actual: 360000 },
  { account: "Utilities", group: "Overheads", budget: 168000, actual: 186400 },
  { account: "Marketing", group: "Overheads", budget: 90000, actual: 62800 },
  { account: "Repairs and maintenance", group: "Overheads", budget: 60000, actual: 78200 },
];

function Budgets() {
  const { branchLabel } = useAppContext();
  const budget = lines.reduce((s, l) => s + l.budget, 0);
  const actual = lines.reduce((s, l) => s + l.actual, 0);
  return (
    <AppShell
      title="Budgets"
      subtitle={`FY2026 budget vs actual  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Import budget</Btn>
          <Btn variant="primary">New budget version</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Budgeted" value={budget} money />
        <Metric label="Actual" value={actual} money />
        <Metric label="Variance" value={Math.abs(budget - actual)} money invert />
        <Metric label="Lines over budget" value={lines.filter((l) => l.actual > l.budget).length} invert />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Budget lines" sub="Monthly phasing with rolling variance and owner accountability" />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Group</TH>
                <TH>Account</TH>
                <TH className="text-right">Budget</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Variance</TH>
                <TH className="text-right">Used</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const variance = line.budget - line.actual;
                const used = Math.round((line.actual / line.budget) * 100);
                const over = line.group !== "Revenue" && variance < 0;
                const short = line.group === "Revenue" && variance > 0;
                return (
                  <tr key={line.account} className="hover:bg-secondary/40">
                    <TD className="text-muted-foreground">{line.group}</TD>
                    <TD className="font-semibold">{line.account}</TD>
                    <TD className="num text-right">{ksh(line.budget)}</TD>
                    <TD className="num text-right font-semibold">{ksh(line.actual)}</TD>
                    <TD className="num text-right">{ksh(variance)}</TD>
                    <TD className="num text-right">{used}%</TD>
                    <TD>
                      <Status>{over ? "Critical" : short ? "Attention" : "Healthy"}</Status>
                    </TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
