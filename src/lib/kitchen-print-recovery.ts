import type { KitchenPrintObligation } from "@/lib/transaction-engine";

/**
 * Keep unresolved delivery obligations visible across browser restarts.
 * A bridge ACK is not proof that paper physically reached the kitchen.
 */
export function kitchenPrintRecoveryItems(
  obligations: readonly KitchenPrintObligation[],
  branchId: string,
): KitchenPrintObligation[] {
  return obligations.filter(
    (item) => item.branchId === branchId && item.status !== "BRIDGE_ACCEPTED",
  );
}
