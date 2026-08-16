import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { ksh } from "@/data/mock";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Segment = {
  id: string;
  name: string;
  rule: string;
  branch: string;
  customers: number;
  avgSpend: number;
  lifetimeValue: number;
  status: string;
};

export const Route = createFileRoute("/segments")({
  head: () => ({
    meta: [
      { title: "Customer Segments - Seramet" },
      {
        name: "description",
        content:
          "Rule-based customer segments driving campaigns, loyalty tiers and service recovery priorities.",
      },
      { property: "og:title", content: "Customer Segments - Seramet" },
      {
        property: "og:description",
        content: "Define and monitor customer segments by spend, frequency and recency.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Segments,
});

const rows: Segment[] = [
  { id: "SEG-01", name: "Frequent diners", rule: "4+ visits in 30 days", branch: "Westlands", customers: 412, avgSpend: 2180, lifetimeValue: 41200, status: "Healthy" },
  { id: "SEG-02", name: "Corporate accounts", rule: "Invoiced customers with credit terms", branch: "Westlands", customers: 38, avgSpend: 18400, lifetimeValue: 312000, status: "Healthy" },
  { id: "SEG-03", name: "Lapsed 60 days", rule: "No order in 60 days", branch: "Ngong Road", customers: 286, avgSpend: 1640, lifetimeValue: 12800, status: "Attention" },
  { id: "SEG-04", name: "High value at risk", rule: "Top 10% spend, no visit in 30 days", branch: "Ngong Road", customers: 44, avgSpend: 6120, lifetimeValue: 98400, status: "Critical" },
];

const columns: EnterpriseColumn<Segment>[] = [
  { key: "name", label: "Segment", sortable: true },
  { key: "rule", label: "Rule" },
  { key: "branch", label: "Branch", sortable: true },
  { key: "customers", label: "Customers", align: "right", sortable: true },
  {
    key: "avgSpend",
    label: "Avg spend",
    align: "right",
    sortable: true,
    render: (row) => <span className="num">{ksh(row.avgSpend)}</span>,
  },
  {
    key: "lifetimeValue",
    label: "Avg lifetime value",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{ksh(row.lifetimeValue)}</span>,
  },
  { key: "status", label: "Health", render: (row) => <Status>{row.status}</Status> },
];

function Segments() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  return (
    <AppShell
      title="Segments"
      subtitle={`Rule-based customer groups feeding campaigns and loyalty  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Export list</Btn>
          <Btn variant="primary">New segment</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Segments" value={scopedRows.length} />
        <Metric
          label="Customers covered"
          value={scopedRows.reduce((sum, row) => sum + row.customers, 0)}
        />
        <Metric
          label="At risk"
          value={scopedRows
            .filter((row) => row.status !== "Healthy")
            .reduce((sum, row) => sum + row.customers, 0)}
          invert
        />
        <Metric
          label="Top segment value"
          value={Math.max(0, ...scopedRows.map((row) => row.lifetimeValue))}
          money
        />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Segment register" sub="Segments are recalculated from order and payment history" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Refreshed: Today"]}
        />
      </Panel>
    </AppShell>
  );
}
