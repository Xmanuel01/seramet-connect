import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine, type BreakageRecord } from "@/lib/transaction-engine";

type BreakageRow = BreakageRecord & { quantityLabel: string };

export const Route = createFileRoute("/breakages")({
  head: () => ({ meta: [{ title: "Breakages - Seramet" }] }),
  component: Breakages,
});

function Breakages() {
  const navigate = useNavigate();
  const { branch, branchLabel, currentUser, matchesBranch } = useAppContext();
  const { state, mutate } = useTransactionEngine();
  const rows: BreakageRow[] = state.breakageRecords
    .filter((row) => matchesBranch(row.branch))
    .map((row) => ({ ...row, quantityLabel: `${row.quantity} ${row.unit}` }));
  const totalValue = rows.reduce((sum, row) => sum + row.value, 0);
  const columns: EnterpriseColumn<BreakageRow>[] = [
    { key: "item", label: "Item", sortable: true },
    { key: "quantityLabel", label: "Quantity", sortable: true },
    { key: "reason", label: "Reason", sortable: true },
    { key: "requestedBy", label: "Employee", sortable: true },
    { key: "branch", label: "Branch", sortable: true },
    {
      key: "value",
      label: "Value",
      align: "right",
      sortable: true,
      render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
    },
    { key: "status", label: "Approval", render: (row) => <Status>{row.status}</Status> },
    {
      key: "id",
      label: "Action",
      render: (row) =>
        row.status === "PENDING" ? (
          <button
            type="button"
            onClick={() => void mutate("approveBreakage", { breakageId: row.id })}
            className="text-[12px] font-semibold text-primary hover:underline"
          >
            Approve
          </button>
        ) : (
          <span className="text-[12px] text-muted-foreground">-</span>
        ),
    },
  ];

  return (
    <AppShell
      title="Breakages"
      subtitle={`Damaged assets and service items requiring approval - ${branchLabel}`}
      actions={
        <>
          <Btn>Upload photo</Btn>
          <Btn variant="primary" onClick={() => void navigate({ to: "/wastage" })}>
            Record breakage
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Breakage value" value={totalValue} money invert={totalValue > 0} />
        <Metric
          label="Pending approval"
          value={rows.filter((row) => row.status === "PENDING").length}
        />
        <Metric label="Incidents" value={rows.length} />
        <Metric
          label="Approved value"
          value={rows
            .filter((row) => row.status === "APPROVED")
            .reduce((sum, row) => sum + row.value, 0)}
          money
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Breakage register"
          sub="Reason, employee, value and manager approval state"
        />
        <EnterpriseTable
          rows={rows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Approval: Open"]}
        />
      </Panel>
    </AppShell>
  );
}
