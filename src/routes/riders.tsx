import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Rider = {
  id: string;
  name: string;
  branch: string;
  shift: string;
  clockedIn: string;
  activeTasks: number;
  completedToday: number;
  status: string;
};

export const Route = createFileRoute("/riders")({
  head: () => ({
    meta: [
      { title: "Riders - Seramet" },
      {
        name: "description",
        content:
          "Rider roster, eligibility, shift and clock-in state, and delivery assignment strategy per branch.",
      },
      { property: "og:title", content: "Riders - Seramet" },
      {
        property: "og:description",
        content: "Manage rider availability, workload and assignment strategy for own deliveries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Riders,
});

const rows: Rider[] = [
  {
    id: "RID-01",
    name: "Kevin M.",
    branch: "Westlands",
    shift: "10:00 - 19:00",
    clockedIn: "09:52",
    activeTasks: 1,
    completedToday: 6,
    status: "Available",
  },
  {
    id: "RID-02",
    name: "Dennis K.",
    branch: "Westlands",
    shift: "12:00 - 21:00",
    clockedIn: "11:58",
    activeTasks: 2,
    completedToday: 4,
    status: "In progress",
  },
  {
    id: "RID-03",
    name: "Sharon A.",
    branch: "Ngong Road",
    shift: "10:00 - 19:00",
    clockedIn: "-",
    activeTasks: 0,
    completedToday: 0,
    status: "Absent",
  },
  {
    id: "RID-04",
    name: "Victor O.",
    branch: "Ngong Road",
    shift: "14:00 - 23:00",
    clockedIn: "13:55",
    activeTasks: 0,
    completedToday: 2,
    status: "Available",
  },
];

const columns: EnterpriseColumn<Rider>[] = [
  { key: "name", label: "Rider", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "shift", label: "Shift", sortable: true },
  { key: "clockedIn", label: "Clocked in" },
  { key: "activeTasks", label: "Active", align: "right", sortable: true },
  { key: "completedToday", label: "Completed", align: "right", sortable: true },
  { key: "status", label: "Status", render: (row) => <Status>{row.status}</Status> },
];

const eligibility = [
  "Assigned to the branch",
  "On the current shift",
  "Clocked in",
  "Available (not on break)",
  "Not overloaded",
  "Not absent",
];

const strategies = [
  "Manual dispatcher assignment",
  "Auto round-robin",
  "First available",
  "Least active deliveries",
  "First rider to accept",
];

function Riders() {
  const { branch, branchLabel } = useAppContext();
  const scopedRows = useBranchRows(rows);
  const available = scopedRows.filter((row) => row.status === "Available");
  return (
    <AppShell
      title="Riders"
      subtitle={`Rider roster, eligibility and dispatch strategy  -  ${branchLabel}`}
      actions={
        <>
          <Btn>Notify riders</Btn>
          <Btn variant="primary">Add rider</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Riders on roster" value={scopedRows.length} />
        <Metric label="Available now" value={available.length} />
        <Metric
          label="Active deliveries"
          value={scopedRows.reduce((sum, row) => sum + row.activeTasks, 0)}
        />
        <Metric
          label="Delivered today"
          value={scopedRows.reduce((sum, row) => sum + row.completedToday, 0)}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Rider roster" sub="Shift, clock-in state and current workload" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Shift: Today"]}
        />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Eligibility rules" sub="A rider must satisfy all of these to be notified" />
          <ul className="space-y-2 px-4 py-4 text-[13px]">
            {eligibility.map((rule) => (
              <li key={rule} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {rule}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHead
            title="Assignment strategy"
            sub="Configurable per branch - no default is applied silently"
          />
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {strategies.map((strategy) => (
              <Status key={strategy}>{strategy}</Status>
            ))}
          </div>
          <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
            If no eligible rider is found, Seramet raises an operational alert instead of assigning
            outside the branch.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
