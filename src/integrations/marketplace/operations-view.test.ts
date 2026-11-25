import { describe, expect, it } from "vitest";
import { restorationTime, availabilityLabel, prepCountdown, orderStage } from "./operations-view";
import type { ExternalResourceMapping } from "@/integrations/runtime/models";
import type { TransactionState } from "@/lib/transaction-engine";

describe("marketplace staff controls", () => {
  it("restores at branch midnight rather than the browser's midnight", () => {
    expect(restorationTime("TODAY", new Date("2026-11-14T18:00:00Z"), "Africa/Nairobi")).toBe(
      "2026-11-14T21:00:00.000Z",
    );
    expect(restorationTime("TODAY", new Date("2026-11-01T04:30:00Z"), "America/New_York")).toBe(
      "2026-11-02T05:00:00.000Z",
    );
    expect(restorationTime("30", new Date("2026-11-14T18:00:00Z"), "Africa/Nairobi")).toBe(
      "2026-11-14T18:30:00.000Z",
    );
    expect(restorationTime("MANUAL", new Date(), "Africa/Nairobi")).toBeUndefined();
  });
  it("does not confuse a requested availability change with provider confirmation", () => {
    const mapping = {
      syncStatus: "PENDING",
      metadata: {
        availabilityOverride: { available: false },
        lastIncrementalSync: { available: true },
      },
    } as unknown as ExternalResourceMapping;
    expect(availabilityLabel(mapping)).toBe("Updating");
    mapping.syncStatus = "SYNCED";
    expect(availabilityLabel(mapping)).toBe("Not verified");
    mapping.metadata["lastIncrementalSync"] = { available: false };
    expect(availabilityLabel(mapping)).toBe("Confirmed unavailable");
    mapping.syncStatus = "FAILED";
    expect(availabilityLabel(mapping)).toBe("Update failed");
  });
  it("keeps payment independent from collection and shows the confirmed preparation deadline", () => {
    const order = {
      status: "PAID",
      externalSource: {
        estimatedReadyAt: "2026-11-14T18:25:00Z",
        metadata: { acceptanceConfirmedAt: "2026-11-14T18:00:00Z" },
      },
    } as unknown as TransactionState["orders"][number];
    expect(orderStage(order, [])).toBe("Preparing");
    expect(prepCountdown(order, new Date("2026-11-14T18:20:00Z"))).toBe("5 min remaining");
    expect(prepCountdown(order, new Date("2026-11-14T18:30:00Z"))).toBe("5 min overdue");
    order.externalSource!.pickedUpAt = "2026-11-14T18:26:00Z";
    expect(orderStage(order, [])).toBe("Collected");
  });
  it("shows rejected orders as closed rather than awaiting acceptance", () => {
    const order = {
      status: "CANCELLED",
      externalSource: { metadata: {} },
    } as unknown as TransactionState["orders"][number];
    expect(prepCountdown(order, new Date())).toBe("Closed");
  });
});
