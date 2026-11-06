import {
  attendanceDuration,
  elapsedAttendanceMinutes,
  type AttendanceHoursRow,
} from "@/lib/attendance-summary";
import { attendanceTime } from "@/lib/attendance-display";

export function AttendanceTimeline({
  rows,
  timezone,
  now,
}: {
  rows: (AttendanceHoursRow & { id: string; employeeName: string })[];
  timezone: string;
  now: number;
}) {
  const minute = (at: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(at));
    return (
      Number(parts.find((p) => p.type === "hour")?.value) * 60 +
      Number(parts.find((p) => p.type === "minute")?.value)
    );
  };
  const timed = rows.map((row) => ({
    ...row,
    start: minute(row.clockInAt),
    duration: elapsedAttendanceMinutes(row, now),
  }));
  const days = Math.max(1, ...timed.map((row) => Math.ceil((row.start + row.duration) / 1440)));
  const end = days * 1440;
  return (
    <div
      className="max-w-full overflow-x-auto border-b border-border p-4"
      aria-label="Attendance timeline"
    >
      <div className="min-w-[580px]">
        <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 pb-3 text-xs text-muted-foreground">
          <span>Employee / business date</span>
          <div className="flex justify-between">
            {[0, 1, 2, 3, 4].map((index) => (
              <span key={index}>
                {index === 4
                  ? days === 1
                    ? "24:00"
                    : `+${days} days`
                  : `${String((index * days * 6) % 24).padStart(2, "0")}:00${index * days * 6 >= 24 ? ` +${Math.floor((index * days * 6) / 24)}` : ""}`}
              </span>
            ))}
          </div>
        </div>
        {timed.map((row) => (
          <div
            key={row.id}
            className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-4 border-t border-border py-3"
          >
            <div className="min-w-0">
              <div className="break-words text-sm font-medium">{row.employeeName}</div>
              <div className="text-xs text-muted-foreground">
                {row.businessDate} · {attendanceDuration(row.duration)}
              </div>
            </div>
            <div
              className="relative h-8 bg-muted/50"
              aria-label={`${row.employeeName}: ${attendanceTime(row.clockInAt, timezone, true)} to ${row.clockOutAt ? attendanceTime(row.clockOutAt, timezone, true) : "working"}`}
            >
              {[0, 25, 50, 75, 100].map((left) => (
                <span
                  key={left}
                  className="absolute inset-y-0 border-l border-border"
                  style={{ left: `${left}%` }}
                />
              ))}
              <div
                title={`${attendanceTime(row.clockInAt, timezone, true)} - ${row.clockOutAt ? attendanceTime(row.clockOutAt, timezone, true) : "Working"}`}
                className={`absolute inset-y-2 rounded-sm ${row.clockOutAt ? "bg-primary/55" : "bg-primary"}`}
                style={{
                  left: `${(row.start / end) * 100}%`,
                  width: `${Math.max(0.3, (row.duration / end) * 100)}%`,
                  maxWidth: `${100 - (row.start / end) * 100}%`,
                }}
              />
            </div>
          </div>
        ))}
        {!rows.length && (
          <p className="py-4 text-sm text-muted-foreground">No attendance in this period.</p>
        )}
      </div>
    </div>
  );
}
