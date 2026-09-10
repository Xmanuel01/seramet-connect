import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  configuredTenantCurrency,
  formatBps,
  formatMinor,
  ManagementReadModelState,
  QualityStatus,
} from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Finance - Seramet" }] }),
  component: Finance,
});

function Finance() {
  const { activeTenantId, branchLabel, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const control = management.control;
  const pnl = control?.flashPnl;
  const currency =
    pnl?.currency ??
    control?.latest?.currency ??
    configuredTenantCurrency(platformState.tenants, activeTenantId);
  const rows = pnl
    ? ([
        ["Gross sales", pnl.grossSalesMinor],
        ["Discounts", -pnl.discountsMinor],
        ["Refunds", -pnl.refundsMinor],
        ["Net revenue", pnl.netRevenueMinor],
        ["COGS", -pnl.cogsMinor],
        ["Gross profit", pnl.grossProfitMinor],
        ["Labour cost", -pnl.labourCostMinor],
        ["Marketplace commissions", -pnl.marketplaceCommissionMinor],
        ["Payment processing fees", -pnl.paymentProcessingFeesMinor],
        ["Delivery fees", -pnl.deliveryFeesMinor],
        ["Operating expenses", -pnl.operatingExpensesMinor],
        ["Flash operating result", pnl.flashOperatingResultMinor],
      ] as const)
    : [];
  return (
    <AppShell
      title="Finance"
      subtitle={`Daily flash P&L and profitability - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState status={management.status} error={management.error} empty={!pnl} />
      {management.status === "ready" && pnl && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Metric label="Net revenue" value={formatMinor(pnl.netRevenueMinor, currency)} />
            <Metric label="Gross profit" value={formatMinor(pnl.grossProfitMinor, currency)} />
            <Metric label="Gross margin" value={formatBps(pnl.grossMarginBps)} />
            <Metric label="COGS" value={formatMinor(pnl.cogsMinor, currency)} />
            <Metric label="Contribution" value={formatMinor(pnl.contributionMinor, currency)} />
            <Metric
              label="Flash result"
              value={formatMinor(pnl.flashOperatingResultMinor, currency)}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel>
              <PanelHead
                title="Daily flash P&L"
                sub={`${pnl.periodStart} - ${pnl.periodEnd}`}
                right={<QualityStatus quality={pnl.quality} />}
              />
              <table className="w-full">
                <thead>
                  <tr>
                    <TH>Line</TH>
                    <TH className="text-right">Amount</TH>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, amount]) => (
                    <tr key={label}>
                      <TD
                        className={
                          label.includes("result") || label === "Gross profit"
                            ? "font-bold"
                            : "font-medium"
                        }
                      >
                        {label}
                      </TD>
                      <TD className="num text-right">{formatMinor(amount, currency)}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pnl.qualityReasons.length > 0 && (
                <div className="border-t border-border p-4 text-[12px] text-muted-foreground">
                  Partial because:{" "}
                  {pnl.qualityReasons.join(", ").replaceAll("_", " ").toLowerCase()}.
                </div>
              )}
            </Panel>
            <div className="grid content-start gap-4">
              <Panel>
                <PanelHead title="Inventory to GL" />
                <div className="space-y-3 p-4 text-[13px]">
                  <div className="flex justify-between">
                    <span>Subledger</span>
                    <span className="num font-semibold">
                      {formatMinor(
                        Number(control?.inventoryGl?.subledgerValueMinor ?? 0),
                        currency,
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>General ledger</span>
                    <span className="num font-semibold">
                      {formatMinor(Number(control?.inventoryGl?.glValueMinor ?? 0), currency)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-3">
                    <span>Difference</span>
                    <span className="num font-bold">
                      {formatMinor(Number(control?.inventoryGl?.differenceMinor ?? 0), currency)}
                    </span>
                  </div>
                  <Status>{String(control?.inventoryGl?.status ?? "Unavailable")}</Status>
                </div>
              </Panel>
              <Panel>
                <PanelHead title="Supplier payables" />
                <div className="p-4">
                  <div className="text-[22px] font-bold">
                    {formatMinor(
                      control?.suppliers.reduce(
                        (sum, supplier) => sum + supplier.outstandingPayableMinor,
                        0,
                      ) ?? 0,
                      currency,
                    )}
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Open approved and posted supplier invoices.
                  </p>
                </div>
              </Panel>
            </div>
          </div>

          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Channel profitability"
              sub="Channels are configured data; fees come from persisted charges and settlements"
            />
            <table className="w-full min-w-[920px]">
              <thead>
                <tr>
                  <TH>Channel</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Net sales</TH>
                  <TH className="text-right">Commission</TH>
                  <TH className="text-right">COGS</TH>
                  <TH className="text-right">Contribution</TH>
                  <TH className="text-right">Settlement diff</TH>
                  <TH>Quality</TH>
                </tr>
              </thead>
              <tbody>
                {control?.channels.map((channel) => (
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
                    <TD className="num text-right">
                      {channel.settlementDifferenceMinor === null
                        ? "Missing"
                        : formatMinor(channel.settlementDifferenceMinor, channel.currency)}
                    </TD>
                    <TD>
                      <QualityStatus quality={channel.quality} />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </AppShell>
  );
}
