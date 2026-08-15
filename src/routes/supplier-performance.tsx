import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/supplier-performance")({
  head: () => ({ meta: [{ title: "Supplier Performance - Seramet" }] }),
  component: SupplierPerformance,
});

const suppliers = [
  {
    name: "Main Meat Supplier",
    spend: 842000,
    onTime: 88,
    quality: 3,
    price: "+12%",
    status: "Attention",
  },
  { name: "Samwest", spend: 612400, onTime: 96, quality: 1, price: "+2%", status: "Healthy" },
  {
    name: "Muthurwa Groceries",
    spend: 318200,
    onTime: 74,
    quality: 5,
    price: "+6%",
    status: "Critical",
  },
  {
    name: "Packaging Supplier",
    spend: 148600,
    onTime: 92,
    quality: 0,
    price: "0%",
    status: "Healthy",
  },
];

function SupplierPerformance() {
  return (
    <AppShell
      title="Supplier performance"
      subtitle="Spend, on-time delivery, price changes and quality issues"
      actions={
        <>
          <Btn>90 days</Btn>
          <Btn>Export</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Purchasing spend" value={1921200} money />
        <Metric label="On-time delivery" value={87} suffix="%" />
        <Metric label="Price changes" value={4} invert />
        <Metric label="Quality issues" value={9} invert />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel>
          <PanelHead title="Spend by supplier" />
          <div className="h-[260px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={suppliers} margin={{ left: -8, right: 8 }}>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--color-muted-foreground)"
                />
                <YAxis
                  tickFormatter={(v) => `${Number(v) / 1000}k`}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  stroke="var(--color-muted-foreground)"
                />
                <Tooltip
                  formatter={(v: number) => ksh(v)}
                  contentStyle={{ borderRadius: 10, fontSize: 12 }}
                />
                <Bar
                  dataKey="spend"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Supplier scorecard" />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Supplier</TH>
                <TH className="text-right">On-time</TH>
                <TH className="text-right">Issues</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.name}>
                  <TD className="font-semibold">{supplier.name}</TD>
                  <TD className="num text-right">{supplier.onTime}%</TD>
                  <TD className="num text-right">{supplier.quality}</TD>
                  <TD>
                    <Status>{supplier.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </AppShell>
  );
}
