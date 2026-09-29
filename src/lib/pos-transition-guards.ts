import type { TransactionOrder, TransactionState } from "@/lib/transaction-engine";

type MutationResponse = {
  state: TransactionState;
  offline?: boolean;
};

type TransitionScope = { tenantId: string; branchId: string };

export type ConfirmedOrderTransition = {
  order: TransactionOrder;
  state: TransactionState;
  persistence: "confirmed" | "queued-offline";
};

const kitchenStatuses = new Set(["SENT_TO_KITCHEN", "IN_PROGRESS", "READY", "SERVED"]);

/**
 * Validate the exact order and branch returned by an authoritative mutation.
 * Do not equate a locally queued offline mutation with an acknowledged server write.
 * Ambiguous new identities fail closed rather than linking another cashier's order.
 */
export function verifyOrderTransition(
  response: MutationResponse | undefined,
  input: {
    previousOrderId: string | null;
    knownOrderIds: ReadonlySet<string>;
    scope: TransitionScope;
    target: "HELD" | "KITCHEN";
  },
): ConfirmedOrderTransition {
  if (!response?.state) throw new Error("Order mutation did not return a transaction state.");
  const matches = response.state.orders.filter((order) =>
    input.previousOrderId ? order.id === input.previousOrderId : !input.knownOrderIds.has(order.id),
  );
  if (matches.length !== 1) {
    throw new Error(
      "Order identity could not be verified. Refresh Orders before retrying; do not submit another order.",
    );
  }
  const order = matches[0]!;
  if (order.tenantId !== input.scope.tenantId || order.branchId !== input.scope.branchId) {
    throw new Error("Order response does not match the active restaurant and branch.");
  }
  const correctStatus =
    input.target === "HELD" ? order.status === "HELD" : kitchenStatuses.has(order.status);
  if (!correctStatus) {
    throw new Error(
      `Order ${order.id} did not reach ${input.target === "HELD" ? "Held" : "Kitchen"} state. Refresh Orders before retrying.`,
    );
  }
  return {
    order,
    state: response.state,
    persistence: response.offline ? "queued-offline" : "confirmed",
  };
}

/** Never advance the workflow or print a KOT from an unacknowledged offline mutation. */
export function requireServerConfirmation(
  result: ConfirmedOrderTransition,
): asserts result is ConfirmedOrderTransition & { persistence: "confirmed" } {
  if (result.persistence !== "confirmed") {
    throw new Error(
      `Order ${result.order.id} was queued locally while offline. Wait for synchronization and verify Orders before proceeding.`,
    );
  }
}

/** A created print job is not accepted unless the device queue actually retains it
 * in an actionable or delivered state. A failed print must never unlock billing.
 */
export function kitchenJobsAcceptedForDelivery(
  jobs: readonly { id: string }[],
  queue: readonly { id: string; status: string }[],
): boolean {
  const actionable = new Set([
    "Queued",
    "Sending",
    "Retrying",
    "Printed",
    "Displayed",
    "Fallback Printed",
  ]);
  return (
    jobs.length > 0 &&
    jobs.every((job) => queue.some((entry) => entry.id === job.id && actionable.has(entry.status)))
  );
}
