import type { TransactionOrder } from "@/lib/transaction-engine";
import type { OrderForPrint, ProductionStation } from "@/lib/seramet-print-service";

/**
 * The authoritative kitchen-print outbox is stored separately from browser
 * transaction snapshots. Its records are inserted in the same PostgreSQL
 * batch that commits a kitchen mutation.
 */
export const KITCHEN_OUTBOX_ENTITY = "print:kitchen-obligation";

export type KitchenObligationStatus =
  | "QUEUED"
  | "NEEDS_ROUTING"
  | "CLAIMED"
  | "DELIVERED"
  | "FAILED"
  | "UNCERTAIN";

export type KitchenPrintObligation = {
  id: string;
  tenantId: string;
  branchId: string;
  orderId: string;
  station: ProductionStation;
  amendmentType: "NEW" | "ADDITION";
  snapshot: OrderForPrint;
  status: KitchenObligationStatus;
  createdAt: string;
  updatedAt: string;
  claimToken?: string;
  claimedBy?: string;
  claimExpiresAt?: string;
  deliveredAt?: string;
  failureReason?: string;
  reviewCount: number;
  reviewReason?: string;
  reviewedBy?: string;
};

/** Pure diff: persist ONLY lines first sent in the accepted kitchen mutation. */
export function newlyDispatchedKitchenGroups(
  previous: TransactionOrder | undefined,
  current: TransactionOrder,
) {
  const previousSent = new Set(
    previous?.lines.filter((line) => line.sentAt).map((line) => line.id) ?? [],
  );
  const dispatched = current.lines.filter((line) => line.sentAt && !previousSent.has(line.id));
  const groups = new Map<ProductionStation, typeof dispatched>();
  for (const line of dispatched) {
    const station = line.productionStation ?? "NONE";
    const group = groups.get(station) ?? [];
    group.push(line);
    groups.set(station, group);
  }
  return {
    amendmentType: (previousSent.size ? "ADDITION" : "NEW") as "ADDITION" | "NEW",
    groups,
  };
}

export function obligationPrintSnapshot(
  order: TransactionOrder,
  lines: TransactionOrder["lines"],
  requestedBy: string,
  terminalId: string,
): OrderForPrint {
  return {
    orderId: order.id,
    branch: order.branch,
    terminalId,
    ...(order.table ? { table: order.table } : {}),
    orderType: order.channel,
    requestedBy,
    cashier: order.cashier,
    waiter: order.waiter ?? order.cashier,
    createdAt: order.createdAt,
    ...(order.customer ? { customer: order.customer } : {}),
    ...(order.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
    lines: lines.map((line) => ({
      id: line.id,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      productionStation: line.productionStation ?? "NONE",
      ...(line.itemNote ? { itemNote: line.itemNote } : {}),
      ...(line.modifiers?.length ? { modifiers: [...line.modifiers] } : {}),
    })),
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
  };
}

/** Stable identity independent of a repeated HTTP request's idempotency key. */
export async function kitchenObligationId(
  orderId: string,
  station: string,
  lineIds: readonly string[],
) {
  const serialized = JSON.stringify([orderId, station, [...lineIds].sort()]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `kot-${hex}`;
}

export function publicKitchenObligation(obligation: KitchenPrintObligation) {
  const { claimToken: _token, ...safe } = obligation;
  return safe;
}
