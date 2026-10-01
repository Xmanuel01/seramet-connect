import { beforeEach, describe, expect, it } from "vitest";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_NGONG_BRANCH_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { acknowledgedSyncStatus, transactionCacheKey } from "@/offline/offline-store";
import {
  formatPosClock,
  invoiceBusinessDate,
  pendingPosOrders,
  needsKitchenDispatch,
  payableInvoiceForOrder,
  resolvePosTimeZone,
  unbilledKitchenOrders,
} from "./pos-workflow";

describe("POS unbilled order continuity", () => {
  const orders = [
    { id: "held-1", status: "HELD" as const },
    { id: "held-2", status: "HELD" as const },
    { id: "held-3", status: "HELD" as const },
  ];
  it("keeps kitchen orders accessible until billing, without returning invoiced orders", () => {
    const bills: { orderIds: string[] }[] = [];
    expect(pendingPosOrders(orders, bills)).toHaveLength(3);
    const firstSent = orders.map((order) =>
      order.id === "held-1" ? { ...order, status: "SENT_TO_KITCHEN" as const } : order,
    );
    expect(pendingPosOrders(firstSent, bills)).toHaveLength(3);
    expect(unbilledKitchenOrders(firstSent, bills).map((order) => order.id)).toEqual(["held-1"]);
    // Production updates do not hide an order until an invoice actually exists.
    for (const status of ["IN_PROGRESS", "READY", "SERVED"] as const) {
      const progressed = firstSent.map((order) =>
        order.id === "held-1" ? { ...order, status } : order,
      );
      expect(pendingPosOrders(progressed, bills).some((order) => order.id === "held-1")).toBe(true);
    }
    expect(
      pendingPosOrders([...firstSent, { id: "cancelled", status: "CANCELLED" as const }], bills),
    ).toHaveLength(3);
    const secondBilled = firstSent.map((order) =>
      order.id === "held-2" ? { ...order, status: "BILL_REQUESTED" as const } : order,
    );
    bills.push({ orderIds: ["held-2"] });
    expect(pendingPosOrders(secondBilled, bills)).toHaveLength(2);
    const finalPaid = secondBilled.map((order) =>
      order.id === "held-3" ? { ...order, status: "PAID" as const } : order,
    );
    expect(pendingPosOrders(finalPaid, bills).map((order) => order.id)).toEqual(["held-1"]);
    expect(finalPaid).toHaveLength(3); // Clearing the badge never destroys order history.
  });
});

