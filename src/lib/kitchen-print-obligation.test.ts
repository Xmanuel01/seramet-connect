import { beforeEach, describe, expect, it } from "vitest";
import {
  TransactionEngine,
  createEmptyTransactionState,
  normalizeTransactionState,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
  createDefaultDemoPlatformState,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

describe("durable server-side production ticket obligation", () => {
  beforeEach(() =>
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    ),
  );
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
        id: "initial-line",
        name: "Chicken Biryani",
        category: "Main Meals",
        quantity: 1,
        unitPrice: 1200,
        productionStation: "MAIN KITCHEN",
      },
    ],
  };

  it("saves one logical original KOT in the same transaction as a held-order dispatch", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft);
    const orderId = state.orders[0]!.id;
    expect(state.kitchenPrintObligations).toEqual([]);
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const first = state.kitchenPrintObligations?.[0];
    expect(first).toMatchObject({
      type: "NEW",
      orderId,
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      status: "PENDING",
    });
    expect(first?.lines).toHaveLength(1);
    expect(first?.lines[0]?.sentAt).toBeTruthy();
    expect(state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(state.kitchenPrintObligations).toHaveLength(1);
    expect(state.bills).toHaveLength(0);
  });

  it("persists an amendment obligation containing only the new production items", () => {
    let state = TransactionEngine.createOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      draft,
      "OPEN",
    );
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    state = TransactionEngine.updateOrderDraft(
      state,
      orderId,
      {
        ...draft,
        lines: [
          ...state.orders[0]!.lines,
          {
            id: "extra-line",
            name: "Chips",
            category: "Sides",
            quantity: 1,
            unitPrice: 300,
            productionStation: "MAIN KITCHEN",
          },
        ],
      },
      "Cashier",
    );
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(state.kitchenPrintObligations).toHaveLength(2);
    expect(state.kitchenPrintObligations?.[0]?.type).toBe("ADDITION");
    expect(state.kitchenPrintObligations?.[0]?.lines.map((line) => line.id)).toEqual([
      "extra-line",
    ]);
    expect(state.productionAmendments).toHaveLength(1);
    expect(state.productionAmendments[0]?.lines.map((line) => line.id)).toEqual(["extra-line"]);
  });

  it("normalizes old snapshots without creating false historic KOT acknowledgments", () => {
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    delete state.kitchenPrintObligations;
    expect(normalizeTransactionState(state).kitchenPrintObligations).toEqual([]);
  });
});
