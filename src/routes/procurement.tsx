import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, PackageCheck, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatNumber, ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  type ProcurementOrderRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement - Seramet" },
      {
        name: "description",
        content: "Purchase requisitions, orders, receiving and supplier performance.",
      },
    ],
  }),
  component: Procurement,
});

type DisplayOrder = {
  id: string;
  number: string;
  supplier: string;
  supplierId: string;
  warehouseId: string;
  status: string;
  currency: string;
  totalMinor: number;
  expectedAt?: string;
  lines: Array<{
    id: string;
    itemId: string;
    item: string;
    unit: string;
    orderedMicro: number;
    receivedMicro: number;
    unitPriceMinor: number;
    totalMinor: number;
  }>;
};

function Procurement() {
  const { branchId, branchLabel, currency } = useAppContext();
  const { state, mutate, persistenceMode, backendStatus } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [orderAction, setOrderAction] = useState<"approve" | "cancel" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const serverData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];

  const orders = useMemo<DisplayOrder[]>(() => {
    if (authoritative) return (serverData?.procurement.purchaseOrders ?? []).map(serverOrder);
    return state.purchaseOrders
      .filter(
        (order) =>
          (order.branchId ?? order.branch) === branchId ||
          order.branch === branchLabel.replace(" Branch", ""),
      )
      .map((order) => ({
        id: order.id,
        number: order.id,
        supplier: order.supplier,
        supplierId: order.supplier,
        warehouseId: "",
        status: order.status,
        currency,
        totalMinor: Math.round(order.total * 100),
        expectedAt: order.expectedAt,
        lines: order.lines.map((line, index) => ({
          id: `${order.id}:${index}`,
          itemId: line.sku,
          item: line.name,
          unit: line.unit,
          orderedMicro: Math.round(line.quantity * 1_000_000),
          receivedMicro: Math.round(line.receivedQuantity * 1_000_000),
          unitPriceMinor: Math.round(line.unitCost * 100),
          totalMinor: Math.round(line.quantity * line.unitCost * 100),
        })),
      }));
  }, [
    authoritative,
    branchId,
    branchLabel,
    serverData?.procurement.purchaseOrders,
    state.purchaseOrders,
    currency,
  ]);
  const selected = orders.find((order) => order.id === selectedId) ?? orders[0];
  const suppliers = authoritative
    ? (serverData?.procurement.suppliers ?? [])
    : Array.from(new Set(orders.map((order) => order.supplier))).map((name) => ({
        id: name,
        code: name,
        name,
        lead_time_days: 0,
        payment_terms_days: 0,
        currency,
        order_count: orders.filter((order) => order.supplier === name).length,
        ordered_minor: orders
          .filter((order) => order.supplier === name)
          .reduce((sum, order) => sum + order.totalMinor, 0),
        outstanding_minor: orders
          .filter(
            (order) => order.supplier === name && !["RECEIVED", "CANCELLED"].includes(order.status),
          )
          .reduce((sum, order) => sum + order.totalMinor, 0),
        on_time_count: 0,
        received_count: 0,
      }));
  const openOrders = orders.filter((order) => !["RECEIVED", "CANCELLED"].includes(order.status));
  const approvalCount = orders.filter((order) =>
    ["DRAFT", "SUBMITTED", "PENDING_APPROVAL"].includes(order.status),
  ).length;
  const outstandingMinor = suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.outstanding_minor),
    0,
  );

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Procurement operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Procurement"
      subtitle={`${branchLabel} purchase-to-pay control  -  ${openOrders.length} open purchase orders`}
      actions={
        <>
          <Btn disabled={!selected || busy} onClick={() => setReceiveOpen(true)}>
            <PackageCheck className="h-4 w-4" /> Receiving
          </Btn>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={() => {
              if (authoritative) setCreateOpen(true);
              else
                void run(
                  async () =>
                    mutate("generatePurchaseOrders", {
                      branch: branchLabel.replace(" Branch", ""),
                    }),
                  "Purchase recommendations converted to draft orders.",
                );
            }}
          >
            <Plus className="h-4 w-4" /> New purchase order
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Open POs" value={openOrders.length} />
        <Metric label="Awaiting approval" value={approvalCount} />
        <Metric
          label="Deliveries expected"
          value={
            orders.filter((order) =>
              ["APPROVED", "PARTIALLY_RECEIVED", "PARTIAL"].includes(order.status),
            ).length
          }
        />
        <Metric label="Supplier commitments" value={Math.round(outstandingMinor / 100)} money />
        <Metric label="Suppliers" value={suppliers.length} />
        <Metric
          label="Receipts recorded"
          value={
            serverData?.procurement.receipts.length ??
            orders.filter((order) => order.status === "RECEIVED").length
          }
        />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}{" "}
          {authoritative
            ? `Server: ${control.status}.`
            : `Development repository: ${backendStatus}.`}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <Panel className="self-start">
          <PanelHead
            title="Purchase orders"
            sub={`${orders.length} recent`}
            right={
              <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
                <RefreshCw className="h-4 w-4" />
              </Btn>
            }
          />
          <ul className="divide-y divide-border">
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(order.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-secondary/50 ${selected?.id === order.id ? "bg-accent/50" : ""}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="num text-[12px] font-bold">{order.number}</span>
                    <Status>{order.status}</Status>
                  </div>
                  <div className="mt-1 truncate text-[12px] text-muted-foreground">
                    {order.supplier}
                  </div>
                  <div className="num mt-1 text-[12px] font-semibold">
                    {ksh(order.totalMinor / 100)}
                  </div>
                </button>
              </li>
            ))}
            {!orders.length && (
              <li className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No purchase orders in this branch.
              </li>
            )}
          </ul>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.number ?? "Purchase order"}
            sub={
              selected
                ? `${selected.supplier}${selected.expectedAt ? `  -  expected ${formatDate(selected.expectedAt)}` : ""}`
                : "Select or create a purchase order"
            }
            right={selected ? <Status>{selected.status}</Status> : undefined}
          />
          {selected && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead>
                    <tr>
                      <TH>Item</TH>
                      <TH className="text-right">Ordered</TH>
                      <TH className="text-right">Received</TH>
                      <TH className="text-right">Unit cost</TH>
                      <TH className="text-right">Line total</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={line.id}>
                        <TD className="font-semibold">{line.item}</TD>
                        <TD className="num text-right">
                          {formatQuantity(line.orderedMicro)} {line.unit}
                        </TD>
                        <TD className="num text-right">
                          {formatQuantity(line.receivedMicro)} {line.unit}
                        </TD>
                        <TD className="num text-right">{ksh(line.unitPriceMinor / 100)}</TD>
                        <TD className="num text-right font-semibold">
                          {ksh(line.totalMinor / 100)}
                        </TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div className="text-[13px] text-muted-foreground">
                  Total{" "}
                  <span className="num text-[16px] font-bold text-foreground">
                    {ksh(selected.totalMinor / 100)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Btn
                    disabled={
                      !authoritative ||
                      busy ||
                      !["DRAFT", "SUBMITTED", "APPROVED"].includes(selected.status)
                    }
                    onClick={() => setOrderAction("cancel")}
                  >
                    Cancel
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={
                      !authoritative || busy || !["DRAFT", "SUBMITTED"].includes(selected.status)
                    }
                    onClick={() => setOrderAction("approve")}
                  >
                    <ClipboardCheck className="h-4 w-4" /> Approve
                  </Btn>
                </div>
              </div>
            </>
          )}
        </Panel>

        <Panel className="self-start">
          <PanelHead title="Supplier performance" sub="Authoritative order history" />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Supplier</TH>
                <TH className="text-right">Spend</TH>
                <TH className="text-right">On-time</TH>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => {
                const received = Number(supplier.received_count);
                const onTime = received
                  ? Math.round((Number(supplier.on_time_count) / received) * 100)
                  : 0;
                return (
                  <tr key={supplier.id}>
                    <TD>
                      <div className="font-semibold">{supplier.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Lead {supplier.lead_time_days} days
                      </div>
                    </TD>
                    <TD className="num text-right">{ksh(Number(supplier.ordered_minor) / 100)}</TD>
                    <TD className="num text-right">{received ? `${onTime}%` : "-"}</TD>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>

      <CreatePurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branchId={branchId}
        currency={currency}
        data={serverData}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/purchase-orders", body),
            "Purchase order created as a draft.",
          ).then(() => setCreateOpen(false))
        }
      />
      <ReceiveOrderDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        order={selected}
        branchId={branchId}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/goods-receipts", body),
            "Goods receipt posted and inventory updated.",
          ).then(() => setReceiveOpen(false))
        }
      />
      <OrderActionDialog
        open={orderAction !== null}
        action={orderAction}
        order={selected}
        busy={busy}
        onOpenChange={(open) => !open && setOrderAction(null)}
        onSubmit={(action, reason) =>
          selected
            ? run(
                () =>
                  control.command(
                    `/api/seramet/procurement/purchase-orders/${encodeURIComponent(selected.id)}/${action}`,
                    { ...(reason ? { reason } : {}) },
                  ),
                action === "approve"
                  ? `${selected.number} approved.`
                  : `${selected.number} cancelled with audit history.`,
              ).then(() => setOrderAction(null))
            : Promise.resolve()
        }
      />
    </AppShell>
  );
}

