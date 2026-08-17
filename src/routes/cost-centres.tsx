import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/cost-centres")({
  head: () => ({
    meta: [
      { title: "Cost Centres - Seramet" },
      {
        name: "description",
        content: "Departmental profitability for kitchen, bar, delivery, front of house and events.",
      },
      { property: "og:title", content: "Cost Centres - Seramet" },
      { property: "og:description", content: "Revenue, direct cost and contribution by restaurant department." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CostCentres,
});

const centres = [
  { centre: "Kitchen", revenue: 2684000, direct: 921400, labour: 604200, status: "Healthy" },
  { centre: "Bar", revenue: 699700, direct: 165100, labour: 128600, status: "Healthy" },
  { centre: "Delivery", revenue: 486200, direct: 214800, labour: 142600, status: "Attention" },
  { centre: "Front of house", revenue: 158700, direct: 42100, labour: 148900, status: "Critical" },
  { centre: "Events and catering", revenue: 100000, direct: 19000, labour: 24600, status: "Healthy" },
];

const allocations = [
  ["Rent", "Floor area", "Kitchen 45% - Bar 20% - FOH 30% - Delivery 5%"],
  ["Electricity", "Metered where possible, else floor area", "Kitchen 55% - Bar 25% - FOH 20%"],
  ["Management salaries", "Revenue share", "Pro-rata monthly"],
  ["Delivery commission", "Direct", "Delivery cost centre only"],
];

function CostCentres() {
  const { branchLabel } = useAppContext();
  const revenue = centres.reduce((s, c) => s + c.revenue, 0);
  const contribution = centres.reduce((s, c) => s + (c.revenue - c.direct - c.labour), 0);
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
        <Metric label="Revenue" value={revenue} money />
        <Metric label="Contribution" value={contribution} money />
        <Metric label="Contribution margin" value={Math.round((contribution / revenue) * 100)} suffix="%" />
        <Metric label="Cost centres" value={centres.length} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Departmental P&L" sub="Direct cost and labour charged to the centre that consumes it" />
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
              {centres.map((row) => {
                const value = row.revenue - row.direct - row.labour;
                return (
                  <tr key={row.centre} className="hover:bg-secondary/40">
                    <TD className="font-semibold">{row.centre}</TD>
                    <TD className="num text-right">{ksh(row.revenue)}</TD>
                    <TD className="num text-right text-muted-foreground">{ksh(row.direct)}</TD>
                    <TD className="num text-right text-muted-foreground">{ksh(row.labour)}</TD>
                    <TD className="num text-right font-semibold">{ksh(value)}</TD>
                    <TD className="num text-right">{Math.round((value / row.revenue) * 100)}%</TD>
                    <TD>
                      <Status>{row.status}</Status>
                    </TD>
                  </tr>
                );
              })}
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