describe("shared POS dispatch and exact-order invoice guards", () => {
  it("reuses sent orders and creates kitchen amendments only for unsent items", () => {
    expect(needsKitchenDispatch(null, true)).toBe(true);
    expect(needsKitchenDispatch({ status: "HELD" }, true)).toBe(true);
    expect(needsKitchenDispatch({ status: "OPEN" }, true)).toBe(true);
    for (const status of ["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"] as const) {
      expect(needsKitchenDispatch({ status }, false)).toBe(false);
      expect(needsKitchenDispatch({ status }, true)).toBe(true);
    }
    expect(needsKitchenDispatch({ status: "BILL_REQUESTED" }, false)).toBe(false);
  });

  it("never selects the first invoice, a different branch, or a terminal invoice", () => {
    const bills = [
      {
        id: "wrong-branch",
        orderIds: ["order-1"],
        status: "OPEN" as const,
        tenantId: "tenant-1",
        branchId: "ngong",
      },
      {
        id: "wrong-order",
        orderIds: ["order-2"],
        status: "OPEN" as const,
        tenantId: "tenant-1",
        branchId: "westlands",
      },
      {
        id: "paid",
        orderIds: ["order-1"],
        status: "PAID" as const,
        tenantId: "tenant-1",
        branchId: "westlands",
      },
      {
        id: "correct",
        orderIds: ["order-1"],
        status: "OPEN" as const,
        tenantId: "tenant-1",
        branchId: "westlands",
      },
    ];
    expect(payableInvoiceForOrder("order-1", "tenant-1", "westlands", bills)?.id).toBe("correct");
    expect(payableInvoiceForOrder("order-1", "tenant-2", "westlands", bills)).toBeUndefined();
    expect(payableInvoiceForOrder("unrelated", "tenant-1", "westlands", bills)).toBeUndefined();
  });

  it("preparing an exact dispatched order twice never creates duplicate bills", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    const draft: OrderDraft = {
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: "Westlands",
      table: "05",
      customer: "Table 05",
      channel: "Dine-In",
      cashier: "Cashier",
      lines: [
        {
          id: "single-kot-line",
          productId: "p1",
          name: "Pilau",
          category: "Main Meals",
          quantity: 1,
          unitPrice: 800,
          productionStation: "MAIN KITCHEN",
        },
      ],
    };
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const sentAt = state.orders[0]!.lines[0]!.sentAt;
    state = TransactionEngine.prepareInvoiceForPayment(state, orderId, "Cashier");
    const invoiceId = state.bills[0]!.id;
    state = TransactionEngine.prepareInvoiceForPayment(state, orderId, "Cashier");
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.id).toBe(invoiceId);
    expect(state.orders[0]?.lines[0]?.sentAt).toBe(sentAt);
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
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });
  it("keeps the exact held order actionable in POS until its invoice exists", () => {
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
    expect(pendingPosOrders(state.orders, state.bills).map((order) => order.id)).toEqual([orderId]);
    expect(unbilledKitchenOrders(state.orders, state.bills)[0]?.id).toBe(orderId);
    expect(state.orders[0]?.lines[0]?.sentAt).toBeTruthy();
    state = TransactionEngine.prepareInvoiceForPayment(state, orderId, "Cashier");
    expect(pendingPosOrders(state.orders, state.bills)).toHaveLength(0);
    expect(unbilledKitchenOrders(state.orders, state.bills)).toHaveLength(0);
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.orderIds).toEqual([orderId]);
    expect(state.orders).toHaveLength(1);
  });
});

describe("branch-correct invoice visibility", () => {
  it("shows late-night UTC invoices on the next Kenyan calendar day", () => {
    expect(invoiceBusinessDate({ issuedAt: "2026-09-28T23:30:00.000Z" }, "Africa/Nairobi")).toBe(
      "2026-09-29",
    );
  });
  it("prefers the server business date when the restaurant uses an overnight cutoff", () => {
    expect(
      invoiceBusinessDate(
        { issuedAt: "2026-09-28T23:30:00.000Z", businessDate: "2026-09-28" },
        "Africa/Nairobi",
      ),
    ).toBe("2026-09-28");
  });
});

