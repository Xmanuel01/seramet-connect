import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  type ProcurementRequisitionRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { formatDate } from "@/lib/currency";

export const Route = createFileRoute("/requisitions")({
  head: () => ({
    meta: [
      { title: "Requisitions - Seramet" },
      {
        name: "description",
        content: "Authoritative purchase requisitions, approval state and PO conversion progress.",
      },
    ],
  }),
  component: Requisitions,
});

function Requisitions() {
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const branchData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const rows = branchData?.procurement.requisitions ?? [];
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  const metrics = useMemo(() => {
    const open = rows.filter((row) =>
      ["DRAFT", "SUBMITTED", "APPROVED", "PARTIALLY_ORDERED"].includes(row.status),
    );
    const requested = rows.reduce((sum, row) => sum + Number(row.requested_quantity_minor), 0);
    const ordered = rows.reduce((sum, row) => sum + Number(row.ordered_quantity_minor), 0);
    return {
      open: open.length,
      approval: rows.filter((row) => row.status === "SUBMITTED").length,
      approved: rows.filter((row) => row.status === "APPROVED").length,
      conversion: requested > 0 ? Math.round((ordered / requested) * 100) : 0,
    };
  }, [rows]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Requisition operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Requisitions"
      subtitle={`Internal purchase demand before supplier commitment - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={control.status === "loading"} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn variant="primary" disabled={!branchData || busy} onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New requisition
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open" value={metrics.open} />
        <Metric label="Awaiting approval" value={metrics.approval} invert={metrics.approval > 0} />
        <Metric label="Approved for ordering" value={metrics.approved} />
        <Metric label="Ordered coverage" value={metrics.conversion} suffix="%" />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel className="self-start">
          <PanelHead title="Requisition queue" sub={`${rows.length} recent requests`} />
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
                  <span className="num text-[12px] font-bold">{row.requisition_number}</span>
                  <Status>{row.status}</Status>
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {row.line_count} line{Number(row.line_count) === 1 ? "" : "s"} ·{" "}
                  {row.source_type.replaceAll("_", " ").toLowerCase()}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {formatDate(row.created_at)}
                  {row.required_at ? ` · required ${formatDate(row.required_at)}` : ""}
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No requisitions for this branch.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.requisition_number ?? "Requisition detail"}
            sub={
              selected
                ? `Requested by ${selected.requested_by}`
                : "Select a requisition or create a new request"
            }
            right={selected ? <Status>{selected.status}</Status> : undefined}
          />
          {selected && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr>
                      <TH>Item</TH>
                      <TH>SKU</TH>
                      <TH className="text-right">Requested</TH>
                      <TH className="text-right">Ordered</TH>
                      <TH className="text-right">Open</TH>
                      <TH>Notes</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => {
                      const requested = Number(line.requested_quantity_minor);
                      const ordered = Number(line.ordered_quantity_minor);
                      return (
                        <tr key={line.id}>
                          <TD className="font-semibold">{line.item_name}</TD>
                          <TD className="num text-muted-foreground">{line.sku ?? "—"}</TD>
                          <TD className="num text-right">
                            {quantity(requested)} {line.unit_symbol ?? ""}
                          </TD>
                          <TD className="num text-right">
                            {quantity(ordered)} {line.unit_symbol ?? ""}
                          </TD>
                          <TD className="num text-right font-semibold">
                            {quantity(Math.max(0, requested - ordered))} {line.unit_symbol ?? ""}
                          </TD>
                          <TD className="text-muted-foreground">{line.notes ?? "—"}</TD>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div className="text-[12px] text-muted-foreground">
                  {selected.approved_at
                    ? `Approved ${formatDate(selected.approved_at)}`
                    : "Approval is required before supplier commitment."}
                </div>
                <div className="flex gap-2">
                  {["APPROVED", "PARTIALLY_ORDERED"].includes(selected.status) && (
                    <Link to="/purchase-orders">
                      <Btn>Open purchase orders</Btn>
                    </Link>
                  )}
                  {selected.status === "SUBMITTED" && (
                    <Btn
                      variant="primary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            control.command(
                              `/api/seramet/procurement/requisitions/${encodeURIComponent(
                                selected.id,
                              )}/approve`,
                              { reason: "Approved from requisition workflow" },
                            ),
                          `${selected.requisition_number} approved for ordering.`,
                        )
                      }
                    >
                      Approve requisition
                    </Btn>
                  )}
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      <NewRequisitionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        data={branchData}
        branchId={branchId}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/requisitions", body),
            "Requisition submitted for approval.",
          ).then(() => setCreateOpen(false))
        }
      />
    </AppShell>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];

function NewRequisitionDialog({
  open,
  onOpenChange,
  data,
  branchId,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BranchData | undefined;
  branchId: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantityValue, setQuantityValue] = useState("1");
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");

  const warehouse =
    data?.warehouses.find((row) => row.id === warehouseId) ?? data?.warehouses[0];
  const item =
    data?.items.find((row) => row.id === itemId && (!warehouse || row.warehouse_id === warehouse.id)) ??
    data?.items.find((row) => !warehouse || row.warehouse_id === warehouse.id) ??
    data?.items[0];
  const quantityMicro = Math.round(Number(quantityValue) * 1_000_000);
  const valid = Boolean(warehouse && item && Number.isSafeInteger(quantityMicro) && quantityMicro > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Warehouse">
            <select
              className={inputClass}
              value={warehouse?.id ?? ""}
              onChange={(event) => {
                setWarehouseId(event.target.value);
                setItemId("");
              }}
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
              className={inputClass}
              value={item?.id ?? ""}
              onChange={(event) => setItemId(event.target.value)}
            >
              {data?.items
                .filter((row) => !warehouse || row.warehouse_id === warehouse.id)
                .map((row) => (
                  <option key={`${row.warehouse_id}:${row.id}`} value={row.id}>
                    {row.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              className={inputClass}
              inputMode="decimal"
              value={quantityValue}
              onChange={(event) => setQuantityValue(event.target.value)}
            />
          </Field>
          <Field label="Required date">
            <input
              className={inputClass}
              type="date"
              value={requiredDate}
              onChange={(event) => setRequiredDate(event.target.value)}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                className={`${inputClass} min-h-20 py-2`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={500}
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!valid || busy}
            onClick={() => {
              if (!valid || !warehouse || !item) return;
              void onSubmit({
                branchId,
                warehouseId: warehouse.id,
                sourceType: "MANUAL_REQUEST",
                ...(requiredDate
                  ? { requiredAt: new Date(`${requiredDate}T12:00:00.000Z`).toISOString() }
                  : {}),
                lines: [
                  {
                    inventoryItemId: item.id,
                    requestedQuantityMicro: quantityMicro,
                    unitId: item.base_unit_id,
                    ...(notes.trim() ? { notes: notes.trim() } : {}),
                  },
                ],
              });
            }}
          >
            Submit requisition
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function quantity(value: number) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(value / 1_000_000);
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
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:border-primary";
