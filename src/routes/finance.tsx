import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { FinanceFetchState, NeedsAttention, reportMoney } from "@/finance/finance-ui";
import { profitAndLoss } from "@/finance/StatementsPage";
import {
  type FinanceStatement,
  useFinancePeriod,
  useFinanceReport,
} from "@/finance/use-finance-report";
import { useAppContext } from "@/lib/app-context";
import { formatBps, formatMinor, ManagementReadModelState } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Finance - Seramet" }] }),
  component: FinanceOverview,
});

function FinanceOverview() {
  const { branchLabel } = useAppContext();
  const management = useManagementIntelligence();
  const dates = useFinancePeriod();
  const accounts = useFinanceReport<FinanceStatement>("statement", dates.from, dates.to);
  const control = management.control;
  const pnl = control?.flashPnl;
  const statement = accounts.report;
  const posted = statement ? profitAndLoss(statement) : null;
  const blockers = control?.closeReadiness?.blockers ?? [];
  const liveLabel = pnl
    ? pnl.periodStart === pnl.periodEnd
      ? `${pnl.periodStart}, before closing`
      : `${pnl.periodStart} – ${pnl.periodEnd}, before closing`
    : "";
  return (
    <AppShell
      title="Finance"
      subtitle={branchLabel}
      actions={
        <Btn
          onClick={() => {
            void management.refresh();
            accounts.refresh();
          }}
        >
          Refresh
        </Btn>
      }
    >
      <Panel>
        <PanelHead
          title="Sales and profit"
          sub={liveLabel}
          right={
            <Link
              to="/prime-cost"
              className="text-[12px] font-semibold text-primary hover:underline"
            >
              Prime cost
            </Link>
          }
        />
        <ManagementReadModelState
          status={management.status}
          error={management.error}
          empty={!pnl}
        />
        {management.status === "ready" && pnl && (
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
            <Metric label="Net sales" value={formatMinor(pnl.netRevenueMinor, pnl.currency)} />
            <Metric label="Cost of sales" value={formatMinor(pnl.cogsMinor, pnl.currency)} />
            <Metric label="Gross profit" value={formatMinor(pnl.grossProfitMinor, pnl.currency)} />
            <Metric label="Gross margin" value={formatBps(pnl.grossMarginBps)} />
            <Metric
              label="Operating result"
              value={formatMinor(pnl.flashOperatingResultMinor, pnl.currency)}
            />
          </div>
        )}
      </Panel>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHead
            title="Accounts"
            sub={`${dates.from} – ${dates.to}`}
            right={
              <Link
                to="/statements"
                search={{ tab: "profit-loss" }}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:underline"
              >
                Statements <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <FinanceFetchState
            status={accounts.status}
            error={accounts.error}
            retry={accounts.refresh}
          />
          {statement && posted && (
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
              <Metric
                label="Income"
                value={reportMoney(posted.totals.income, statement.scope.currency)}
              />
              <Metric
                label="Expenses"
                value={reportMoney(
                  posted.totals.costOfSales + posted.totals.expenses,
                  statement.scope.currency,
                )}
              />
              <Metric
                label="Net result"
                value={reportMoney(posted.totals.netResult, statement.scope.currency)}
              />
              <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Books
                </div>
                <div className="mt-2">
                  <Status>
                    {statement.quality === "RECONCILED" ? "Balanced" : "Needs attention"}
                  </Status>
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Needs attention" />
          {statement && statement.quality !== "RECONCILED" && (
            <Link
              to="/statements"
              search={{ tab: "trial-balance" }}
              className="flex items-center gap-3 border-b border-border px-4 py-3 text-[13px] hover:bg-secondary/50"
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
              <span className="min-w-0 flex-1">Accounts checks</span>
              <span className="font-semibold tabular-nums">{statement.issues.length}</span>
            </Link>
          )}
          {management.status === "ready" && (
            <NeedsAttention
              blockers={blockers}
              empty={
                statement?.quality === "RECONCILED" || !statement
                  ? "Nothing needs attention."
                  : "No other items."
              }
            />
          )}
        </Panel>
      </div>

      {management.status === "ready" && control && control.channels.length > 0 && (
        <Panel className="mt-4 overflow-x-auto">
          <PanelHead title="Profit by channel" sub={liveLabel} />
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <TH>Channel</TH>
                <TH className="text-right">Orders</TH>
                <TH className="text-right">Net sales</TH>
                <TH className="text-right">Commission</TH>
                <TH className="text-right">Cost of sales</TH>
                <TH className="text-right">Contribution</TH>
              </tr>
            </thead>
            <tbody>
              {control.channels.map((channel) => (
                <tr key={channel.channelKey}>
                  <TD className="font-semibold">{channel.channelLabel}</TD>
                  <TD className="num text-right">{channel.orderCount}</TD>
                  <TD className="num text-right">
                    {formatMinor(channel.netSalesMinor, channel.currency)}
                  </TD>
                  <TD className="num text-right">
                    {formatMinor(channel.commissionMinor, channel.currency)}
                  </TD>
                  <TD className="num text-right">
                    {formatMinor(channel.cogsMinor, channel.currency)}
                  </TD>
                  <TD className="num text-right font-semibold">
                    {formatMinor(channel.contributionMinor, channel.currency)}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </AppShell>
  );
}