describe("real three-order cashier-to-kitchen-to-payment acceptance", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("retains unbilled kitchen work while removing invoiced orders without duplicate receipts", () => {
    const makeDraft = (number: number): OrderDraft => ({
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: "Westlands",
      table: String(number).padStart(2, "0"),
      customer: `Table ${number}`,
      channel: "Dine-In",
      cashier: "Cashier",
      lines: [
        {
          id: `test-line-${number}`,
          productId: "p1",
          name: "Chicken Biryani",
          category: "Main Meals",
          quantity: 1,
          unitPrice: 1250,
          productionStation: "MAIN KITCHEN",
        },
      ],
    });
    let state = createEmptyTransactionState(DEMO_TENANT_ID);
    const ids: string[] = [];
    for (const number of [1, 2, 3]) {
      state = TransactionEngine.holdOrder(state, makeDraft(number));
      ids.push(state.orders[0]!.id);
    }
    expect(new Set(ids).size).toBe(3);
    expect(pendingPosOrders(state.orders, state.bills)).toHaveLength(3);
    expect(state.bills).toHaveLength(0);

    // Send the first held order to the kitchen, but do not bill it yet.
    state = TransactionEngine.sendToKitchen(state, ids[0]!, "Cashier");
    expect(pendingPosOrders(state.orders, state.bills)).toHaveLength(3);
    expect(unbilledKitchenOrders(state.orders, state.bills).map((o) => o.id)).toContain(ids[0]);

    // A separate held order must dispatch and produce only its own invoice.
    state = TransactionEngine.sendToKitchen(state, ids[1]!, "Cashier");
    state = TransactionEngine.prepareInvoiceForPayment(state, ids[1]!, "Cashier");
    state = TransactionEngine.prepareInvoiceForPayment(state, ids[1]!, "Cashier");
    expect(pendingPosOrders(state.orders, state.bills)).toHaveLength(2);
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.orderIds).toEqual([ids[1]]);
    expect(state.bills[0]?.orderIds).not.toContain(ids[0]);

    // Dispatch and settle the third using a simulated confirmed provider event.
    state = TransactionEngine.sendToKitchen(state, ids[2]!, "Cashier");
    state = TransactionEngine.prepareInvoiceForPayment(state, ids[2]!, "Cashier");
    const thirdInvoice = state.bills.find((bill) => bill.orderIds.includes(ids[2]!))!;
    const result = TransactionEngine.createPaymentIntent(state, thirdInvoice.id, {
      amount: thirdInvoice.total,
      method: "MPESA_PROMPT",
      provider: "M-Pesa STK",
      customerPhone: "0700000000",
      createdBy: "Cashier",
    });
    expect(result.intent?.status).toBe("AWAITING_CUSTOMER");
    state = TransactionEngine.confirmPaymentIntent(result.state, result.intent!.id, "TEST-REF-3");
    state = TransactionEngine.confirmPaymentIntent(state, result.intent!.id, "TEST-REF-3");

    expect(pendingPosOrders(state.orders, state.bills).map((o) => o.id)).toEqual([ids[0]]);
    expect(state.orders).toHaveLength(3);
    expect(state.bills).toHaveLength(2);
    expect(state.payments).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.orders.find((o) => o.id === ids[2])?.status).toBe("PAID");
    expect(unbilledKitchenOrders(state.orders, state.bills).map((o) => o.id)).toEqual([ids[0]]);
  });
});

describe("two-branch concurrent-order source isolation", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("dispatches and bills Westlands without changing Ngong's held queue or invoice", () => {
    const draft = (branchId: string, branch: string, lineId: string): OrderDraft => ({
      tenantId: DEMO_TENANT_ID,
      branchId,
      branch,
      table: "01",
      customer: "Table 01",
      channel: "Dine-In",
      cashier: "Cashier",
      lines: [
        {
          id: lineId,
          productId: "p1",
          name: "Chicken Biryani",
          category: "Main Meals",
          quantity: 1,
          unitPrice: 1250,
          productionStation: "MAIN KITCHEN",
        },
      ],
    });
    let state = createEmptyTransactionState(DEMO_TENANT_ID);
    state = TransactionEngine.holdOrder(
      state,
      draft(DEMO_WESTLANDS_BRANCH_ID, "Westlands", "west-line"),
    );
    const westId = state.orders[0]!.id;
    state = TransactionEngine.holdOrder(
      state,
      draft(DEMO_NGONG_BRANCH_ID, "Ngong Road", "ngong-line"),
    );
    const ngongId = state.orders[0]!.id;
    const westOrders = () =>
      state.orders.filter((order) => order.branchId === DEMO_WESTLANDS_BRANCH_ID);
    const ngongOrders = () =>
      state.orders.filter((order) => order.branchId === DEMO_NGONG_BRANCH_ID);

    expect(pendingPosOrders(westOrders(), state.bills)).toHaveLength(1);
    expect(pendingPosOrders(ngongOrders(), state.bills)).toHaveLength(1);
    state = TransactionEngine.sendToKitchen(state, westId, "Westlands Cashier");
    state = TransactionEngine.prepareInvoiceForPayment(state, westId, "Westlands Cashier");
    expect(pendingPosOrders(westOrders(), state.bills)).toHaveLength(0);
    expect(pendingPosOrders(ngongOrders(), state.bills)).toHaveLength(1);
    expect(state.orders.find((order) => order.id === ngongId)?.status).toBe("HELD");
    expect(state.bills).toHaveLength(1);
    expect(state.bills[0]?.orderIds).toEqual([westId]);
    expect(state.bills[0]?.branchId).toBe(DEMO_WESTLANDS_BRANCH_ID);
  });
});
