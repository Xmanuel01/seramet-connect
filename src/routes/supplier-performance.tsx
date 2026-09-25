import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  configuredTenantCurrency,
  formatBps,
  formatMinor,
  ManagementReadModelState,
  QualityStatus,
} from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/supplier-performance")({
  head: () => ({
    meta: [
      { title: "Supplier Performance - Seramet" },
      {
        name: "description",
        content:
          "Authoritative supplier delivery, quality, variance, returns, invoice-match and payable evidence.",
      },
    ],
  }),
  component: SupplierPerformance,
});

function SupplierPerformance() {
  const { activeTenantId, branchLabel, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const suppliers = management.control?.suppliers ?? [];
  const currency =
    management.control?.latest?.currency ??
    configuredTenantCurrency(platformState.tenants, activeTenantId);
  const businessDate = management.control?.periodEnd ?? "";
  const currencies = Array.from(new Set(suppliers.map((row) => row.currency)));
  const mixedCurrencies = currencies.length > 1;
  const totalsByCurrency = currencies.map((code) => {
    const rows = suppliers.filter((row) => row.currency === code);
    return {
      currency: code,
      purchaseMinor: rows.reduce((sum, row) => sum + row.purchaseValueMinor, 0),
      payableMinor: rows.reduce((sum, row) => sum + row.outstandingPayableMinor, 0),
      returnMinor: rows.reduce((sum, row) => sum + row.returnValueMinor, 0),
    };
  });
  const purchaseValueMinor = totalsByCurrency[0]?.purchaseMinor ?? 0;
  const outstandingPayableMinor = totalsByCurrency[0]?.payableMinor ?? 0;
  const returnValueMinor = totalsByCurrency[0]?.returnMinor ?? 0;
  const displayedCurrency = totalsByCurrency[0]?.currency ?? currency;
  const matchExceptions = suppliers.reduce((sum, row) => sum + row.invoiceMatchExceptions, 0);
  const orderCount = suppliers.reduce((sum, row) => sum + row.orderCount, 0);

  return (
    <AppShell
      title="Supplier performance"
      subtitle={`Receipt, quality, variance and payable evidence - ${branchLabel}${
        businessDate ? ` - ${businessDate}` : ""
      }`}
      actions={
        <>
          <Link to="/suppliers">
            <Btn>Suppliers</Btn>
          </Link>
          <Link to="/supplier-bills">
            <Btn>Supplier bills</Btn>
          </Link>
          <Btn onClick={() => void management.refresh()}>Refresh</Btn>
        </>
      }
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={suppliers.length === 0}
      />
      {management.status === "ready" && suppliers.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric label="Suppliers" value={suppliers.length} />
            <Metric label="Orders" value={orderCount} />
            <Metric
              label="Purchase value"
              value={
                mixedCurrencies
                  ? "See currency totals"
                  : formatMinor(purchaseValueMinor, displayedCurrency)
              }
            />
            <Metric
              label="Supplier returns"
              value={
                mixedCurrencies
                  ? "See currency totals"
                  : formatMinor(returnValueMinor, displayedCurrency)
              }
              invert={suppliers.some((row) => row.returnValueMinor > 0)}
            />
            <Metric
              label="Outstanding payable"
              value={
                mixedCurrencies
                  ? "See currency totals"
                  : formatMinor(outstandingPayableMinor, displayedCurrency)
              }
            />
            <Metric label="Match exceptions" value={matchExceptions} invert={matchExceptions > 0} />
          </div>

          {mixedCurrencies && (
            <Panel className="mt-4">
              <PanelHead
                title="Totals by currency"
                sub="Amounts in different currencies are not added together without conversion"
              />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <TH>Currency</TH>
                      <TH className="text-right">Purchases</TH>
                      <TH className="text-right">Returns</TH>
                      <TH className="text-right">Outstanding payable</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {totalsByCurrency.map((row) => (
                      <tr key={row.currency}>
                        <TD className="font-semibold">{row.currency}</TD>
                        <TD className="num text-right">
                          {formatMinor(row.purchaseMinor, row.currency)}
                        </TD>
                        <TD className="num text-right">
                          {formatMinor(row.returnMinor, row.currency)}
                        </TD>
                        <TD className="num text-right">
                          {formatMinor(row.payableMinor, row.currency)}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Supplier evidence"
              sub="Operational evidence only; Seramet does not auto-select or auto-replace suppliers"
            />
            <table className="w-full min-w-[1220px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Purchases</TH>
                  <TH className="text-right">Lead time</TH>
                  <TH className="text-right">On time</TH>
                  <TH className="text-right">Fill rate</TH>
                  <TH className="text-right">Rejected qty</TH>
                  <TH className="text-right">Price variance</TH>
                  <TH className="text-right">Returns</TH>
                  <TH className="text-right">Match exceptions</TH>
                  <TH className="text-right">Payable</TH>
                  <TH>Data quality</TH>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((row) => (
                  <tr key={row.supplierId}>
                    <TD>
                      <div className="font-semibold">{row.supplierName}</div>
                      <div className="text-[11px] text-muted-foreground">{row.businessDate}</div>
                    </TD>
                    <TD className="num text-right">{row.orderCount}</TD>
                    <TD className="num text-right">
                      {formatMinor(row.purchaseValueMinor, row.currency)}
                    </TD>
                    <TD className="num text-right">
                      {row.averageLeadTimeMinutes === null
                        ? "Missing"
                        : `${(row.averageLeadTimeMinutes / 1440).toFixed(1)} d`}
                    </TD>
                    <TD className="num text-right">
                      {row.onTimeBps === null ? "Missing" : formatBps(row.onTimeBps)}
                    </TD>
                    <TD className="num text-right">
                      {row.fillRateBps === null ? "Missing" : formatBps(row.fillRateBps)}
                    </TD>
                    <TD className="num text-right">
                      {(row.rejectedQuantityMicro / 1_000_000).toFixed(3)}
                    </TD>
                    <TD className="num text-right">
                      {formatMinor(row.priceVarianceMinor, row.currency)}
                    </TD>
                    <TD className="num text-right">
                      {formatMinor(row.returnValueMinor, row.currency)}
                    </TD>
                    <TD className="num text-right">{row.invoiceMatchExceptions}</TD>
                    <TD className="num text-right">
                      {formatMinor(row.outstandingPayableMinor, row.currency)}
                    </TD>
                    <TD>
                      <QualityStatus quality={row.quality} />
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel className="mt-4">
            <PanelHead
              title="Metric scope"
              sub="How to interpret the supplier evidence shown above"
            />
            <div className="grid gap-3 p-4 md:grid-cols-3">
              <ScopeNote
                title="Daily operational metrics"
                text="Purchase value, order count, rejected quantity, price variance and returns use the selected management business date."
              />
              <ScopeNote
                title="Delivery evidence"
                text="Lead time and on-time delivery use authoritative purchase-order and goods-receipt timestamps for the branch."
              />
              <ScopeNote
                title="Payables and matching"
                text="Outstanding payables and invoice-match exceptions are derived from posted supplier invoices and procurement match records."
              />
            </div>
          </Panel>
        </>
      )}
    </AppShell>
  );
}

function ScopeNote({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{text}</div>
    </div>
  );
}
