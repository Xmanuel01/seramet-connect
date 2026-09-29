import type { TransactionLine, TransactionOrder } from "@/lib/transaction-engine";

/**
 * Persisted in the authoritative order payload in the SAME database commit as
 * the kitchen transition. This is an obligation to route a KOT, not evidence
 * that a physical printer has accepted or produced one.
 */
export type KotObligation = {
  id: string;
  orderId: string;
  tenantId: string;
  branchId: string;
  station: string;
  kind: "NEW" | "ADDITION" | "VOID";
  lines: TransactionLine[];
  status:
    | "PENDING"
    | "CLAIMED"
    | "QUEUED"
    | "DIGITAL_DISPLAYED"
    | "UNCERTAIN"
    | "BRIDGE_ACKNOWLEDGED"
    | "SUPERSEDED";
  createdAt: string;
  claimedBy?: string;
  claimedAt?: string;
  queuedAt?: string;
  acknowledgedAt?: string;
  reviewedBy?: string;
  reviewReason?: string;
};

export function createKotObligations(
  order: TransactionOrder,
  newlySentLines: readonly TransactionLine[],
  kind: KotObligation["kind"],
  timestamp: string,
): KotObligation[] {
  const stations = new Map<string, TransactionLine[]>();
  for (const line of newlySentLines) {
    const station = line.productionStation?.trim();
    if (!station || station === "NONE") continue;
    const lines = stations.get(station) ?? [];
    lines.push({ ...line });
    stations.set(station, lines);
  }
  const previous = order.kotObligations ?? [];
  const tenantId = order.tenantId;
  const branchId = order.branchId;
  if (!tenantId || !branchId) throw new Error("A KOT needs authoritative tenant and branch scope");
  return [...stations].map(([station, lines], index) => ({
    id: `KOT-${order.id}-${previous.length + index + 1}`,
    orderId: order.id,
    tenantId,
    branchId,
    station,
    kind,
    lines,
    status: "PENDING" as const,
    createdAt: timestamp,
  }));
}

export function pendingKotObligations(
  orders: readonly TransactionOrder[],
  branchId: string,
): { order: TransactionOrder; obligation: KotObligation }[] {
  return orders.flatMap((order) =>
    order.branchId === branchId
      ? (order.kotObligations ?? [])
          .filter(
            (obligation) =>
              obligation.status !== "DIGITAL_DISPLAYED" &&
              obligation.status !== "BRIDGE_ACKNOWLEDGED" &&
              obligation.status !== "SUPERSEDED",
          )
          .map((obligation) => ({ order, obligation }))
      : [],
  );
}
