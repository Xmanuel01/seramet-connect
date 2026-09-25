import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, Download, PackageCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatNumber, ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  type ProcurementOrderRow,
  type ProcurementRequisitionRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Seramet" },
      {
        name: "description",
        content:
          "Authoritative purchase order approvals, supplier commitments and receiving progress.",
      },
    ],
  }),
  component: PurchaseOrders,
});

function PurchaseOrders() {
  const { branchId, branchLabel, currency } = useAppContext();
  const { persistenceMode, backendStatus } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const data = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = data?.procurement.purchaseOrders ?? [];

  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<"approve" | "cancel" | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId("");
  }, [rows, selectedId]);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const openRows = rows.filter((row) => !["RECEIVED", "CANCELLED"].includes(row.status));
  const submitted = rows.filter((row) => row.status === "SUBMITTED").length;
  const expected = rows.filter((row) =>
    ["APPROVED", "PARTIALLY_RECEIVED"].includes(row.status),
  ).length;
  const commitmentsMinor = openRows.reduce((sum, row) => sum + Number(row.total_minor), 0);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Purchase order operation failed");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = [
      "Purchase Order",
      "Supplier",
      "Status",
      "Requisition",
      "Created",
      "Expected",
      "Currency",
      "Total",
      "Received %",
    ];
    const lines = rows.map((row) => [
      row.purchase_order_number,
      row.supplier_name,
      row.status,
      requisitionNumber(data, row.requisition_id),
      row.created_at,
      row.expected_at ?? "",
      row.currency,
      (Number(row.total_minor) / 100).toFixed(2),
      receivedPercent(row).toFixed(1),
    ]);
    const csv = [header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `seramet-purchase-orders-${branchId}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Purchase orders"
      subtitle={`Authoritative PO approvals, commitments and receiving progress - ${branchLabel}`}
      actions={
        <>
          <Link to="/requisitions">
            <Btn>Requisitions</Btn>
          </Link>
          <Btn disabled={!rows.length} onClick={exportCsv}>
            <Download className="h-4 w-4" /> Export
          </Btn>
          <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New purchase order
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open POs" value={openRows.length} />
        <Metric label="Awaiting approval" value={submitted} invert={submitted > 0} />
        <Metric label="Deliveries expected" value={expected} />
        <Metric label="Supplier commitments" value={Math.round(commitmentsMinor / 100)} money />
      </div>

      {(!authoritative || notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {!authoritative
            ? `Purchase order writes require the authoritative server database. Backend: ${backendStatus}.`
            : notice || control.error}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead title="Purchase order register" sub={`${rows.length} recent orders`} />
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setSelectedId(row.id)}
                className={`w-full px-4 py-3 text-left hover:bg-secondary/50 ${
                  selected?.id === row.id ? "bg-accent/50" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-bold">{row.purchase_order_number}</span>
                  <Status>{displayStatus(row.status)}</Status>
                </div>
                <div className="mt-1 truncate text-[12px] text-muted-foreground">
                  {row.supplier_name}
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="num text-[12px] font-semibold">
                    {ksh(Number(row.total_minor) / 100)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {receivedPercent(row).toFixed(0)}% received
                  </span>
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No purchase orders in this branch yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.purchase_order_number ?? "Purchase order detail"}
            sub={
              selected
                ? `${selected.supplier_name} · created ${formatDate(selected.created_at)}`
                : "Select or create a purchase order"
            }
            right={selected ? <Status>{displayStatus(selected.status)}</Status> : undefined}
          />

          {selected ? (
            <>
              <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
                <Info
                  label="Requisition"
                  value={requisitionNumber(data, selected.requisition_id) || "Direct purchase"}
                />
                <Info label="Warehouse" value={warehouseName(data, selected.warehouse_id)} />
                <Info
                  label="Expected"
                  value={selected.expected_at ? formatDate(selected.expected_at) : "Not specified"}
                />
                <Info
                  label="Approval"
                  value={
                    selected.approved_at
                      ? `Approved ${formatDate(selected.approved_at)}`
                      : selected.status === "SUBMITTED"
                        ? "Awaiting approval"
                        : displayStatus(selected.status)
                  }
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <TH>Item</TH>
                      <TH className="text-right">Ordered</TH>
                      <TH className="text-right">Received</TH>
                      <TH className="text-right">Progress</TH>
                      <TH className="text-right">Unit price</TH>
                      <TH className="text-right">Line total</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => {
                      const progress =
                        Number(line.ordered_quantity_minor) > 0
                          ? Math.min(
                              100,
                              (Number(line.received_purchase_quantity_minor) /
                                Number(line.ordered_quantity_minor)) *
                                100,
                            )
                          : 0;
                      return (
                        <tr key={line.id}>
                          <TD>
                            <div className="font-semibold">{line.item_name}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {line.sku ?? "No SKU"}
                            </div>
                          </TD>
                          <TD className="num text-right">
                            {quantity(line.ordered_quantity_minor)} {line.unit_symbol ?? ""}
                          </TD>
                          <TD className="num text-right">
                            {quantity(line.received_purchase_quantity_minor)}{" "}
                            {line.unit_symbol ?? ""}
                          </TD>
                          <TD className="num text-right">{progress.toFixed(0)}%</TD>
                          <TD className="num text-right">
                            {ksh(Number(line.unit_price_minor) / 100)}
                          </TD>
                          <TD className="num text-right font-semibold">
                            {ksh(Number(line.line_total_minor) / 100)}
                          </TD>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Order total
                  </div>
                  <div className="num text-[18px] font-bold">
                    {ksh(Number(selected.total_minor) / 100)}
                  </div>
                  {selected.approval_reason && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Approval note: {selected.approval_reason}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Btn
                    disabled={!authoritative || busy || !["SUBMITTED", "APPROVED"].includes(selected.status)}
                    onClick={() => setAction("cancel")}
                  >
                    Cancel PO
                  </Btn>
                  {["APPROVED", "PARTIALLY_RECEIVED"].includes(selected.status) && (
                    <Link to="/receiving">
                      <Btn>
                        <PackageCheck className="h-4 w-4" /> Receive
                      </Btn>
                    </Link>
                  )}
                  <Btn
                    variant="primary"
                    disabled={!authoritative || busy || selected.status !== "SUBMITTED"}
                    onClick={() => setAction("approve")}
                  >
                    <ClipboardCheck className="h-4 w-4" /> Approve
                  </Btn>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
              Approved requisitions can be converted into supplier purchase orders here, or a direct
              purchase order can be created when no requisition is required.
            </div>
          )}
        </Panel>
      </div>

      <CreatePurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        data={data}
        branchId={branchId}
        currency={currency}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/purchase-orders", body),
            "Purchase order submitted for approval.",
          ).then(() => setCreateOpen(false))
        }
      />

      <OrderActionDialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        action={action}
        order={selected}
        busy={busy}
        onSubmit={(reason) => {
          if (!selected || !action) return Promise.resolve();
          const endpoint =
            action === "approve"
              ? `/api/seramet/procurement/purchase-orders/${encodeURIComponent(selected.id)}/approve`
              : `/api/seramet/procurement/purchase-orders/${encodeURIComponent(selected.id)}/cancel`;
          return run(
            () => control.command(endpoint, reason.trim() ? { reason: reason.trim() } : {}),
            action === "approve"
              ? `${selected.purchase_order_number} approved and ready for receiving.`
              : `${selected.purchase_order_number} cancelled.`,
          ).then(() => setAction(null));
        }}
      />
    </AppShell>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];
type DraftLine = {
  key: string;
  itemId: string;
  quantity: string;
  unitPrice: string;
  tax: string;
  discount: string;
};

function CreatePurchaseOrderDialog({
  open,
  onOpenChange,
  data,
  branchId,
  currency,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BranchData | undefined;
  branchId: string;
  currency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const approvedRequisitions =
    data?.procurement.requisitions.filter((row) =>
      ["APPROVED", "PARTIALLY_ORDERED"].includes(row.status),
    ) ?? [];
  const [supplierId, setSupplierId] = useState("");
  const [requisitionId, setRequisitionId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [overReceiptPolicy, setOverReceiptPolicy] = useState<
    "REJECT_OVER_RECEIPT" | "ALLOW_WITH_APPROVAL" | "ALLOW_WITH_TOLERANCE"
  >("REJECT_OVER_RECEIPT");
  const [tolerancePercent, setTolerancePercent] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([
    {
      key: crypto.randomUUID(),
      itemId: "",
      quantity: "1",
      unitPrice: "0",
      tax: "0",
      discount: "0",
    },
  ]);

  useEffect(() => {
    if (!open || !data) return;
    const supplier = data.procurement.suppliers[0];
    const warehouse = data.warehouses.find((row) => row.active) ?? data.warehouses[0];
    const item = data.items.find((row) => row.purchase_unit_id) ?? data.items[0];
    setSupplierId((current) => current || supplier?.id || "");
    setWarehouseId((current) => current || warehouse?.id || "");
    setLines((current) =>
      current.map((line) => ({
        ...line,
        itemId: line.itemId || item?.id || "",
      })),
    );
  }, [data, open]);

  const selectedRequisition = approvedRequisitions.find((row) => row.id === requisitionId);

  useEffect(() => {
    if (!selectedRequisition || !data) return;
    setWarehouseId(selectedRequisition.warehouse_id);
    setLines(
      selectedRequisition.lines.map((line) => {
        const item = data.items.find((row) => row.id === line.inventory_item_id);
        const canCarryQuantity = item?.purchase_unit_id === line.unit_id;
        return {
          key: crypto.randomUUID(),
          itemId: line.inventory_item_id,
          quantity: canCarryQuantity
            ? String(Number(line.requested_quantity_minor) / 1_000_000)
            : "",
          unitPrice: "0",
          tax: "0",
          discount: "0",
        };
      }),
    );
  }, [data, selectedRequisition]);

  const supplier =
    data?.procurement.suppliers.find((row) => row.id === supplierId) ??
    data?.procurement.suppliers[0];

  const normalized = useMemo(
    () =>
      lines.map((line) => {
        const item = data?.items.find((row) => row.id === line.itemId);
        return {
          ...line,
          item,
          quantityNumber: Number(line.quantity),
          unitPriceNumber: Number(line.unitPrice),
          taxNumber: Number(line.tax),
          discountNumber: Number(line.discount),
        };
      }),
    [data?.items, lines],
  );

  const tolerance = Number(tolerancePercent);
  const valid =
    Boolean(supplier && warehouseId) &&
    normalized.length > 0 &&
    normalized.every(
      (line) =>
        line.item?.purchase_unit_id &&
        line.quantityNumber > 0 &&
        line.unitPriceNumber >= 0 &&
        line.taxNumber >= 0 &&
        line.discountNumber >= 0,
    ) &&
    (overReceiptPolicy !== "ALLOW_WITH_TOLERANCE" ||
      (Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 100));

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Field label="Approved requisition">
            <select
              value={requisitionId}
              onChange={(event) => setRequisitionId(event.target.value)}
              className={inputClass}
            >
              <option value="">Direct purchase</option>
              {approvedRequisitions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.requisition_number}
                </option>
              ))}
            </select>
          </Field>
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
          <Field label="Warehouse">
            <select
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              disabled={Boolean(selectedRequisition)}
              className={inputClass}
            >
              {data?.warehouses
                .filter((row) => row.active)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Expected delivery">
            <input
              type="datetime-local"
              value={expectedAt}
              onChange={(event) => setExpectedAt(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Over-receipt policy">
            <select
              value={overReceiptPolicy}
              onChange={(event) =>
                setOverReceiptPolicy(event.target.value as typeof overReceiptPolicy)
              }
              className={inputClass}
            >
              <option value="REJECT_OVER_RECEIPT">Reject over-receipt</option>
              <option value="ALLOW_WITH_APPROVAL">Allow with approval</option>
              <option value="ALLOW_WITH_TOLERANCE">Allow within tolerance</option>
            </select>
          </Field>
          {overReceiptPolicy === "ALLOW_WITH_TOLERANCE" && (
            <Field label="Tolerance %">
              <input
                inputMode="decimal"
                value={tolerancePercent}
                onChange={(event) => setTolerancePercent(event.target.value)}
                className={inputClass}
              />
            </Field>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {normalized.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[minmax(180px,1.6fr)_110px_130px_100px_100px_auto]"
            >
              <Field label={`Item ${index + 1}`}>
                <select
                  value={line.itemId}
                  onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
                  className={inputClass}
                  disabled={Boolean(selectedRequisition)}
                >
                  {data?.items.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Quantity">
                <input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  className={inputClass}
                  placeholder="0"
                />
              </Field>
              <Field label={`Price / ${purchaseUnitSymbol(data, line.itemId)}`}>
                <input
                  inputMode="decimal"
                  value={line.unitPrice}
                  onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Tax">
                <input
                  inputMode="decimal"
                  value={line.tax}
                  onChange={(event) => updateLine(line.key, { tax: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Discount">
                <input
                  inputMode="decimal"
                  value={line.discount}
                  onChange={(event) => updateLine(line.key, { discount: event.target.value })}
                  className={inputClass}
                />
              </Field>
              <div className="flex items-end">
                <Btn
                  disabled={Boolean(selectedRequisition) || lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Btn>
              </div>
              {!line.item?.purchase_unit_id && (
                <div className="md:col-span-6 text-[11px] text-warning">
                  {line.item?.name ?? "This item"} has no purchase unit configured. Fix the
                  inventory item before ordering it.
                </div>
              )}
              {selectedRequisition &&
                selectedRequisition.lines[index] &&
                selectedRequisition.lines[index]!.unit_id !== line.item?.purchase_unit_id && (
                  <div className="md:col-span-6 text-[11px] text-muted-foreground">
                    Requisition quantity was requested in{" "}
                    {selectedRequisition.lines[index]!.unit_symbol ?? "another unit"}. Enter the
                    supplier purchase quantity in {purchaseUnitSymbol(data, line.itemId)}; Seramet
                    will use the configured item conversion when posting the PO.
                  </div>
                )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Btn
            disabled={Boolean(selectedRequisition)}
            onClick={() => {
              const item = data?.items.find((row) => row.purchase_unit_id) ?? data?.items[0];
              setLines((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  itemId: item?.id ?? "",
                  quantity: "1",
                  unitPrice: "0",
                  tax: "0",
                  discount: "0",
                },
              ]);
            }}
          >
            <Plus className="h-4 w-4" /> Add line
          </Btn>
          <div className="flex gap-2">
            <Btn onClick={() => onOpenChange(false)}>Close</Btn>
            <Btn
              variant="primary"
              disabled={!valid || busy}
              onClick={() =>
                valid &&
                void onSubmit({
                  branchId,
                  warehouseId,
                  supplierId: supplier!.id,
                  ...(requisitionId ? { requisitionId } : {}),
                  currency: supplier!.currency || currency,
                  ...(expectedAt ? { expectedAt: new Date(expectedAt).toISOString() } : {}),
                  overReceiptPolicy,
                  ...(overReceiptPolicy === "ALLOW_WITH_TOLERANCE"
                    ? { overReceiptToleranceBps: Math.round(tolerance * 100) }
                    : {}),
                  lines: normalized.map((line) => ({
                    inventoryItemId: line.item!.id,
                    purchaseUnitId: line.item!.purchase_unit_id!,
                    quantityMicro: Math.round(line.quantityNumber * 1_000_000),
                    unitPriceMinor: Math.round(line.unitPriceNumber * 100),
                    taxMinor: Math.round(line.taxNumber * 100),
                    discountMinor: Math.round(line.discountNumber * 100),
                  })),
                })
              }
            >
              Submit PO
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderActionDialog({
  open,
  onOpenChange,
  action,
  order,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: "approve" | "cancel" | null;
  order: ProcurementOrderRow | undefined;
  busy: boolean;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  const cancellation = action === "cancel";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {cancellation ? "Cancel" : "Approve"} {order?.purchase_order_number ?? "purchase order"}
          </DialogTitle>
        </DialogHeader>
        <Field label={cancellation ? "Cancellation reason" : "Approval note"}>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${inputClass} min-h-24 py-2`}
            placeholder={cancellation ? "Required" : "Optional"}
            maxLength={500}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!order || busy || (cancellation && reason.trim().length === 0)}
            onClick={() => void onSubmit(reason)}
          >
            {cancellation ? "Cancel PO" : "Approve PO"}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function quantity(value: number) {
  return formatNumber(Number(value) / 1_000_000, { maximumFractionDigits: 3 });
}

function receivedPercent(order: ProcurementOrderRow) {
  const ordered = order.lines.reduce((sum, line) => sum + Number(line.ordered_quantity_minor), 0);
  const received = order.lines.reduce(
    (sum, line) => sum + Number(line.received_purchase_quantity_minor),
    0,
  );
  return ordered > 0 ? Math.min(100, (received / ordered) * 100) : 0;
}

function displayStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function requisitionNumber(data: BranchData | undefined, id: string | null) {
  if (!id) return "";
  return data?.procurement.requisitions.find((row) => row.id === id)?.requisition_number ?? id;
}

function warehouseName(data: BranchData | undefined, id: string) {
  return data?.warehouses.find((row) => row.id === id)?.name ?? id;
}

function purchaseUnitSymbol(data: BranchData | undefined, itemId: string) {
  const item = data?.items.find((row) => row.id === itemId);
  const unit = data?.units.find((row) => row.id === item?.purchase_unit_id);
  return unit?.symbol ?? "unit";
}

function csvCell(value: string) {
  const escaped = value.replaceAll('"', '""');
  return `"${escaped}"`;
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[12px] outline-none focus:border-primary disabled:cursor-not-allowed disabled:opacity-60";
