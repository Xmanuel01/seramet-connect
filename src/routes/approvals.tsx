import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useAppContext } from "@/lib/app-context";
import { formatMinor, ManagementReadModelState } from "@/management/ui";
import { useManagementIntelligence } from "@/management/use-management-intelligence";

export const Route = createFileRoute("/approvals")({
  head: () => ({ meta: [{ title: "Approval Centre - Seramet" }] }),
  component: Approvals,
});

function Approvals() {
  const { branchLabel } = useAppContext();
  const management = useManagementIntelligence();
  const approvals = management.control?.approvals ?? [];
  const categories = new Set(approvals.map((row) => row.category));
  return (
    <AppShell
      title="Approvals"
      subtitle={branchLabel}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={approvals.length === 0}
        emptyTitle="Nothing waiting for approval"
        emptyText="Purchase orders, refunds and other requests that need your OK show up here."
      />
      {management.status === "ready" && approvals.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Waiting" value={approvals.length} />
            <Metric
              label="Finance"
              value={approvals.filter((row) => row.category === "FINANCE").length}
            />
            <Metric
              label="Inventory"
              value={approvals.filter((row) => row.category === "INVENTORY").length}
            />
            <Metric label="Kinds" value={categories.size} />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead title="Waiting for you" />
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <TH>Area</TH>
                  <TH>Request</TH>
                  <TH>Reference</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Requested</TH>
                </tr>
              </thead>
              <tbody>
                {approvals.map((row) => (
                  <tr key={`${row.sourceType}:${row.sourceId}`}>
                    <TD>
                      <Status>{sentence(row.category)}</Status>
                    </TD>
                    <TD className="font-semibold">{sentence(row.sourceType)}</TD>
                    <TD className="num text-muted-foreground">{row.sourceId}</TD>
                    <TD>
                      <Status>{sentence(row.status)}</Status>
                    </TD>
                    <TD className="num text-right">
                      {row.amountMinor === null || !row.currency
                        ? "-"
                        : formatMinor(row.amountMinor, row.currency)}
                    </TD>
                    <TD className="text-muted-foreground">
                      {new Date(row.requestedAt).toLocaleString()}
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

function sentence(value: string) {
  const words = value.replaceAll("_", " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
