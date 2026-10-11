import { describe, expect, it } from "vitest";
import {
  businessDateForTimestamp,
  businessDatePeriod,
  enumerateBusinessDates,
} from "@/lib/business-date";

describe("branch business dates", () => {
  it("applies the branch timezone and cutoff around Nairobi midnight", () => {
    expect(businessDateForTimestamp("2026-09-30T22:45:00.000Z", "Africa/Nairobi", 240)).toBe(
      "2026-09-30",
    );
    expect(businessDateForTimestamp("2026-10-01T01:30:00.000Z", "Africa/Nairobi", 240)).toBe(
      "2026-10-01",
    );
  });

  it("uses local wall-clock cutoff semantics across daylight-saving transitions", () => {
    expect(businessDateForTimestamp("2026-03-08T06:30:00.000Z", "America/New_York", 240)).toBe(
      "2026-03-07",
    );
    expect(businessDateForTimestamp("2026-03-08T08:30:00.000Z", "America/New_York", 240)).toBe(
      "2026-03-08",
    );
    expect(businessDateForTimestamp("2026-11-01T07:30:00.000Z", "America/New_York", 240)).toBe(
      "2026-10-31",
    );
  });

  it("builds bounded dashboard periods from business dates rather than browser dates", () => {
    const now = new Date("2026-09-30T22:45:00.000Z");
    expect(businessDatePeriod("Yesterday", now, "Africa/Nairobi", 240)).toEqual({
      from: "2026-09-29",
      to: "2026-09-29",
    });
    expect(businessDatePeriod("Week", now, "Africa/Nairobi", 240)).toEqual({
      from: "2026-09-24",
      to: "2026-09-30",
    });
    expect(enumerateBusinessDates("2026-09-29", "2026-10-01")).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
  });
});
