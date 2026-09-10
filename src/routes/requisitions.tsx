import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Req = {
  id: string;
  request: string;
  branch: string;
  requester: string;
  value: number;
  age: string;
  status: string;
};

export const Route = createFileRoute("/requisitions")({
  head: () => ({ meta: [{ title: "Requisitions - Seramet" }] }),
  component: Requisitions,
});

const rows: Req[] = emptyRecords();

const columns: EnterpriseColumn<Req>[] = [
  { key: "request", label: "Request", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "requester", label: "Requester", sortable: true },
  {
    key: "value",
    label: "Value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
  },
  { key: "age", label: "Age", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Requisitions() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const requestedValue = scopedRows.reduce((sum, row) => sum + row.value, 0);
  return (
    <AppShell
      title="Requisitions"
      subtitle={`Internal purchase requests before PO creation  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Generate PO</Btn>
          <Btn variant="primary">New requisition</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open" value={scopedRows.filter((row) => row.status !== "Approved").length} />
        <Metric
          label="Awaiting approval"
          value={scopedRows.filter((row) => row.status === "Pending").length}
        />
        <Metric label="Value requested" value={requestedValue} money />
        <Metric
          label="Critical"
          value={scopedRows.filter((row) => row.status === "Critical").length}
          invert
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Requisition queue"
          sub="Approve, reject or convert requests into purchase orders"
        />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Status: Open"]}
        />
      </Panel>
    </AppShell>
  );
}
