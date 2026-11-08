import { describe, expect, it } from "vitest";
import { attendanceWeekStart, summarizeAttendance, attendanceDuration } from "./attendance-summary";

describe("attendance business-date summaries", () => {
  const row = {
    employeeId: "staff",
    businessDate: "2026-11-05",
    clockInAt: "2026-11-05T19:00:00Z",
    clockOutAt: "2026-11-06T03:00:00Z",
    scheduledMinutes: 420,
  };
  const now = Date.parse("2026-11-06T04:00:00Z");
  it("starts the attendance week on Monday across year boundaries", () => {
    expect(attendanceWeekStart("2026-11-08")).toBe("2026-11-02");
    expect(attendanceWeekStart("2027-01-01")).toBe("2026-12-28");
  });
  it("keeps an overnight shift on its original business date", () => {
    expect(summarizeAttendance([row], now)).toEqual({
      workedMinutes: 480,
      overtimeMinutes: 60,
      unassessedDays: 0,
    });
  });
  it("counts a daily schedule once across multiple sessions", () => {
    const morning = {
      ...row,
      clockInAt: "2026-11-05T06:00:00Z",
      clockOutAt: "2026-11-05T10:00:00Z",
      scheduledMinutes: 480,
    };
    const evening = {
      ...morning,
      clockInAt: "2026-11-05T11:00:00Z",
      clockOutAt: "2026-11-05T16:00:00Z",
    };
    expect(summarizeAttendance([morning, evening], now)).toEqual({
      workedMinutes: 540,
      overtimeMinutes: 60,
      unassessedDays: 0,
    });
  });
  it("does not invent overtime for missing or conflicting schedules", () => {
    expect(summarizeAttendance([{ ...row, scheduledMinutes: null }], now).unassessedDays).toBe(1);
    expect(summarizeAttendance([row, { ...row, scheduledMinutes: 480 }], now)).toMatchObject({
      unassessedDays: 1,
      overtimeMinutes: 0,
    });
  });
  it("uses current server time for an active shift and formats durations", () => {
    expect(summarizeAttendance([{ ...row, clockOutAt: null }], now).workedMinutes).toBe(540);
    expect(attendanceDuration(540)).toBe("9h 00m");
    expect(attendanceDuration(null)).toBe("--");
  });
});
