import { describe, expect, it } from "vitest";
import {
  kitchenJobsAcceptedForDelivery,
  requireServerConfirmation,
  verifyOrderTransition,
} from "./pos-transition-guards";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type TransactionOrder,
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
import { applyServerMutation } from "@/lib/seramet-repository";

const scope = { tenantId: "tenant-1", branchId: "branch-1" };
const order = (status: TransactionOrder["status"], id = "order-1"): TransactionOrder => ({
  id,
  tenantId: scope.tenantId,
  branchId: scope.branchId,
  branch: "Westlands",
  customer: "Walk-in",
  channel: "TAKEAWAY",
  cashier: "Cashier",
  status,
  paymentStatus: "UNPAID",
  createdAt: "2026-09-29T12:00:00.000Z",
  updatedAt: "2026-09-29T12:00:00.000Z",
  lines: [],
  subtotal: 100,
  tax: 0,
  total: 100,
});
const response = (orders: TransactionOrder[], offline = false) => {
  const state = createEmptyTransactionState(scope.tenantId);
  state.orders = orders;
  return { state, offline };
};
const input = (target: "HELD" | "KITCHEN", previousOrderId: string | null = null) => ({
  previousOrderId,
  knownOrderIds: new Set<string>(),
  scope,
  target,
});

describe("POS Phase 1 authoritative transitions", () => {
  it("confirms the exact held order and its branch before clearing the cashier's cart", () => {
    const verified = verifyOrderTransition(response([order("HELD")]), input("HELD"));
    expect(verified.order.id).toBe("order-1");
    expect(verified.persistence).toBe("confirmed");
    expect(() => requireServerConfirmation(verified)).not.toThrow();
  });

  it("treats offline optimistic holds and dispatches as queued, not committed", () => {
    for (const [status, target] of [
      ["HELD", "HELD"],
      ["SENT_TO_KITCHEN", "KITCHEN"],
    ] as const) {
      const queued = verifyOrderTransition(response([order(status)], true), input(target));
      expect(queued.persistence).toBe("queued-offline");
      expect(() => requireServerConfirmation(queued)).toThrow(/queued locally/);
    }
  });

  it("rejects absent responses, wrong statuses, mismatched scopes and ambiguous identities", () => {
    expect(() => verifyOrderTransition(undefined, input("KITCHEN"))).toThrow(
      /did not return a transaction state/,
    );
    expect(() => verifyOrderTransition(response([order("HELD")]), input("KITCHEN"))).toThrow(
      /did not reach Kitchen/,
    );
    expect(() =>
      verifyOrderTransition(
        response([{ ...order("SENT_TO_KITCHEN"), branchId: "another-branch" }]),
        input("KITCHEN"),
      ),
    ).toThrow(/does not match/);
    expect(() =>
      verifyOrderTransition(
        response([order("SENT_TO_KITCHEN"), order("SENT_TO_KITCHEN", "order-2")]),
        input("KITCHEN"),
      ),
    ).toThrow(/identity could not be verified/);
    expect(
      verifyOrderTransition(response([order("SENT_TO_KITCHEN"), order("HELD", "other")]), {
        ...input("KITCHEN", "order-1"),
        knownOrderIds: new Set(["other"]),
      }).order.id,
    ).toBe("order-1");
  });

  it("holds the exact existing open order atomically and rejects repeat hold after kitchen dispatch", () => {
    setConfigurationRepositoryForTests(
      new ConfigurationRepository(createDefaultDemoPlatformState()),
    );
    const draft: OrderDraft = {
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      branch: "Westlands",
      customer: "Guest",
      channel: "Dine-In",
      cashier: "Cashier",
      lines: [
        {
          id: "line-1",
          productId: "pilau",
          name: "Pilau",
          category: "Main Meals",
          quantity: 1,
          unitPrice: 500,
        },
      ],
    };
    // This mutation only consumes actor.name; authorization is covered by the API tests.
    const actor = { name: "Cashier" } as Parameters<typeof applyServerMutation>[3];
    const initial = TransactionEngine.createOrder(
      createEmptyTransactionState(DEMO_TENANT_ID),
      draft,
      "OPEN",
    );
    const originalId = initial.orders[0]!.id;
    const first = applyServerMutation(
      initial,
      "upsertOrderDraft",
      { orderId: originalId, draft, targetStatus: "HELD" },
      actor,
    );
    expect(first.orders).toHaveLength(1);
    expect(first.orders[0]).toMatchObject({ id: originalId, status: "HELD" });
    const repeated = applyServerMutation(
      first,
      "upsertOrderDraft",
      { orderId: originalId, draft, targetStatus: "HELD" },
      actor,
    );
    expect(repeated.orders).toHaveLength(1);
    expect(repeated.orders[0]).toMatchObject({ id: originalId, status: "HELD" });
    const sent = TransactionEngine.sendToKitchen(repeated, originalId, "Cashier");
    expect(() =>
      applyServerMutation(
        sent,
        "upsertOrderDraft",
        { orderId: originalId, draft, targetStatus: "HELD" },
        actor,
      ),
    ).toThrow(/Only unsent/);
  });

  it("accepts only actionable jobs and rejects immediate device failures", () => {
    const jobs = [{ id: "kot-1" }, { id: "bar-1" }];
    expect(
      kitchenJobsAcceptedForDelivery(jobs, [
        { id: "kot-1", status: "Queued" },
        { id: "bar-1", status: "Displayed" },
      ]),
    ).toBe(true);
    expect(
      kitchenJobsAcceptedForDelivery(jobs, [
        { id: "kot-1", status: "Queued" },
        { id: "bar-1", status: "Failed" },
      ]),
    ).toBe(false);
    expect(kitchenJobsAcceptedForDelivery(jobs, [{ id: "kot-1", status: "Printed" }])).toBe(false);
    expect(kitchenJobsAcceptedForDelivery([], [])).toBe(false);
  });
});
