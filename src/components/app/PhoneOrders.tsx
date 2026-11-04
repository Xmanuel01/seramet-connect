import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Panel, PanelHead, Status } from "@/components/app/ui";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionPeriodFilter, useTransactionPeriod } from "./TransactionPeriodFilter";
import { mergeDocuments, useDocumentList } from "@/lib/use-document-list";
export function PhoneOrders() {
  const { branchLabel, branchId, timeZone } = useAppContext();
  const { state, backendStatus } = useTransactionEngine();
  const period = useTransactionPeriod();
  const server = useDocumentList("orders", period.range.from, {
    to: period.range.to,
    basis: "calendar",
  });
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [search, setSearch] = useState("");
  const orders = mergeDocuments(server.rows, state.orders).filter(
    (order) =>
      order.branchId === branchId &&
      period.matches(order.createdAt, order.branchId) &&
      `${order.id} ${order.table ?? ""} ${order.status}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selected = orders.find((order) => order.id === selectedId);
  return (
    <AppShell title="Orders" subtitle={branchLabel}>
      <p className="mb-4 text-sm">
        Read-only account access. Sales and payments require an enrolled sales terminal.
      </p>
      <Panel>
        <PanelHead title="Branch orders" />
        <div className="grid gap-3 p-4">
          <TransactionPeriodFilter filter={period} />
          {server.error && (
            <p role="alert">
              {server.error} <button onClick={server.refresh}>Try again</button>
            </p>
          )}
          {server.hasMore && (
            <Btn disabled={server.loading} onClick={server.loadMore}>
              Load more history
            </Btn>
          )}
          <label className="grid gap-1 text-sm">
            Find order
            <input
              className="min-h-10 rounded border px-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {backendStatus !== "synced" && (
            <p role="status" className="text-sm">
              Connection: {backendStatus}
            </p>
          )}
          {orders.map((order) => (
            <div
              key={order.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 text-sm"
            >
              <div className="min-w-0 break-words">
                <strong>{order.id}</strong>
                <p>
                  {order.table ? `Table ${order.table}` : order.channel} ·{" "}
                  {new Intl.DateTimeFormat(undefined, {
                    timeZone,
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(order.createdAt))}
                </p>
              </div>
              <div className="flex gap-2">
                <Status>{order.status}</Status>
                <Btn onClick={() => setSelectedId(order.id)}>Open order</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Order {selected?.id}</DialogTitle>
            <DialogDescription>
              {selected?.status} · {selected?.channel}
            </DialogDescription>
          </DialogHeader>
          {selected?.lines.map((line) => (
            <div key={line.id} className="border-b pb-2 text-sm">
              <strong>
                {line.quantity} × {line.name}
              </strong>
              {line.itemNote && <p>{line.itemNote}</p>}
              {line.productionStatus && <Status>{line.productionStatus}</Status>}
            </div>
          ))}
          {selected?.kitchenNote && <p>{selected.kitchenNote}</p>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
