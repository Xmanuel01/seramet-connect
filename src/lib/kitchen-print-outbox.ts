import type { TransactionLine, TransactionOrder } from "@/lib/transaction-engine";

export type KitchenPrintStatus = "PENDING" | "CLAIMED" | "SPOOLED" | "DIGITAL_QUEUED" | "UNCERTAIN";

export type KitchenPrintObligation = {
  id: string;
  tenantId: string;
  branchId: string;
  branch: string;
  orderId: string;
  station: string;
  kind: "ORIGINAL" | "ADDITION" | "AUDITED_REPRINT";
  status: KitchenPrintStatus;
  lines: TransactionLine[];
  snapshot: {
    table?: string;
    channel: string;
    cashier: string;
    waiter?: string;
    customer: string;
    kitchenNote?: string;
    createdAt: string;
    subtotal: number;
    tax: number;
    total: number;
  };
  createdAt: string;
  updatedAt: string;
  claimId?: string;
  claimedBy?: string;
  claimedDeviceId?: string;
  claimedAt?: string;
  bridgeJobIds?: string[];
  failureReason?: string;
  reprintOf?: string;
  reviewedBy?: string;
  reviewReason?: string;
};

/**
 * These immutable line snapshots are part of the SAME transaction-state commit
 * as kitchen dispatch. They are not browser-generated print jobs.
 */
export function appendKitchenPrintObligations(
  existing: readonly KitchenPrintObligation[],
  order: TransactionOrder,
  newlySentLines: readonly TransactionLine[],
  kind: "ORIGINAL" | "ADDITION",
  stamp: string,
): KitchenPrintObligation[] {
  const groups = new Map<string, TransactionLine[]>();
  for (const line of newlySentLines) {
    const station = line.productionStation?.trim();
    if (!station || station === "NONE") continue;
    groups.set(station, [...(groups.get(station) ?? []), { ...line }]);
  }
  const tenantId = order.tenantId;
  const branchId = order.branchId;
  if (!tenantId || !branchId) {
    throw new Error("Kitchen print obligations require resolved tenant and branch identities");
  }
  const next = [...existing];
  for (const [station, lines] of groups) {
    next.unshift({
      id: `KPO-${crypto.randomUUID()}`,
      tenantId,
      branchId,
      branch: order.branch,
      orderId: order.id,
      station,
      kind,
      status: "PENDING",
      lines,
      snapshot: {
        ...(order.table ? { table: order.table } : {}),
        channel: order.channel,
        cashier: order.cashier,
        ...(order.waiter ? { waiter: order.waiter } : {}),
        customer: order.customer,
        ...(order.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
        createdAt: stamp,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
      },
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  return next;
}

export function claimKitchenPrintObligation(
  existing: readonly KitchenPrintObligation[],
  obligationId: string,
  claimId: string,
  actor: { id: string; deviceId?: string },
  stamp: string,
): KitchenPrintObligation[] {
  if (!claimId || claimId.length > 128) throw new Error("A stable claim identity is required");
  const target = existing.find((obligation) => obligation.id === obligationId);
  if (!target) throw new Error("Kitchen print obligation not found");
  if (target.status === "CLAIMED" && target.claimId === claimId && target.claimedBy === actor.id) {
    return [...existing];
  }
  if (target.status !== "PENDING") {
    throw new Error("Ticket is already claimed or was attempted. Review before another print.");
  }
  return existing.map((obligation) =>
    obligation.id === obligationId
      ? {
          ...obligation,
          status: "CLAIMED" as const,
          claimId,
          claimedBy: actor.id,
          ...(actor.deviceId ? { claimedDeviceId: actor.deviceId } : {}),
          claimedAt: stamp,
          updatedAt: stamp,
        }
      : obligation,
  );
}

export function finishKitchenPrintObligation(
  existing: readonly KitchenPrintObligation[],
  obligationId: string,
  claimId: string,
  actorId: string,
  status: "SPOOLED" | "DIGITAL_QUEUED" | "UNCERTAIN",
  bridgeJobIds: readonly string[],
  stamp: string,
  reason?: string,
): KitchenPrintObligation[] {
  const target = existing.find((obligation) => obligation.id === obligationId);
  if (!target) throw new Error("Kitchen print obligation not found");
  if (!["SPOOLED", "DIGITAL_QUEUED", "UNCERTAIN"].includes(status)) {
    throw new Error("Invalid ticket delivery acknowledgement");
  }
  if (
    bridgeJobIds.length > 16 ||
    bridgeJobIds.some((id) => typeof id !== "string" || id.length > 150)
  ) {
    throw new Error("Invalid printer bridge job evidence");
  }
  if (target.claimId !== claimId || target.claimedBy !== actorId) {
    throw new Error("Only the operator who claimed this ticket can report its outcome");
  }
  if (target.status === status && target.bridgeJobIds?.join("|") === bridgeJobIds.join("|")) {
    return [...existing];
  }
  if (target.status !== "CLAIMED") {
    throw new Error("Ticket cannot be finished twice or automatically retried");
  }
  if (status === "UNCERTAIN" && (!reason?.trim() || reason.length > 600)) {
    throw new Error("An uncertain delivery needs a concise reason");
  }
  return existing.map((obligation) =>
    obligation.id === obligationId
      ? {
          ...obligation,
          status,
          bridgeJobIds: [...bridgeJobIds],
          ...(reason ? { failureReason: reason.trim() } : {}),
          updatedAt: stamp,
        }
      : obligation,
  );
}

/**
 * A human-authorized reprint gets a NEW immutable obligation and an audit link.
 * The original remains intact, even when the bridge may already have printed it.
 */
export function authorizeKitchenReprint(
  existing: readonly KitchenPrintObligation[],
  obligationId: string,
  actorId: string,
  reason: string,
  stamp: string,
): KitchenPrintObligation[] {
  const previous = existing.find((obligation) => obligation.id === obligationId);
  if (!previous) throw new Error("Original kitchen ticket not found");
  if (!["CLAIMED", "UNCERTAIN", "SPOOLED", "DIGITAL_QUEUED"].includes(previous.status)) {
    throw new Error("An unattempted ticket cannot be reprinted");
  }
  if (reason.trim().length < 12 || reason.length > 500) {
    throw new Error("Reprint requires a specific review reason (12–500 characters)");
  }
  return [
    {
      ...previous,
      id: `KPO-${crypto.randomUUID()}`,
      kind: "AUDITED_REPRINT",
      status: "PENDING",
      createdAt: stamp,
      updatedAt: stamp,
      reprintOf: previous.id,
      reviewedBy: actorId,
      reviewReason: reason.trim(),
      claimId: undefined,
      claimedBy: undefined,
      claimedDeviceId: undefined,
      claimedAt: undefined,
      bridgeJobIds: undefined,
      failureReason: undefined,
    },
    ...existing,
  ];
}

/** Never auto retry a claimed or uncertain physical ticket after a crash. */
export function pendingUnclaimedKitchenTickets(
  obligations: readonly KitchenPrintObligation[],
  branchId: string,
) {
  return obligations.filter(
    (obligation) => obligation.branchId === branchId && obligation.status === "PENDING",
  );
}
