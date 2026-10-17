import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Clock3, ShieldCheck, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { getSerametAccessToken } from "@/lib/access-token";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People - Seramet" },
      { name: "description", content: "Verified attendance and employee administration by branch." },
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
  const { branchId, branchLabel, activeTenantId, hasPermission } = useAppContext();
  const [people, setPeople] = useState<VerifiedPeople | null>(null);
  const [notice, setNotice] = useState("");
  const mayRead = hasPermission(permissions.staffManage) || hasPermission(permissions.attendanceUse);

  useEffect(() => {
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
          setPeople(result);
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
  }, [activeTenantId, branchId, mayRead]);

  const records = people?.records ?? [];
  const count = people?.employees.length ?? 0;
  const recorded = records.length;
  const working = records.filter((row) => !row.clockOutAt).length;
  const late = records.filter((row) => (row.minutesLate ?? 0) > 0).length;
  const canSeeRoster = people?.canManage ?? false;
  return (
    <AppShell
      title="People"
      subtitle={"Employee records and verified timekeeping · " + branchLabel}
      actions={
        <>
          <Btn onClick={() => void navigate({ to: "/attendance" })}>
            <Clock3 className="h-4 w-4" />
            Attendance
          </Btn>
          <Btn variant="primary" onClick={() => void navigate({ to: "/employees" })}>
            <UserPlus className="h-4 w-4" />
            Add Employee
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Employees" value={canSeeRoster ? count : "—"} />
        <Metric label="Recorded today" value={canSeeRoster ? recorded : people?.me ? 1 : 0} />
        <Metric label="Currently working" value={canSeeRoster ? working : people?.me && !people.me.clockOutAt ? 1 : 0} />
        <Metric label="Late arrivals" value={canSeeRoster ? late : people?.me && (people.me.minutesLate ?? 0) > 0 ? 1 : 0} />
      </div>
      {notice && (
        <p role="status" className="mt-4 rounded-md border border-border bg-card px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      {!mayRead && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Attendance access has not been assigned to your account.
        </p>
      )}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Panel>
          <PanelHead
            title="Employee management"
            sub="Active POS identities, assigned branches and PIN credentials"
            right={<UserPlus className="h-4 w-4 text-primary" />}
          />
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Add employees, assign an authorized role and configure their login credentials.
              Account owners manage who can create new employee accounts.
            </p>
            <Btn className="mt-4" onClick={() => void navigate({ to: "/employees" })}>
              Open employee register <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        </Panel>
        <Panel>
          <PanelHead
            title="Attendance and shifts"
            sub="Location-verified punches, exceptions and assigned start times"
            right={<ShieldCheck className="h-4 w-4 text-primary" />}
          />
          <div className="p-4">
            <p className="text-sm text-muted-foreground">
              Clock in or out from your assigned branch. Supervisors can record exceptions and
              manage employee scheduled start times with an audit trail.
            </p>
            <Btn className="mt-4" onClick={() => void navigate({ to: "/attendance" })}>
              Open attendance <ArrowRight className="h-4 w-4" />
            </Btn>
          </div>
        </Panel>
      </div>
      {canSeeRoster && (
        <Panel className="mt-4">
          <PanelHead
            title="Today's employee register"
            sub={"Verified attendance for " + people?.businessDate + "; no fabricated schedules or deductions"}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px]">
              <thead>
                <tr>
                  <TH>Employee</TH>
                  <TH>Start time</TH>
                  <TH>Clock in</TH>
                  <TH>Clock out</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {people?.employees.map((employee) => {
                  const record = records.find((row) => row.employeeId === employee.id);
                  const zone = people.branchTimezone;
                  return (
                    <tr key={employee.id}>
                      <TD className="font-semibold">{employee.name}</TD>
                      <TD>{employee.scheduled_start ?? "Not assigned"}</TD>
                      <TD>{renderTime(record?.clockInAt, zone)}</TD>
                      <TD>{renderTime(record?.clockOutAt, zone)}</TD>
                      <TD>
                        <Status>
                          {!record
                            ? "NOT CLOCKED"
                            : record.clockOutAt
                              ? "COMPLETED"
                              : (record.minutesLate ?? 0) > 0
                                ? "LATE"
                                : "PRESENT"}
                        </Status>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        Verified punches are maintained separately from historical payroll records.
        Attendance does not automatically deduct wages.
      </p>
    </AppShell>
  );
}
