import { useEffect, useRef } from "react";
import type { TransactionOrder } from "@/lib/transaction-engine";
import type { PrintJob } from "@/lib/seramet-print-service";
import type { useTransactionEngine } from "@/hooks/use-transaction-engine";

type Mutate = ReturnType<typeof useTransactionEngine>["mutate"];

/**
 * A trusted local bridge's returned status is an acknowledgement, NOT
 * independent proof that paper physically emerged from the printer.
 * Suppress automatic retries of any uncertain acknowledgement.
 */
export function useKotDeliveryAcknowledgement(
  branchId: string,
  orders: readonly TransactionOrder[],
  jobs: readonly PrintJob[],
  mutate: Mutate,
) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const ready = orders.flatMap((order) =>
      order.branchId === branchId
        ? (order.kotObligations ?? [])
            .filter((item) => item.status === "QUEUED")
            .map((item) => ({ orderId: order.id, obligationId: item.id }))
        : [],
    );
    for (const item of ready) {
      if (attempted.current.has(item.obligationId)) continue;
      const deliveries = jobs.filter((job) => job.kotObligationId === item.obligationId);
      if (
        deliveries.length === 0 ||
        deliveries.some((job) => !["Printed", "Fallback Printed", "Displayed"].includes(job.status))
      ) {
        continue;
      }
      attempted.current.add(item.obligationId);
      void mutate("markKotObligations", {
        orderId: item.orderId,
        obligationIds: [item.obligationId],
        status: "BRIDGE_ACKNOWLEDGED",
      }).catch(() => {
        // If this acknowledgement is lost, server retains QUEUED for
        // manual review; never transmit a second physical ticket automatically.
      });
    }
  }, [branchId, jobs, mutate, orders]);
}
