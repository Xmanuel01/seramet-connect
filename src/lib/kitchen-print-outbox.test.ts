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
  DEMO_NGONG_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const draft = (): OrderDraft => ({
  tenantId: DEMO_TENANT_ID,
  branchId: DEMO_WESTLANDS_BRANCH_ID,
  branch: "Westlands",
  channel: "Dine-In",
  cashier: "Cashier One",
  customer: "Table 1",
  lines: [
    {
      id: "food-line",
      name: "Beef Pilau",
      category: "Main",
      quantity: 1,
      unitPrice: 900,
      productionStation: "MAIN KITCHEN",
    },
    {
      id: "bar-line",
      name: "Passion Juice",
      category: "Drinks",
      quantity: 1,
      unitPrice: 200,
      productionStation: "BAR",
    },
  ],
});

describe("durable original and amendment kitchen print obligations", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("creates one immutable obligation per station in the same dispatched order state", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft());
    const orderId = state.orders[0]!.id;
    expect(state.kitchenPrintObligations).toHaveLength(0);

    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier One");
    const initial = state.kitchenPrintObligations ?? [];
    expect(initial).toHaveLength(2);
    expect(new Set(initial.map((item) => item.station))).toEqual(new Set(["MAIN KITCHEN", "BAR"]));
    expect(initial.every((item) => item.sourceId === "ORIGINAL")).toBe(true);
    expect(initial.every((item) => item.status === "PENDING")).toBe(true);
    expect(initial.every((item) => item.branchId === DEMO_WESTLANDS_BRANCH_ID)).toBe(true);

    // A browser retry cannot create a second physical KOT obligation.
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier One");
    expect(state.kitchenPrintObligations).toEqual(initial);
    expect(state.orders).toHaveLength(1);

    const amended: OrderDraft = {
      ...draft(),
      lines: [
        ...draft().lines,
        {
          id: "additional-food",
          name: "Chips",
          category: "Sides",
          quantity: 1,
          unitPrice: 250,
          productionStation: "MAIN KITCHEN",
        },
      ],
    };
    state = TransactionEngine.updateOrderDraft(state, orderId, amended, "Cashier One");
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier One");
    const additions = (state.kitchenPrintObligations ?? []).filter(
      (item) => item.kind === "ADDITION",
    );
    expect(additions).toHaveLength(1);
    expect(additions[0]?.station).toBe("MAIN KITCHEN");
    expect(additions[0]?.lines.map((line) => line.id)).toEqual(["additional-food"]);
    expect(state.kitchenPrintObligations).toHaveLength(3);
    expect(state.productionAmendments).toHaveLength(1);
    expect(additions[0]?.sourceId).toBe(state.productionAmendments[0]?.id);
  });

  it("permits one branch-scoped claim, never auto-retries an uncertain bridge response", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft());
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier One");
    const obligationId = state.kitchenPrintObligations![0]!.id;
    const initialSnapshot = structuredClone(state);

    expect(() =>
      TransactionEngine.claimKitchenPrintObligation(
        state,
        obligationId,
        DEMO_NGONG_BRANCH_ID,
        "Cashier One",
        "claim-1",
      ),
    ).toThrow(/branch/);
    expect(state).toEqual(initialSnapshot);
    state = TransactionEngine.claimKitchenPrintObligation(
      state,
      obligationId,
      DEMO_WESTLANDS_BRANCH_ID,
      "user-1",
      "claim-1",
    );
    expect(() =>
      TransactionEngine.claimKitchenPrintObligation(
        state,
        obligationId,
        DEMO_WESTLANDS_BRANCH_ID,
        "user-2",
        "claim-2",
      ),
    ).toThrow(/review before retry/i);
    expect(() =>
      TransactionEngine.settleKitchenPrintObligation(
        state,
        obligationId,
        DEMO_WESTLANDS_BRANCH_ID,
        "user-2",
        "claim-2",
        "BRIDGE_ACCEPTED",
      ),
    ).toThrow(/claim owner/);

    state = TransactionEngine.settleKitchenPrintObligation(
      state,
      obligationId,
      DEMO_WESTLANDS_BRANCH_ID,
      "user-1",
      "claim-1",
      "UNCERTAIN",
      "Bridge response was lost",
    );
    expect(state.kitchenPrintObligations![0]?.status).toBe("UNCERTAIN");
    expect(() =>
      TransactionEngine.claimKitchenPrintObligation(
        state,
        obligationId,
        DEMO_WESTLANDS_BRANCH_ID,
        "user-2",
        "claim-2",
      ),
    ).toThrow(/review before retry/i);
    expect(() =>
      TransactionEngine.reviewKitchenPrintObligation(
        state,
        obligationId,
        DEMO_WESTLANDS_BRANCH_ID,
        "Manager",
        "RETRY",
        "short",
      ),
    ).toThrow(/reason/i);
    state = TransactionEngine.reviewKitchenPrintObligation(
      state,
      obligationId,
      DEMO_WESTLANDS_BRANCH_ID,
      "Manager",
      "RETRY",
      "Kitchen confirmed no paper was delivered",
    );
    expect(state.kitchenPrintObligations![0]?.status).toBe("PENDING");
    expect(state.kitchenPrintObligations![0]?.claimToken).toBeUndefined();
    expect(state.auditEvents[0]?.action).toContain("Reviewed KOT");
  });

  it("distinguishes a printer bridge acknowledgement from a physically verified ticket", () => {
    let state = TransactionEngine.holdOrder(createEmptyTransactionState(DEMO_TENANT_ID), draft());
    const id = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, id, "Cashier One");
    const item = state.kitchenPrintObligations![0]!;
    state = TransactionEngine.claimKitchenPrintObligation(
      state,
      item.id,
      DEMO_WESTLANDS_BRANCH_ID,
      "user-1",
      "claim-1",
    );
    state = TransactionEngine.settleKitchenPrintObligation(
      state,
      item.id,
      DEMO_WESTLANDS_BRANCH_ID,
      "user-1",
      "claim-1",
      "BRIDGE_ACCEPTED",
    );
    expect(state.kitchenPrintObligations![0]?.status).toBe("BRIDGE_ACCEPTED");
    const audited = TransactionEngine.requestKitchenReprint(
      state,
      item.id,
      DEMO_WESTLANDS_BRANCH_ID,
      "Branch manager",
      "Paper was missing after verifying the production printer",
    );
    expect(audited.kitchenPrintObligations).toHaveLength(3);
    const reprint = audited.kitchenPrintObligations![0]!;
    expect(reprint).toMatchObject({
      kind: "REPRINT",
      status: "PENDING",
      parentObligationId: item.id,
      sourceId: item.sourceId,
    });
    expect(reprint.lines).toEqual(item.lines);
    expect(audited.kitchenPrintObligations!.find((row) => row.id === item.id)?.status).toBe(
      "BRIDGE_ACCEPTED",
    );
    expect(() =>
      TransactionEngine.reviewKitchenPrintObligation(
        state,
        item.id,
        DEMO_WESTLANDS_BRANCH_ID,
        "Manager",
        "RETRY",
        "Customer saw no ticket in kitchen",
      ),
    ).toThrow(/audited reprint/i);
  });
});
