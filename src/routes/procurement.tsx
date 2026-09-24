import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, PackageCheck, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatNumber, ksh } from "@/lib/currency";
import {
  type ProcurementBranchPayload,
  type ProcurementOrderRow,
  type ProcurementSupplierRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement - Seramet" },
      {
        name: "description",
        content: "Purchase requisitions, orders, receiving, supplier bills and performance.",
      },
    ],
  }),
  component: Procurement,
});

type DisplayOrder = {
  id: string;
  branchId: string;
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
  const { branchId, branchLabel, currency, currentUser, isAllBranches } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [orderAction, setOrderAction] = useState<"approve" | "cancel" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const activeBranchData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];

  const orders = useMemo<DisplayOrder[]>(
    () =>
      control.data.flatMap((branch) =>
        branch.purchaseOrders.map((order) => serverOrder(order, branch.branchId)),
      ),
    [control.data],
  );
  const selected = orders.find((order) => order.id === selectedId) ?? orders[0];

  const suppliers = useMemo(() => {
    const byId = new Map<string, ProcurementSupplierRow>();
    for (const branch of control.data) {
      for (const supplier of branch.suppliers) {
        const existing = byId.get(supplier.id);
        if (!existing) {
          byId.set(supplier.id, { ...supplier });
          continue;
        }
        existing.order_count += Number(supplier.order_count);
        existing.ordered_minor += Number(supplier.ordered_minor);
        existing.outstanding_minor += Number(supplier.outstanding_minor);
        existing.on_time_count += Number(supplier.on_time_count);
        existing.received_count += Number(supplier.received_count);
      }
    }
    return [...byId.values()].sort(
      (a, b) => Number(b.ordered_minor) - Number(a.ordered_minor) || a.name.localeCompare(b.name),
    );
  }, [control.data]);

  const requisitions = control.data.flatMap((row) => row.requisitions);
  const receipts = control.data.flatMap((row) => row.receipts);
  const supplierInvoices = control.data.flatMap((row) => row.supplierInvoices);
  const openOrders = orders.filter((order) => !["RECEIVED", "CANCELLED"].includes(order.status));
  const approvalCount = orders.filter((order) => order.status === "SUBMITTED").length;
  const outstandingMinor = suppliers.reduce(
    (sum, supplier) => sum + Number(supplier.outstanding_minor),
    0,
  );
  const matchExceptions = supplierInvoices.filter(
    (invoice) => invoice.match_status && invoice.match_status !== "MATCHED",
  ).length;

  const canCreate = currentUser.permissions.includes(permissions.procurementCreate);
  const canApprove = currentUser.permissions.includes(permissions.procurementApprove);
  const canCancel = currentUser.permissions.includes(permissions.procurementCancel);
  const canReceive = currentUser.permissions.includes(permissions.procurementReceive);

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
      subtitle={`${branchLabel} purchase-to-pay control - ${openOrders.length} open purchase orders`}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            disabled={
              !selected ||
              !canReceive ||
              isAllBranches ||
              busy ||
              !["APPROVED", "PARTIALLY_RECEIVED"].includes(selected.status)
            }
            onClick={() => setReceiveOpen(true)}
          >
            <PackageCheck className="h-4 w-4" /> Receiving
          </Btn>
          <Btn
            variant="primary"
            disabled={!canCreate || isAllBranches || busy || control.status !== "ready"}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New purchase order
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Open POs" value={openOrders.length} />
        <Metric label="Awaiting approval" value={approvalCount} invert={approvalCount > 0} />
        <Metric
          label="Deliveries expected"
          value={orders.filter((order) => ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status)).length}
        />
        <Metric label="Supplier commitments" value={outstandingMinor / 100} money />
        <Metric label="Open requisitions" value={requisitions.filter((row) => row.status !== "ORDERED").length} />
        <Metric label="Receipts recorded" value={receipts.length} />
        <Metric label="Match exceptions" value={matchExceptions} invert={matchExceptions > 0} />
      </div>

      {(notice || control.error || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            control.error ||
            "All-branches mode is read-only for procurement transactions. Switch to one branch to create, approve, cancel or receive."}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
        <Panel className="self-start">
          <PanelHead title="Purchase orders" sub={`${orders.length} recent`} />
          <ul className="divide-y divide-border">
            {orders.map((order) => (
              <li key={`${order.branchId}:${order.id}`}>
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
                  {isAllBranches && (
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {order.branchId}
                    </div>
                  )}
                  <div className="num mt-1 text-[12px] font-semibold">
                    {ksh(order.totalMinor / 100)}
                  </div>
                </button>
              </li>
            ))}
            {!orders.length && (
              <li className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No purchase orders in this branch scope.
              </li>
            )}
          </ul>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.number ?? "Purchase order"}
            sub={
              selected
                ? `${selected.supplier}${selected.expectedAt ? ` - expected ${formatDate(selected.expectedAt)}` : ""}`
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
                      !canCancel ||
                      isAllBranches ||
                      busy ||
                      !["SUBMITTED", "APPROVED"].includes(selected.status)
                    }
                    onClick={() => setOrderAction("cancel")}
                  >
                    Cancel
                  </Btn>
                  <Btn
                    variant="primary"
                    disabled={!canApprove || isAllBranches || busy || selected.status !== "SUBMITTED"}
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
                        Lead {supplier.lead_time_days ?? 0} days
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
        data={activeBranchData}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/purchase-orders", body),
            "Purchase order submitted for approval.",
          ).then(() => setCreateOpen(false))
        }
      />
      <ReceiveOrderDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        order={selected}
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
                    reason ? { reason } : {},
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

function serverOrder(order: ProcurementOrderRow, branchId: string): DisplayOrder {
  return {
    id: order.id,
    branchId,
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
  data: ProcurementBranchPayload | undefined;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const supplier = data?.suppliers.find((row) => row.id === supplierId) ?? data?.suppliers[0];
  const warehouse =
    data?.warehouses.find((row) => row.id === warehouseId) ?? data?.warehouses[0];
  const item = data?.items.find((row) => row.id === itemId) ?? data?.items[0];
  const valid =
    supplier &&
    warehouse &&
    item?.purchase_unit_id &&
    Number(quantity) > 0 &&
    Number(unitPrice) >= 0;

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
              {data?.suppliers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Warehouse">
            <select
              value={warehouse?.id ?? ""}
              onChange={(event) => setWarehouseId(event.target.value)}
              className={inputClass}
            >
              {data?.warehouses.map((row) => (
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
                <option key={row.id} value={row.id}>
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
                warehouseId: warehouse.id,
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
            Submit PO
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
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: DisplayOrder | undefined;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const receivable = order?.lines.filter((line) => line.orderedMicro > line.receivedMicro) ?? [];
  const valid =
    order &&
    ["APPROVED", "PARTIALLY_RECEIVED"].includes(order.status) &&
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
                branchId: order.branchId,
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
            <PackageCheck className="h-4 w-4" /> Post full remaining receipt
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
