import { describe, expect, it } from "vitest";
import {
  branchLocalTimeToIso,
  InvalidScheduledTimeError,
  isScheduledHold,
  scheduledOrderTimes,
  shiftScheduledRelease,
} from "@/orders/scheduled-orders";

const now = Date.parse("2026-11-17T12:00:00Z");
const base = { travelMinutes: 15, prepMinutes: 20, bufferMinutes: 5, now };

describe("scheduled order times", () => {
  it("works back from the delivery time, leaving the rider's trip", () => {
    expect(
      scheduledOrderTimes({ ...base, pickup: false, scheduledFor: "2026-11-17T19:00:00Z" }),
    ).toEqual({
      scheduledReadyAt: "2026-11-17T18:45:00.000Z",
      scheduledReleaseAt: "2026-11-17T18:20:00.000Z",
      hold: true,
    });
  });

  it("uses the app's pickup time when it gives one", () => {
    expect(
      scheduledOrderTimes({
        ...base,
        pickup: false,
        scheduledFor: "2026-11-17T19:00:00Z",
        scheduledReadyAt: "2026-11-17T18:40:00Z",
      })?.scheduledReleaseAt,
    ).toBe("2026-11-17T18:15:00.000Z");
  });

  it("allows no trip for pickup orders", () => {
    expect(
      scheduledOrderTimes({ ...base, pickup: true, scheduledFor: "2026-11-17T19:00:00Z" })
        ?.scheduledReadyAt,
    ).toBe("2026-11-17T19:00:00.000Z");
  });

  it("sends it to the kitchen straight away when prep should already have started", () => {
    expect(
      scheduledOrderTimes({ ...base, pickup: false, scheduledFor: "2026-11-17T12:30:00Z" })?.hold,
    ).toBe(false);
  });

  it("is not scheduled without a time", () => {
    expect(scheduledOrderTimes({ ...base, pickup: false })).toBeUndefined();
  });
});

describe("scheduled order review fixes", () => {
  it("refuses an unreadable scheduled time instead of treating the order as unscheduled", () => {
    expect(() =>
      scheduledOrderTimes({ ...base, pickup: false, scheduledFor: "not a date" }),
    ).toThrow(InvalidScheduledTimeError);
    expect(() =>
      scheduledOrderTimes({ ...base, pickup: false, scheduledReadyAt: "31/11/2026" }),
    ).toThrow(InvalidScheduledTimeError);
  });

  it("reads a typed ready-by time in the branch's time zone, not the device's", () => {
    expect(branchLocalTimeToIso("2026-11-18T19:30", "Africa/Nairobi")).toBe(
      "2026-11-18T16:30:00.000Z",
    );
    expect(branchLocalTimeToIso("2026-07-01T12:00", "America/New_York")).toBe(
      "2026-07-01T16:00:00.000Z",
    );
    expect(branchLocalTimeToIso("2026-12-01T12:00", "America/New_York")).toBe(
      "2026-12-01T17:00:00.000Z",
    );
    expect(() => branchLocalTimeToIso("19:30", "Africa/Nairobi")).toThrow();
  });

  it("moves the kitchen time with a changed ready time, keeping the prep gap", () => {
    const source = {
      scheduledReadyAt: "2026-11-17T18:45:00.000Z",
      scheduledReleaseAt: "2026-11-17T18:20:00.000Z",
    } as Parameters<typeof shiftScheduledRelease>[0];
    shiftScheduledRelease(source, "2026-11-17T19:15:00.000Z");
    expect(source.scheduledReadyAt).toBe("2026-11-17T19:15:00.000Z");
    expect(source.scheduledReleaseAt).toBe("2026-11-17T18:50:00.000Z");
  });

  it("recognises a held scheduled order without a customer time", () => {
    expect(
      isScheduledHold({
        status: "HELD",
        externalSource: { isScheduled: true, scheduledReleaseAt: "2026-11-17T18:20:00Z" },
      } as Parameters<typeof isScheduledHold>[0]),
    ).toBe(true);
    expect(
      isScheduledHold({
        status: "SENT_TO_KITCHEN",
        externalSource: { isScheduled: true },
      } as Parameters<typeof isScheduledHold>[0]),
    ).toBe(false);
  });
});
