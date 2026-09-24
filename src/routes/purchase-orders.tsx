import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, Plus, RefreshCw, XCircle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementBranchPayload,
  type ProcurementOrderRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate, ksh } from "@/lib/currency";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/purchase-orders")({
  head: () => ({
    meta: [
      { title: "Purchase Orders - Seramet" },
      {
        name: "description",
        content:
          "Authoritative purchase order approvals, requisition linkage and receiving progress.",
      },
    ],
  }),
  component: PurchaseOrders,
});

type DisplayOrder = ProcurementOrderRow & { branchId: string };

function PurchaseOrders() {
  const { branchId, branchLabel, currentUser, currency, isAllBranches } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const rows = useMemo<DisplayOrder[]>(
    () =>
      control.data.flatMap((branch) =>
        branch.purchaseOrders.map((row) => ({ ...row, branchId: branch.branchId })),
      ),
    [control.data],
  );
  const branchData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const openRows = rows.filter((row) => !["RECEIVED", "CANCELLED"].includes(row.status));
  const openValueMinor = openRows.reduce((sum, row) => {
    const receivedMinor = row.lines.reduce(
      (lineSum, line) =>
        lineSum +
        Math.round(
          (Number(line.received_purchase_quantity_minor) * Number(line.unit_price_minor)) /
            1_000_000,
        ),
      0,
    );
    return sum + Math.max(0, Number(row.total_minor) - receivedMinor);
  }, 0);

  const canCreate = currentUser.permissions.includes(permissions.procurementCreate);
  const canApprove = currentUser.permissions.includes(permissions.procurementApprove);
  const canCancel = currentUser.permissions.includes(permissions.procurementCancel);

  const runAction = async (row: DisplayOrder, action: "approve" | "cancel") => {
    let reason: string | undefined;
    if (action === "cancel") {
      reason = window.prompt(`Reason for cancelling ${row.purchase_order_number}?`)?.trim();
      if (!reason) return;
    }
    setBusyId(row.id);
    setNotice("");
    try {
      await control.command(
        `/api/seramet/procurement/purchase-orders/${encodeURIComponent(row.id)}/${action}`,
        reason ? { reason } : {},
      );
      setNotice(
        action === "approve"
          ? `${row.purchase_order_number} approved and available for receiving.`
          : `${row.purchase_order_number} cancelled.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Purchase-order action failed");
    } finally {
      setBusyId("");
    }
  };

  return (
    <AppShell
      title="Purchase orders"
      subtitle={`PO approvals, receiving progress and supplier commitments - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!canCreate || isAllBranches || control.status !== "ready"}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New purchase order
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Visible POs" value={rows.length} />
        <Metric label="Open value" value={openValueMinor / 100} money invert={openValueMinor > 0} />
        <Metric
          label="Pending approval"
          value={rows.filter((row) => row.status === "SUBMITTED").length}
          invert={rows.some((row) => row.status === "SUBMITTED")}
        />
        <Metric label="Received" value={rows.filter((row) => row.status === "RECEIVED").length} />
      </div>

      {(notice || control.error || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Switch to a single branch to create a purchase order."}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Purchase order register"
          sub="Requisition linkage, approvals and receiving progress use the authoritative procurement ledger"
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading purchase orders...</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No purchase orders exist in the selected branch scope.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px]">
              <thead>
                <tr>
                  <TH>PO</TH>
                  <TH>Supplier</TH>
                  <TH>Created</TH>
                  <TH>Expected</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Received</TH>
                  <TH className="text-right">Open</TH>
                  <TH>Requisition</TH>
                  <TH>Status</TH>
                  <TH>Action</TH>
                </tr>
              </thead>
              <tbody>
                {rows.map((po) => {
                  const receivedMinor = po.lines.reduce(
                    (sum, line) =>
                      sum +
                      Math.round(
                        (Number(line.received_purchase_quantity_minor) *
                          Number(line.unit_price_minor)) /
                          1_000_000,
                      ),
                    0,
                  );
                  return (
                    <tr key={`${po.branchId}:${po.id}`} className="hover:bg-secondary/50">
                      <TD>
                        <div className="num font-semibold">{po.purchase_order_number}</div>
                        {isAllBranches && (
                          <div className="text-[11px] text-muted-foreground">{po.branchId}</div>
                        )}
                      </TD>
                      <TD>{po.supplier_name}</TD>
                      <TD className="text-muted-foreground">{formatDate(po.created_at)}</TD>
                      <TD className="text-muted-foreground">
                        {po.expected_at ? formatDate(po.expected_at) : "Not set"}
                      </TD>
                      <TD className="num text-right">{ksh(Number(po.total_minor) / 100)}</TD>
                      <TD className="num text-right text-muted-foreground">
                        {ksh(receivedMinor / 100)}
                      </TD>
                      <TD className="num text-right font-semibold">
                        {ksh(Math.max(0, Number(po.total_minor) - receivedMinor) / 100)}
                      </TD>
                      <TD className="num text-muted-foreground">{po.requisition_id ?? "-"}</TD>
                      <TD>
                        <Status>{po.status}</Status>
                      </TD>
                      <TD>
                        <div className="flex gap-2">
                          {po.status === "SUBMITTED" && (
                            <Btn
                              variant="primary"
                              disabled={!canApprove || busyId === po.id}
                              onClick={() => void runAction(po, "approve")}
                            >
                              <ClipboardCheck className="h-4 w-4" /> Approve
                            </Btn>
                          )}
                          {["SUBMITTED", "APPROVED"].includes(po.status) && (
                            <Btn
                              disabled={!canCancel || busyId === po.id}
                              onClick={() => void runAction(po, "cancel")}
                            >
                              <XCircle className="h-4 w-4" /> Cancel
                            </Btn>
                          )}
                          {["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status) && (
                            <span className="self-center text-[12px] font-semibold text-success">
                              Ready to receive
                            </span>
                          )}
                        </div>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <CreatePurchaseOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branchId={branchId}
        currency={currency}
        data={branchData}
        busy={busyId === "create"}
        onSubmit={async (body) => {
          setBusyId("create");
          setNotice("");
          try {
            await control.command("/api/seramet/procurement/purchase-orders", body);
            setNotice("Purchase order submitted for approval.");
            setCreateOpen(false);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Purchase-order creation failed");
          } finally {
            setBusyId("");
          }
        }}
      />
    </AppShell>
  );
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
  const [requisitionId, setRequisitionId] = useState("");
  const [requisitionLineId, setRequisitionLineId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("0");
  const [expectedAt, setExpectedAt] = useState("");

  const supplier =
    data?.procurement.suppliers.find((row) => row.id === supplierId) ??
    data?.procurement.suppliers[0];
  const requisitions =
    data?.procurement.requisitions.filter((row) =>
      ["APPROVED", "PARTIALLY_ORDERED"].includes(row.status),
    ) ?? [];
  const requisition = requisitions.find((row) => row.id === requisitionId);
  const availableReqLines =
    requisition?.lines.filter(
      (line) => Number(line.ordered_quantity_minor) < Number(line.requested_quantity_minor),
    ) ?? [];
  const requisitionLine =
    availableReqLines.find((line) => line.id === requisitionLineId) ?? availableReqLines[0];

  const manualItem = data?.items.find((row) => row.id === itemId) ?? data?.items[0];
  const warehouse = requisition
    ? data?.warehouses.find((row) => row.id === requisition.warehouse_id)
    : data?.warehouses.find((row) => row.id === warehouseId) ?? data?.warehouses[0];
  const item = requisition
    ? data?.items.find((row) => row.id === requisitionLine?.inventory_item_id)
    : manualItem;
  const purchaseUnitId = requisition ? requisitionLine?.unit_id : item?.purchase_unit_id;
  const remainingMicro = requisitionLine
    ? Number(requisitionLine.requested_quantity_minor) - Number(requisitionLine.ordered_quantity_minor)
    : null;
  const requestedMicro = Math.round(Number(quantity) * 1_000_000);
  const valid = Boolean(
    supplier &&
      warehouse &&
      item &&
      purchaseUnitId &&
      requestedMicro > 0 &&
      Number(unitPrice) >= 0 &&
      (remainingMicro === null || requestedMicro <= remainingMicro),
  );

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
          <Field label="Requisition (optional)">
            <select
              value={requisitionId}
              onChange={(event) => {
                setRequisitionId(event.target.value);
                setRequisitionLineId("");
              }}
              className={inputClass}
            >
              <option value="">Manual purchase order</option>
              {requisitions.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.requisition_number}
                </option>
              ))}
            </select>
          </Field>

          {requisition ? (
            <Field label="Requisition line">
              <select
                value={requisitionLine?.id ?? ""}
                onChange={(event) => setRequisitionLineId(event.target.value)}
                className={inputClass}
              >
                {availableReqLines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.item_name} -{" "}
                    {(
                      (Number(line.requested_quantity_minor) -
                        Number(line.ordered_quantity_minor)) /
                      1_000_000
                    ).toLocaleString()}{" "}
                    {line.unit_symbol ?? "unit"} remaining
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
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
                    <option key={`${row.default_warehouse_id ?? "all"}:${row.id}`} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}

          <Field label="Quantity">
            <input
              value={quantity}
              inputMode="decimal"
              onChange={(event) => setQuantity(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Unit price">
            <input
              value={unitPrice}
              inputMode="decimal"
              onChange={(event) => setUnitPrice(event.target.value)}
              className={inputClass}
            />
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

        {remainingMicro !== null && requestedMicro > remainingMicro && (
          <p className="text-[12px] text-warning">
            Quantity exceeds the outstanding requisition balance.
          </p>
        )}
        {!purchaseUnitId && (
          <p className="text-[12px] text-warning">
            The selected item needs a purchase unit before it can be ordered.
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
                warehouseId: warehouse!.id,
                supplierId: supplier!.id,
                ...(requisition ? { requisitionId: requisition.id } : {}),
                currency: supplier!.currency || currency,
                ...(expectedAt ? { expectedAt: new Date(expectedAt).toISOString() } : {}),
                overReceiptPolicy: "REJECT_OVER_RECEIPT",
                lines: [
                  {
                    inventoryItemId: item!.id,
                    purchaseUnitId: purchaseUnitId!,
                    quantityMicro: requestedMicro,
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-[12px] font-semibold">
      <span>{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
