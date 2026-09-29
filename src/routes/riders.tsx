import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";
import { currentDateKey } from "@/lib/currency";

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
  "Clocked in / not marked absent",
  "Available (not on break)",
  "Not overloaded",
  "Not on leave or off day",
];

const strategies = [
  "Manual dispatcher assignment",
  "Auto round-robin",
  "First available",
  "Least active deliveries",
  "First rider to accept",
];

function Riders() {
  const { branch, branchLabel, currentUser, isAllBranches, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [notice, setNotice] = useState("");
  const today = currentDateKey();

  const scopedRows = useMemo<Rider[]>(() => {
    const employees = state.employees.filter(
      (employee) =>
        employee.active &&
        employee.role === "Rider" &&
        matchesBranch(employee.branchId ?? employee.branch),
    );
    return employees.map((employee) => {
      const attendance = state.attendanceRecords.find(
        (record) => record.employeeId === employee.id && record.date === today,
      );
      const ownOrders = state.orders.filter(
        (order) =>
          ["Delivery", "Online"].includes(order.channel) &&
          order.branch === employee.branch &&
          order.delivery?.rider === employee.name,
      );
      const activeTasks = ownOrders.filter(
        (order) =>
          order.delivery?.status !== "DELIVERED" &&
          !["CANCELLED", "REFUNDED"].includes(order.status),
      ).length;
      const completedToday = ownOrders.filter(
        (order) =>
          order.delivery?.status === "DELIVERED" &&
          (order.delivery.deliveredAt ?? "").slice(0, 10) === today,
      ).length;
      let status = attendance?.clockIn
        ? activeTasks > 0
          ? "In progress"
          : "Available"
        : "Not clocked in";
      if (attendance?.status === "ABSENT") status = "Absent";
      if (attendance?.status === "ON_LEAVE") status = "On leave";
      if (attendance?.status === "OFF") status = "Off shift";
      if (
        !attendance?.clockIn &&
        attendance &&
        !["ABSENT", "ON_LEAVE", "OFF"].includes(attendance.status)
      )
        status = "Not clocked in";
      return {
        id: employee.id,
        name: employee.name,
        branch: employee.branch,
        shift: employee.shift,
        clockedIn: attendance?.clockIn ?? "-",
        activeTasks,
        completedToday,
        status,
      };
    });
  }, [matchesBranch, state.attendanceRecords, state.employees, state.orders, today]);

  const available = scopedRows.filter((row) => row.status === "Available");

  const addRider = () => {
    if (isAllBranches) {
      setNotice("Select a single branch before adding a rider.");
      return;
    }
    const name = window.prompt("Rider name");
    if (!name?.trim()) return;
    const shift = window.prompt("Shift (HH:MM-HH:MM)", "10:00-21:30") ?? "10:00-21:30";
    void mutate("addRider", { name, branch, shift });
    setNotice(`${name.trim()} added to the ${branch} rider roster.`);
  };

  return (
    <AppShell
      title="Riders"
      subtitle={`Rider roster, eligibility and dispatch strategy  -  ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => (window.location.href = "/delivery")}>View delivery queue</Btn>
          <Btn variant="primary" onClick={addRider}>
            Add rider
          </Btn>
        </>
      }
    >
      {notice && (
        <div className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium">
          {notice} <span className="ml-2 text-muted-foreground">Backend: {backendStatus}</span>
        </div>
      )}
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
        <PanelHead title="Rider roster" sub="Live shift, attendance state and delivery workload" />
        <EnterpriseTable
          rows={scopedRows}
          columns={columns}
          filters={[`Branch: ${branch}`, "Shift: Today"]}
        />
      </Panel>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Eligibility rules" sub="A rider must satisfy these before assignment" />
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
            sub="Manual assignment is active; automation can be enabled per branch later"
          />
          <div className="flex flex-wrap gap-2 px-4 py-4">
            {strategies.map((strategy) => (
              <Status key={strategy}>{strategy}</Status>
            ))}
          </div>
          <p className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
            If no eligible rider is found, Seramet leaves the task unassigned and exposes it in the
            Delivery operations queue.
          </p>
        </Panel>
      </div>
    </AppShell>
  );
}
