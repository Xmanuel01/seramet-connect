import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Segmented, Status } from "@/components/app/ui";
import { useAppContext, useBranchRows } from "@/lib/app-context";

type Task = {
  id: string;
  title: string;
  owner: string;
  due: string;
  priority: string;
  module: string;
  branch: string;
  status: string;
};

export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: "Tasks - Seramet" }] }),
  component: Tasks,
});

const tasks: Task[] = [
  {
    id: "TSK-001",
    title: "Review beef supplier variance",
    owner: "Kelvin M.",
    due: "Today",
    priority: "High",
    module: "Inventory",
    branch: "Westlands",
    status: "Open",
  },
  {
    id: "TSK-002",
    title: "Approve overtime request",
    owner: "Emmanuel K.",
    due: "Today",
    priority: "High",
    module: "People",
    branch: "Westlands",
    status: "Review",
  },
  {
    id: "TSK-003",
    title: "Call complaint CMP-0114",
    owner: "Joan A.",
    due: "Tomorrow",
    priority: "Medium",
    module: "Customers",
    branch: "Westlands",
    status: "In Progress",
  },
  {
    id: "TSK-004",
    title: "Prepare Ngong stock count",
    owner: "Kelvin M.",
    due: "Fri",
    priority: "Medium",
    module: "Inventory",
    branch: "Ngong Road",
    status: "Open",
  },
  {
    id: "TSK-005",
    title: "Send weekly board pack",
    owner: "Emmanuel K.",
    due: "Fri",
    priority: "Low",
    module: "Management",
    branch: "All",
    status: "Done",
  },
];

const columns: EnterpriseColumn<Task>[] = [
  { key: "title", label: "Task", sortable: true },
  { key: "owner", label: "Owner", sortable: true },
  { key: "due", label: "Due", sortable: true },
  {
    key: "priority",
    label: "Priority",
    sortable: true,
    render: (row) => (
      <Status>
        {row.priority === "High" ? "Critical" : row.priority === "Medium" ? "Attention" : "Pending"}
      </Status>
    ),
  },
  { key: "module", label: "Module", sortable: true },
  { key: "branch", label: "Branch", sortable: true },
  { key: "status", label: "Status", sortable: true },
];

function Tasks() {
  const [view, setView] = useState("List");
  const { branch, branchLabel } = useAppContext();
  const scopedTasks = useBranchRows(tasks);
  return (
    <AppShell
      title="Tasks"
      subtitle={`Operational work linked to records, branches and modules  -  ${branchLabel}`}
      actions={
        <>
          <Segmented options={["List", "Board", "Calendar"]} value={view} onChange={setView} />
          <Btn variant="primary">New task</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open" value={scopedTasks.filter((task) => task.status !== "Done").length} />
        <Metric
          label="Due today"
          value={scopedTasks.filter((task) => task.due === "Today").length}
        />
        <Metric
          label="High priority"
          value={scopedTasks.filter((task) => task.priority === "High").length}
        />
        <Metric
          label="Completed week"
          value={scopedTasks.filter((task) => task.status === "Done").length}
          delta={20}
        />
      </div>

      {view === "List" && (
        <Panel className="mt-4">
          <PanelHead title="Task list" sub="Search, sort, select and bulk update tasks" />
          <EnterpriseTable
            rows={scopedTasks}
            columns={columns}
            filters={["Owner: Any", `Branch: ${branch}`, "Status: Open"]}
          />
        </Panel>
      )}
      {view === "Board" && (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {["Open", "In Progress", "Review", "Done"].map((status) => (
            <Panel key={status} className="p-3">
              <PanelHead title={status} />
              <div className="mt-3 space-y-2">
                {scopedTasks
                  .filter((task) => task.status === status)
                  .map((task) => (
                    <article key={task.id} className="rounded-lg border border-border p-3">
                      <div className="text-[13px] font-semibold">{task.title}</div>
                      <div className="mt-1 text-[12px] text-muted-foreground">
                        {task.owner} - {task.due}
                      </div>
                      <div className="mt-2">
                        <Status>{task.priority === "High" ? "Critical" : "Attention"}</Status>
                      </div>
                    </article>
                  ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
      {view === "Calendar" && (
        <Panel className="mt-4 p-4">
          <div className="grid gap-3 md:grid-cols-5">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => (
              <div key={day} className="rounded-lg border border-border p-3">
                <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {day}
                </div>
                {scopedTasks
                  .filter((_, taskIndex) => taskIndex % 5 === index)
                  .map((task) => (
                    <div
                      key={task.id}
                      className="mt-2 rounded-md bg-secondary/60 px-2 py-1.5 text-[12px] font-semibold"
                    >
                      {task.title}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