function serverOrder(order: ProcurementOrderRow): DisplayOrder {
  return {
    id: order.id,
    number: order.purchase_order_number,
    supplier: order.supplier_name,
    supplierId: order.supplier_id,
    warehouseId: order.warehouse_id,
    status: order.status,
    currency: order.currency,
    totalMinor: Number(order.total_minor),
    ...(order.expected_at ? { expectedAt: order.expected_at } : {}),
    lines: order.lines.map((line) => ({
      id: line.id,
      itemId: line.inventory_item_id,
      item: line.item_name,
      unit: line.unit_symbol ?? "unit",
      orderedMicro: Number(line.ordered_quantity_minor),
      receivedMicro: Number(line.received_purchase_quantity_minor),
      unitPriceMinor: Number(line.unit_price_minor),
      totalMinor: Number(line.line_total_minor),
    })),
  };
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];

function CreatePurchaseOrderDialog({
  open,
  onOpenChange,
  branchId,
  currency,
  data,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  currency: string;
  data: BranchData | undefined;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const supplier =
    data?.procurement.suppliers.find((row) => row.id === supplierId) ??
    data?.procurement.suppliers[0];
  const item = data?.items.find((row) => row.id === itemId) ?? data?.items[0];
  const valid =
    supplier && item?.purchase_unit_id && Number(quantity) > 0 && Number(unitPrice) >= 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              value={supplier?.id ?? ""}
              onChange={(event) => setSupplierId(event.target.value)}
              className={inputClass}
            >
              {data?.procurement.suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inventory item">
            <select
              value={item?.id ?? ""}
              onChange={(event) => setItemId(event.target.value)}
              className={inputClass}
            >
              {data?.items.map((row) => (
                <option key={`${row.warehouse_id}:${row.id}`} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Purchase quantity">
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
          <Field label="Unit price">
            <input
              value={unitPrice}
              onChange={(event) => setUnitPrice(event.target.value)}
              inputMode="decimal"
              className={inputClass}
            />
          </Field>
        </div>
        {!item?.purchase_unit_id && (
          <p className="text-[12px] text-warning">
            The selected item needs a purchase unit and conversion before ordering.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                branchId,
                warehouseId: item.warehouse_id,
                supplierId: supplier.id,
                currency: supplier.currency || currency,
                overReceiptPolicy: "REJECT_OVER_RECEIPT",
                lines: [
                  {
                    inventoryItemId: item.id,
                    purchaseUnitId: item.purchase_unit_id,
                    quantityMicro: Math.round(Number(quantity) * 1_000_000),
                    unitPriceMinor: Math.round(Number(unitPrice) * 100),
                  },
                ],
              })
            }
          >
            Create draft
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveOrderDialog({
  open,
  onOpenChange,
  order,
  branchId,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DisplayOrder | undefined;
  branchId: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const receivable = order?.lines.filter((line) => line.orderedMicro > line.receivedMicro) ?? [];
  const valid =
    order &&
    ["APPROVED", "PARTIALLY_RECEIVED", "PARTIAL"].includes(order.status) &&
    receivable.length > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive {order?.number ?? "purchase order"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {receivable.map((line) => (
            <div
              key={line.id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]"
            >
              <span>{line.item}</span>
              <span className="num font-semibold">
                {formatQuantity(line.orderedMicro - line.receivedMicro)} {line.unit}
              </span>
            </div>
          ))}
        </div>
        {!valid && (
          <p className="text-[12px] text-warning">
            Only approved orders with outstanding quantities can be received.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              valid &&
              void onSubmit({
                branchId,
                warehouseId: order.warehouseId,
                purchaseOrderId: order.id,
                supplierId: order.supplierId,
                idempotencyKey: crypto.randomUUID(),
                lines: receivable.map((line) => ({
                  purchaseOrderLineId: line.id,
                  receivedPurchaseQuantityMicro: line.orderedMicro - line.receivedMicro,
                  acceptedPurchaseQuantityMicro: line.orderedMicro - line.receivedMicro,
                  unitPriceMinor: line.unitPriceMinor,
                })),
              })
            }
          >
            <PackageCheck className="h-4 w-4" /> Post receipt
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderActionDialog({
  open,
  action,
  order,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  action: "approve" | "cancel" | null;
  order: DisplayOrder | undefined;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (action: "approve" | "cancel", reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  if (!action) return null;
  const requiresReason = action === "cancel";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {action === "approve" ? "Approve" : "Cancel"} {order?.number ?? "purchase order"}
          </DialogTitle>
        </DialogHeader>
        <Field label={requiresReason ? "Reason (required)" : "Approval note (optional)"}>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            maxLength={500}
            className={`${inputClass} h-auto py-2`}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            {...(action === "approve" ? { variant: "primary" as const } : {})}
            disabled={busy || (requiresReason && !reason.trim())}
            onClick={() => void onSubmit(action, reason.trim())}
          >
            {action === "approve" ? "Approve order" : "Cancel order"}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}
const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40";
function formatQuantity(value: number) {
  return formatNumber(value / 1_000_000, { maximumFractionDigits: 3 });
}
