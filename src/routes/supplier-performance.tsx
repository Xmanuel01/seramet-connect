import { createFileRoute } from "@tanstack/react-router";
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
  head: () => ({ meta: [{ title: "Supplier Performance - Seramet" }] }),
  component: SupplierPerformance,
});

function SupplierPerformance() {
  const { activeTenantId, branchLabel, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const suppliers = management.control?.suppliers ?? [];
  const currency =
    management.control?.latest?.currency ??
    configuredTenantCurrency(platformState.tenants, activeTenantId);
  return (
    <AppShell
      title="Supplier performance"
      subtitle={`Receipt, variance and payable evidence - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={suppliers.length === 0}
      />
      {management.status === "ready" && suppliers.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Suppliers" value={suppliers.length} />
            <Metric
              label="Purchase value"
              value={formatMinor(
                suppliers.reduce((sum, row) => sum + row.purchaseValueMinor, 0),
                currency,
              )}
            />
            <Metric
              label="Outstanding payable"
              value={formatMinor(
                suppliers.reduce((sum, row) => sum + row.outstandingPayableMinor, 0),
                currency,
              )}
            />
            <Metric
              label="Match exceptions"
              value={suppliers.reduce((sum, row) => sum + row.invoiceMatchExceptions, 0)}
            />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Supplier evidence"
              sub="No automatic supplier replacement recommendation"
            />
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Supplier</TH>
                  <TH className="text-right">Purchases</TH>
                  <TH className="text-right">Lead time</TH>
                  <TH className="text-right">On time</TH>
                  <TH className="text-right">Fill rate</TH>
                  <TH className="text-right">Rejected qty</TH>
                  <TH className="text-right">Price variance</TH>
                  <TH className="text-right">Payable</TH>
                  <TH>Quality</TH>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((row) => (
                  <tr key={row.supplierId}>
                    <TD className="font-semibold">{row.supplierName}</TD>
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
        </>
      )}
    </AppShell>
  );
}
