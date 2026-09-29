import { describe, expect, it } from "vitest";
import { acknowledgedSyncStatus, transactionCacheKey } from "@/offline/offline-store";
import {
  formatPosClock,
  pendingPosOrders,
  resolvePosTimeZone,
  unbilledKitchenOrders,
} from "./pos-workflow";

describe("POS production queue separation", () => {
  const orders = [
    { id: "held-1", status: "HELD" as const },
    { id: "held-2", status: "HELD" as const },
    { id: "held-3", status: "HELD" as const },
  ];
  it("reduces the entry queue from three to zero as orders enter kitchen and billing", () => {
    const bills: { orderIds: string[] }[] = [];
    expect(pendingPosOrders(orders, bills)).toHaveLength(3);
    const firstSent = orders.map((order) =>
      order.id === "held-1" ? { ...order, status: "SENT_TO_KITCHEN" as const } : order,
    );
    expect(pendingPosOrders(firstSent, bills)).toHaveLength(2);
    expect(unbilledKitchenOrders(firstSent, bills).map((order) => order.id)).toEqual(["held-1"]);
    const secondBilled = firstSent.map((order) =>
      order.id === "held-2" ? { ...order, status: "BILL_REQUESTED" as const } : order,
    );
    bills.push({ orderIds: ["held-2"] });
    expect(pendingPosOrders(secondBilled, bills)).toHaveLength(1);
    const finalPaid = secondBilled.map((order) =>
      order.id === "held-3" ? { ...order, status: "PAID" as const } : order,
    );
    expect(pendingPosOrders(finalPaid, bills)).toHaveLength(0);
    expect(finalPaid).toHaveLength(3); // Clearing the badge never destroys order history.
  });
});

describe("POS business-branch clock", () => {
  it("displays a UTC instant at 05:00 in Nairobi, without modifying the event timestamp", () => {
    const now = new Date("2026-09-29T02:00:00.000Z");
    expect(resolvePosTimeZone("UTC", "UTC", "KE")).toBe("Africa/Nairobi");
    expect(formatPosClock(now, "en-GB", "Africa/Nairobi")).toBe("05:00:00");
    expect(now.toISOString()).toBe("2026-09-29T02:00:00.000Z");
  });
  it("respects non-Kenyan configured branch zones", () => {
    expect(resolvePosTimeZone("Europe/London", "Africa/Nairobi", "GB")).toBe("Europe/London");
    expect(resolvePosTimeZone(undefined, "Africa/Nairobi", "KE")).toBe("Africa/Nairobi");
  });
});

describe("offline isolation and acknowledgement safety", () => {
  it("separates the same tenant's two branch transaction caches", () => {
    expect(transactionCacheKey("tenant-a", "westlands")).not.toBe(
      transactionCacheKey("tenant-a", "ngong"),
    );
  });
  it("never silently marks missing or conflicting acknowledgements as synced", () => {
    expect(acknowledgedSyncStatus("accepted")).toBe("SYNCED");
    expect(acknowledgedSyncStatus("duplicate")).toBe("SYNCED");
    expect(acknowledgedSyncStatus("conflict")).toBe("CONFLICT");
    expect(acknowledgedSyncStatus(undefined)).toBe("FAILED");
    expect(acknowledgedSyncStatus("rejected")).toBe("FAILED");
  });
});
