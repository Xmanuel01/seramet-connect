import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type LeaveRequest = {
  id: string;
  employee: string;
  type: string;
  from: string;
  to: string;
  days: number;
  balance: number;
  branch: string;
  status: string;
};

export const Route = createFileRoute("/leave")({
  head: () => ({
    meta: [
      { title: "Leave Management - Seramet" },
      {
        name: "description",
        content:
          "Leave requests, approval chain, balances and the impact of leave on shift planning and payroll.",
      },
      { property: "og:title", content: "Leave Management - Seramet" },
      {
        property: "og:description",
        content: "Track leave requests from employee submission through manager and HR approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Leave,
});

const rows: LeaveRequest[] = [
  {
    id: "LV-201",
    employee: "Amina W.",
    type: "Annual",
    from: "22 Aug",
    to: "26 Aug",
    days: 5,
    balance: 12,
    branch: "Westlands",
    status: "Pending",
  },
  {
    id: "LV-202",
    employee: "Brian O.",
    type: "Sick",
    from: "15 Aug",
    to: "16 Aug",
    days: 2,
    balance: 7,
    branch: "Ngong Road",
    status: "Approved",
  },
  {
    id: "LV-203",
    employee: "Cecilia W.",
    type: "Compassionate",
    from: "18 Aug",
    to: "19 Aug",
    days: 2,
    balance: 4,
    branch: "Westlands",
    status: "Requested",
  },
  {
    id: "LV-204",
    employee: "Dennis K.",
    type: "Unpaid",
    from: "01 Sep",
    to: "05 Sep",
    days: 5,
    balance: 0,
    branch: "Ngong Road",
    status: "Rejected",
  },
];

const columns: EnterpriseColumn<LeaveRequest>[] = [
  { key: "id", label: "Request", sortable: true },
  { key: "employee", label: "Employee", sortable: true },
  { key: "type", label: "Type", sortable: true },
  { key: "from", label: "From" },
  { key: "to", label: "To" },
  { key: "days", label: "Days", align: "right", sortable: true },
  { key: "balance", label: "Balance after", align: "right", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const chain = [
  "Employee request",
  "Manager approval",
  "HR approval",
  "Balance update",
  "Shift planning",
  "Payroll impact",
  "Audit",
];

function Leave() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const pending = scopedRows.filter(
    (row) => row.status === "Pending" || row.status === "Requested",
  );
  return (
    <AppShell
      title="Leave"
      subtitle={`Requests, balances and approval chain  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Leave policy</Btn>
          <Btn variant="primary">New request</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Awaiting approval" value={pending.length} />
        <Metric
          label="Days requested"
          value={scopedRows.reduce((sum, row) => sum + row.days, 0)}
        />
        <Metric
          label="Approved this month"
          value={scopedRows.filter((row) => row.status === "Approved").length}
        />
        <Metric label="Coverage risk days" value={2} invert delta={2} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Leave requests" sub="Every request keeps its full approval trail" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Period: This month"]}
        />
      </Panel>
      <Panel className="mt-4">
        <PanelHead title="Approval chain" sub="HR approval applies where the leave policy requires it" />
        <div className="flex flex-wrap items-center gap-2 px-4 py-4">
          {chain.map((step, index) => (
            <span key={step} className="flex items-center gap-2">
              <Status>{step}</Status>
              {index < chain.length - 1 && <span className="text-muted-foreground">-&gt;</span>}
            </span>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
