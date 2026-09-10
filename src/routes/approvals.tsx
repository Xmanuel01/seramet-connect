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
      title="Approval centre"
      subtitle={`Authoritative approval and exception inbox - ${branchLabel}`}
      actions={<Btn onClick={() => void management.refresh()}>Refresh</Btn>}
    >
      <ManagementReadModelState
        status={management.status}
        error={management.error}
        empty={approvals.length === 0}
      />
      {management.status === "ready" && approvals.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Pending items" value={approvals.length} />
            <Metric
              label="Finance"
              value={approvals.filter((row) => row.category === "FINANCE").length}
            />
            <Metric
              label="Inventory"
              value={approvals.filter((row) => row.category === "INVENTORY").length}
            />
            <Metric label="Categories" value={categories.size} />
          </div>
          <Panel className="mt-4 overflow-x-auto">
            <PanelHead
              title="Consolidated inbox"
              sub="Each row references the original approval record; decisions remain in the owning module"
            />
            <table className="w-full min-w-[820px]">
              <thead>
                <tr>
                  <TH>Category</TH>
                  <TH>Type</TH>
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
                      <Status>{row.category}</Status>
                    </TD>
                    <TD className="font-semibold">{row.sourceType.replaceAll("_", " ")}</TD>
                    <TD className="num text-muted-foreground">{row.sourceId}</TD>
                    <TD>
                      <Status>{row.status.replaceAll("_", " ")}</Status>
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
