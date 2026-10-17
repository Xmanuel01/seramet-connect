import { describe, expect, it } from "vitest";
import { attendanceTiming } from "./attendance-timing";

describe("attendance timing without invented payroll rules", () => {
  it("measures actual UTC work, keeps unknown schedules unavailable", () => {
    expect(
      attendanceTiming({
        business_date: "2026-10-18",
        clock_in_at: "2026-10-18T05:00:00Z",
        clock_out_at: "2026-10-18T06:17:59Z",
      }),
    ).toEqual({ workedMinutes: 77, earlyDepartureMinutes: null, overtimeMinutes: null });
  });
  it("supports overnight schedules and cutoff starts after midnight", () => {
    const row = {
      business_date: "2026-10-18",
      clock_in_at: "2026-10-18T19:00:00Z",
      clock_out_at: "2026-10-19T01:30:00Z",
      scheduled_start: "22:00",
      scheduled_end: "05:00",
      schedule_timezone: "Africa/Nairobi",
      schedule_cutoff_minutes: 240,
    };
    expect(attendanceTiming(row)).toMatchObject({ workedMinutes: 390, earlyDepartureMinutes: 30 });
    expect(
      attendanceTiming({ ...row, clock_in_at: "2026-10-18T22:00:00Z", scheduled_start: "01:00" }),
    ).toMatchObject({ workedMinutes: 210, earlyDepartureMinutes: 30 });
  });
  it("does not invent scheduled deductions across a daylight-saving offset transition", () => {
    expect(
      attendanceTiming({
        business_date: "2026-11-01",
        clock_in_at: "2026-11-01T04:00:00Z",
        clock_out_at: "2026-11-01T08:00:00Z",
        scheduled_start: "00:00",
        scheduled_end: "04:00",
        schedule_timezone: "America/New_York",
        schedule_cutoff_minutes: 0,
      }),
    ).toMatchObject({ workedMinutes: 240, earlyDepartureMinutes: null });
  });
});
