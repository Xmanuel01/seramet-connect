import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/cash-flow")({
  head: () => ({ meta: [{ title: "Cash Flow - Seramet" }] }),
  component: CashFlow,
});

const rows = [
  ["Opening cash", 421600],
  ["Operating activities", 284200],
  ["Investing activities", -128400],
  ["Financing activities", -91200],
  ["Net cash movement", 64600],
  ["Closing cash", 486200],
];

function CashFlow() {
  return (
    <AppShell
      title="Cash flow"
      subtitle="Month to date - direct cash movement view"
      actions={
        <>
          <Btn>Branch: All</Btn>
          <Btn>Export</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Opening cash" value={421600} money />
        <Metric label="Operating" value={284200} money delta={11} />
        <Metric label="Net movement" value={64600} money />
        <Metric label="Closing cash" value={486200} money />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead title="Cash movement" sub="Operating, investing and financing" />
          <div className="h-[260px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows.slice(1, 4).map(([name, value]) => ({ name, value }))}
                margin={{ left: -8, right: 8 }}
              >
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
                  dataKey="value"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={42}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel>
          <PanelHead title="Statement" />
          <table className="w-full">
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={String(label)}>
                  <TD className="font-semibold">{label}</TD>
                  <TD className="num text-right font-bold">{ksh(Number(value))}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </AppShell>
  );
}
