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

beforeEach(() => {
  setConfigurationRepositoryForTests(
    new ConfigurationRepository(createDefaultDemoPlatformState()),
  );
});

function sentOrder() {
  const configuration = createDefaultDemoPlatformState();
  const branch = configuration.branches.find(
    (candidate) => candidate.id === DEMO_WESTLANDS_BRANCH_ID,
  )!;
  const baseDraft: OrderDraft = {
    tenantId: DEMO_TENANT_ID,
    branchId: branch.id,
    branch: branch.name,
    table: "T-01",
    customer: "Test guest",
    channel: "DINE_IN",
    cashier: "Cashier",
    waiter: "Waiter",
    lines: [
      {
        id: "line-pilau",
        productId: "pilau",
        name: "Beef Pilau",
        category: "Main",
        quantity: 2,
        unitPrice: 900,
        productionStation: "MAIN KITCHEN",
        itemNote: "No chilli",
      },
    ],
  };
  let state = createEmptyTransactionState(DEMO_TENANT_ID);
  state = TransactionEngine.createOrder(state, baseDraft, "OPEN");
  const orderId = state.orders[0]!.id;
  state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
  return { state, orderId, branch, baseDraft };
}

describe("POS kitchen amendments", () => {
  it("does nothing when a sent order is submitted without item changes", () => {
    const { state, orderId, baseDraft } = sentOrder();
    const beforeAmendments = state.productionAmendments.length;

    const next = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      {
        ...baseDraft,
        lines: state.orders[0]!.lines.map((line) => ({ ...line })),
      },
      "Cashier",
    );

    expect(next.productionAmendments).toHaveLength(beforeAmendments);
    expect(next.orders[0]!.lines).toHaveLength(1);
    expect(next.orders[0]!.lines[0]!.quantity).toBe(2);
  });

  it("creates only an addition amendment for an increased quantity", () => {
    const { state, orderId, baseDraft } = sentOrder();

    const next = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      {
        ...baseDraft,
        lines: [{ ...state.orders[0]!.lines[0]!, quantity: 3 }],
      },
      "Cashier",
    );

    const amendment = next.productionAmendments[0]!;
    expect(amendment.type).toBe("ADDITION");
    expect(amendment.lines).toHaveLength(1);
    expect(amendment.lines[0]!.name).toBe("Beef Pilau");
    expect(amendment.lines[0]!.quantity).toBe(1);
    expect(next.orders[0]!.lines[0]!.quantity).toBe(3);
  });

  it("creates only a cancellation amendment for a quantity reduction", () => {
    const { state, orderId, baseDraft } = sentOrder();

    const next = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      {
        ...baseDraft,
        lines: [{ ...state.orders[0]!.lines[0]!, quantity: 1 }],
      },
      "Cashier",
    );

    const amendment = next.productionAmendments[0]!;
    expect(amendment.type).toBe("CANCEL_ITEM");
    expect(amendment.lines).toHaveLength(1);
    expect(amendment.lines[0]!.quantity).toBe(1);
    expect(amendment.lines[0]!.productionStatus).toBe("CANCELLED");
    expect(next.orders[0]!.lines[0]!.quantity).toBe(1);
  });

  it("turns a sent item-note modification into cancel-old plus add-new amendments", () => {
    const { state, orderId, baseDraft } = sentOrder();

    const next = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      {
        ...baseDraft,
        lines: [{ ...state.orders[0]!.lines[0]!, itemNote: "Extra gravy" }],
      },
      "Cashier",
    );

    const amendments = next.productionAmendments.filter(
      (amendment) => amendment.orderId === orderId,
    );
    expect(amendments.map((amendment) => amendment.type).sort()).toEqual([
      "ADDITION",
      "CANCEL_ITEM",
    ]);
    expect(
      amendments.find((amendment) => amendment.type === "ADDITION")?.lines[0]?.itemNote,
    ).toBe("Extra gravy");
    expect(next.orders[0]!.lines[0]!.itemNote).toBe("Extra gravy");
  });

  it("creates a cancellation amendment when a sent item is removed entirely", () => {
    const { state, orderId, baseDraft } = sentOrder();

    const next = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      { ...baseDraft, lines: [], financialOverride: { subtotal: 0, tax: 0, total: 0 } },
      "Cashier",
    );

    expect(next.productionAmendments[0]!.type).toBe("CANCEL_ITEM");
    expect(next.productionAmendments[0]!.lines[0]!.quantity).toBe(2);
    expect(next.orders[0]!.lines).toHaveLength(0);
    expect(next.orders[0]!.total).toBe(0);
  });
});
