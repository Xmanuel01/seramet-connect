import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import {
  configuredTenantCurrency,
  formatDuration,
  formatMinor,
  ManagementReadModelState,
  QualityStatus,
} from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/performance")({
  head: () => ({ meta: [{ title: "Staff Performance - Seramet" }] }),
  component: Performance,
});

function Performance() {
  const { activeTenantId, branchLabel, platformState } = useAppContext();
  const management = useManagementIntelligence();
  const staff = management.control?.staff ?? [];
  const currency =
    management.control?.latest?.currency ??
    configuredTenantCurrency(platformState.tenants, activeTenantId);
  return (
    <AppShell
      title="Performance"
      subtitle={`Factual attendance and service metrics - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={staff.length === 0}
      />
      {management.status === "ready" && staff.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Employees measured" value={staff.length} />
            <Metric
              label="Worked hours"
              value={(staff.reduce((sum, row) => sum + row.workedMinutes, 0) / 60).toFixed(1)}
            />
            <Metric
              label="Late minutes"
              value={staff.reduce((sum, row) => sum + row.lateMinutes, 0)}
            />
            <Metric
              label="Labour cost"
              value={formatMinor(
                staff.reduce((sum, row) => sum + row.labourCostMinor, 0),
                currency,
              )}
            />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Operational staff facts"
              sub="No opaque score or misconduct inference is calculated"
            />
            <table className="w-full min-w-[940px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH className="text-right">Hours</TH>
                  <TH className="text-right">Late min</TH>
                  <TH className="text-right">Orders</TH>
                  <TH className="text-right">Net sales</TH>
                  <TH className="text-right">AOV</TH>
                  <TH className="text-right">Service time</TH>
                  <TH className="text-right">Voids</TH>
                  <TH>Quality</TH>
                </tr>
              </thead>
              <tbody>
                {staff.map((row) => (
                  <tr key={row.employeeId}>
                    <TD className="font-semibold">{row.employeeName}</TD>
                    <TD className="num text-right">{(row.workedMinutes / 60).toFixed(1)}</TD>
                    <TD className="num text-right">{row.lateMinutes}</TD>
                    <TD className="num text-right">{row.ordersHandled}</TD>
                    <TD className="num text-right">{formatMinor(row.netSalesMinor, currency)}</TD>
                    <TD className="num text-right">
                      {formatMinor(row.averageOrderValueMinor, currency)}
                    </TD>
                    <TD className="num text-right">{formatDuration(row.averageServiceMs)}</TD>
                    <TD className="num text-right">{row.voidRequests}</TD>
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
