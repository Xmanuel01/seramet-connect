import { useState } from "react";
import { PencilLine, Users } from "lucide-react";
import { Btn, TD, TH } from "@/components/app/ui";
import { attendanceTime } from "@/lib/attendance-display";
import {
  attendanceDuration,
  summarizeAttendance,
  type AttendanceHoursRow,
} from "@/lib/attendance-summary";

type Record = AttendanceHoursRow & {
  id: string;
  branchId: string;
  minutesLate: number | null;
  clockInSource: string;
  clockOutSource: string | null;
  version: number;
  workedMinutes: number | null;
  missingClockOut?: boolean;
};
type Employee = {
  id: string;
  name: string;
  scheduled_start: string | null;
  rest_day: number | null;
  missingClockIn?: boolean;
};
export function AttendanceWorkday({
  records,
  employees,
  date,
  timezone,
  serverNow,
  summary,
  onCorrect,
}: {
  records: Record[];
  employees: Employee[];
  date: string;
  timezone: string;
  serverNow: string;
  summary: { recorded: number; working: number; late: number; not_recorded: number } | null;
  onCorrect: (record?: Record, employeeId?: string) => void;
}) {
  const [employeeId, setEmployee] = useState("");
  const [status, setStatus] = useState("ALL");
  const missing = (row: Record) =>
    !row.clockOutAt &&
    (row.missingClockOut ||
      (row.scheduledMinutes == null &&
        Date.parse(serverNow) - Date.parse(row.clockInAt) >= 86400000));
  const rows = employees.map((employee) => {
    const sessions = records.filter((row) => row.employeeId === employee.id);
    const current = sessions.find((row) => !row.clockOutAt) ?? sessions[0];
    const hours = summarizeAttendance(sessions, Date.parse(serverNow));
    return {
      employee,
      current,
      hours,
      status: current
        ? missing(current)
          ? "MISSING"
          : current.clockOutAt
            ? "COMPLETED"
            : "WORKING"
        : employee.missingClockIn
          ? "MISSING_IN"
          : "NOT_CLOCKED",
    };
  });
  const visible = rows.filter(
    (row) =>
      (!employeeId || employeeId === row.employee.id) &&
      (status === "ALL" || status === row.status),
  );
  return (
    <section className="min-w-0 py-5" aria-label="Workday attendance">
      <dl className="grid grid-cols-2 gap-y-6 border-b border-border pb-5 sm:grid-cols-4">
        {[
          ["Currently working", summary?.working ?? 0],
          ["Recorded today", summary?.recorded ?? 0],
          ["Late arrivals", summary?.late ?? 0],
          [
            "Missing punches",
            records.filter(missing).length +
              employees.filter((employee) => employee.missingClockIn).length,
          ],
        ].map(([label, value]) => (
          <div key={label} className="border-l-2 border-primary/30 px-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 items-end gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <label className="grid min-w-0 gap-1 text-xs font-semibold">
          Employee
          <select
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={employeeId}
            onChange={(e) => setEmployee(e.target.value)}
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold">
          Attendance status
          <select
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              ["ALL", "All statuses"],
              ["WORKING", "Working"],
              ["COMPLETED", "Completed"],
              ["NOT_CLOCKED", "Not clocked in"],
              ["MISSING", "Missing clock-out"],
              ["MISSING_IN", "Missing clock-in"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Btn className="col-span-2 justify-self-end sm:col-span-1" onClick={() => onCorrect()}>
          <PencilLine className="h-4 w-4" />
          Record exception
        </Btn>
      </div>
      <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <Users className="h-4 w-4" />
          Today's attendance
        </h2>
        <span className="text-muted-foreground">
          {date} · {timezone}
        </span>
      </div>
      <div className="max-w-full overflow-x-auto border-y border-border">
        <table className="w-full min-w-[780px] text-sm">
          <thead>
            <tr>
              <TH>Employee</TH>
              <TH>Clock in</TH>
              <TH>Clock out</TH>
              <TH>Worked</TH>
              <TH>Over schedule</TH>
              <TH>Late</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </tr>
          </thead>
          <tbody>
            {visible.map(({ employee, current, hours, status }) => (
              <tr key={employee.id}>
                <TD>
                  <span className="font-semibold">{employee.name}</span>
                  {current && current.businessDate < date && (
                    <div className="text-xs text-muted-foreground">
                      Since {current.businessDate}
                    </div>
                  )}
                </TD>
                <TD>{attendanceTime(current?.clockInAt ?? null, timezone)}</TD>
                <TD>{attendanceTime(current?.clockOutAt ?? null, timezone)}</TD>
                <TD>{current ? attendanceDuration(hours.workedMinutes) : "--"}</TD>
                <TD>
                  {current && !hours.unassessedDays
                    ? attendanceDuration(hours.overtimeMinutes)
                    : "--"}
                </TD>
                <TD>{current?.minutesLate == null ? "--" : `${current.minutesLate} min`}</TD>
                <TD>
                  <span
                    className={`inline-flex items-center gap-2 ${status === "WORKING" ? "text-primary" : status === "MISSING" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current" />
                    {status === "WORKING"
                      ? "Working"
                      : status === "COMPLETED"
                        ? "Completed"
                        : status === "MISSING"
                          ? "Missing clock-out"
                          : status === "MISSING_IN"
                            ? "Missing clock-in"
                            : employee.rest_day
                              ? "Day off"
                              : "Not clocked in"}
                  </span>
                </TD>
                <TD>
                  <Btn
                    title={`Correct attendance for ${employee.name}`}
                    onClick={() => onCorrect(current, employee.id)}
                  >
                    <PencilLine className="h-4 w-4" />
                  </Btn>
                </TD>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <TD colSpan={8}>No employees match these filters.</TD>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
