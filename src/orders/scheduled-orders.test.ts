import { describe, expect, it } from "vitest";
import { scheduledOrderTimes } from "@/orders/scheduled-orders";

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
