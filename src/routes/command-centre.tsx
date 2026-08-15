import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { alerts, branchPerf, decisions, health, ksh, revenueTrend } from "@/data/mock";

export const Route = createFileRoute("/command-centre")({
  head: () => ({
    meta: [
      { title: "Command Centre - Seramet" },
      {
        name: "description",
        content:
          "Company-wide business intelligence: health, profitability, risks and pending decisions.",
      },
      { property: "og:title", content: "Command Centre - Seramet" },
      {
        property: "og:description",
        content: "Whole-company health, risks and decisions for directors.",
      },
    ],
  }),
  component: CommandCentre,
});

const forecast = [
  { d: "Wk 30", actual: 1120000, plan: 1080000 },
  { d: "Wk 31", actual: 1184000, plan: 1150000 },
  { d: "Wk 32", actual: 1092000, plan: 1200000 },
  { d: "Wk 33", actual: 1268000, plan: 1240000 },
  { d: "Wk 34", actual: 1198000, plan: 1310000 },
];

const risks = [
  { r: "Single supplier dependency for beef", impact: "High", owner: "Procurement" },
  { r: "Cash buffer below 45 days at Ngong Road", impact: "Medium", owner: "Finance" },
  { r: "Kitchen understaffed on weekends", impact: "Medium", owner: "People" },
];

function CommandCentre() {
  return (
    <AppShell
      title="Command centre"
      subtitle="Mona Swahili  -  all branches  -  month to date"
      actions={
        <>
          <Btn>Month to date</Btn>
          <Btn variant="primary">Board pack</Btn>
        </>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Revenue MTD" value={4862400} money delta={7.6} />
            <Metric label="Net profit" value={957300} money delta={4.2} />
            <Metric label="Net margin" value={19.7} suffix="%" delta={-0.4} />
            <Metric label="Cash on hand" value={486420} money delta={2.4} />
          </div>

          <Panel>
            <PanelHead title="Actual vs plan" sub="Weekly revenue, all branches" />
            <div className="h-[220px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecast} margin={{ left: -14, right: 8, top: 8 }}>
                  <CartesianGrid stroke="var(--color-border)" vertical={false} />
                  <XAxis
                    dataKey="d"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--color-muted-foreground)"
                  />
                  <YAxis
                    tickFormatter={(v) => `${v / 1000000}M`}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--color-muted-foreground)"
                  />
                  <Tooltip
                    formatter={(v: number) => ksh(v)}
                    contentStyle={{ borderRadius: 10, fontSize: 12 }}
                  />
                  <Line
                    dataKey="actual"
                    stroke="var(--color-primary)"
                    strokeWidth={2.4}
                    dot={false}
                  />
                  <Line
                    dataKey="plan"
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={1.6}
                    strokeDasharray="5 4"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHead title="Daily revenue" sub="Last 7 days" />
              <div className="h-[180px] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueTrend} margin={{ left: -20, right: 8, top: 6 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="d"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="var(--color-muted-foreground)"
                    />
                    <YAxis
                      tickFormatter={(v) => `${v / 1000}k`}
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
                      dataKey="sales"
                      fill="var(--color-primary)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel>
              <PanelHead title="Branch comparison" sub="Month to date" />
              <table className="w-full">
                <thead>
                  <tr>
                    <TH>Branch</TH>
                    <TH className="text-right">Sales</TH>
                    <TH className="text-right">Margin</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {branchPerf.map((b) => (
                    <tr key={b.branch}>
                      <TD className="font-semibold">{b.branch}</TD>
                      <TD className="num text-right">{ksh(b.sales * 26)}</TD>
                      <TD className="num text-right">{b.margin}%</TD>
                      <TD>
                        <Status>{b.status}</Status>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          </div>

          <Panel>
            <PanelHead
              title="Risk register"
              sub="Owned and reviewed weekly"
              right={<Btn>Add risk</Btn>}
            />
            <table className="w-full">
              <thead>
                <tr>
                  <TH>Risk</TH>
                  <TH>Impact</TH>
                  <TH>Owner</TH>
                </tr>
              </thead>
              <tbody>
                {risks.map((r) => (
                  <tr key={r.r}>
                    <TD className="font-medium">{r.r}</TD>
                    <TD>
                      <Status>{r.impact === "High" ? "Critical" : "Attention"}</Status>
                    </TD>
                    <TD className="text-muted-foreground">{r.owner}</TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <div className="grid content-start gap-4">
          <Panel className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-accent">
                <span className="num text-[19px] font-extrabold text-accent-foreground">
                  {health.score}
                </span>
              </div>
              <div>
                <div className="text-[13px] font-semibold">Business health</div>
                <div className="text-[12px] text-muted-foreground">{health.label}</div>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {health.signals.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between rounded-md bg-secondary/50 px-2 py-1.5 text-[12px] font-medium"
                >
                  {s.name}
                  <Status>{s.state}</Status>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHead
              title="Pending decisions"
              sub="4 waiting on you"
              right={
                <Link to="/approvals" className="text-[12px] font-semibold text-primary">
                  Open
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {decisions.map((d) => (
                <li key={d.title} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold leading-snug">{d.title}</span>
                    <span className="num shrink-0 text-[13px] font-bold">{ksh(d.value)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {d.by} - {d.time}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHead title="Live alerts" sub="Across all modules" />
            <ul className="divide-y divide-border">
              {alerts.slice(0, 4).map((a) => (
                <li key={a.title} className="px-4 py-2.5 text-[12px]">
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-muted-foreground">
                    {a.branch} - {a.time}
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
