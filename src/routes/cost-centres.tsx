import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { currentMonthSettledSales } from "@/lib/financial-reporting";

export const Route = createFileRoute("/cost-centres")({
  head: () => ({
    meta: [
      { title: "Cost Centres - Seramet" },
      {
        name: "description",
        content:
          "Departmental profitability for kitchen, bar, delivery, front of house and events.",
      },
      { property: "og:title", content: "Cost Centres - Seramet" },
      {
        property: "og:description",
        content: "Revenue, direct cost and contribution by restaurant department.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostCentres,
});


const allocations = emptyRecords();

function CostCentres() {
  const { branchLabel, matchesBranch } = useAppContext();
  const { state } = useTransactionEngine();
  const sales = currentMonthSettledSales(state, matchesBranch);
  const centres = sales.revenueByCategory.map((row) => ({
    centre: row.category,
    revenue: row.revenue,
  }));
  return (
    <AppShell
      title="Cost centres"
      subtitle={`Departmental profitability  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Allocation rules</Btn>
          <Btn variant="primary">Export</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Revenue MTD" value={sales.netSales} money />
        <Metric label="Contribution" value="Not available" />
        <Metric label="Contribution margin" value="Not available" />
        <Metric label="Revenue categories" value={centres.length} />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Departmental P&L"
          sub="Direct cost and labour charged to the centre that consumes it"
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <TH>Cost centre</TH>
                <TH className="text-right">Revenue</TH>
                <TH className="text-right">Direct cost</TH>
                <TH className="text-right">Labour</TH>
                <TH className="text-right">Contribution</TH>
                <TH className="text-right">Margin</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {centres.map((row) => (
                <tr key={row.centre} className="hover:bg-secondary/40">
                  <TD className="font-semibold">{row.centre}</TD>
                  <TD className="num text-right">{ksh(row.revenue)}</TD>
                  <TD className="text-right text-muted-foreground">Not available</TD>
                  <TD className="text-right text-muted-foreground">Not available</TD>
                  <TD className="text-right text-muted-foreground">Not available</TD>
                  <TD className="text-right text-muted-foreground">Not available</TD>
                  <TD>
                    <Status>Revenue only</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Overhead allocation" sub="Shared cost drivers and their split" />
        <table className="w-full">
          <thead>
            <tr>
              <TH>Overhead</TH>
              <TH>Driver</TH>
              <TH>Split</TH>
            </tr>
          </thead>
          <tbody>
            {allocations.map(([overhead, driver, split]) => (
              <tr key={overhead} className="hover:bg-secondary/40">
                <TD className="font-semibold">{overhead}</TD>
                <TD className="text-muted-foreground">{driver}</TD>
                <TD className="text-muted-foreground">{split}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
