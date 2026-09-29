import { beforeEach, describe, expect, it } from "vitest";
import { TransactionEngine, createEmptyTransactionState, type OrderDraft } from "@/lib/transaction-engine";
import { createDefaultDemoPlatformState, DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID } from "@/platform/demo/default-demo-data";
import { ConfigurationRepository, setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
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
    expect(resolvePosTimeZone("UTC", "UTC", undefined, "KES")).toBe("Africa/Nairobi");
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

describe("authoritative held-to-kitchen-to-invoice order continuity", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
  });
  it("moves the exact held order out of entry pending without deleting the kitchen or invoice record", () => {
    const draft: OrderDraft = {
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: "Westlands",
      table: "04",
      customer: "Table 04",
      channel: "Dine-In",
      cashier: "Cashier",
      lines: [
        {
          id: "held-line",
          productId: "p1",
          name: "Chicken Biryani",
          category: "Main Meals",
          quantity: 1,
          unitPrice: 1250,
          productionStation: "MAIN KITCHEN",
        },
      ],
    };
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    expect(pendingPosOrders(state.orders, state.bills).map((order) => order.id)).toEqual([orderId]);
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(pendingPosOrders(state.orders, state.bills)).toHaveLength(0);
    expect(unbilledKitchenOrders(state.orders, state.bills)[0]?.id).toBe(orderId);
    expect(state.orders[0]?.lines[0]?.sentAt).toBeTruthy();
    state = TransactionEngine.prepareInvoiceForPayment(state, orderId, "Cashier");
    expect(unbilledKitchenOrders(state.orders, state.bills)).toHaveLength(0);
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.orderIds).toEqual([orderId]);
    expect(state.orders).toHaveLength(1);
  });
});
