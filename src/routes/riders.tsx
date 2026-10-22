import { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EnterpriseTable, type EnterpriseColumn } from "@/components/app/EnterpriseTable";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { permissions } from "@/platform/permissions";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { riderWorkload } from "@/delivery/rider-workload";

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
  const {
    branch,
    branchId,
    branchRecords,
    activeTenantId,
    branchLabel,
    currentUser,
    isAllBranches,
    matchesBranch,
    timeZone,
    hasPermission,
  } = useAppContext();
  const navigate = useNavigate();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [riderDialogScope, setRiderDialogScope] = useState("");
  const [riderDraft, setRiderDraft] = useState({ name: "", shift: "" });
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const scope = `${activeTenantId}:${branchId}:${currentUser.id}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const canAdd = !isAllBranches && hasPermission(permissions.ridersManage);
  const channels = getConfigurationRepository().listOrderChannels(activeTenantId, false);

  const scopedRows = useMemo<Rider[]>(() => {
    const employees = state.employees.filter(
      (employee) =>
        employee.active &&
        employee.role === "Rider" &&
        matchesBranch(employee.branchId ?? employee.branch),
    );
    return employees.map((employee) => {
      const employeeBranch = branchRecords.find(
        (item) =>
          item.id === employee.branchId || (!employee.branchId && item.name === employee.branch),
      );
      const { today, activeTasks, completedToday } = riderWorkload({
        orders: state.orders,
        channels,
        branchId: employee.branchId ?? employeeBranch?.id ?? branchId,
        legacyBranch: employee.branch,
        rider: employee.name,
        timezone: employeeBranch?.timezone ?? timeZone,
        cutoffMinutes: Number(employeeBranch?.metadata["businessDayCutoffMinutes"] ?? 0),
      });
      const attendance = state.attendanceRecords.find(
        (record) => record.employeeId === employee.id && record.date === today,
      );
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
  }, [
    matchesBranch,
    state.attendanceRecords,
    state.employees,
    state.orders,
    branchId,
    branchRecords,
    channels,
    timeZone,
  ]);

  const available = scopedRows.filter((row) => row.status === "Available");

  const addRider = async () => {
    if (!canAdd || busy.current || riderDialogScope !== scope) return;
    busy.current = true;
    setSaving(true);
    setError("");
    const requestedScope = scope;
    const name = riderDraft.name.trim();
    try {
      const result = await mutate("addRider", {
        name,
        branch: branchId,
        branchId,
        shift: riderDraft.shift.trim(),
      });
      if (scopeRef.current !== requestedScope) return;
      const confirmed = result?.state?.employees.find(
        (row) =>
          row.active &&
          row.role === "Rider" &&
          row.branchId === branchId &&
          row.name.toLowerCase() === name.toLowerCase(),
      );
      if (!confirmed || (result && "offline" in result && result.offline))
        throw new Error("The server has not confirmed this rider. Your entries were retained.");
      setNotice(`${confirmed.name} is saved on the ${branchLabel} rider roster.`);
      setRiderDialogScope("");
    } catch (cause) {
      if (scopeRef.current === requestedScope)
        setError(
          cause instanceof Error
            ? cause.message
            : "Rider could not be saved. Your entries were retained.",
        );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <AppShell
      title="Riders"
      subtitle={`Rider roster, eligibility and dispatch strategy  -  ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void navigate({ to: "/delivery" })}>View delivery queue</Btn>
          <Btn
            variant="primary"
            disabled={!canAdd}
            onClick={() => {
              setRiderDraft({ name: "", shift: "" });
              setError("");
              setRiderDialogScope(scope);
            }}
          >
            Add rider
          </Btn>
        </>
      }
    >
      <Dialog
        open={riderDialogScope === scope}
        onOpenChange={(open) => {
          if (!open && !busy.current) setRiderDialogScope("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add rider</DialogTitle>
            <DialogDescription>
              Save a rider to this branch. Employee sign-in credentials are managed in Employees.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void addRider();
            }}
          >
            <label className="grid gap-1 text-sm">
              Rider name
              <input
                aria-label="Rider name"
                required
                minLength={2}
                maxLength={120}
                disabled={saving}
                value={riderDraft.name}
                onChange={(event) => setRiderDraft({ ...riderDraft, name: event.target.value })}
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Shift (HH:MM-HH:MM)
              <input
                aria-label="Rider shift"
                required
                pattern="([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]"
                disabled={saving}
                value={riderDraft.shift}
                onChange={(event) => setRiderDraft({ ...riderDraft, shift: event.target.value })}
                className="h-10 rounded-md border border-border bg-background px-3"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Btn disabled={saving} onClick={() => setRiderDialogScope("")}>
                Cancel
              </Btn>
              <Btn type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving..." : "Save rider"}
              </Btn>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {notice && (
        <div
          role="status"
          className="mb-4 rounded-md border border-border bg-card px-4 py-3 text-[13px] font-medium"
        >
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
