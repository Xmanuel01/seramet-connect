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
import { currentDateKey, formatTime, ksh } from "@/lib/currency";
import { ordersDashboardFinancials } from "@/lib/orders-dashboard-financials";
import { invoiceCandidatesForOrder, orderBusinessDate } from "@/lib/orders-interface";
import { billingRecordToPrintOrder } from "@/lib/print-order-adapter";
import { useSerametPrintQueue } from "@/hooks/use-seramet-print-queue";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatFilterDate } from "@/lib/date-filters";

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
  const { branchId, branchLabel, matchesBranch, currentUser, timeZone, currency } = useAppContext();
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [periodDate, setPeriodDate] = useState(() => currentDateKey(new Date(), timeZone));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);
  const { state, mutate } = useTransactionEngine();
  const { printCustomerDocument } = useSerametPrintQueue(branchId);
  const rows = state.orders
    .filter((order) => matchesBranch(order.branchId ?? order.branch))
    .filter(
      (order) =>
        !periodDate ||
        orderBusinessDate(order, timeZone) === periodDate,
    );
  const financials = ordersDashboardFinancials(
    state,
    matchesBranch,
    periodDate,
    timeZone,
    currency,
  );
  const cancelled = rows.filter((order) => order.status === "CANCELLED").length;
  const selectedOrder =
    selectedOrders.length === 1 ? rows.find((order) => order.id === selectedOrders[0]) : undefined;
  const detailsOrder = rows.find((order) => order.id === detailsOrderId);

  // Read-only print: never create an invoice implicitly just to make a button work.
  const printSelectedBill = () => {
    if (!selectedOrder) {
      setOperationNotice("Select exactly one invoiced order to print.");
      return;
    }
    const bills = invoiceCandidatesForOrder(state.bills, selectedOrder, matchesBranch);
    if (bills.length !== 1) {
      setOperationNotice(
        bills.length > 1
          ? "This order has multiple active invoices. Open Invoices to select the exact bill."
          : "This order has no active invoice. Create an invoice before printing its bill.",
      );
      return;
    }
    try {
      const result = printCustomerDocument(
        billingRecordToPrintOrder(bills[0]!, state.payments, state.orders),
        "BILL",
      );
      setOperationNotice(
        result.jobs.length
          ? `Bill ${bills[0]!.id} queued. Physical delivery is not yet confirmed; check Printers.`
          : `Bill not queued: ${result.skipped[0] ?? "Configure your branch printer."}`,
      );
    } catch (error) {
      setOperationNotice(error instanceof Error ? error.message : "Bill printing failed.");
    }
  };

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
      subtitle={`${rows.length} orders in selected period - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={printSelectedBill} disabled={operationBusy || !selectedOrder}>
            Print selected bill
          </Btn>
          <Btn onClick={openCancellation} disabled={operationBusy}>
            Cancel with reason
          </Btn>
          <Btn variant="primary" onClick={() => void resumeHeld()} disabled={operationBusy}>
            Resume held
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Metric label="Orders created" value={rows.length} />
        <Metric label="Open order value" value={financials.activeOrderValue} money />
        <Metric label="Invoiced outstanding" value={financials.invoiceOutstanding} money />
        <Metric label="Paid invoice sales" value={financials.paidInvoiceSales} money />
        <Metric label="Provider receivables" value={financials.providerReceivables} money />
        <Metric label="Completed refunds" value={financials.completedRefunds} money invert />
        <Metric label="Cancelled orders" value={cancelled} invert />
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Open order value includes held and kitchen orders, not revenue. Outstanding balances,
        provider receivables and paid sales use issued invoices, with void and replaced invoices
        excluded. Paid sales are gross paid invoices issued in the selected period, before
        separately displayed refunds; this is not payment-date cash flow or accounting revenue.
        Refunds use their completion date. See Finance for recognized revenue.
      </p>
      {operationNotice && (
        <div className="mt-3 rounded-md border border-border bg-card px-3 py-2 text-[13px]">
          {operationNotice}
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="All orders"
          sub="Permanent order history - no hard deletion"

        />
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              {
                label: "Period",
                value: formatFilterDate(periodDate, currentDateKey(new Date(), timeZone)),
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
                  <span className="num font-semibold">
                    {formatTime(order.createdAt, { hour: "2-digit", minute: "2-digit" }, undefined, timeZone)}
                  </span>
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
                <Btn onClick={() => setDetailsOrderId(order.id)}>Open</Btn>
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
                  <TD className="num font-semibold">
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline focus-visible:underline"
                      onClick={() => setDetailsOrderId(order.id)}
                    >
                      {order.id}
                    </button>
                  </TD>
                  <TD className="num text-muted-foreground">
                    {formatTime(order.createdAt, { hour: "2-digit", minute: "2-digit" }, undefined, timeZone)}
                  </TD>
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
      <Dialog
        open={Boolean(detailsOrder)}
        onOpenChange={(open) => {
          if (!open) setDetailsOrderId(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailsOrder?.id ?? "Order details"}</DialogTitle>
            <DialogDescription>
              Read-only order details. Use the existing authorized actions for changes.
            </DialogDescription>
          </DialogHeader>
          {detailsOrder && (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto text-[13px]">
              <div className="flex flex-wrap gap-2">
                <Status>{detailsOrder.status}</Status>
                <Status>{detailsOrder.paymentStatus}</Status>
              </div>
              <dl className="grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{detailsOrder.customer}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Channel</dt>
                  <dd>{detailsOrder.channel}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd>{orderBusinessDate(detailsOrder, timeZone)} · {formatTime(detailsOrder.createdAt, { hour: "2-digit", minute: "2-digit" }, undefined, timeZone)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cashier</dt>
                  <dd>{detailsOrder.cashier}</dd>
                </div>
                {detailsOrder.table && (
                  <div>
                    <dt className="text-muted-foreground">Table</dt>
                    <dd>{detailsOrder.table}</dd>
                  </div>
                )}
              </dl>
              <div className="border-t border-border pt-2">
                <div className="mb-2 font-semibold">Order items</div>
                {detailsOrder.lines.map((line) => (
                  <div key={line.id} className="flex justify-between gap-3 py-1">
                    <span>{line.quantity} × {line.name}</span>
                    <span className="num">{ksh(line.quantity * line.unitPrice)}</span>
                  </div>
                ))}
                {detailsOrder.lines.length === 0 && <p>No line items recorded.</p>}
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <span>Order total (not necessarily received)</span>
                <span className="num">{ksh(detailsOrder.total)}</span>
              </div>
              {detailsOrder.cancellation && (
                <p>Cancellation reason: {detailsOrder.cancellation.reason}</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Btn onClick={() => setDetailsOrderId(null)}>Close</Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
