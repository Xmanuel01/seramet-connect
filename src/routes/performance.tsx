import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Review = {
  id: string;
  employee: string;
  role: string;
  branch: string;
  period: string;
  score: number;
  attendance: number;
  reviewer: string;
  status: string;
};

export const Route = createFileRoute("/performance")({
  head: () => ({
    meta: [
      { title: "Performance Reviews - Seramet" },
      {
        name: "description",
        content:
          "Employee performance cycles with scores, attendance context, reviewer and approval state.",
      },
      { property: "og:title", content: "Performance Reviews - Seramet" },
      {
        property: "og:description",
        content: "Run review cycles per branch with objective attendance and service data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Performance,
});

const rows: Review[] = [
  { id: "PRF-101", employee: "Amina W.", role: "Cashier", branch: "Westlands", period: "Q3 2026", score: 88, attendance: 97, reviewer: "Branch Manager", status: "Completed" },
  { id: "PRF-102", employee: "Brian O.", role: "Storekeeper", branch: "Ngong Road", period: "Q3 2026", score: 74, attendance: 91, reviewer: "Branch Manager", status: "In progress" },
  { id: "PRF-103", employee: "Cecilia W.", role: "Chef", branch: "Westlands", period: "Q3 2026", score: 92, attendance: 99, reviewer: "General Manager", status: "Approved" },
  { id: "PRF-104", employee: "Dennis K.", role: "Rider", branch: "Ngong Road", period: "Q3 2026", score: 61, attendance: 82, reviewer: "Branch Manager", status: "Attention" },
];

const columns: EnterpriseColumn<Review>[] = [
  { key: "employee", label: "Employee", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "period", label: "Cycle", sortable: true },
  {
    key: "score",
    label: "Score",
    align: "right",
    sortable: true,
    render: (row) => <span className="num font-semibold">{row.score}</span>,
  },
  {
    key: "attendance",
    label: "Attendance",
    align: "right",
    sortable: true,
    render: (row) => <span className="num">{row.attendance}%</span>,
  },
  { key: "reviewer", label: "Reviewer" },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

function Performance() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const avg = scopedRows.length
    ? Math.round(scopedRows.reduce((sum, row) => sum + row.score, 0) / scopedRows.length)
    : 0;
  return (
    <AppShell
      title="Performance"
      subtitle={`Review cycles backed by attendance and service data  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Review template</Btn>
          <Btn variant="primary">Start cycle</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Average score" value={avg} />
        <Metric
          label="Reviews open"
          value={scopedRows.filter((row) => row.status === "In progress").length}
        />
        <Metric
          label="Needs attention"
          value={scopedRows.filter((row) => row.status === "Attention").length}
          invert
        />
        <Metric label="Cycle" value="Q3 2026" />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Review register" sub="Scores are visible to managers only, in line with HR privacy" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Cycle: Q3 2026"]}
        />
      </Panel>
    </AppShell>
  );
}
