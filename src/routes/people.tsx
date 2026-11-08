import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock3, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "Workforce - Seramet" },
      {
        name: "description",
        content: "Who is working today and your employee register, by branch.",
      },
    ],
  }),
  component: People,
});

type VerifiedEmployee = {
  id: string;
  name: string;
  employee_code: string | null;
  scheduled_start: string | null;
};
type VerifiedSession = {
  employeeId: string;
  clockInAt: string;
  clockOutAt: string | null;
  minutesLate: number | null;
};
type VerifiedPeople = {
  summary: {
    total: number;
    recorded: number;
    working: number;
    late: number;
    completed: number;
    exceptions: number;
    not_recorded: number;
  } | null;
  branchTimezone: string;
  businessDate: string;
  canManage: boolean;
  records: VerifiedSession[];
  employees: VerifiedEmployee[];
  me: VerifiedSession | null;
};
const renderTime = (value: string | null | undefined, zone: string) =>
  value
    ? new Intl.DateTimeFormat("en-KE", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";

function People() {
  const navigate = useNavigate();
  const { branchId, branchLabel, activeTenantId, hasPermission, currentUser, sessionId } =
    useAppContext();
  const scope = JSON.stringify([activeTenantId, branchId, currentUser.id, sessionId]);
  const [storedPeople, setPeople] = useState<(VerifiedPeople & { scope: string }) | null>(null);
  const people = storedPeople?.scope === scope ? storedPeople : null;
  const [notice, setNotice] = useState("");
  const mayRead =
    hasPermission(permissions.staffManage) || hasPermission(permissions.attendanceUse);

  useEffect(() => {
    setPeople(null);
    setNotice("");
    if (!mayRead) return;
    let active = true;
    const controller = new AbortController();
    const token = getSerametAccessToken();
    void fetch("/api/seramet/attendance?branchId=" + encodeURIComponent(branchId), {
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "x-seramet-tenant-id": activeTenantId,
        "x-seramet-branch-id": branchId,
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as VerifiedPeople & {
          message?: string;
        };
        if (!response.ok) throw new Error(result.message ?? "Attendance is unavailable");
        if (active) {
          setPeople({ ...result, scope });
          setNotice("");
        }
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : "Attendance is unavailable");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeTenantId, branchId, mayRead, currentUser.id, sessionId, scope]);

  const records = people?.records ?? [];
  const count = people?.summary?.total ?? 0;
  const working = people?.summary?.working ?? 0;
  const late = people?.summary?.late ?? 0;
  const notIn = people?.summary?.not_recorded ?? 0;
  const canSeeRoster = people?.canManage ?? false;
  const zone = people?.branchTimezone ?? "Africa/Nairobi";
  // Who needs a look first: late, then working, then not in yet, then finished.
  const today = (people?.employees ?? [])
    .map((employee) => {
      const record = records.find((row) => row.employeeId === employee.id);
      const lateBy = record?.minutesLate ?? 0;
      const state = !record
        ? { label: "Not in", rank: 2, tone: "bg-secondary text-muted-foreground" }
        : record.clockOutAt
          ? { label: "Done", rank: 3, tone: "bg-secondary text-muted-foreground" }
          : lateBy > 0
            ? { label: `Late ${lateBy} min`, rank: 0, tone: "bg-warning-soft text-warning" }
            : { label: "Working", rank: 1, tone: "bg-success-soft text-success" };
      return { employee, record, state };
    })
    .sort((a, b) => a.state.rank - b.state.rank || a.employee.name.localeCompare(b.employee.name));
  return (
    <AppShell
      title="Workforce"
      subtitle={branchLabel}
      actions={
        canSeeRoster ? (
          <Btn variant="primary" onClick={() => void navigate({ to: "/employees" })}>
            <UserPlus className="h-4 w-4" />
            Add employee
          </Btn>
        ) : (
          <Btn variant="primary" onClick={() => void navigate({ to: "/attendance" })}>
            <Clock3 className="h-4 w-4" />
            Clock in or out
          </Btn>
        )
      }
    >
      {canSeeRoster ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Employees" value={count} />
          <Metric label="Working now" value={working} />
          <Metric label="Late today" value={late} invert={late > 0} />
          <Metric label="Not in yet" value={notIn} />
        </div>
      ) : people?.me ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm">
          {people.me.clockOutAt
            ? `You clocked out at ${renderTime(people.me.clockOutAt, zone)}.`
            : `You clocked in at ${renderTime(people.me.clockInAt, zone)}.`}
        </p>
      ) : people ? (
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm">
          You haven&apos;t clocked in today.
        </p>
      ) : null}
      {notice && (
        <p role="status" className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      {!mayRead && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          You don&apos;t have access to attendance. Ask the account owner.
        </p>
      )}
      {canSeeRoster && (
        <Panel className="mt-4">
          <PanelHead
            title="Today"
            right={
              <Btn onClick={() => void navigate({ to: "/schedule" })}>
                Attendance <ArrowRight className="h-4 w-4" />
              </Btn>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Starts</TH>
                  <TH>In</TH>
                  <TH>Out</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {today.map(({ employee, record, state }) => (
                  <tr key={employee.id}>
                    <TD className="font-semibold">{employee.name}</TD>
                    <TD>{employee.scheduled_start ?? "—"}</TD>
                    <TD>{renderTime(record?.clockInAt, zone)}</TD>
                    <TD>{renderTime(record?.clockOutAt, zone)}</TD>
                    <TD>
                      <Status className={state.tone}>{state.label}</Status>
                    </TD>
                  </tr>
                ))}
                {!today.length && (
                  <tr>
                    <TD colSpan={5} className="text-muted-foreground">
                      No employees in this branch yet.
                    </TD>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
