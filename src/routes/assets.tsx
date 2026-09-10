import { emptyRecords } from "@/lib/empty-records";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Asset = {
  id: string;
  asset: string;
  tag: string;
  category: string;
  branch: string;
  value: number;
  condition: string;
  nextService: string;
  status: string;
};

export const Route = createFileRoute("/assets")({
  head: () => ({ meta: [{ title: "Assets - Seramet" }] }),
  component: Assets,
});

const rows: Asset[] = emptyRecords();

const columns: EnterpriseColumn<Asset>[] = [
  { key: "asset", label: "Asset", sortable: true },
  { key: "tag", label: "Tag", sortable: true },
  { key: "category", label: "Category", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  {
    key: "value",
    label: "Value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.value)}</span>,
  },
  { key: "condition", label: "Condition", sortable: true },
  { key: "nextService", label: "Next service", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Assets() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const assetValue = scopedRows.reduce((sum, row) => sum + row.value, 0);
  return (
    <AppShell
      title="Asset management"
      subtitle={`Fixed assets, service schedules and condition  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Import assets</Btn>
          <Btn variant="primary">Add asset</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Asset value" value={assetValue} money />
        <Metric label="Assets" value={scopedRows.length} />
        <Metric
          label="Service due"
          value={scopedRows.filter((row) => row.status === "Attention").length}
          invert
        />
        <Metric
          label="Critical"
          value={scopedRows.filter((row) => row.status === "Critical").length}
          invert
        />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Asset register" sub="Track branch assets, condition and maintenance" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Category: All", "Status: Active"]}
        />
      </Panel>
    </AppShell>
  );
}
