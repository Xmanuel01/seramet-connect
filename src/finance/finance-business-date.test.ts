import { describe, expect, it } from "vitest";
import { financeDefaultDates } from "@/finance/finance-business-date";

describe("finance period defaults", () => {
  it("uses wall-clock cutoff across the daylight-saving jump", () => {
    expect(financeDefaultDates(new Date("2026-03-08T08:30:00Z"), "America/New_York", 240)).toEqual({
      from: "2026-03-01",
      to: "2026-03-08",
    });
  });
  it("uses the Nairobi business date instead of UTC", () => {
    const utcLateEvening = new Date("2026-09-30T22:45:00.000Z");
    expect(financeDefaultDates(utcLateEvening, "Africa/Nairobi", 0)).toEqual({
      from: "2026-10-01",
      to: "2026-10-01",
    });
  });

  it("respects branch rollover at 04:00 Nairobi local time", () => {
    expect(
      financeDefaultDates(new Date("2026-09-30T22:45:00.000Z"), "Africa/Nairobi", 240),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(
      financeDefaultDates(new Date("2026-10-01T01:30:00.000Z"), "Africa/Nairobi", 240),
    ).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("does not silently accept unsupported UTC or malformed time-zone assumptions", () => {
    expect(financeDefaultDates(new Date("2026-09-28T23:30:00.000Z"), "UTC", 0)).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
    expect(financeDefaultDates(new Date("2026-09-28T23:30:00.000Z"), "Invalid/Zone", 0)).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
    expect(financeDefaultDates(new Date("2026-09-28T23:30:00.000Z"), "UTC", -3)).toEqual({
      from: "2026-09-01",
      to: "2026-09-28",
    });
  });
});
