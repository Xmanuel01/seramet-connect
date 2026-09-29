import { beforeEach, describe, expect, it } from "vitest";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { pendingKotObligations } from "./kot-obligations";

describe("atomic durable KOT obligation and crash reconciliation", () => {
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
        id: "food-1",
        productId: "p1",
        name: "Chicken Biryani",
        category: "Main Meals",
        quantity: 1,
        unitPrice: 1250,
        productionStation: "MAIN KITCHEN",
      },
      {
        id: "bar-1",
        productId: "p8",
        name: "Passion Juice",
        category: "Drinks",
        quantity: 1,
        unitPrice: 300,
        productionStation: "BAR",
      },
    ],
  };

  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("persists one immutable obligation per station in the same kitchen transaction", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    expect(state.orders[0]?.kotObligations).toBeUndefined();
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const obligations = state.orders[0]?.kotObligations ?? [];
    expect(state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    expect(obligations).toHaveLength(2);
    expect(obligations.map((item) => item.station).sort()).toEqual(["BAR", "MAIN KITCHEN"]);
    expect(obligations.every((item) => item.status === "PENDING")).toBe(true);
    expect(obligations.every((item) => item.kind === "NEW")).toBe(true);
    expect(pendingKotObligations(state.orders, DEMO_WESTLANDS_BRANCH_ID)).toHaveLength(2);

    const originalPayload = JSON.stringify(obligations);
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(JSON.stringify(state.orders[0]?.kotObligations)).toBe(originalPayload);
  });

  it("keeps a claimed outbox entry visible after a simulated browser crash", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const obligationId = state.orders[0]!.kotObligations![0]!.id;
    state = TransactionEngine.claimKotObligations(
      state,
      orderId,
      [obligationId],
      "Cashier",
      "device-1",
    );
    const persistedServerState = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(
      pendingKotObligations(persistedServerState.orders, DEMO_WESTLANDS_BRANCH_ID)[0]?.obligation
        .status,
    ).toBe("CLAIMED");
    expect(() =>
      TransactionEngine.claimKotObligations(
        persistedServerState,
        orderId,
        [obligationId],
        "Other Cashier",
        "device-2",
      ),
    ).toThrow(/already claimed/);
    expect(() =>
      TransactionEngine.markKotObligations(
        persistedServerState,
        orderId,
        [obligationId],
        "QUEUED",
        "Other Cashier",
        "device-2",
      ),
    ).toThrow(/another device/);
  });

  it("requires manager review and an audit trail to retry an uncertain claim", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const obligationId = state.orders[0]!.kotObligations![0]!.id;
    state = TransactionEngine.claimKotObligations(
      state,
      orderId,
      [obligationId],
      "Cashier",
      "device-1",
    );
    state = TransactionEngine.markKotObligations(
      state,
      orderId,
      [obligationId],
      "UNCERTAIN",
      "Cashier",
      "device-1",
    );
    expect(() =>
      TransactionEngine.resetKotObligationAfterReview(state, orderId, obligationId, "retry", "Mgr"),
    ).toThrow(/15/);
    state = TransactionEngine.resetKotObligationAfterReview(
      state,
      orderId,
      obligationId,
      "Verified no paper or digital ticket on either terminal",
      "Manager",
    );
    expect(state.orders[0]?.kotObligations?.[0]?.status).toBe("PENDING");
    expect(state.auditEvents[0]?.action).toContain("Authorized KOT retry");
  });

  it("emits an addition obligation only for newly dispatched items", () => {
    let state = TransactionEngine.createOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const original = state.orders[0]!.kotObligations!.map((item) => ({ ...item }));
    state = TransactionEngine.updateOrderDraft(
      state,
      orderId,
      {
        ...draft,
        lines: [
          ...state.orders[0]!.lines.map((line) => ({ ...line })),
          {
            id: "extra-1",
            productId: "p7",
            name: "Chips",
            category: "Sides",
            quantity: 1,
            unitPrice: 250,
            productionStation: "MAIN KITCHEN",
          },
        ],
      },
      "Cashier",
    );
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const obligations = state.orders[0]!.kotObligations!;
    expect(obligations).toHaveLength(3);
    expect(obligations.slice(0, 2)).toEqual(original);
    expect(obligations[2]?.kind).toBe("ADDITION");
    expect(obligations[2]?.lines.map((line) => line.id)).toEqual(["extra-1"]);
  });
});
