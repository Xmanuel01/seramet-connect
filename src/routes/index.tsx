import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Segmented, Status, TD, TH } from "@/components/app/ui";
import { alerts, branchPerf, health, kpis, ksh, revenueTrend, salesByChannel, salesByHour } from "@/data/mock";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seramet — Home Dashboard" },
      { name: "description", content: "Live sales, business health, alerts and branch performance for Mona Swahili." },
      { property: "og:title", content: "Seramet — Home Dashboard" },
      { property: "og:description", content: "Sales, health signals, alerts and branch performance in one view." },
    ],
  }),
  component: Home,
});

const sevTone: Record<string, string> = {
  critical: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
};

function Home() {
  const [period, setPeriod] = useState("Today");
  return (
    <AppShell
      title="Good afternoon, Emmanuel"
      subtitle="Westlands Branch · Wednesday, 12 August 2026"
      actions={
        <>
          <Segmented options={["Today", "Yesterday", "Week", "Month"]} value={period} onChange={setPeriod} />
          <Btn>Export</Btn>
          <Link to="/pos">
            <Btn variant="primary">Open POS</Btn>
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {kpis.map((k) => (
          <Metric key={k.label} {...k} note="vs previous Wednesday" />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <Panel>
            <PanelHead
              title="Revenue vs cost of sales"
              sub="Last 7 days · all branches"
              right={<Segmented options={["Day", "Week"]} value="Week" onChange={() => {}} />}
            />
            <div className="h-[240px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueTrend} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="d" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                  <YAxis tickFormatter={(v) => `${v / 1000}k`} tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                  <Tooltip
                    formatter={(v: number) => ksh(v)}
                    contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)", fontSize: 12 }}
                  />
                  <Area type="monotone" dataKey="sales" stroke="var(--color-primary)" strokeWidth={2} fill="url(#g1)" />
                  <Area type="monotone" dataKey="cost" stroke="var(--color-warning)" strokeWidth={1.5} fill="none" strokeDasharray="4 4" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHead title="Sales by hour" sub="Peak 8pm · KSh 41,200" />
              <div className="h-[190px] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={salesByHour} margin={{ left: -22, right: 8, top: 6 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="h" tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                    <YAxis tickFormatter={(v) => `${v / 1000}k`} tickLine={false} axisLine={false} fontSize={11} stroke="var(--color-muted-foreground)" />
                    <Tooltip formatter={(v: number) => ksh(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    <Bar dataKey="v" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <PanelHead title="Sales by channel" sub="Today" />
              <div className="flex items-center gap-2 p-3">
                <div className="h-[170px] w-[170px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={salesByChannel} dataKey="value" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
                        {salesByChannel.map((_, i) => (
                          <Cell key={i} fill={`var(--color-chart-${i + 1})`} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => ksh(v)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 flex-1 space-y-2">
                  {salesByChannel.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2 text-[13px]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: `var(--color-chart-${i + 1})` }} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.name}</span>
                      <span className="num font-semibold">{ksh(c.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHead title="Branch performance" sub="Today · compared with last Wednesday" right={<Btn>Compare</Btn>} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr>
                    <TH>Branch</TH>
                    <TH className="text-right">Sales</TH>
                    <TH className="text-right">Orders</TH>
                    <TH className="text-right">Margin</TH>
                    <TH className="text-right">Food cost</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {branchPerf.map((b) => (
                    <tr key={b.branch} className="hover:bg-secondary/50">
                      <TD className="font-semibold">{b.branch}</TD>
                      <TD className="num text-right font-semibold">{ksh(b.sales)}</TD>
                      <TD className="num text-right">{b.orders}</TD>
                      <TD className="num text-right">{b.margin}%</TD>
                      <TD className="num text-right">{b.foodCost}%</TD>
                      <TD>
                        <Status>{b.status}</Status>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel className="p-4">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <div className="relative grid h-16 w-16 place-items-center rounded-full bg-accent">
                <span className="num text-[19px] font-extrabold text-accent-foreground">{health.score}</span>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Business Health</div>
                <div className="text-[12px] text-muted-foreground">
                  {health.label} · 2 signals need attention
                </div>
              </div>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5">
              {health.signals.map((s) => (
                <li key={s.name} className="flex items-center justify-between rounded-md bg-secondary/50 px-2 py-1.5">
                  <span className="text-[12px] font-medium">{s.name}</span>
                  <Status>{s.state}</Status>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHead title="Management alerts" sub="5 open" right={<Link to="/approvals" className="text-[12px] font-semibold text-primary">View all</Link>} />
            <ul className="divide-y divide-border">
              {alerts.map((a) => (
                <li key={a.title} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sevTone[a.sev]}`}>
                      {a.sev}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold leading-snug">{a.title}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">{a.detail}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{a.branch}</span>
                        <span>·</span>
                        <span>{a.time}</span>
                        <button className="ml-auto font-semibold text-primary hover:underline">{a.action}</button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
