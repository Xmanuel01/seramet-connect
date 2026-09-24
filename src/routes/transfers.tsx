import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryOperations, type TransferRow } from "@/inventory/use-inventory-operations";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/transfers")({
  head: () => ({
    meta: [
      { title: "Stock Transfers - Seramet" },
      {
        name: "description",
        content:
          "Controlled stock transfer requests, approvals, dispatches and destination receipts.",
      },
    ],
  }),
  component: Transfers,
});

type TransferDetail = {
  transfer: Record<string, unknown>;
  lines: Array<{
    id: string;
    inventory_item_id: string;
    code: string;
    sku: string | null;
    name: string;
    unit_symbol: string | null;
    requested_quantity_minor: number;
    sent_quantity_minor: number;
    received_quantity_minor: number;
    shortage_quantity_minor: number;
    unit_cost_minor: number;
    damaged_quantity_micro: number;
    rejected_quantity_micro: number;
    missing_quantity_micro: number;
  }>;
  receipts: Array<Record<string, unknown>>;
};

function Transfers() {
  const { branchLabel } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const operations = useInventoryOperations(authoritative);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<TransferRow | null>(null);
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [notice, setNotice] = useState("");

  const rows = useMemo(() => {
    const unique = new Map<string, TransferRow>();
    for (const branch of operations.data) {
      for (const row of branch.transfers) unique.set(row.id, row);
    }
    return [...unique.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [operations.data]);

  const open = rows.filter((row) => ["REQUESTED", "APPROVED"].includes(row.status)).length;
  const inTransit = rows.filter((row) => row.status === "IN_TRANSIT").length;
  const awaitingApproval = rows.filter((row) => row.status === "REQUESTED").length;
  const transferredValue = rows
    .filter((row) => row.status === "RECEIVED")
    .reduce((sum, row) => sum + Number(row.sent_value_minor ?? 0), 0);

  const loadDetail = async (row: TransferRow) => {
    setSelected(row);
    setShowReceipt(false);
    setNotice("");
    try {
      const response = await fetch(
        `/api/seramet/inventory/transfers/${encodeURIComponent(row.id)}`,
        { headers: operations.control.headers },
      );
      const body = (await response.json().catch(() => ({}))) as {
        detail?: TransferDetail;
        message?: string;
        error?: string;
      };
      if (!response.ok || !body.detail) {
        throw new Error(body.message ?? body.error ?? `Transfer detail failed (${response.status})`);
      }
      setDetail(body.detail);
    } catch (error) {
      setDetail(null);
      setNotice(error instanceof Error ? error.message : "Transfer detail could not be loaded");
    }
  };

  const lifecycle = async (row: TransferRow, action: "approve" | "cancel" | "dispatch") => {
    try {
      if (action === "dispatch") {
        await operations.command(
          `/api/seramet/inventory/transfers/${encodeURIComponent(row.id)}/dispatch`,
          { idempotencyKey: crypto.randomUUID() },
        );
        setNotice("Transfer dispatched. Source stock has moved out and is now in transit.");
      } else {
        const reason = window.prompt(
          action === "approve" ? "Approval reason" : "Cancellation reason",
          action === "approve" ? "Transfer verified" : "",
        );
        if (!reason?.trim()) return;
        await operations.command(
          `/api/seramet/inventory/transfers/${encodeURIComponent(row.id)}/${action}`,
          { reason: reason.trim() },
        );
        setNotice(action === "approve" ? "Transfer approved." : "Transfer cancelled.");
      }
      const refreshed = operations.data
        .flatMap((branch) => branch.transfers)
        .find((candidate) => candidate.id === row.id);
      if (refreshed) await loadDetail(refreshed);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transfer action failed");
    }
  };

  return (
    <AppShell
      title="Stock transfers"
      subtitle={`${branchLabel} - request, approve, dispatch and receive stock between stores or branches`}
      actions={
        <Btn
          variant="primary"
          disabled={!authoritative || operations.control.status !== "ready"}
          onClick={() => setShowForm((value) => !value)}
        >
          {showForm ? "Close form" : "New transfer"}
        </Btn>
      }
    >
      {(notice || operations.error || operations.control.error) && (
        <Notice>{notice || operations.error || operations.control.error}</Notice>
      )}

      {showForm && (
        <TransferRequestForm
          branches={operations.control.data}
          busy={operations.status === "loading"}
          onCancel={() => setShowForm(false)}
          onSubmit={async (body) => {
            try {
              await operations.command("/api/seramet/inventory/transfers/request", body);
              setNotice("Transfer request created. No stock has moved yet.");
              setShowForm(false);
            } catch (error) {
              setNotice(error instanceof Error ? error.message : "Transfer request failed");
            }
          }}
        />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open transfers" value={open} />
        <Metric label="In transit" value={inTransit} invert={inTransit > 0} />
        <Metric label="Awaiting approval" value={awaitingApproval} invert={awaitingApproval > 0} />
        <Metric label="Received value" value={transferredValue / 100} money />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Panel>
          <PanelHead
            title="Transfer register"
            sub="Stock leaves the source only on dispatch and enters destination only on receipt"
          />
          <DataTable
            cols={[
              "Transfer",
              "From",
              "To",
              { l: "Items", r: true },
              { l: "Sent value", r: true },
              "Status",
              "Action",
            ]}
          >
            {rows.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer hover:bg-secondary/50"
                onClick={() => void loadDetail(row)}
              >
                <TD>
                  <div className="num font-semibold">{row.transfer_number}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </div>
                </TD>
                <TD>
                  <div className="font-semibold">{row.source_warehouse_name}</div>
                  <div className="text-[10px] text-muted-foreground">{row.source_branch_name}</div>
                </TD>
                <TD>
                  <div className="font-semibold">{row.destination_warehouse_name}</div>
                  <div className="text-[10px] text-muted-foreground">{row.destination_branch_name}</div>
                </TD>
                <TD className="num text-right">{Number(row.line_count ?? 0)}</TD>
                <TD className="num text-right font-semibold">{ksh(Number(row.sent_value_minor ?? 0) / 100)}</TD>
                <TD><Status>{row.status}</Status></TD>
                <TD onClick={(event) => event.stopPropagation()}>
                  <TransferActions
                    row={row}
                    onAction={(action) => void lifecycle(row, action)}
                    onReceive={() => {
                      void loadDetail(row).then(() => setShowReceipt(true));
                    }}
                  />
                </TD>
              </tr>
            ))}
          </DataTable>
          {!rows.length && operations.status === "ready" && <Empty>No stock transfers yet.</Empty>}
        </Panel>

        <Panel>
          <PanelHead
            title={selected ? selected.transfer_number : "Transfer details"}
            sub={selected ? `${selected.source_warehouse_name} → ${selected.destination_warehouse_name}` : "Select a transfer"}
          />
          {detail ? (
            <>
              <div className="grid grid-cols-2 gap-2 border-b border-border p-4 text-[11px]">
                <Detail label="Status" value={String(detail.transfer["status"] ?? "-")} />
                <Detail label="Shipment" value={String(detail.transfer["shipment_status"] ?? "Not dispatched")} />
                <Detail label="Requested by" value={String(detail.transfer["requested_by"] ?? "-")} />
                <Detail label="Approved by" value={String(detail.transfer["approved_by"] ?? "-")} />
              </div>
              <DataTable
                cols={[
                  "Item",
                  { l: "Requested", r: true },
                  { l: "Sent", r: true },
                  { l: "Received", r: true },
                  { l: "Exceptions", r: true },
                ]}
              >
                {detail.lines.map((line) => {
                  const exceptions =
                    Number(line.damaged_quantity_micro ?? 0) +
                    Number(line.rejected_quantity_micro ?? 0) +
                    Number(line.missing_quantity_micro ?? 0);
                  return (
                    <tr key={line.id}>
                      <TD>
                        <div className="font-semibold">{line.name}</div>
                        <div className="num text-[10px] text-muted-foreground">{line.sku ?? line.code}</div>
                      </TD>
                      <TD className="num text-right">{qty(line.requested_quantity_minor)}</TD>
                      <TD className="num text-right">{qty(line.sent_quantity_minor)}</TD>
                      <TD className="num text-right">{qty(line.received_quantity_minor)}</TD>
                      <TD className="num text-right">{qty(exceptions)}</TD>
                    </tr>
                  );
                })}
              </DataTable>
              {selected?.status === "IN_TRANSIT" && selected.shipment_id && (
                <div className="border-t border-border p-3">
                  <Btn variant="primary" onClick={() => setShowReceipt((value) => !value)}>
                    {showReceipt ? "Close receipt" : "Receive shipment"}
                  </Btn>
                </div>
              )}
              {showReceipt && selected?.shipment_id && (
                <ReceiptForm
                  shipmentId={selected.shipment_id}
                  lines={detail.lines}
                  busy={operations.status === "loading"}
                  onSubmit={async (body) => {
                    try {
                      await operations.command(
                        `/api/seramet/inventory/transfer-shipments/${encodeURIComponent(selected.shipment_id!)}/receive`,
                        body,
                      );
                      setNotice("Transfer receipt posted. Destination stock updated.");
                      setShowReceipt(false);
                      await loadDetail(selected);
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : "Transfer receipt failed");
                    }
                  }}
                />
              )}
            </>
          ) : (
            <Empty>Select a transfer to inspect its shipment and receipt history.</Empty>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function TransferActions({
  row,
  onAction,
  onReceive,
}: {
  row: TransferRow;
  onAction: (action: "approve" | "cancel" | "dispatch") => void;
  onReceive: () => void;
}) {
  if (row.status === "REQUESTED") {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => onAction("approve")} className="text-[12px] font-semibold text-primary hover:underline">Approve</button>
        <button type="button" onClick={() => onAction("cancel")} className="text-[12px] font-semibold text-danger hover:underline">Cancel</button>
      </div>
    );
  }
  if (row.status === "APPROVED") {
    return (
      <div className="flex gap-2">
        <button type="button" onClick={() => onAction("dispatch")} className="text-[12px] font-semibold text-primary hover:underline">Dispatch</button>
        <button type="button" onClick={() => onAction("cancel")} className="text-[12px] font-semibold text-danger hover:underline">Cancel</button>
      </div>
    );
  }
  if (row.status === "IN_TRANSIT") {
    return <button type="button" onClick={onReceive} className="text-[12px] font-semibold text-primary hover:underline">Receive</button>;
  }
  return <span className="text-[11px] text-muted-foreground">Final</span>;
}

function TransferRequestForm({
  branches,
  busy,
  onCancel,
  onSubmit,
}: {
  branches: ReturnType<typeof useInventoryOperations>["control"]["data"];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [sourceBranchId, setSourceBranchId] = useState(branches[0]?.branchId ?? "");
  const sourceBranch = branches.find((row) => row.branchId === sourceBranchId) ?? branches[0];
  const [sourceWarehouseId, setSourceWarehouseId] = useState(sourceBranch?.warehouses[0]?.id ?? "");
  const initialDestination = branches[1]?.branchId ?? branches[0]?.branchId ?? "";
  const [destinationBranchId, setDestinationBranchId] = useState(initialDestination);
  const destinationBranch =
    branches.find((row) => row.branchId === destinationBranchId) ?? branches[0];
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(
    destinationBranch?.warehouses[0]?.id ?? "",
  );
  const [lines, setLines] = useState<Array<{ inventoryItemId: string; quantity: string }>>([
    { inventoryItemId: sourceBranch?.items[0]?.id ?? "", quantity: "" },
  ]);

  const setSourceBranch = (next: string) => {
    setSourceBranchId(next);
    const selected = branches.find((row) => row.branchId === next);
    setSourceWarehouseId(selected?.warehouses[0]?.id ?? "");
    setLines([{ inventoryItemId: selected?.items[0]?.id ?? "", quantity: "" }]);
  };
  const setDestinationBranch = (next: string) => {
    setDestinationBranchId(next);
    const selected = branches.find((row) => row.branchId === next);
    setDestinationWarehouseId(selected?.warehouses[0]?.id ?? "");
  };
  const valid =
    Boolean(sourceBranchId && sourceWarehouseId && destinationBranchId && destinationWarehouseId) &&
    (sourceBranchId !== destinationBranchId || sourceWarehouseId !== destinationWarehouseId) &&
    lines.length > 0 &&
    lines.every((line) => line.inventoryItemId && Number(line.quantity) > 0) &&
    new Set(lines.map((line) => line.inventoryItemId)).size === lines.length;

  return (
    <Panel className="mb-4">
      <PanelHead title="Request stock transfer" sub="Creating the request does not move stock" />
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <Field label="Source branch">
          <select value={sourceBranchId} onChange={(event) => setSourceBranch(event.target.value)} className={inputClass}>
            {branches.map((row) => <option key={row.branchId} value={row.branchId}>{row.branchId}</option>)}
          </select>
        </Field>
        <Field label="Source warehouse">
          <select value={sourceWarehouseId} onChange={(event) => setSourceWarehouseId(event.target.value)} className={inputClass}>
            {(sourceBranch?.warehouses ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
        <Field label="Destination branch">
          <select value={destinationBranchId} onChange={(event) => setDestinationBranch(event.target.value)} className={inputClass}>
            {branches.map((row) => <option key={row.branchId} value={row.branchId}>{row.branchId}</option>)}
          </select>
        </Field>
        <Field label="Destination warehouse">
          <select value={destinationWarehouseId} onChange={(event) => setDestinationWarehouseId(event.target.value)} className={inputClass}>
            {(destinationBranch?.warehouses ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-semibold">Transfer items</div>
          <Btn
            onClick={() =>
              setLines((current) => [
                ...current,
                { inventoryItemId: sourceBranch?.items[0]?.id ?? "", quantity: "" },
              ])
            }
          >
            Add item
          </Btn>
        </div>
        <div className="grid gap-2">
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
              <select
                value={line.inventoryItemId}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((value, rowIndex) =>
                      rowIndex === index ? { ...value, inventoryItemId: event.target.value } : value,
                    ),
                  )
                }
                className={inputClass}
              >
                {(sourceBranch?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {qty(item.quantity_available_minor)} {item.base_unit_symbol ?? "unit"} available
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={line.quantity}
                onChange={(event) =>
                  setLines((current) =>
                    current.map((value, rowIndex) =>
                      rowIndex === index ? { ...value, quantity: event.target.value } : value,
                    ),
                  )
                }
                className={inputClass}
                placeholder="Quantity"
              />
              <Btn
                disabled={lines.length === 1}
                onClick={() => setLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              >
                Remove
              </Btn>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Btn onClick={onCancel}>Cancel</Btn>
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() =>
            void onSubmit({
              sourceBranchId,
              sourceWarehouseId,
              destinationBranchId,
              destinationWarehouseId,
              idempotencyKey: crypto.randomUUID(),
              lines: lines.map((line) => ({
                inventoryItemId: line.inventoryItemId,
                quantityMicro: Math.round(Number(line.quantity) * 1_000_000),
              })),
            })
          }
        >
          Create transfer request
        </Btn>
      </div>
    </Panel>
  );
}

function ReceiptForm({
  shipmentId,
  lines,
  busy,
  onSubmit,
}: {
  shipmentId: string;
  lines: TransferDetail["lines"];
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const initial = useMemo(
    () =>
      lines.map((line) => {
        const exception =
          Number(line.damaged_quantity_micro ?? 0) +
          Number(line.rejected_quantity_micro ?? 0) +
          Number(line.missing_quantity_micro ?? 0);
        const outstanding = Math.max(
          0,
          Number(line.sent_quantity_minor ?? 0) -
            Number(line.received_quantity_minor ?? 0) -
            exception,
        );
        return {
          transferLineId: line.id,
          name: line.name,
          unit: line.unit_symbol ?? "unit",
          outstanding,
          received: String(outstanding / 1_000_000),
          damaged: "0",
          rejected: "0",
          missing: "0",
        };
      }),
    [lines],
  );
  const [receiptReference, setReceiptReference] = useState(
    `RCV-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`,
  );
  const [values, setValues] = useState(initial);
  const [final, setFinal] = useState(true);

  const update = (
    index: number,
    key: "received" | "damaged" | "rejected" | "missing",
    value: string,
  ) =>
    setValues((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    );

  const valid =
    receiptReference.trim().length > 0 &&
    values.length > 0 &&
    values.every((row) => {
      const accounted =
        micro(row.received) + micro(row.damaged) + micro(row.rejected) + micro(row.missing);
      return accounted > 0 && accounted <= row.outstanding;
    });

  return (
    <div className="border-t border-border p-4">
      <div className="mb-3 text-[12px] font-semibold">Receive shipment {shipmentId}</div>
      <Field label="Receipt reference">
        <input className={inputClass} value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} />
      </Field>
      <div className="mt-3 grid gap-3">
        {values.map((row, index) => (
          <div key={row.transferLineId} className="rounded-lg border border-border p-3">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-semibold">{row.name}</span>
              <span className="text-muted-foreground">{qty(row.outstanding)} {row.unit} outstanding</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniField label="Received" value={row.received} onChange={(value) => update(index, "received", value)} />
              <MiniField label="Damaged" value={row.damaged} onChange={(value) => update(index, "damaged", value)} />
              <MiniField label="Rejected" value={row.rejected} onChange={(value) => update(index, "rejected", value)} />
              <MiniField label="Missing" value={row.missing} onChange={(value) => update(index, "missing", value)} />
            </div>
          </div>
        ))}
      </div>
      <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <input type="checkbox" checked={final} onChange={(event) => setFinal(event.target.checked)} />
        Final receipt — every dispatched quantity must be accounted for
      </label>
      <div className="mt-3 flex justify-end">
        <Btn
          variant="primary"
          disabled={!valid || busy}
          onClick={() =>
            void onSubmit({
              receiptReference: receiptReference.trim(),
              idempotencyKey: crypto.randomUUID(),
              final,
              lines: values.map((row) => ({
                transferLineId: row.transferLineId,
                receivedQuantityMicro: micro(row.received),
                damagedQuantityMicro: micro(row.damaged),
                rejectedQuantityMicro: micro(row.rejected),
                missingQuantityMicro: micro(row.missing),
              })),
            })
          }
        >
          Post receipt
        </Btn>
      </div>
    </div>
  );
}

function MiniField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[10px] text-muted-foreground">
      {label}
      <input type="number" min="0" step="0.001" className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">{label}{children}</label>;
}
function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">{children}</div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">{children}</div>;
}
function qty(value: number) {
  return (Number(value ?? 0) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
function micro(value: string) {
  return Math.round(Math.max(0, Number(value || 0)) * 1_000_000);
}
const inputClass = "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary";
