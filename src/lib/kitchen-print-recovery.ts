import type { KitchenPrintObligation, OrderStatus } from "@/lib/transaction-engine";

/**
 * Once an order has moved past the kitchen (ready, served, billed, paid, closed), its food
 * was clearly made or the order is over, so an unconfirmed ticket no longer needs action.
 */
const PAST_KITCHEN: ReadonlySet<OrderStatus> = new Set([
  "READY",
  "SERVED",
  "BILL_REQUESTED",
  "AWAITING_PAYMENT",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
  "REFUNDED",
]);

type RecoveryContext = {
  /** The branch's orders, to retire tickets whose order has moved on. */
  orders?: readonly { id: string; status: OrderStatus; businessDate?: string }[];
  /** Today's business date; tickets for orders from an earlier day are retired. */
  today?: string;
};

/**
 * Kitchen tickets still worth a manager's attention: not confirmed by the bridge, not
 * deliberately bypassed, and for an order that is still open today. Tickets for orders
 * that moved on, or from a previous business day, retire on their own.
 */
export function kitchenPrintRecoveryItems<
  T extends Pick<KitchenPrintObligation, "branchId" | "status"> & { orderId?: string },
>(obligations: readonly T[], branchId: string, context: RecoveryContext = {}): T[] {
  const orders = new Map((context.orders ?? []).map((order) => [order.id, order]));
  return obligations.filter((item) => {
    if (item.branchId !== branchId) return false;
    if (item.status === "BRIDGE_ACCEPTED") return false;
    // Bypassed tickets were deliberately never printed; nothing to recover.
    if (item.status === "BYPASSED") return false;
    const order = item.orderId ? orders.get(item.orderId) : undefined;
    if (order && PAST_KITCHEN.has(order.status)) return false;
    if (order?.businessDate && context.today && order.businessDate < context.today) return false;
    return true;
  });
}
