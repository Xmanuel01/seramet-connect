import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { ManagementReadModelState, QualityStatus, severityLabel } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/period-close")({
  head: () => ({ meta: [{ title: "Period Close Readiness - Seramet" }] }),
  component: PeriodClose,
});

function PeriodClose() {
  const { branchLabel } = useAppContext();
  const management = useManagementIntelligence();
  const readiness = management.control?.closeReadiness;
  return (
    <AppShell
      title="Period close"
      subtitle={`Management readiness only - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh checks</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={!readiness}
      />
      {management.status === "ready" && readiness && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Business date" value={readiness.businessDate} />
            <Metric label="Blocking issues" value={readiness.blockerCount} />
            <Metric label="Warnings" value={readiness.warningCount} />
            <Metric label="Status" value={readiness.status.replaceAll("_", " ")} />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Close readiness"
              sub="This read model cannot close or reopen an accounting period"
              right={<QualityStatus quality={readiness.quality} />}
            />
            {readiness.blockers.length > 0 ? (
              <table className="w-full min-w-[680px]">
                <thead>
                  <tr>
                    <TH>Check</TH>
                    <TH className="text-right">Records</TH>
                    <TH>Severity</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {readiness.blockers.map((blocker) => (
                    <tr key={blocker.code}>
                      <TD className="font-semibold">{blocker.code.replaceAll("_", " ")}</TD>
                      <TD className="num text-right">{blocker.count}</TD>
                      <TD>
                        <Status>{severityLabel(blocker.severity)}</Status>
                      </TD>
                      <TD>
                        <Status>Pending</Status>
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-5">
                <Status>Ready</Status>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  No configured close blockers are open. Use the authoritative accounting close
                  workflow to close the period.
                </p>
              </div>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
