import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { formatDuration, ManagementReadModelState, QualityStatus } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/kitchen-analytics")({
  head: () => ({ meta: [{ title: "Kitchen Analytics - Seramet" }] }),
  component: KitchenAnalytics,
});

function KitchenAnalytics() {
  const { branchLabel } = useAppContext();
  const management = useManagementIntelligence();
  const stations = management.control?.stations ?? [];
  const tickets = stations.reduce((sum, row) => sum + row.ticketCount, 0);
  const completed = stations.reduce((sum, row) => sum + row.completedCount, 0);
  const late = stations.reduce((sum, row) => sum + row.lateCount, 0);
  return (
    <AppShell
      title="Kitchen analytics"
      subtitle={`Persisted station timestamps - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={stations.length === 0}
      />
      {management.status === "ready" && stations.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Tickets" value={tickets} />
            <Metric label="Completed" value={completed} />
            <Metric label="Late" value={late} />
            <Metric
              label="Average prep"
              value={formatDuration(management.control?.latest?.averagePrepTimeMs ?? null)}
            />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Station performance"
              sub="Station names and timing targets come from configuration"
            />
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <TH>Station</TH>
                  <TH className="text-right">Tickets</TH>
                  <TH className="text-right">Completed</TH>
                  <TH className="text-right">Late</TH>
                  <TH className="text-right">Average</TH>
                  <TH className="text-right">Median</TH>
                  <TH className="text-right">P90</TH>
                  <TH>Quality</TH>
                </tr>
              </thead>
              <tbody>
                {stations.map((station) => (
                  <tr key={station.stationId}>
                    <TD className="font-semibold">{station.stationName}</TD>
                    <TD className="num text-right">{station.ticketCount}</TD>
                    <TD className="num text-right">{station.completedCount}</TD>
                    <TD className="num text-right">{station.lateCount}</TD>
                    <TD className="num text-right">{formatDuration(station.averagePrepMs)}</TD>
                    <TD className="num text-right">{formatDuration(station.medianPrepMs)}</TD>
                    <TD className="num text-right">{formatDuration(station.p90PrepMs)}</TD>
                    <TD>
                      <QualityStatus quality={station.quality} />
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
