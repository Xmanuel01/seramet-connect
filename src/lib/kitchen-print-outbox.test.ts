import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type OrderDraft,
} from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_NGONG_BRANCH_ID,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import {
  authorizeKitchenReprint,
  claimKitchenPrintObligation,
  finishKitchenPrintObligation,
  pendingUnclaimedKitchenTickets,
} from "./kitchen-print-outbox";

const createDraft = (): OrderDraft => ({
  tenantId: DEMO_TENANT_ID,
  branchId: DEMO_WESTLANDS_BRANCH_ID,
  branch: "Westlands",
  table: "01",
  customer: "Table 01",
  channel: "Dine-In",
  cashier: "Cashier",
  lines: [
    {
      id: "pilau",
      productId: "p1",
      name: "Beef Pilau",
      category: "Meals",
      quantity: 1,
      unitPrice: 900,
      productionStation: "MAIN KITCHEN",
    },
    {
      id: "juice",
      productId: "p8",
      name: "Passion Juice",
      category: "Drinks",
      quantity: 1,
      unitPrice: 250,
      productionStation: "BAR",
    },
  ],
});

describe("authoritative durable KOT outbox", () => {
  beforeEach(() => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
  });

  it("atomically creates exactly two separate immutable station obligations on initial dispatch", () => {
    let state = TransactionEngine.holdOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      createDraft(),
    );
    const orderId = state.orders[0]!.id;
    expect(state.kitchenPrintObligations).toEqual([]);
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    expect(state.kitchenPrintObligations).toHaveLength(2);
    expect(new Set(state.kitchenPrintObligations?.map((item) => item.station))).toEqual(
      new Set(["MAIN KITCHEN", "BAR"]),
    );
    expect(state.kitchenPrintObligations?.every((item) => item.status === "PENDING")).toBe(true);
    expect(
      state.kitchenPrintObligations?.every(
        (item) => item.orderId === orderId && item.kind === "ORIGINAL",
      ),
    ).toBe(true);
    expect(
      state.kitchenPrintObligations?.find((item) => item.station === "BAR")?.lines[0]?.id,
    ).toBe("juice");
    expect(
      pendingUnclaimedKitchenTickets(state.kitchenPrintObligations ?? [], DEMO_NGONG_BRANCH_ID),
    ).toHaveLength(0);
    const repeated = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(repeated.kitchenPrintObligations).toEqual(state.kitchenPrintObligations);
  });

  it("claims once, tracks OS spool acceptance separately from physical print, and requires audited reprint", () => {
    let state = TransactionEngine.holdOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      createDraft(),
    );
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Cashier");
    const original = state.kitchenPrintObligations![0]!;
    const claimId = "claim-test-original";
    const actor = { id: "cashier-1", deviceId: "pos-1" };
    let claims = claimKitchenPrintObligation(
      state.kitchenPrintObligations!,
      original.id,
      claimId,
      actor,
      "2026-09-29T01:00:00.000Z",
    );
    expect(claims.find((item) => item.id === original.id)?.status).toBe("CLAIMED");
    expect(
      claimKitchenPrintObligation(claims, original.id, claimId, actor, "2026-09-29T01:00:01.000Z"),
    ).toEqual(claims);
    expect(() =>
      claimKitchenPrintObligation(
        claims,
        original.id,
        "second-device-claim",
        { id: "cashier-2" },
        "2026-09-29T01:00:02.000Z",
      ),
    ).toThrow(/already claimed/i);
    expect(() =>
      finishKitchenPrintObligation(
        claims,
        original.id,
        "wrong-claim",
        actor,
        "SPOOLED",
        [],
        "2026-09-29T01:00:03.000Z",
      ),
    ).toThrow(/claimed this ticket/i);

    expect(() =>
      finishKitchenPrintObligation(
        claims,
        original.id,
        claimId,
        { id: actor.id, deviceId: "different-device" },
        "SPOOLED",
        ["stable-bridge-copy-1"],
        "2026-09-29T01:00:03.500Z",
      ),
    ).toThrow(/device that claimed/i);
    expect(() =>
      finishKitchenPrintObligation(
        claims,
        original.id,
        claimId,
        actor,
        "SPOOLED",
        [],
        "2026-09-29T01:00:03.750Z",
      ),
    ).toThrow(/bridge job evidence/i);

    claims = finishKitchenPrintObligation(
      claims,
      original.id,
      claimId,
      actor,
      "SPOOLED",
      ["stable-bridge-copy-1"],
      "2026-09-29T01:00:04.000Z",
    );
    expect(claims.find((item) => item.id === original.id)?.status).toBe("SPOOLED");
    expect(() =>
      claimKitchenPrintObligation(
        claims,
        original.id,
        "automatic-retry",
        actor,
        "2026-09-29T01:00:05.000Z",
      ),
    ).toThrow(/already claimed/i);
    const audited = authorizeKitchenReprint(
      claims,
      original.id,
      "manager-1",
      "Manager visually verified the missing kitchen ticket",
      "2026-09-29T01:01:00.000Z",
    );
    expect(audited[0]?.status).toBe("PENDING");
    expect(audited[0]?.kind).toBe("AUDITED_REPRINT");
    expect(audited[0]?.reprintOf).toBe(original.id);
    expect(audited.find((item) => item.id === original.id)?.status).toBe("SPOOLED");
  });

  it("a lost bridge acknowledgement stays claimed and cannot be automatically replayed", () => {
    let state = TransactionEngine.holdOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      createDraft(),
    );
    state = TransactionEngine.sendToKitchen(state, state.orders[0]!.id, "Cashier");
    const obligation = state.kitchenPrintObligations![0]!;
    const claimed = claimKitchenPrintObligation(
      state.kitchenPrintObligations!,
      obligation.id,
      "persisted-claim-1",
      { id: "cashier-1" },
      "2026-09-29T01:00:00.000Z",
    );
    const restarted = structuredClone(claimed);
    expect(restarted.find((item) => item.id === obligation.id)?.status).toBe("CLAIMED");
    expect(pendingUnclaimedKitchenTickets(restarted, DEMO_WESTLANDS_BRANCH_ID)).toHaveLength(1);
    expect(() =>
      authorizeKitchenReprint(
        restarted,
        obligation.id,
        "manager-1",
        "Manager reviewed an apparent missing ticket",
        "2026-09-29T01:01:00.000Z",
      ),
    ).toThrow(/wait two minutes/i);
    const reviewed = authorizeKitchenReprint(
      restarted,
      obligation.id,
      "manager-1",
      "Manager reviewed the kitchen and confirmed no ticket after the wait",
      "2026-09-29T01:02:01.000Z",
    );
    expect(reviewed[0]?.kind).toBe("AUDITED_REPRINT");
    expect(() =>
      claimKitchenPrintObligation(
        restarted,
        obligation.id,
        "restarted-device",
        { id: "cashier-1" },
        "2026-09-29T01:01:00.000Z",
      ),
    ).toThrow();
  });

  it("creates separate durable ADDITION and VOID obligations for an audited kitchen amendment", () => {
    let state = TransactionEngine.holdOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      createDraft(),
    );
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const originalCount = state.kitchenPrintObligations!.length;
    const retainedPilau = { ...state.orders[0]!.lines.find((line) => line.id === "pilau")! };
    state = TransactionEngine.amendKitchenOrder(
      state,
      orderId,
      {
        ...createDraft(),
        lines: [
          retainedPilau,
          {
            id: "chips-amendment",
            productId: "chips",
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

    const newTickets = state.kitchenPrintObligations!.slice(
      0,
      state.kitchenPrintObligations!.length - originalCount,
    );
    expect(newTickets.map((ticket) => ticket.kind).sort()).toEqual(["ADDITION", "VOID"]);
    expect(newTickets.find((ticket) => ticket.kind === "ADDITION")?.lines.map((line) => line.id)).toEqual([
      "chips-amendment",
    ]);
    expect(newTickets.find((ticket) => ticket.kind === "VOID")?.lines.map((line) => line.id)).toEqual([
      "juice",
    ]);
    expect(newTickets.every((ticket) => ticket.status === "PENDING")).toBe(true);
  });

  it("only new line snapshots generate an amendment ticket after original kitchen dispatch", () => {
    let state = TransactionEngine.holdOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      createDraft(),
    );
    const orderId = state.orders[0]!.id;
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    const originalIds = state.kitchenPrintObligations!.map((item) => item.id);
    const sent = state.orders[0]!.lines.map((line) => ({ ...line }));
    const addition = {
      id: "chips",
      productId: "chips",
      name: "Chips",
      category: "Sides",
      quantity: 1,
      unitPrice: 250,
      productionStation: "MAIN KITCHEN",
    };
    state = TransactionEngine.updateOrderDraft(
      state,
      orderId,
      { ...createDraft(), lines: [...sent, addition] },
      "Cashier",
    );
    state = TransactionEngine.sendToKitchen(state, orderId, "Cashier");
    expect(state.kitchenPrintObligations).toHaveLength(3);
    const amendment = state.kitchenPrintObligations!.find((item) => item.kind === "ADDITION")!;
    expect(amendment.lines.map((line) => line.id)).toEqual(["chips"]);
    expect(
      originalIds.every((id) => state.kitchenPrintObligations!.some((item) => item.id === id)),
    ).toBe(true);
  });
});
