import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";

export const Route = createFileRoute("/requisitions")({
  head: () => ({ meta: [{ title: "Requisitions - Seramet" }] }),
  component: Requisitions,
});

function Requisitions() {
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const branch = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = branch?.procurement.requisitions ?? [];
  const items = branch?.items ?? [];
  const warehouses = branch?.warehouses ?? [];
  const units = branch?.units ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const requestedUnits = rows.reduce(
    (sum, row) =>
      sum +
      row.lines.reduce(
        (lineSum, line) => lineSum + Number(line.requested_quantity_minor),
        0,
      ),
    0,
  );

  async function approve(id: string) {
    setBusy(true);
    setNotice("");
    try {
      await control.command(
        "/api/seramet/procurement/requisitions/" + encodeURIComponent(id) + "/approve",
        { reason: "Approved from requisition queue" },
      );
      setNotice("Requisition approved and ready for purchase-order conversion.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Requisitions"
      subtitle={"Internal purchase requests before PO creation - " + branchLabel}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>Refresh</Btn>
          <Btn variant="primary" onClick={() => setOpen(true)}>
            New requisition
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Open"
          value={
            rows.filter((row) => !["ORDERED", "REJECTED", "CANCELLED"].includes(row.status)).length
          }
        />
        <Metric
          label="Awaiting approval"
          value={rows.filter((row) => row.status === "SUBMITTED").length}
        />
        <Metric label="Requested qty" value={(requestedUnits / 1_000_000).toFixed(2)} />
        <Metric
          label="Partially ordered"
          value={rows.filter((row) => row.status === "PARTIALLY_ORDERED").length}
          invert
        />
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice}
        </div>
      )}

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Requisition queue"
          sub={
            control.error ||
            "Approve requests and preserve line-level traceability into purchase orders"
          }
        />
        {rows.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No requisitions for this branch.
          </div>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead>
              <tr>
                <TH>Request</TH>
                <TH>Source</TH>
                <TH>Requester</TH>
                <TH>Required</TH>
                <TH>Lines</TH>
                <TH>Status</TH>
                <TH>Action</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <TD className="num font-semibold">{row.requisition_number}</TD>
                  <TD>{row.source_type.replaceAll("_", " ")}</TD>
                  <TD>{row.requested_by}</TD>
                  <TD>
                    {row.required_at ? new Date(row.required_at).toLocaleDateString() : "Not set"}
                  </TD>
                  <TD>{row.lines.length}</TD>
                  <TD>
                    <Status>{row.status.replaceAll("_", " ")}</Status>
                  </TD>
                  <TD>
                    {row.status === "SUBMITTED" ? (
                      <Btn disabled={busy} variant="primary" onClick={() => void approve(row.id)}>
                        Approve
                      </Btn>
                    ) : row.status === "APPROVED" || row.status === "PARTIALLY_ORDERED" ? (
                      <span className="text-[12px] font-semibold text-success">Ready for PO</span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">No action</span>
                    )}
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <CreateRequisitionDialog
        open={open}
        onOpenChange={setOpen}
        branchId={branchId}
        items={items}
        warehouses={warehouses}
        units={units}
        busy={busy}
        onSubmit={async (body) => {
          setBusy(true);
          setNotice("");
          try {
            await control.command("/api/seramet/procurement/requisitions", body);
            setOpen(false);
            setNotice("Requisition submitted for approval.");
          } catch (error) {
            setNotice(error instanceof Error ? error.message : "Could not create requisition");
          } finally {
            setBusy(false);
          }
        }}
      />
    </AppShell>
  );
}

function CreateRequisitionDialog({
  open,
  onOpenChange,
  branchId,
  items,
  warehouses,
  units,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  branchId: string;
  items: Array<{
    id: string;
    name: string;
    base_unit_id: string;
    default_warehouse_id: string | null;
  }>;
  warehouses: Array<{ id: string; name: string }>;
  units: Array<{ id: string; symbol: string }>;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [sourceType, setSourceType] = useState<"MANUAL_REQUEST" | "LOW_STOCK" | "FORECAST">(
    "MANUAL_REQUEST",
  );

  const item = items.find((row) => row.id === itemId);
  const unitId = item?.base_unit_id ?? units[0]?.id ?? "";
  const effectiveWarehouseId = warehouseId || item?.default_warehouse_id || warehouses[0]?.id || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="text-[12px] font-semibold">
            Item
            <select
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
              value={itemId}
              onChange={(event) => setItemId(event.target.value)}
            >
              <option value="">Select item</option>
              {items.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px] font-semibold">
            Warehouse
            <select
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
              value={effectiveWarehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              {warehouses.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[12px] font-semibold">
            Source
            <select
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value as typeof sourceType)}
            >
              <option value="MANUAL_REQUEST">Manual request</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="FORECAST">Forecast</option>
            </select>
          </label>

          <label className="text-[12px] font-semibold">
            Quantity
            <input
              className="mt-1 h-9 w-full rounded-md border border-border bg-card px-2"
              type="number"
              min="0.001"
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>

          <Btn
            variant="primary"
            disabled={busy || !itemId || !effectiveWarehouseId || !unitId || Number(quantity) <= 0}
            onClick={() =>
              void onSubmit({
                branchId,
                warehouseId: effectiveWarehouseId,
                sourceType,
                lines: [
                  {
                    inventoryItemId: itemId,
                    requestedQuantityMicro: Math.round(Number(quantity) * 1_000_000),
                    unitId,
                  },
                ],
              })
            }
          >
            Submit requisition
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
