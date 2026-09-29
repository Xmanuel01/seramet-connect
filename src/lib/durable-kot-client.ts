import type { KitchenPrintObligation } from "@/lib/kitchen-print-outbox";
import type { TransactionState } from "@/lib/transaction-engine";
import type { OrderForPrint, PrintJob } from "@/lib/seramet-print-service";

export type KitchenObligationMutation = (
  action: string,
  payload: unknown,
) => Promise<{ state: TransactionState; revision?: number } | undefined>;

export type KotDeliveryOutcome = {
  jobs: PrintJob[];
  outcomes: Array<"SPOOLED" | "DIGITAL_QUEUED" | "UNCERTAIN">;
  skipped: string[];
};

export function obligationToPrintOrder(
  obligation: KitchenPrintObligation,
  terminalId: string,
): OrderForPrint {
  return {
    orderId: obligation.orderId,
    branch: obligation.branch,
    terminalId,
    ...(obligation.snapshot.table ? { table: obligation.snapshot.table } : {}),
    orderType: obligation.snapshot.channel,
    requestedBy: obligation.snapshot.cashier,
    cashier: obligation.snapshot.cashier,
    waiter: obligation.snapshot.waiter ?? obligation.snapshot.cashier,
    createdAt: obligation.snapshot.createdAt,
    customer: obligation.snapshot.customer,
    ...(obligation.snapshot.kitchenNote ? { kitchenNote: obligation.snapshot.kitchenNote } : {}),
    lines: obligation.lines.map((line) => ({
      id: line.id,
      name: line.name,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      productionStation: (line.productionStation ??
        "NONE") as OrderForPrint["lines"][number]["productionStation"],
      ...(line.itemNote ? { itemNote: line.itemNote } : {}),
    })),
    subtotal: obligation.snapshot.subtotal,
    tax: obligation.snapshot.tax,
    total: obligation.snapshot.total,
  };
}

/**
 * Never submit to a printer until an authoritative claim has succeeded.
 * Any lost acknowledgement leaves the claimed obligation visible for explicit
 * investigation, rather than silently replaying a potentially printed KOT.
 */
export async function dispatchDurableKitchenObligation(input: {
  obligation: KitchenPrintObligation;
  terminalId: string;
  mutate: KitchenObligationMutation;
  preflight?: (
    order: OrderForPrint,
    kind: KitchenPrintObligation["kind"],
    obligationId: string,
  ) => Promise<void>;
  deliver: (
    order: OrderForPrint,
    kind: KitchenPrintObligation["kind"],
    obligationId: string,
  ) => Promise<KotDeliveryOutcome>;
}): Promise<KotDeliveryOutcome> {
  const { obligation, terminalId, mutate, preflight, deliver } = input;
  const printable = obligationToPrintOrder(obligation, terminalId);
  // Known configuration/offline failures are checked BEFORE the authoritative
  // claim. If no printer attempt can occur, the obligation stays PENDING and
  // is safe to recover automatically later.
  if (preflight) await preflight(printable, obligation.kind, obligation.id);
  const claimId = crypto.randomUUID();
  const claimed = await mutate("claimKitchenPrintObligation", {
    obligationId: obligation.id,
    claimId,
  });
  const confirmedClaim = claimed?.state.kitchenPrintObligations?.find(
    (candidate) => candidate.id === obligation.id,
  );
  if (confirmedClaim?.status !== "CLAIMED" || confirmedClaim.claimId !== claimId) {
    throw new Error("Kitchen print claim was not confirmed; no printing was attempted.");
  }

  let delivered: KotDeliveryOutcome;
  try {
    delivered = await deliver(printable, obligation.kind, obligation.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Print delivery outcome is unknown";
    // We deliberately do not retry a timeout: the bridge may already have
    // accepted the ticket before its response was lost.
    try {
      await mutate("finishKitchenPrintObligation", {
        obligationId: obligation.id,
        claimId,
        status: "UNCERTAIN",
        bridgeJobIds: [],
        reason: message,
      });
    } catch {
      // The CLAIMED record survives; its original claim cannot auto-reprint.
    }
    throw new Error(
      `Kitchen order remains saved, but KOT delivery is uncertain: ${message}. Review Printers.`,
    );
  }

  const allSpool =
    delivered.outcomes.length > 0 && delivered.outcomes.every((status) => status === "SPOOLED");
  const allDigital =
    delivered.outcomes.length > 0 &&
    delivered.outcomes.every((status) => status === "DIGITAL_QUEUED");
  const status = allSpool ? "SPOOLED" : allDigital ? "DIGITAL_QUEUED" : "UNCERTAIN";
  const reason =
    status === "UNCERTAIN"
      ? delivered.skipped.join("; ") || "One or more delivery routes could not be verified"
      : undefined;
  await mutate("finishKitchenPrintObligation", {
    obligationId: obligation.id,
    claimId,
    status,
    bridgeJobIds: delivered.jobs.map((job) => job.id),
    ...(reason ? { reason } : {}),
  });
  if (status === "UNCERTAIN") {
    throw new Error("Kitchen order saved, but a ticket delivery is uncertain. Review Printers.");
  }
  return delivered;
}
