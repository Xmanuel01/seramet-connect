import { shiftBusinessDate } from "./business-date";

export type AttendanceHoursRow = {
  employeeId: string;
  businessDate: string;
  clockInAt: string;
  clockOutAt: string | null;
  scheduledMinutes?: number | null;
};

export function attendanceWeekStart(date: string) {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay();
  return shiftBusinessDate(date, -(weekday === 0 ? 6 : weekday - 1));
}

export function elapsedAttendanceMinutes(row: AttendanceHoursRow, now: number) {
  return Math.max(
    0,
    (Math.min(now, row.clockOutAt ? Date.parse(row.clockOutAt) : now) - Date.parse(row.clockInAt)) /
      60000,
  );
}

// A schedule belongs to an employee's business date, not to each separate punch.
// Count it once when an employee returns for more than one session that day.
export function summarizeAttendance(rows: AttendanceHoursRow[], now: number) {
  const days = new Map<
    string,
    { minutes: number; scheduled: number | null; comparable: boolean }
  >();
  for (const row of rows) {
    const key = JSON.stringify([row.employeeId, row.businessDate]);
    const day = days.get(key) ?? {
      minutes: 0,
      scheduled: row.scheduledMinutes ?? null,
      comparable: true,
    };
    day.minutes += elapsedAttendanceMinutes(row, now);
    if (day.scheduled !== (row.scheduledMinutes ?? null)) day.comparable = false;
    days.set(key, day);
  }
  let worked = 0;
  let overtime = 0;
  let unassessed = 0;
  for (const day of days.values()) {
    worked += day.minutes;
    if (!day.comparable || day.scheduled === null) unassessed += 1;
    else overtime += Math.max(0, day.minutes - day.scheduled);
  }
  return {
    workedMinutes: Math.floor(worked),
    overtimeMinutes: Math.floor(overtime),
    unassessedDays: unassessed,
  };
}

export function attendanceDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "--";
  const whole = Math.max(0, Math.floor(minutes));
  return `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, "0")}m`;
}
