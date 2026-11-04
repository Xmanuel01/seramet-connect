import { describe, expect, it } from "vitest";
import { calendarDateStart, inDateWindow, transactionWindow } from "./transaction-period";
import { businessDateForTimestamp } from "./business-date";

describe("transaction calendar periods", () => {
  const today = "2026-11-04";
  const custom = { from: "2020-01-01", to: "2026-11-01" };
  it("rolls Nairobi today at local midnight, not UTC midnight", () => {
    expect(businessDateForTimestamp("2026-11-03T20:59:59.999Z", "Africa/Nairobi")).toBe(
      "2026-11-03",
    );
    expect(businessDateForTimestamp("2026-11-03T21:00:00Z", "Africa/Nairobi")).toBe(today);
    expect(calendarDateStart(today, "Africa/Nairobi")).toBe("2026-11-03T21:00:00.000Z");
  });
  it("uses 23 and 25 hour dates across DST without losing history", () => {
    expect(calendarDateStart("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00.000Z");
    expect(calendarDateStart("2026-03-09", "America/New_York")).toBe("2026-03-09T04:00:00.000Z");
    expect(calendarDateStart("2026-11-01", "America/New_York")).toBe("2026-11-01T04:00:00.000Z");
    expect(calendarDateStart("2026-11-02", "America/New_York")).toBe("2026-11-02T05:00:00.000Z");
  });
  it("preserves custom ranges and covers rolling presets inclusively", () => {
    expect(transactionWindow("Today", today, custom)).toEqual({ from: today, to: today });
    expect(transactionWindow("Yesterday", today, custom)).toEqual({
      from: "2026-11-03",
      to: "2026-11-03",
    });
    expect(transactionWindow("Last 7 Days", today, custom).from).toBe("2026-10-29");
    expect(transactionWindow("Last 30 Days", today, custom).from).toBe("2026-10-06");
    expect(transactionWindow("Custom Range", today, custom)).toEqual(custom);
    expect(inDateWindow("1990-01-01", transactionWindow("All Time", today, custom))).toBe(true);
    expect(inDateWindow("2026-11-03", transactionWindow("Today", today, custom))).toBe(false);
  });
});
