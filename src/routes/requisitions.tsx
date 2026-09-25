import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Plus, RefreshCw, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatNumber } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  type ProcurementRequisitionRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";

export const Route = createFileRoute("/requisitions")({
  head: () => ({
    meta: [
      { title: "Requisitions - Seramet" },
      {
        name: "description",
        content:
          "Create, approve and track internal purchase requisitions before purchase ordering.",
      },
    ],
  }),
  component: Requisitions,
});

function Requisitions() {
  const { branchId, branchLabel } = useAppContext();
  const { persistenceMode, backendStatus } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const data = control.data.find((row) => row.branchId === branchId);
  const rows = data?.procurement.requisitions ?? [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];

  useEffect(() => {
    if (selectedId && !rows.some((row) => row.id === selectedId)) setSelectedId("");
  }, [rows, selectedId]);

  const submitted = rows.filter((row) => row.status === "SUBMITTED").length;
  const approved = rows.filter((row) => row.status === "APPROVED").length;
  const ordered = rows.filter((row) =>
    ["PARTIALLY_ORDERED", "ORDERED"].includes(row.status),
  ).length;
  const critical = rows.filter(
    (row) =>
      row.required_at &&
      new Date(row.required_at).getTime() <= Date.now() + 24 * 60 * 60 * 1000 &&
      !["ORDERED", "REJECTED", "CANCELLED"].includes(row.status),
  ).length;

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setNotice(success);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Requisition operation failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Requisitions"
      subtitle={`Internal purchase requests before PO creation - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Link to="/purchase-orders">
            <Btn>Purchase orders</Btn>
          </Link>
          <Btn
            variant="primary"
            disabled={!authoritative || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New requisition
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Submitted" value={submitted} />
        <Metric label="Approved" value={approved} />
        <Metric label="Ordered" value={ordered} />
        <Metric label="Required ≤24h" value={critical} invert={critical > 0} />
      </div>

      {(!authoritative || notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {!authoritative
            ? `Requisition writes require the authoritative server database. Backend: ${backendStatus}.`
            : notice || control.error}
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
                  <Status>{displayStatus(row.status)}</Status>
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {displayStatus(row.source_type)} · {row.lines.length} line
                  {row.lines.length === 1 ? "" : "s"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {row.required_at
                    ? `Required ${formatDate(row.required_at)}`
                    : `Created ${formatDate(row.created_at)}`}
                </div>
              </button>
            ))}
            {!rows.length && (
              <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                No requisitions in this branch yet.
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title={selected?.requisition_number ?? "Requisition detail"}
            sub={
              selected
                ? `${displayStatus(selected.source_type)} · created ${formatDate(selected.created_at)}`
                : "Select or create a requisition"
            }
            right={selected ? <Status>{displayStatus(selected.status)}</Status> : undefined}
          />
          {selected ? (
            <>
              <div className="grid gap-3 border-b border-border p-4 sm:grid-cols-3">
                <Info label="Warehouse" value={warehouseName(data, selected.warehouse_id)} />
                <Info
                  label="Required"
                  value={selected.required_at ? formatDate(selected.required_at) : "Not specified"}
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
                <table className="w-full min-w-[680px]">
                  <thead>
                    <tr>
                      <TH>Item</TH>
                      <TH className="text-right">Requested</TH>
                      <TH className="text-right">Ordered</TH>
                      <TH>Notes</TH>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.lines.map((line) => (
                      <tr key={line.id}>
                        <TD>
                          <div className="font-semibold">{line.item_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {line.sku ?? "No SKU"}
                          </div>
                        </TD>
                        <TD className="num text-right">
                          {quantity(line.requested_quantity_minor)} {line.unit_symbol ?? ""}
                        </TD>
                        <TD className="num text-right">
                          {quantity(line.ordered_quantity_minor)} {line.unit_symbol ?? ""}
                        </TD>
                        <TD className="max-w-[260px] text-muted-foreground">{line.notes || "—"}</TD>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
                <div className="text-[12px] text-muted-foreground">
                  Requested by{" "}
                  <span className="font-semibold text-foreground">{selected.requested_by}</span>
                  {selected.approval_reason ? ` · ${selected.approval_reason}` : ""}
                </div>
                <div className="flex gap-2">
                  {selected.status === "APPROVED" && (
                    <Link to="/purchase-orders">
                      <Btn>Continue to PO</Btn>
                    </Link>
                  )}
                  <Btn
                    variant="primary"
                    disabled={!authoritative || busy || selected.status !== "SUBMITTED"}
                    onClick={() => setApproveOpen(true)}
                  >
                    <ClipboardCheck className="h-4 w-4" /> Approve
                  </Btn>
                </div>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-[13px] text-muted-foreground">
              Requisitions created here will enter the approval queue before a purchase order is
              raised.
            </div>
          )}
        </Panel>
      </div>

      <CreateRequisitionDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        data={data}
        branchId={branchId}
        busy={busy}
        onSubmit={(body) =>
          run(
            () => control.command("/api/seramet/procurement/requisitions", body),
            "Requisition submitted for approval.",
          ).then((succeeded) => {
            if (succeeded) setCreateOpen(false);
          })
        }
      />

      <ApproveRequisitionDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        requisition={selected}
        busy={busy}
        onSubmit={(reason) =>
          selected
            ? run(
                () =>
                  control.command(
                    `/api/seramet/procurement/requisitions/${encodeURIComponent(selected.id)}/approve`,
                    reason.trim() ? { reason: reason.trim() } : {},
                  ),
                `${selected.requisition_number} approved and ready for purchase ordering.`,
              ).then((succeeded) => {
                if (succeeded) setApproveOpen(false);
              })
            : Promise.resolve()
        }
      />
    </AppShell>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];
type DraftLine = { key: string; itemId: string; unitId: string; quantity: string; notes: string };

function CreateRequisitionDialog({
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
  const [requiredAt, setRequiredAt] = useState("");
  const [sourceType, setSourceType] = useState<"MANUAL_REQUEST" | "LOW_STOCK" | "FORECAST">(
    "MANUAL_REQUEST",
  );
  const [lines, setLines] = useState<DraftLine[]>([
    { key: crypto.randomUUID(), itemId: "", unitId: "", quantity: "1", notes: "" },
  ]);

  useEffect(() => {
    if (!open || !data) return;
    const warehouse = data.warehouses.find((row) => row.active) ?? data.warehouses[0];
    setWarehouseId((current) => current || warehouse?.id || "");
    setLines((current) =>
      current.map((line) => {
        const item = data.items.find((row) => row.id === line.itemId) ?? data.items[0];
        return {
          ...line,
          itemId: item?.id ?? "",
          unitId: line.unitId || item?.base_unit_id || "",
        };
      }),
    );
  }, [data, open]);

  const normalized = useMemo(
    () =>
      lines.map((line) => {
        const item = data?.items.find((row) => row.id === line.itemId);
        return {
          ...line,
          item,
          unitId: line.unitId || item?.base_unit_id || "",
          quantityNumber: Number(line.quantity),
        };
      }),
    [data?.items, lines],
  );
  const valid =
    Boolean(warehouseId) &&
    normalized.length > 0 &&
    normalized.every((line) => line.item && line.unitId && line.quantityNumber > 0);

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Warehouse">
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
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
          <Field label="Source">
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
              className={inputClass}
            >
              <option value="MANUAL_REQUEST">Manual request</option>
              <option value="LOW_STOCK">Low stock</option>
              <option value="FORECAST">Forecast</option>
            </select>
          </Field>
          <Field label="Required at">
            <input
              type="datetime-local"
              value={requiredAt}
              onChange={(e) => setRequiredAt(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-2 space-y-3">
          {normalized.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1.5fr_110px_140px_1fr_auto]"
            >
              <Field label={`Item ${index + 1}`}>
                <select
                  value={line.itemId}
                  onChange={(e) => {
                    const item = data?.items.find((row) => row.id === e.target.value);
                    updateLine(line.key, {
                      itemId: e.target.value,
                      unitId: item?.base_unit_id ?? "",
                    });
                  }}
                  className={inputClass}
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
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Unit">
                <select
                  value={line.unitId}
                  onChange={(e) => updateLine(line.key, { unitId: e.target.value })}
                  className={inputClass}
                >
                  {data?.units.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.symbol}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Notes">
                <input
                  value={line.notes}
                  onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                  className={inputClass}
                  placeholder="Optional"
                />
              </Field>
              <div className="flex items-end">
                <Btn
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) => current.filter((row) => row.key !== line.key))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Btn>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-2">
          <Btn
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: crypto.randomUUID(),
                  itemId: data?.items[0]?.id ?? "",
                  unitId: data?.items[0]?.base_unit_id ?? "",
                  quantity: "1",
                  notes: "",
                },
              ])
            }
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
                  sourceType,
                  ...(requiredAt ? { requiredAt: new Date(requiredAt).toISOString() } : {}),
                  lines: normalized.map((line) => ({
                    inventoryItemId: line.item!.id,
                    requestedQuantityMicro: Math.round(line.quantityNumber * 1_000_000),
                    unitId: line.unitId,
                    ...(line.notes.trim() ? { notes: line.notes.trim() } : {}),
                  })),
                })
              }
            >
              Submit requisition
            </Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApproveRequisitionDialog({
  open,
  onOpenChange,
  requisition,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requisition: ProcurementRequisitionRow | undefined;
  busy: boolean;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {requisition?.requisition_number ?? "requisition"}</DialogTitle>
        </DialogHeader>
        <Field label="Approval note">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`${inputClass} min-h-24 py-2`}
            placeholder="Optional approval context"
            maxLength={500}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => onOpenChange(false)}>Cancel</Btn>
          <Btn
            variant="primary"
            disabled={!requisition || busy}
            onClick={() => void onSubmit(reason)}
          >
            Approve requisition
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

function warehouseName(data: BranchData | undefined, id: string) {
  return data?.warehouses.find((row) => row.id === id)?.name ?? id;
}

function quantity(value: number) {
  return formatNumber(Number(value) / 1_000_000, { maximumFractionDigits: 3 });
}

function displayStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[12px] outline-none focus:border-primary";
