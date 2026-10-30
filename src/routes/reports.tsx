import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { deriveBranchOperations } from "@/lib/restaurant-operations";
import { businessDateForTimestamp } from "@/lib/business-date";
import { projectFinancialLifecycle } from "@/lib/financial-lifecycle";
import { majorFromMinor } from "@/payments/money";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Report Centre - Seramet" },
      {
        name: "description",
        content: "Pinned, recent and categorised reports across sales, stock, finance and people.",
      },
      { property: "og:title", content: "Report Centre - Seramet" },
      { property: "og:description", content: "Categorised, pinnable reports for every module." },
    ],
  }),
  component: Reports,
});

const availableReports = [
  {
    to: "/daily-sales-journal",
    label: "Daily sales journal",
    detail: "Closed business-date snapshot",
  },
  { to: "/profit-loss", label: "Profit and loss", detail: "Settled revenue and configured costs" },
  {
    to: "/supplier-performance",
    label: "Supplier performance",
    detail: "Evidence-backed procurement metrics",
  },
  { to: "/attendance", label: "Attendance", detail: "Recorded employee attendance" },
] as const;

function Reports() {
  const { activeTenantId, branch, branchLabel, branchRecords, branchScope, currency, timeZone } =
    useAppContext();
  const { state, syncFromBackend, backendStatus } = useTransactionEngine();
  const selectedBranches =
    branchScope.type === "ALL"
      ? branchRecords
      : branchRecords.filter((configuredBranch) => configuredBranch.name === branch);
  const scopedPreview = selectedBranches.map((configuredBranch) => {
    const branchTimeZone = configuredBranch.timezone ?? timeZone;
    const cutoffMinutes = Number(configuredBranch.metadata["businessDayCutoffMinutes"] ?? 0);
    const businessDate = businessDateForTimestamp(new Date(), branchTimeZone, cutoffMinutes);
    const projection = projectFinancialLifecycle(state, {
      tenantId: activeTenantId,
      branchId: configuredBranch.id,
      businessDate,
      currency,
      timeZone: branchTimeZone,
      businessDayCutoffMinutes: cutoffMinutes,
    });
    const health = deriveBranchOperations(state, configuredBranch.name);
    return {
      branch: configuredBranch.name,
      businessDate,
      sales: majorFromMinor(projection.netRevenueMinor, currency),
      orders: projection.orderCount,
      paidRate: projection.invoiceCount
        ? Math.round((projection.settledInvoiceCount / projection.invoiceCount) * 100)
        : 0,
      projection,
      state: health.label,
    };
  });
  const businessDates = [...new Set(scopedPreview.map((row) => row.businessDate))];
  const businessDateLabel = businessDates.length === 1 ? businessDates[0] : "Per branch";
  const totalSales = scopedPreview.reduce((sum, row) => sum + row.sales, 0);
  const totalOrders = scopedPreview.reduce((sum, row) => sum + row.orders, 0);
  const avgOrder = totalOrders ? Math.round(totalSales / totalOrders) : 0;
  const paidRate = totalOrders
    ? Math.round(
        scopedPreview.reduce((sum, row) => sum + row.orders * row.paidRate, 0) / totalOrders,
      )
    : 0;
  return (
    <AppShell title="Report centre" subtitle={`Operational and financial reports - ${branchLabel}`}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Ordered"
          value={majorFromMinor(
            scopedPreview.reduce((sum, row) => sum + row.projection.orderedMinor, 0),
            currency,
          )}
          money
        />
        <Metric
          label="Invoiced"
          value={majorFromMinor(
            scopedPreview.reduce((sum, row) => sum + row.projection.invoicedMinor, 0),
            currency,
          )}
          money
        />
        <Metric
          label="Settled"
          value={majorFromMinor(
            scopedPreview.reduce((sum, row) => sum + row.projection.settledMinor, 0),
            currency,
          )}
          money
        />
        <Metric
          label="Collected"
          value={majorFromMinor(
            scopedPreview.reduce((sum, row) => sum + row.projection.collectedMinor, 0),
            currency,
          )}
          money
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead
            title="Report shell preview"
            sub="Daily sales summary"
            right={<Btn onClick={() => void syncFromBackend()}>Refresh</Btn>}
          />
          <div className="border-b border-border px-4 py-3">
            <Chips
              items={[
                `Business date: ${businessDateLabel}`,
                `Branch: ${branch}`,
                `Sync: ${backendStatus}`,
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
            <Metric label="Net sales" value={totalSales} money />
            <Metric label="Orders" value={totalOrders} />
            <Metric label="Average order" value={avgOrder} money />
            <Metric label="Paid orders" value={paidRate} suffix="%" />
          </div>
          <div className="grid gap-3 p-3 md:hidden">
            {scopedPreview.map((r) => (
              <article
                key={r.branch}
                className="rounded-lg border border-border bg-card p-3 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-bold">{r.branch}</div>
                    <div className="num mt-1 text-[16px] font-bold">{ksh(r.sales)}</div>
                  </div>
                  <Status>{r.state}</Status>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Orders </span>
                    <span className="num font-semibold">{r.orders}</span>
                  </div>
                  <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                    <span className="text-muted-foreground">Paid </span>
                    <span className="num font-semibold">{r.paidRate}%</span>
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
                  <TH className="text-right">Paid rate</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {scopedPreview.map((r) => (
                  <tr key={r.branch} className="hover:bg-secondary/50">
                    <TD className="font-semibold">{r.branch}</TD>
                    <TD className="num text-right font-semibold">{ksh(r.sales)}</TD>
                    <TD className="num text-right">{r.orders}</TD>
                    <TD className="num text-right">{r.paidRate}%</TD>
                    <TD>
                      <Status>{r.state}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Available reports" sub="Reports backed by implemented data sources" />
          <ul className="divide-y divide-border">
            {availableReports.map((item) => (
              <li key={item.to} className="px-4 py-2.5 text-[13px] hover:bg-secondary/50">
                <Link to={item.to} className="block">
                  <span className="font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {item.detail}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
