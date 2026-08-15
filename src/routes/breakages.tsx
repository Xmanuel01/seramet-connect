import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Breakage = {
  id: string;
  item: string;
  quantity: string;
  reason: string;
  employee: string;
  branch: string;
  value: number;
  status: string;
};

export const Route = createFileRoute("/breakages")({
  head: () => ({ meta: [{ title: "Breakages - Seramet" }] }),
  component: Breakages,
});

const rows: Breakage[] = [
  {
    id: "BRK-001",
    item: "Dinner plates",
    quantity: "12 pcs",
    reason: "Dropped tray",
    employee: "Cecilia W.",
    branch: "Westlands",
    value: 9600,
    status: "Pending",
  },
  {
    id: "BRK-002",
    item: "Glass tumblers",
    quantity: "18 pcs",
    reason: "Storage shelf collapse",
    employee: "Brian O.",
    branch: "Ngong Road",
    value: 7200,
    status: "Approved",
  },
  {
    id: "BRK-003",
    item: "POS scanner",
    quantity: "1 pc",
    reason: "Impact damage",
    employee: "Amina W.",
    branch: "Ngong Road",
    value: 14800,
    status: "Critical",
  },
];

const columns: EnterpriseColumn<Breakage>[] = [
  { key: "item", label: "Item", sortable: true },
  { key: "quantity", label: "Quantity", sortable: true },
  { key: "reason", label: "Reason", sortable: true },
  { key: "employee", label: "Employee", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  {
    key: "value",
    label: "Value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
  },
  { key: "status", label: "Approval", render: (row) => <Status>{row.status}</Status> },
];

function Breakages() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const totalValue = scopedRows.reduce((sum, row) => sum + row.value, 0);
  return (
    <AppShell
      title="Breakages"
      subtitle={`Damaged assets and service items requiring approval  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Upload photo</Btn>
          <Btn variant="primary">Record breakage</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Breakage value" value={totalValue} money invert />
        <Metric
          label="Pending approval"
          value={scopedRows.filter((row) => row.status === "Pending").length}
        />
        <Metric label="Incidents" value={scopedRows.length} />
        <Metric label="Recovered cost" value={Math.round(totalValue * 0.2)} money />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Breakage register"
          sub="Reason, employee, value and manager approval state"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Approval: Open"]}
        />
      </Panel>
    </AppShell>
  );
}
