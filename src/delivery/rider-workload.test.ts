import { describe, expect, it } from "vitest";
import { riderWorkload } from "./rider-workload";
import type { TransactionOrder } from "@/lib/transaction-engine";
import type { OrderChannelDefinition } from "@/platform/types";
const channel = {
  id: "own-id",
  code: "MY-COURIER",
  displayName: "Restaurant courier",
  channelType: "OWN_DELIVERY",
  metadata: {},
} as OrderChannelDefinition;
const order = (extra: Partial<TransactionOrder> = {}) =>
  ({
    id: "order",
    channel: "own-id",
    branchId: "A",
    branch: "Legacy A",
    status: "PAID",
    delivery: { rider: "Rider", status: "DELIVERED", deliveredAt: "2026-10-18T21:30:00Z" },
    ...extra,
  }) as TransactionOrder;
describe("canonical rider workload", () => {
  it("resolves configured channel IDs/codes/names and excludes other branches and platform orders", () => {
    const result = riderWorkload({
      orders: [
        order(),
        order({ channel: channel.code }),
        order({ channel: channel.displayName }),
        order({ branchId: "B" }),
        order({ channel: "platform" }),
      ],
      channels: [channel],
      branchId: "A",
      legacyBranch: "Legacy A",
      rider: "Rider",
      timezone: "Africa/Nairobi",
      cutoffMinutes: 180,
      now: new Date("2026-10-18T22:00:00Z"),
    });
    expect(result).toEqual({ today: "2026-10-18", activeTasks: 0, completedToday: 3 });
  });
  it("uses local cutoff boundaries and daylight-saving dates instead of UTC slicing", () => {
    const base = {
      channels: [channel],
      branchId: "A",
      legacyBranch: "Legacy A",
      rider: "Rider",
      timezone: "America/New_York",
      cutoffMinutes: 240,
      now: new Date("2026-11-01T08:30:00Z"),
    };
    expect(
      riderWorkload({
        ...base,
        orders: [
          order({
            delivery: { rider: "Rider", status: "DELIVERED", deliveredAt: "2026-11-01T05:30:00Z" },
          }),
        ],
      }).completedToday,
    ).toBe(1);
    expect(
      riderWorkload({
        ...base,
        now: new Date("2026-11-01T09:00:00Z"),
        orders: [
          order({
            delivery: { rider: "Rider", status: "DELIVERED", deliveredAt: "2026-11-01T05:30:00Z" },
          }),
        ],
      }).completedToday,
    ).toBe(0);
  });
});
