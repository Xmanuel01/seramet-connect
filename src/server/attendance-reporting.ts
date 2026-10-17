import { SerametHttpError, type ServerActor } from "@/lib/seramet-auth";
import { shiftBusinessDate } from "@/lib/business-date";
import { permissions } from "@/platform/permissions";
import type { D1Database } from "@/server/database/d1";
import { csvCell } from "@/onboarding/menu-import-schema";
import { attendanceTiming } from "@/lib/attendance-timing";

export type AttendanceRecord = {
  id: string;
  user_id: string;
  employee_name: string;
  branch_id: string;
  business_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  minutes_late: number | null;
  clock_in_source: string;
  clock_out_source: string | null;
  version: number;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  schedule_timezone?: string | null;
  schedule_cutoff_minutes?: number | null;
};
export function attendanceRecord(row: AttendanceRecord) {
  return {
    id: row.id,
    employeeId: row.user_id,
    employeeName: row.employee_name,
    branchId: row.branch_id,
    businessDate: row.business_date,
    clockInAt: row.clock_in_at,
    clockOutAt: row.clock_out_at,
    minutesLate: row.minutes_late,
    clockInSource: row.clock_in_source,
    clockOutSource: row.clock_out_source,
    version: row.version,
    ...attendanceTiming(row),
  };
}
function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + "T00:00:00Z")) &&
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date
  );
}
export async function attendanceRecords(
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  today: string,
  url: URL,
  exporting = false,
) {
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || from;
  if (!validDate(from) || !validDate(to) || from > to || to > shiftBusinessDate(from, 30))
    throw new SerametHttpError(400, "Choose a valid attendance range of at most 31 business dates");
  const managed = actor.permissions.includes(permissions.staffManage);
  const employee = url.searchParams.get("employeeId") || (managed ? "" : actor.id);
  if (!managed && employee !== actor.id)
    throw new SerametHttpError(403, "Only your own attendance is available");
  const status = url.searchParams.get("status") || "ALL";
  const source = url.searchParams.get("source") || "ALL";
  const conditions: Record<string, string> = {
    ALL: "1=1",
    OPEN: "s.clock_out_at IS NULL",
    COMPLETED: "s.clock_out_at IS NOT NULL",
    LATE: "s.minutes_late>0",
    EXCEPTION: "(s.clock_in_source='SUPERVISOR' OR s.clock_out_source='SUPERVISOR')",
  };
  if (!Object.hasOwn(conditions, status) || !["ALL", "GEOFENCE", "SUPERVISOR"].includes(source))
    throw new SerametHttpError(400, "Invalid attendance filter");
  const offset = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000)
    throw new SerametHttpError(400, "Invalid attendance page");
  const values: unknown[] = [actor.tenantId, branchId, from, to];
  let where = `s.tenant_id=? AND s.branch_id=? AND s.business_date>=? AND s.business_date<=? AND ${conditions[status]}`;
  if (employee) {
    where += " AND s.user_id=?";
    values.push(employee);
  }
  if (source !== "ALL") {
    where += " AND (s.clock_in_source=? OR s.clock_out_source=?)";
    values.push(source, source);
  }
  const limit = exporting ? 5000 : 200;
  const result = await db
    .prepare(
      `SELECT s.*,u.name employee_name FROM employee_attendance_sessions s JOIN users u ON u.tenant_id=s.tenant_id AND u.id=s.user_id WHERE ${where} ORDER BY s.clock_in_at DESC,s.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, limit + 1, exporting ? 0 : offset)
    .all<AttendanceRecord>();
  const rows = result.results ?? [];
  if (exporting && rows.length > limit)
    throw new SerametHttpError(
      422,
      "Export exceeds 5000 sessions; narrow the date or employee filters",
    );
  return {
    from,
    to,
    status,
    source,
    employeeId: employee || null,
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
    records: rows.slice(0, limit).map(attendanceRecord),
  };
}
export async function attendanceCsv(
  db: D1Database,
  actor: ServerActor,
  branchId: string,
  timezone: string,
  today: string,
  url: URL,
) {
  const report = await attendanceRecords(db, actor, branchId, today, url, true);
  const localTime = (at: string | null) =>
    at
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          dateStyle: "short",
          timeStyle: "medium",
          hourCycle: "h23",
        }).format(new Date(at))
      : "";
  const rows = [
    [
      "Employee",
      "Business date",
      `Clock in (${timezone})`,
      `Clock out (${timezone})`,
      "Clock in (UTC)",
      "Clock out (UTC)",
      "Worked whole minutes",
      "Late minutes",
      "Clock-in source",
      "Clock-out source",
    ],
    ...report.records.map((row) => [
      row.employeeName,
      row.businessDate,
      localTime(row.clockInAt),
      localTime(row.clockOutAt),
      row.clockInAt,
      row.clockOutAt ?? "",
      row.workedMinutes?.toString() ?? "",
      row.minutesLate?.toString() ?? "",
      row.clockInSource,
      row.clockOutSource ?? "",
    ]),
  ];
  const csv = rows
    .map((row) =>
      row.map((field) => csvCell(/^\s*[=+@-]/.test(field) ? "'" + field : field)).join(","),
    )
    .join("\r\n");
  await db
    .prepare(
      "INSERT INTO attendance_access_events(tenant_id,id,branch_id,actor_id,event_type,at,details_json) VALUES(?,?,?,?,'TIMESHEET_EXPORT',?,?)",
    )
    .bind(
      actor.tenantId,
      crypto.randomUUID(),
      branchId,
      actor.id,
      new Date().toISOString(),
      JSON.stringify({
        from: report.from,
        to: report.to,
        employeeId: report.employeeId,
        status: report.status,
        source: report.source,
        rows: report.records.length,
        timezone,
      }),
    )
    .run();
  return new Response(csv, {
    headers: {
      "content-type": "text/csv;charset=utf-8",
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="seramet-attendance-${report.from}-${report.to}.csv"`,
    },
  });
}
