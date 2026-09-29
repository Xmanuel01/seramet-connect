import { useMemo, useState } from "react";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useKotDeliveryAcknowledgement } from "@/hooks/use-kot-delivery-ack";
import { useAppContext } from "@/lib/app-context";
import { pendingKotObligations } from "@/lib/kot-obligations";
import type { OrderForPrint, PrintJob, PrintPlanResult } from "@/lib/seramet-print-service";
import { permissions as permissionCodes } from "@/platform/permissions";

type QueueResult = PrintPlanResult & { queue: PrintJob[] };

export function KotOutboxRecovery({
  branchId,
  branchName,
  jobs,
  canRoute,
  sendKitchenTickets,
}: {
  branchId: string;
  branchName: string;
  jobs: PrintJob[];
  canRoute: boolean;
  sendKitchenTickets: (
    order: OrderForPrint,
    kind?: "NEW" | "ADDITION" | "VOID" | "REPRINT",
  ) => QueueResult;
}) {
  const { branchId: activeBranchId, currentUser, permissions } = useAppContext();
  const { state, mutate } = useTransactionEngine();
  useKotDeliveryAcknowledgement(branchId, state.orders, jobs, mutate);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const active = branchId === activeBranchId;
  const canReview = permissions.includes(permissionCodes.productionAdjust);
  const obligations = useMemo(
    () => pendingKotObligations(state.orders, branchId),
    [branchId, state.orders],
  );
  const legacy = state.orders.filter(
    (order) =>
      order.branchId === branchId &&
      order.lines.some((line) => line.sentAt && line.productionStation !== "NONE") &&
      !order.kotObligations?.length,
  );

  const recover = async (orderId: string, obligationId: string) => {
    if (!active || !canRoute || busyId) return;
    const entry = obligations.find(
      ({ obligation }) => obligation.id === obligationId && obligation.orderId === orderId,
    );
    if (!entry || entry.obligation.status !== "PENDING") return;
    if (jobs.some((job) => job.kotObligationId === obligationId)) {
      setNotice("This device already has this KOT: inspect its existing print job first.");
      return;
    }
    if (
      !window.confirm(
        "Check kitchen paper and KDS/other-terminal logs first. " +
          "Another terminal may already have produced this KOT. " +
          "Queue this server-pending ticket only after verifying it is missing?",
      )
    ) {
      return;
    }
    setBusyId(obligationId);
    let claimed = false;
    try {
      const ticket = entry.obligation;
      const claim = await mutate("claimKotObligations", {
        orderId,
        obligationIds: [obligationId],
      });
      if (!claim || ("offline" in claim && claim.offline)) {
        throw new Error("Server KOT claim was not confirmed. Do not print.");
      }
      claimed = true;
      const { order } = entry;
      const result = sendKitchenTickets(
        {
          orderId,
          kotObligationId: obligationId,
          branch: branchName,
          terminalId: "KOT-RECOVERY",
          ...(order.table ? { table: order.table } : {}),
          orderType: order.channel,
          requestedBy: currentUser.name,
          cashier: order.cashier,
          waiter: order.waiter ?? currentUser.name,
          createdAt: order.createdAt,
          customer: order.customer,
          ...(order.kitchenNote ? { kitchenNote: order.kitchenNote } : {}),
          lines: ticket.lines.map((line) => ({
            id: line.id,
            name: line.name,
            category: line.category,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            productionStation: line.productionStation ?? "NONE",
            ...(line.itemNote ? { itemNote: line.itemNote } : {}),
          })),
          subtotal: order.subtotal,
          tax: order.tax,
          total: order.total,
        },
        ticket.kind,
      );
      const persisted =
        result.jobs.length > 0 &&
        result.jobs.every((job) => {
          const local = result.queue.find((item) => item.id === job.id);
          return (
            local &&
            !local.failureReason &&
            local.printerId !== "UNASSIGNED" &&
            ["Queued", "Sending", "Retrying", "Displayed"].includes(local.status)
          );
        });
      const marked = await mutate("markKotObligations", {
        orderId,
        obligationIds: [obligationId],
        status: persisted ? "QUEUED" : "UNCERTAIN",
      });
      if (!marked || !persisted) {
        throw new Error("Ticket output is uncertain. Review physical paper before further action.");
      }
      setNotice(`${obligationId} queued on this device. Physical printing is not confirmed.`);
    } catch (error) {
      if (claimed) {
        try {
          await mutate("markKotObligations", {
            orderId,
            obligationIds: [obligationId],
            status: "UNCERTAIN",
          });
        } catch {
          // The claim remains server-visible for manager review.
        }
      }
      setNotice(
        error instanceof Error ? error.message : "Recovery failed; review server KOT claim.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const managerReset = async (orderId: string, obligationId: string) => {
    if (!active || !canReview || busyId) return;
    const reason = window.prompt(
      "Confirm you checked physical paper, KDS and other-terminal logs. " +
        "Explain why this specific KOT needs a new dispatch attempt:",
    );
    if (!reason) return;
    setBusyId(obligationId);
    try {
      await mutate("resetKotObligationAfterReview", { orderId, obligationId, reason });
      setNotice(`${obligationId} released for a reviewed retry. Existing paper is not voided.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Manager KOT review was not recorded.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel className="mt-4">
      <PanelHead
        title="Durable kitchen print outbox"
        sub="Persisted with the kitchen order. Queued never means physically printed."
      />
      <div className="space-y-3 p-4">
        {!active && (
          <p className="text-[12px] text-amber-700">
            Switch the application to {branchName} before claiming its KOTs.
          </p>
        )}
        {legacy.length > 0 && (
          <p className="text-[12px] text-amber-700">
            {legacy.length} historical orders predate durable KOT tracking. Check them manually: no
            automatic reprinting is permitted.
          </p>
        )}
        {obligations.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            No unresolved server-side KOT obligations for this branch.
          </p>
        )}
        {obligations.map(({ order, obligation }) => {
          const local = jobs.filter((job) => job.kotObligationId === obligation.id);
          return (
            <div
              key={obligation.id}
              className="rounded-lg border border-border bg-secondary/30 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                <div className="font-bold">
                  {order.id} · {obligation.station} · {obligation.kind}
                </div>
                <Status>{obligation.status.replaceAll("_", " ")}</Status>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {obligation.lines.map((line) => `${line.quantity} × ${line.name}`).join(", ")}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {local.length
                  ? `This device: ${local.map((job) => job.status).join(", ")}. Check other terminals too.`
                  : "No ticket is recorded on this device. Other terminals may have printed it."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {obligation.status === "PENDING" && local.length === 0 && (
                  <Btn
                    disabled={!active || !canRoute || busyId !== null}
                    onClick={() => void recover(order.id, obligation.id)}
                  >
                    Review and queue missing KOT
                  </Btn>
                )}
                {obligation.status !== "PENDING" && canReview && (
                  <Btn
                    disabled={!active || busyId !== null}
                    onClick={() => void managerReset(order.id, obligation.id)}
                  >
                    Manager-reviewed retry
                  </Btn>
                )}
              </div>
            </div>
          );
        })}
        {notice && (
          <p role="status" className="text-[12px] text-amber-700">
            {notice}
          </p>
        )}
      </div>
    </Panel>
  );
}
