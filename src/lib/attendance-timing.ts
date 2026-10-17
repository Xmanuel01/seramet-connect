type TimedAttendance = {
  business_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  schedule_timezone?: string | null;
  schedule_cutoff_minutes?: number | null;
};
const minuteOfDay = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
function local(at: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const minute = Number(value("hour")) * 60 + Number(value("minute"));
  return {
    date,
    minute,
    offset:
      Date.parse(date + "T00:00:00Z") + minute * 60000 - Math.floor(Date.parse(at) / 60000) * 60000,
  };
}
export function attendanceTiming(row: TimedAttendance) {
  const workedMinutes = row.clock_out_at
    ? Math.floor((Date.parse(row.clock_out_at) - Date.parse(row.clock_in_at)) / 60000)
    : null;
  let earlyDepartureMinutes: number | null = null;
  if (
    row.clock_out_at &&
    row.scheduled_start &&
    row.scheduled_end &&
    row.schedule_timezone &&
    row.schedule_cutoff_minutes !== null &&
    row.schedule_cutoff_minutes !== undefined
  ) {
    const start = local(row.clock_in_at, row.schedule_timezone);
    const end = local(row.clock_out_at, row.schedule_timezone);
    // Without an approved DST disambiguation policy, do not invent scheduled
    // comparisons across an offset transition. Actual UTC work duration is valid.
    if (start.offset === end.offset) {
      const scheduledStart = minuteOfDay(row.scheduled_start);
      let expectedEnd =
        minuteOfDay(row.scheduled_end) + (scheduledStart < row.schedule_cutoff_minutes ? 1440 : 0);
      if (minuteOfDay(row.scheduled_end) <= scheduledStart) expectedEnd += 1440;
      const actualEnd =
        end.minute +
        Math.round(
          (Date.parse(end.date + "T00:00:00Z") - Date.parse(row.business_date + "T00:00:00Z")) /
            86400000,
        ) *
          1440;
      earlyDepartureMinutes = Math.max(0, expectedEnd - actualEnd);
    }
  }
  return { workedMinutes, earlyDepartureMinutes, overtimeMinutes: null };
}
