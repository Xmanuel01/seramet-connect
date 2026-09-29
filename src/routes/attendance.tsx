import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine, type AttendanceStatus } from "@/lib/transaction-engine";

export const Route = createFileRoute("/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance - Seramet" },
      {
        name: "description",
        content: "Daily attendance, clock-in status, lateness and overtime by branch.",
      },
      { property: "og:title", content: "Attendance - Seramet" },
      {
        property: "og:description",
        content: "Clock-in status, lateness and overtime for every employee.",
      },
    ],
  }),
  component: Attendance,
});

function statusLabel(status?: AttendanceStatus) {
  if (!status) return "Not Clocked";
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function minutesBetween(start?: string, end?: string) {
  if (!start) return "-";
  if (!end) return "Open";
  const asMinutes = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  let minutes = asMinutes(end) - asMinutes(start);
  if (minutes < 0) minutes += 24 * 60;
  return `${(minutes / 60).toFixed(1)}h`;
}

function Attendance() {
  const { branch, branchLabel, currentUser } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const rows = TransactionEngine.getAttendanceRows(state, branch);
  const present = rows.filter(({ attendance }) => attendance?.status === "PRESENT").length;
  const late = rows.filter(({ attendance }) => attendance?.status === "LATE").length;
  const absent = rows.filter(({ attendance }) => attendance?.status === "ABSENT").length;
  const overtimeMinutes = rows.reduce(
    (sum, { attendance }) => sum + (attendance?.overtimeMinutes ?? 0),
    0,
  );
  const toggleAttendance = (employeeId: string, clockedIn: boolean) =>
    void mutate(clockedIn ? "clockOutEmployee" : "clockInEmployee", {
      employeeId,
      source: "MANUAL",
    });

  const exportCsv = () => {
    if (typeof document === "undefined") return;
    const csv = [
      [
        "Employee",
        "Department",
        "Branch",
        "Scheduled",
        "Clock In",
        "Clock Out",
        "Late Minutes",
        "Overtime Minutes",
        "Status",
      ],
      ...rows.map(({ employee, attendance }) => [
        employee.name,
        employee.department,
        employee.branch,
        employee.shift,
        attendance?.clockIn ?? "",
        attendance?.clockOut ?? "",
        String(attendance?.minutesLate ?? 0),
        String(attendance?.overtimeMinutes ?? 0),
        statusLabel(attendance?.status),
      ]),
    ]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `seramet-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Attendance"
      subtitle={`Today - ${branchLabel} - live attendance and lateness deductions`}
      actions={
        <>
          <Btn>Date: Today</Btn>
          <Btn variant="primary" onClick={exportCsv}>
            Export timesheet
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Present" value={present} />
        <Metric label="Absent" value={absent} invert={absent > 0} />
        <Metric label="Late" value={late} invert={late > 0} />
        <Metric label="Overtime hrs" value={(overtimeMinutes / 60).toFixed(1)} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Daily attendance"
          sub={`Clock-in records feed payroll automatically - backend ${backendStatus}`}
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips items={["Date: Today", `Branch: ${branch}`, "Department: All", "Status: Any"]} />
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map(({ employee, attendance }) => (
            <article
              key={employee.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold">{employee.name}</div>
                  <div className="text-[12px] text-muted-foreground">
                    {employee.department} - {employee.branch}
                  </div>
                </div>
                <Status>{statusLabel(attendance?.status)}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Scheduled </span>
                  <span className="num font-semibold">{employee.shift}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Clock in </span>
                  <span className="num font-semibold">{attendance?.clockIn ?? "-"}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Clock out </span>
                  <span className="num font-semibold">
                    {attendance?.clockOut ?? (attendance?.clockIn ? "Open" : "-")}
                  </span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Late </span>
                  <span className="num font-semibold">{attendance?.minutesLate ?? 0} min</span>
                </div>
              </div>
              {!(["ABSENT", "OFF", "ON_LEAVE"] as AttendanceStatus[]).includes(
                attendance?.status ?? "PRESENT",
              ) && (
                <Btn
                  className="mt-3 w-full"
                  onClick={() =>
                    toggleAttendance(
                      employee.id,
                      Boolean(attendance?.clockIn && !attendance.clockOut),
                    )
                  }
                >
                  {attendance?.clockIn && !attendance.clockOut ? "Clock out" : "Clock in"}
                </Btn>
              )}
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr>
                <TH>Employee</TH>
                <TH>Department</TH>
                <TH>Branch</TH>
                <TH>Scheduled</TH>
                <TH>Clock in</TH>
                <TH>Clock out</TH>
                <TH>Worked</TH>
                <TH className="text-right">Late min</TH>
                <TH>Status</TH>
                <TH>Action</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ employee, attendance }) => (
                <tr key={employee.id} className="hover:bg-secondary/50">
                  <TD className="font-semibold">{employee.name}</TD>
                  <TD className="text-muted-foreground">{employee.department}</TD>
                  <TD className="text-muted-foreground">{employee.branch}</TD>
                  <TD className="num">{employee.shift}</TD>
                  <TD className="num">{attendance?.clockIn ?? "-"}</TD>
                  <TD className="num">
                    {attendance?.clockOut ?? (attendance?.clockIn ? "Open" : "-")}
                  </TD>
                  <TD className="num">
                    {minutesBetween(attendance?.clockIn, attendance?.clockOut)}
                  </TD>
                  <TD className="num text-right font-semibold">{attendance?.minutesLate ?? 0}</TD>
                  <TD>
                    <Status>{statusLabel(attendance?.status)}</Status>
                  </TD>
                  <TD>
                    {!(["ABSENT", "OFF", "ON_LEAVE"] as AttendanceStatus[]).includes(
                      attendance?.status ?? "PRESENT",
                    ) ? (
                      <button
                        type="button"
                        onClick={() =>
                          toggleAttendance(
                            employee.id,
                            Boolean(attendance?.clockIn && !attendance.clockOut),
                          )
                        }
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        {attendance?.clockIn && !attendance.clockOut ? "Clock out" : "Clock in"}
                      </button>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">-</span>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </AppShell>
  );
}
