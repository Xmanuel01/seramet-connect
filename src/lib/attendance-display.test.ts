import { describe, expect, it } from "vitest";
import { attendanceCollection, attendanceTime } from "./attendance-display";

describe("attendance rendering boundaries", () => {
  it("reproduces the unguarded historical timestamp crash and renders an explicit error instead", () => {
    expect(() => new Intl.DateTimeFormat("en-KE").format(new Date("bad historical value"))).toThrow(
      RangeError,
    );
    expect(attendanceTime("bad historical value", "Africa/Nairobi", true)).toBe(
      "Invalid recorded time",
    );
  });
  it("does not substitute UTC for an invalid configured timezone", () => {
    expect(attendanceTime("2026-10-19T00:00:00Z", "invalid/zone")).toBe("Invalid branch timezone");
  });
  it("uses branch-local time and handles open sessions", () => {
    expect(attendanceTime("2026-10-19T11:21:00Z", "Africa/Nairobi")).toBe("14:21");
    expect(attendanceTime(null, "Africa/Nairobi", true)).toBe("Open");
  });
  it.each([null, {}, { records: null }, { records: {} }])(
    "rejects incomplete responses without exposing their contents",
    (body) => {
      expect(() => attendanceCollection(body, "records")).toThrow(
        "Attendance response is incomplete",
      );
    },
  );
  it("accepts an honestly empty result", () => {
    expect(attendanceCollection({ records: [] }, "records")).toEqual([]);
  });
});
