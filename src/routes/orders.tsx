import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate, todayInputValue } from "@/lib/date-filters";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [
      { title: "Orders - Seramet" },
      {
        name: "description",
        content: "Every dine-in, take away, delivery and online order with payment and status.",
      },
      { property: "og:title", content: "Orders - Seramet" },
      {
        property: "og:description",
        content: "All channels, payments and order statuses in one table.",
      },
    ],
  }),
  component: Orders,
});

function Orders() {
  const { branchLabel, matchesBranch, currentUser } = useAppContext();
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [periodDate, setPeriodDate] = useState(() => todayInputValue());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const { state, mutate } = useTransactionEngine();
  const rows = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .filter((order) => !periodDate || order.createdAt.slice(0, 10) === periodDate);
  const netSales = rows.reduce((sum, order) => sum + order.total, 0);
  const unpaid = rows
    .filter((order) => order.paymentStatus !== "PAID")
    .reduce((sum, order) => sum + order.total, 0);
  const cancelled = rows.filter((order) => order.status === "CANCELLED").length;
  const selectedOrder =
    selectedOrders.length === 1 ? rows.find((order) => order.id === selectedOrders[0]) : undefined;

  const resumeHeld = async () => {
    if (!selectedOrder || selectedOrder.status !== "HELD") {
      setOperationNotice("Select exactly one held order to resume.");
      return;
    }
    setOperationBusy(true);
    try {
      await mutate("releaseHeldOrder", { orderId: selectedOrder.id });
      setSelectedOrders([]);
      setOperationNotice(`${selectedOrder.id} resumed by ${currentUser.name}.`);
    } catch (error) {
      setOperationNotice(
        error instanceof Error ? error.message : "The order could not be resumed.",
      );
    } finally {
      setOperationBusy(false);
    }
  };

  const openCancellation = () => {
    if (!selectedOrder || ["PAID", "REFUNDED", "CANCELLED"].includes(selectedOrder.status)) {
      setOperationNotice("Select exactly one cancellable order.");
      return;
    }
    setCancelReason("");
    setCancelOpen(true);
  };

  const confirmCancellation = async () => {
    if (!selectedOrder || !cancelReason.trim()) return;
    setOperationBusy(true);
    try {
      await mutate("cancelOrder", {
        orderId: selectedOrder.id,
        input: { reason: cancelReason.trim() },
      });
      setCancelOpen(false);
      setSelectedOrders([]);
      setOperationNotice(`${selectedOrder.id} cancelled. The reason and actor were audited.`);
    } catch (error) {
      setOperationNotice(
        error instanceof Error ? error.message : "The order could not be cancelled.",
      );
    } finally {
      setOperationBusy(false);
    }
  };

  const toggleOrder = (orderId: string) => {
    setSelectedOrders((current) =>
      current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId],
    );
  };

  return (
    <AppShell
      title="Orders"
      subtitle={`${rows.length} visible orders today - ${branchLabel}`}
      actions={
        <>
          <Btn>Saved views</Btn>
          <Btn>Print selected bill</Btn>
          <Btn onClick={openCancellation} disabled={operationBusy}>
            Cancel with reason
          </Btn>
          <Btn variant="primary" onClick={() => void resumeHeld()} disabled={operationBusy}>
            Resume held
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Orders" value={rows.length} />
        <Metric label="Net sales" value={netSales} money />
        <Metric label="Unpaid bills" value={unpaid} money />
        <Metric label="Cancelled" value={cancelled} invert />
      </div>
      {operationNotice && (
        <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
          {operationNotice}
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="All orders"
          sub="Permanent order history - no hard deletion"
          right={<Btn>Columns</Btn>}
        />
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              {
                label: "Period",
                value: formatFilterDate(periodDate),
                dateValue: periodDate,
                onDateChange: setPeriodDate,
                onClear: () => setPeriodDate(""),
              },
              { label: "Scope", value: branchLabel },
              { label: "Channel", value: "All" },
              { label: "Status", value: "Any" },
              { label: "Retention", value: "Permanent" },
            ]}
            onClear={() => setPeriodDate("")}
          />
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((order) => (
            <article
              key={order.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="num text-[13px] font-bold">{order.id}</div>
                  <div className="truncate text-[12px] text-muted-foreground">
                    {order.customer} - {order.channel}
                  </div>
                </div>
                <div className="num shrink-0 text-[14px] font-bold">{ksh(order.total)}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Created </span>
                  <span className="num font-semibold">{order.createdAt.slice(11, 16)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Source </span>
                  <span className="font-semibold">{order.channel}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Owner </span>
                  <span className="font-semibold">{order.cashier}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <Status>{order.paymentStatus}</Status>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Status>{order.status}</Status>
                <Btn>Open</Btn>
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px]">
            <thead>
              <tr>
                <TH>
                  <span className="sr-only">Select</span>
                </TH>
                <TH>Order</TH>
                <TH>Time</TH>
                <TH>Customer / table</TH>
                <TH>Channel</TH>
                <TH>Employee</TH>
                <TH className="text-right">Amount</TH>
                <TH>Payment</TH>
                <TH>Status</TH>
                <TH>Audit</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.id} className="hover:bg-secondary/50">
                  <TD>
                    <input
                      type="checkbox"
                      checked={selectedOrders.includes(order.id)}
                      onChange={() => toggleOrder(order.id)}
                      className="h-4 w-4 accent-primary"
                    />
                  </TD>
                  <TD className="num font-semibold">{order.id}</TD>
                  <TD className="num text-muted-foreground">{order.createdAt.slice(11, 16)}</TD>
                  <TD className="font-medium">{order.customer}</TD>
                  <TD className="text-muted-foreground">{order.channel}</TD>
                  <TD className="text-muted-foreground">{order.cashier}</TD>
                  <TD className="num text-right font-semibold">{ksh(order.total)}</TD>
                  <TD>
                    <Status>{order.paymentStatus}</Status>
                  </TD>
                  <TD>
                    <Status>{order.status}</Status>
                  </TD>
                  <TD className="text-right text-muted-foreground">
                    {order.cancellation ? "reason captured" : "immutable"}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {selectedOrder?.id ?? "order"}</DialogTitle>
            <DialogDescription>
              Sent production lines are retained and receive a cancellation amendment.
            </DialogDescription>
          </DialogHeader>
          <label className="text-[13px] font-semibold" htmlFor="order-cancel-reason">
            Reason
          </label>
          <textarea
            id="order-cancel-reason"
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            maxLength={300}
            rows={4}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
          <DialogFooter>
            <Btn onClick={() => setCancelOpen(false)} disabled={operationBusy}>
              Keep order
            </Btn>
            <Btn
              variant="primary"
              onClick={() => void confirmCancellation()}
              disabled={operationBusy || !cancelReason.trim()}
            >
              {operationBusy ? "Cancelling..." : "Confirm cancellation"}
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
