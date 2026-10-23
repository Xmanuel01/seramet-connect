import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttendanceClock } from "./AttendanceClock";

const base: ComponentProps<typeof AttendanceClock> = {
  name: "Amina",
  branch: "Westlands",
  businessDate: "2026-10-23",
  loaded: true,
  working: false,
  completed: false,
  clockIn: "09:00",
  clockOut: "17:00",
  schedule: "09:00 - 17:00",
  locationEnabled: true,
  openElsewhere: false,
  unknown: false,
  busy: false,
  onPunch: () => {},
};
const render = (overrides: Partial<typeof base> = {}) =>
  renderToStaticMarkup(createElement(AttendanceClock, { ...base, ...overrides }));

describe("Attendance clock", () => {
  it("shows employee identity and recorded times with shift details collapsed", () => {
    const html = render();
    expect(html).toContain("Amina");
    expect(html).toContain("Westlands");
    expect(html).toContain('dateTime="2026-10-23"');
    expect(html).toContain("09:00");
    expect(html).toContain("17:00");
    expect(html).toContain("Not clocked in");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain('disabled=""');
  });

  it.each([{ loaded: false }, { busy: true }, { openElsewhere: true }, { locationEnabled: false }])(
    "blocks a punch when unavailable: %j",
    (state) => {
      expect(render(state)).toContain('disabled=""');
    },
  );

  it("offers clock-out for an open shift and completion for a closed shift", () => {
    expect(render({ working: true })).toContain("Clocked in");
    expect(render({ working: true })).toMatch(/<button[^>]*>[\s\S]*Clock out<\/button>/);
    expect(render({ completed: true })).toContain("Shift completed");
  });

  it("preserves safe reconciliation of an uncertain request", () => {
    const html = render({ unknown: true, locationEnabled: false });
    expect(html).toContain("Check / retry request");
    expect(html).toContain("Previous request not confirmed");
    expect(html).not.toContain('disabled=""');
  });
});
