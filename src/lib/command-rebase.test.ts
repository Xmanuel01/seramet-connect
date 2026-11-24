import { expect, it } from "vitest";
import { commandTargetIds, commandTargetsUnchanged } from "@/lib/command-rebase";
import { createEmptyTransactionState, type TransactionState } from "@/lib/transaction-engine";

const order = (id: string, status: string) =>
  ({ id, status, lines: [], total: 1000 }) as unknown as TransactionState["orders"][number];

function state(orders: TransactionState["orders"]) {
  const next = createEmptyTransactionState("tenant");
  next.orders = orders;
  return next;
}

it("finds every id a command names, at any depth", () => {
  expect([
    ...commandTargetIds({
      orderId: "o1",
      payment: { billId: "b1", lines: [{ productId: "p1" }] },
      refundIds: ["r1", "r2"],
      idempotency: "not-an-id",
    }),
  ]).toEqual(["o1", "b1", "p1", "r1", "r2"]);
});

it("resends only when nothing the command names changed", () => {
  const before = state([order("table-1", "OPEN"), order("table-2", "OPEN")]);
  // Another till changed table 2 (and the kitchen added an order): table 1's command can go.
  const elsewhere = state([
    order("table-1", "OPEN"),
    order("table-2", "SENT_TO_KITCHEN"),
    order("table-3", "OPEN"),
  ]);
  expect(commandTargetsUnchanged(before, elsewhere, { orderId: "table-1" })).toBe(true);
  // Table 1 itself changed: a real conflict, so the cashier must look again.
  const same = state([order("table-1", "SENT_TO_KITCHEN"), order("table-2", "OPEN")]);
  expect(commandTargetsUnchanged(before, same, { orderId: "table-1" })).toBe(false);
  // A record the command names that someone else created or removed also counts.
  expect(
    commandTargetsUnchanged(before, state([order("table-2", "OPEN")]), { orderId: "table-1" }),
  ).toBe(false);
});
