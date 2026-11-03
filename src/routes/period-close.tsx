import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { NeedsAttention } from "@/finance/finance-ui";
import { humanize } from "@/finance/finance-labels";
import { useAppContext } from "@/lib/app-context";
import { ManagementReadModelState } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/period-close")({
  head: () => ({ meta: [{ title: "Period Close - Seramet" }] }),
  component: PeriodClose,
});

function PeriodClose() {
  const { branchLabel, hasPermission } = useAppContext();
  const management = useManagementIntelligence();
  const readiness = management.control?.closeReadiness;
  const ready = readiness ? readiness.blockerCount === 0 : false;
  return (
    <AppShell
      title="Period close"
      subtitle={branchLabel}
      actions={
        <>
          <Btn onClick={() => void management.refresh()}>Refresh</Btn>
          {hasPermission(permissions.reconciliationView) && (
            <Link to="/payment-control" search={{ tab: "daily-closing" }}>
              <Btn variant="primary">Go to daily closing</Btn>
            </Link>
          )}
        </>
      }
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
            <Metric label="Must fix" value={readiness.blockerCount} invert />
            <Metric label="Should review" value={readiness.warningCount} invert />
            <div className="rounded-xl border border-border bg-card p-3.5 shadow-card">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Status
              </div>
              <div className="mt-2">
                <Status>{ready ? "Ready to close" : humanize(readiness.status)}</Status>
              </div>
            </div>
          </div>
          <Panel className="mt-4">
            <PanelHead
              title="Before closing"
              sub="Fix each item, then close the day from Daily closing."
            />
            <NeedsAttention
              blockers={readiness.blockers}
              empty="Everything is in order. Close the day from Daily closing."
            />
          </Panel>
        </>
      )}
    </AppShell>
  );
}
