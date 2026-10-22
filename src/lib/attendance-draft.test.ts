import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAttendanceDraft,
  writeAttendanceDraft,
  type AttendanceDraft,
} from "./attendance-draft";

describe("session-scoped attendance recovery", () => {
  afterEach(() => vi.unstubAllGlobals());
  const draft: AttendanceDraft = {
    selected: "employee",
    sessionId: "record",
    reason: "Transport delay",
    occurredAt: "",
    action: "EXPLAIN",
  };
  it("isolates employee/tenant/branch/device sessions, bounds retention and serializes no GPS or secrets", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    expect(
      writeAttendanceDraft("tenant/branch/user/device/session", {
        ...draft,
        pin: "secret",
        latitude: -1.2,
      } as AttendanceDraft),
    ).toBe(true);
    expect(readAttendanceDraft("tenant/branch/user/device/session")).toEqual(draft);
    expect(readAttendanceDraft("tenant/other/user/device/session")).toBeNull();
    expect(
      readAttendanceDraft("tenant/branch/user/device/session", Date.now() + 9 * 3600000),
    ).toBeNull();
    expect([...values.values()].join()).not.toMatch(/secret|latitude/);
  });
  it("fails safely when browser storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    });
    expect(writeAttendanceDraft("scope", draft)).toBe(false);
    expect(readAttendanceDraft("scope")).toBeNull();
  });
  it("retains the exact pending clock-out target without nested location data", () => {
    let stored = "";
    vi.stubGlobal("sessionStorage", {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    });
    const pending = {
      action: "OUT" as const,
      key: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      expectedVersion: 3,
    };
    writeAttendanceDraft("scope", {
      ...draft,
      pending: { ...pending, latitude: -1.2 },
    } as AttendanceDraft);
    expect(readAttendanceDraft("scope")?.pending).toEqual(pending);
    expect(stored).not.toContain("latitude");
  });
});
