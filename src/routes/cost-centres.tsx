import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/cost-centres")({
  head: () => ({
    meta: [
      { title: "Cost Centres - Seramet" },
      { name: "description", content: "Departmental profitability for kitchen, bar, delivery, front of house and events." },
      { property: "og:title", content: "Cost Centres - Seramet" },
      { property: "og:description", content: "Revenue, direct cost and contribution by restaurant department." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostCentres,
});

// Departmental figures require authoritative department-allocated records.
// Never attribute a restaurant-wide sales figure to an arbitrary cost centre.
const centres = emptyRecords();
const allocations = emptyRecords();

function CostCentres() {
  const { branchLabel } = useAppContext();
  const revenue = centres.reduce((sum, centre) => sum + centre.revenue, 0);
  const contribution = centres.reduce((sum, centre) => sum + centre.revenue - centre.direct - centre.labour, 0);
  const hasAllocatedData = centres.length > 0;
  return (
    <AppShell title="Cost centres" subtitle={`Departmental profitability - ${branchLabel}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Allocated revenue" value={hasAllocatedData ? revenue : "Not available"} money={hasAllocatedData} />
        <Metric label="Contribution" value={hasAllocatedData ? contribution : "Not available"} money={hasAllocatedData} />
        <Metric label="Contribution margin" value={revenue > 0 ? Math.round(contribution / revenue * 100) : "Not available"} suffix={revenue > 0 ? "%" : ""} />
        <Metric label="Cost centres with data" value={centres.length} />
      </div>
      {!hasAllocatedData && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          No department-allocated financial records are available. Restaurant-wide sales cannot be assigned to cost centres without a configured allocation basis.
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead title="Departmental P&L" sub="Direct cost and labour charged to the centre that consumes it" />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><TH>Cost centre</TH><TH className="text-right">Revenue</TH><TH className="text-right">Direct cost</TH><TH className="text-right">Labour</TH><TH className="text-right">Contribution</TH><TH className="text-right">Margin</TH><TH>Status</TH></tr></thead>
            <tbody>
              {centres.map((row) => {
                const value = row.revenue - row.direct - row.labour;
                return (
                  <tr key={row.centre} className="hover:bg-secondary/40">
                    <TD className="font-semibold">{row.centre}</TD>
                    <TD className="num text-right">{ksh(row.revenue)}</TD>
                    <TD className="num text-right text-muted-foreground">{ksh(row.direct)}</TD>
                    <TD className="num text-right text-muted-foreground">{ksh(row.labour)}</TD>
                    <TD className="num text-right font-semibold">{ksh(value)}</TD>
                    <TD className="num text-right">{row.revenue > 0 ? `${Math.round(value / row.revenue * 100)}%` : "—"}</TD>
                    <TD><Status>{row.status}</Status></TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Overhead allocation" sub="Shared cost drivers and their split" />
        {!allocations.length && <div className="p-4 text-sm text-muted-foreground">No overhead allocation data is available.</div>}
        <table className="w-full">
          <thead><tr><TH>Overhead</TH><TH>Driver</TH><TH>Split</TH></tr></thead>
          <tbody>
            {allocations.map(([overhead, driver, split]) => (
              <tr key={overhead} className="hover:bg-secondary/40">
                <TD className="font-semibold">{overhead}</TD>
                <TD className="text-muted-foreground">{driver}</TD>
                <TD>{split}</TD>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </AppShell>
  );
}
