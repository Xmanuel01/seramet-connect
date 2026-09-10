import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Segmented, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { deriveBranchOperations } from "@/lib/restaurant-operations";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Seramet - Home Dashboard" },
      {
        name: "description",
        content:
          "Live sales, business health, alerts and branch performance for the active tenant.",
      },
      { property: "og:title", content: "Seramet - Home Dashboard" },
      {
        property: "og:description",
        content: "Sales, health signals, alerts and branch performance in one view.",
      },
    ],
  }),
  component: Home,
});

const sevTone: Record<string, string> = {
  critical: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-info-soft text-info",
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function periodStart(period: string, now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "Yesterday") start.setDate(start.getDate() - 1);
  if (period === "Week") start.setDate(start.getDate() - 6);
  if (period === "Month") start.setDate(1);
  return start;
}

function dateKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function lastSevenDays(now: Date) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - index));
    return {
      key: dateKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
    };
  });
}

function Home() {
  const [period, setPeriod] = useState("Today");
  const {
    branch,
    branchLabel,
    branchRecords,
    matchesBranch,
    role,
    currentUser,
    hasPermission,
    locale,
    timeZone,
  } = useAppContext();
  const { state } = useTransactionEngine();
  const operations = deriveBranchOperations(state, branch);
  const canViewDashboard = hasPermission(permissions.dashboardView);
  const report = useMemo(() => {
    const now = new Date();
    const start = periodStart(period, now);
    const scopedOrders = state.orders.filter((order) => {
      const created = new Date(order.createdAt);
      return (
        matchesBranch(order.branchId ?? order.branch) &&
        created >= start &&
        created <= now &&
        !["DRAFT", "HELD", "CANCELLED"].includes(order.status)
      );
    });
    const netSales = scopedOrders.reduce((total, order) => total + order.total, 0);
    const scopedMovements = state.stockMovements.filter((movement) => {
      const created = new Date(movement.createdAt);
      return (
        matchesBranch(movement.branchId ?? movement.branch) &&
        movement.type === "SALE_CONSUMPTION" &&
        created >= start &&
        created <= now
      );
    });
    const cost = scopedMovements.reduce(
      (total, movement) => total + Math.abs(movement.quantity) * movement.unitCost,
      0,
    );
    const collected = state.payments
      .filter((payment) => {
        const created = new Date(payment.timestamp);
        return (
          matchesBranch(payment.branchId ?? payment.branch) && created >= start && created <= now
        );
      })
      .reduce((total, payment) => total + payment.amount, 0);
    const trend = lastSevenDays(now).map(({ key, label }) => ({
      d: label,
      sales: scopedOrders
        .filter((order) => dateKey(order.createdAt) === key)
        .reduce((total, order) => total + order.total, 0),
      cost: scopedMovements
        .filter((movement) => dateKey(movement.createdAt) === key)
        .reduce((total, movement) => total + Math.abs(movement.quantity) * movement.unitCost, 0),
    }));
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      h: `${String(hour).padStart(2, "0")}:00`,
      v: scopedOrders
        .filter((order) => new Date(order.createdAt).getHours() === hour)
        .reduce((total, order) => total + order.total, 0),
    })).filter((row) => row.v > 0);
    const channels = [...new Set(scopedOrders.map((order) => order.channel))].map((channel) => ({
      name: channel,
      value: scopedOrders
        .filter((order) => order.channel === channel)
        .reduce((total, order) => total + order.total, 0),
    }));
    const branches = branchRecords
      .filter((record) => matchesBranch(record.id))
      .map((record) => {
        const orders = scopedOrders.filter(
          (order) => order.branchId === record.id || order.branch === record.name,
        );
        const sales = orders.reduce((total, order) => total + order.total, 0);
        const branchCost = scopedMovements
          .filter((movement) => movement.branchId === record.id || movement.branch === record.name)
          .reduce((total, movement) => total + Math.abs(movement.quantity) * movement.unitCost, 0);
        const margin = sales > 0 ? ((sales - branchCost) / sales) * 100 : 0;
        const foodCost = sales > 0 ? (branchCost / sales) * 100 : 0;
        return {
          branch: record.name,
          sales,
          orders: orders.length,
          margin: Math.round(margin),
          foodCost: Math.round(foodCost),
          status: sales === 0 ? "No activity" : margin >= 60 ? "Healthy" : "Attention",
        };
      });
    return { netSales, cost, collected, orders: scopedOrders, trend, hourly, channels, branches };
  }, [branchRecords, matchesBranch, period, state.orders, state.payments, state.stockMovements]);
  const grossProfit = report.netSales - report.cost;
  const scopedKpis = [
    { label: "Net Sales", value: report.netSales, money: true },
    { label: "Orders", value: report.orders.length },
    {
      label: "Avg Order Value",
      value: report.orders.length ? Math.round(report.netSales / report.orders.length) : 0,
      money: true,
    },
    { label: "Gross Profit", value: grossProfit, money: true },
    {
      label: "Gross Margin",
      value: report.netSales ? Math.round((grossProfit / report.netSales) * 1000) / 10 : 0,
      suffix: "%",
    },
    {
      label: "Food Cost",
      value: report.netSales ? Math.round((report.cost / report.netSales) * 1000) / 10 : 0,
      suffix: "%",
      invert: true,
    },
    { label: "Unmatched", value: operations.unreadablePayments, invert: true },
    { label: "Collected", value: report.collected, money: true },
  ];
  const scopedTrend = report.trend;
  const scopedSalesByHour = report.hourly;
  const scopedSalesByChannel = report.channels;
  const scopedBranches = report.branches;
  const scopedAlerts = operations.actions;
  if (!canViewDashboard) {
    return (
      <AppShell title="Dashboard restricted" subtitle={`${role} - ${branchLabel}`}>
        <Panel className="p-5">
          <div className="max-w-xl">
            <div className="text-[15px] font-bold">
              This dashboard contains management-only business data.
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Your account opens only the modules assigned to your role and branch. A manager can
              change page privileges from Settings when the restaurant wants this role to see more
              areas.
            </p>
          </div>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={`${greeting()}, ${currentUser.name.split(" ")[0]}`}
      subtitle={`${branchLabel}  -  ${new Date().toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone,
        year: "numeric",
      })}`}
      actions={
        <>
          <Segmented
            options={["Today", "Yesterday", "Week", "Month"]}
            value={period}
            onChange={setPeriod}
          />
          <Btn>Export</Btn>
          <Link to="/pos">
            <Btn variant="primary">Open POS</Btn>
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {scopedKpis.map((k) => (
          <Metric key={k.label} {...k} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <Panel>
            <PanelHead
              title="Revenue vs cost of sales"
              sub={`Last 7 days  -  ${branchLabel.toLowerCase()}`}
              right={<Segmented options={["Day", "Week"]} value="Week" onChange={() => {}} />}
            />
            <div className="h-[240px] p-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scopedTrend} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
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
                    contentStyle={{
                      borderRadius: 10,
                      border: "1px solid var(--color-border)",
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="sales"
                    stroke="var(--color-primary)"
                    strokeWidth={2}
                    fill="url(#g1)"
                  />
                  <Area
                    type="monotone"
                    dataKey="cost"
                    stroke="var(--color-warning)"
                    strokeWidth={1.5}
                    fill="none"
                    strokeDasharray="4 4"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHead
                title="Sales by hour"
                sub={
                  scopedSalesByHour.length ? "Recorded order activity" : "No sales in this period"
                }
              />
              <div className="h-[190px] p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scopedSalesByHour} margin={{ left: -22, right: 8, top: 6 }}>
                    <CartesianGrid stroke="var(--color-border)" vertical={false} />
                    <XAxis
                      dataKey="h"
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
                      dataKey="v"
                      fill="var(--color-primary)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={26}
                    />
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
                      <Pie
                        data={scopedSalesByChannel}
                        dataKey="value"
                        innerRadius={44}
                        outerRadius={70}
                        paddingAngle={2}
                        stroke="none"
                      >
                        {scopedSalesByChannel.map((_, i) => (
                          <Cell key={i} fill={`var(--color-chart-${i + 1})`} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => ksh(v)}
                        contentStyle={{ borderRadius: 10, fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="min-w-0 flex-1 space-y-2">
                  {scopedSalesByChannel.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2 text-[13px]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: `var(--color-chart-${i + 1})` }}
                      />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {c.name}
                      </span>
                      <span className="num font-semibold">{ksh(c.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHead
              title="Branch performance"
              sub={`${period} - authoritative branch totals`}
              right={<Btn>Compare</Btn>}
            />
            <div className="grid gap-3 p-3 md:hidden">
              {scopedBranches.map((b) => (
                <article
                  key={b.branch}
                  className="rounded-lg border border-border bg-card p-3 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[13px] font-bold">{b.branch}</div>
                      <div className="num mt-1 text-[16px] font-bold">{ksh(b.sales)}</div>
                    </div>
                    <Status>{b.status}</Status>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Orders</span>
                      <span className="num font-semibold">{b.orders}</span>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Margin</span>
                      <span className="num font-semibold">{b.margin}%</span>
                    </div>
                    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                      <span className="block text-muted-foreground">Food cost</span>
                      <span className="num font-semibold">{b.foodCost}%</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
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
                  {scopedBranches.map((b) => (
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
                <span className="num text-[19px] font-extrabold text-accent-foreground">
                  {operations.score}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">Business Health</div>
                <div className="text-[12px] text-muted-foreground">
                  {operations.label} - {operations.readiness.score}% branch readiness
                </div>
              </div>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5">
              {operations.signals.map((s) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between rounded-md bg-secondary/50 px-2 py-1.5"
                >
                  <span className="text-[12px] font-medium">{s.name}</span>
                  <Status>{s.state}</Status>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHead
              title="Management alerts"
              sub={`${scopedAlerts.length} open`}
              right={
                <Link to="/approvals" className="text-[12px] font-semibold text-primary">
                  View all
                </Link>
              }
            />
            <ul className="divide-y divide-border">
              {scopedAlerts.map((a) => (
                <li key={a.title} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sevTone[a.sev]}`}
                    >
                      {a.sev}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold leading-snug">{a.title}</div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">{a.detail}</div>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span>{a.branch}</span>
                        <span> - </span>
                        <span>{a.time}</span>
                        <Link
                          to={a.to as never}
                          className="ml-auto font-semibold text-primary hover:underline"
                        >
                          {a.action}
                        </Link>
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
