import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh, pnl, revenueTrend } from "@/data/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/finance")({
  head: () => ({
    meta: [
      { title: "Finance — Seramet" },
      { name: "description", content: "Profit & loss, cash position, receivables, payables and expense control." },
      { property: "og:title", content: "Finance — Seramet" },
      { property: "og:description", content: "P&L, cash, receivables and payables in one finance workspace." },
    ],
  }),
  component: Finance,
});

const payables = [
  { s: "Main Meat Supplier", inv: "MMS-2291", due: "14 Aug", amount: 128400, paid: 60000, age: "12 d", status: "Partial" },
  { s: "Samwest", inv: "SW-8842", due: "18 Aug", amount: 96200, paid: 96200, age: "—", status: "Paid" },
  { s: "Muthurwa Groceries", inv: "MG-0471", due: "09 Aug", amount: 42800, paid: 0, age: "3 d overdue", status: "Critical" },
  { s: "Packaging Supplier", inv: "PKG-1120", due: "22 Aug", amount: 31600, paid: 0, age: "—", status: "Pending" },
];

function Finance() {
  return (
    <AppShell
      title="Finance"
      subtitle="Month to date · 1–12 August 2026 · all branches"
      actions={<><Btn>Compare budget</Btn><Btn>Export</Btn><Btn variant="primary">Post journal</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Revenue" value={4862400} money delta={7.6} />
        <Metric label="Gross profit" value={3238100} money delta={6.1} />
        <Metric label="Operating expenses" value={2184600} money delta={3.2} invert />
        <Metric label="Net profit" value={957300} money delta={4.2} />
        <Metric label="Receivables" value={312800} money delta={-6.4} />
        <Metric label="Payables" value={299000} money delta={9.1} invert />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel>
          <PanelHead title="Cash position" sub="Rolling 7 days · operating account" />
          <div className="h-[230px] p-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTrend} margin={{ left: -14, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="cash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="d" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                <YAxis tickFormatter={(v) => `${v / 1000}k`} tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                <Tooltip formatter={(v: number) => ksh(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                <Area dataKey="sales" stroke="var(--color-success)" strokeWidth={2} fill="url(#cash)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Profit & loss" sub="Actual vs previous month" right={<Btn>Expand all</Btn>} />
          <table className="w-full">
            <thead><tr><TH>Account</TH><TH className="text-right">Actual</TH><TH className="text-right">Prev</TH></tr></thead>
            <tbody>
              {pnl.map((r) => (
                <tr key={r.label} className={cn(r.total && "bg-secondary/50")}>
                  <TD className={cn(r.indent && "pl-7 text-muted-foreground", (r.bold || r.total) && "font-semibold", r.strong && "text-[14px] font-extrabold")}>
                    {r.label}
                  </TD>
                  <TD className={cn("num text-right", (r.bold || r.total) && "font-semibold", r.value < 0 && "text-muted-foreground")}>
                    {ksh(Math.abs(r.value))}
                  </TD>
                  <TD className="num text-right text-muted-foreground">{ksh(Math.round(Math.abs(r.value) * 0.94))}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel className="mt-4">
        <PanelHead title="Accounts payable ageing" sub="4 supplier invoices open" right={<Btn variant="primary">Schedule payment</Btn>} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead><tr><TH>Supplier</TH><TH>Invoice</TH><TH>Due</TH><TH className="text-right">Amount</TH><TH className="text-right">Paid</TH><TH className="text-right">Outstanding</TH><TH>Age</TH><TH>Status</TH></tr></thead>
            <tbody>
              {payables.map((p) => (
                <tr key={p.inv} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{p.s}</TD>
                  <TD className="num text-muted-foreground">{p.inv}</TD>
                  <TD className="text-muted-foreground">{p.due}</TD>
                  <TD className="num text-right">{ksh(p.amount)}</TD>
                  <TD className="num text-right text-muted-foreground">{ksh(p.paid)}</TD>
                  <TD className="num text-right font-semibold">{ksh(p.amount - p.paid)}</TD>
                  <TD className="text-muted-foreground">{p.age}</TD>
                  <TD><Status>{p.status}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}