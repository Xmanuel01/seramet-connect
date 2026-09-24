import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useInventoryOperations } from "@/inventory/use-inventory-operations";
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
          "Authoritative store and branch transfers with dispatch, partial receipt and variance capture.",
      },
    ],
  }),
  component: Transfers,
});

type TransferRow = {
  id: string;
  transfer_number: string;
  source_branch_id: string;
  destination_branch_id: string;
  source_warehouse_id: string;
  source_warehouse_name: string;
  destination_warehouse_id: string;
  destination_warehouse_name: string;
  status: string;
  shipment_id: string | null;
  shipment_status: string | null;
  item_count: number;
  sent_quantity_minor: number;
  received_quantity_minor: number;
  shortage_quantity_minor: number;
  transfer_value_minor: number;
  damaged_quantity_minor: number;
  rejected_quantity_minor: number;
  missing_quantity_minor: number;
  created_at: string;
};

type TransferDetail = {
  transfer: TransferRow & {
    source_warehouse_code: string;
    destination_warehouse_code: string;
  };
  lines: Array<{
    id: string;
    inventory_item_id: string;
    item_name: string;
    code: string;
    sku: string | null;
    unit_symbol: string | null;
    requested_quantity_minor: number;
    sent_quantity_minor: number;
    received_quantity_minor: number;
    shortage_quantity_minor: number;
    unit_cost_minor: number;
    damaged_quantity_minor: number;
    rejected_quantity_minor: number;
    missing_quantity_minor: number;
  }>;
  receipts: Array<{
    id: string;
    shipment_id: string;
    receipt_reference: string;
    received_by: string;
    received_at: string;
    variance_json: string;
  }>;
};

type StockPosition = {
  item_id: string;
  name: string;
  code: string;
  sku: string | null;
  unit_symbol: string | null;
  quantity_available_minor: number;
};

type DispatchLine = { inventoryItemId: string; quantity: string };
type ReceiptLine = {
  transferLineId: string;
  received: string;
  damaged: string;
  rejected: string;
  missing: string;
};

function Transfers() {
  const { branchLabel, branchRecords, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const { branchIds, request, post } = useInventoryOperations(authoritative);
  const control = useInventoryControlCentre(authoritative);
  const [rows, setRows] = useState<TransferRow[]>([]);
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [showForm, setShowForm] = useState(false);
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [sourceItems, setSourceItems] = useState<StockPosition[]>([]);
  const [lines, setLines] = useState<DispatchLine[]>([{ inventoryItemId: "", quantity: "" }]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<TransferDetail | null>(null);
  const [receiptReference, setReceiptReference] = useState("");
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [finalReceipt, setFinalReceipt] = useState(true);

  useEffect(() => {
    if (!sourceBranchId && control.data[0]?.branchId) {
      setSourceBranchId(control.data[0].branchId);
      setDestinationBranchId(control.data[0].branchId);
    }
  }, [control.data, sourceBranchId]);

  const load = useCallback(async () => {
    if (!authoritative) return;
    setStatus("loading");
    try {
      const result = await Promise.all(
        branchIds.map(async (branchId) => {
          const body = await request<{ transfers: TransferRow[] }>(
            `/api/seramet/inventory/transfers?branchId=${encodeURIComponent(branchId)}&limit=200`,
          );
          return body.transfers;
        }),
      );
      const deduplicated = [...new Map(result.flat().map((row) => [row.id, row])).values()];
      setRows(deduplicated);
      setStatus("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transfers could not be loaded");
      setStatus("error");
    }
  }, [authoritative, branchIds, request]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!authoritative || !sourceBranchId || !sourceWarehouseId) {
      setSourceItems([]);
      return;
    }
    let cancelled = false;
    void request<{ detail: { rows: StockPosition[] } }>(
      `/api/seramet/inventory/stock-detail?branchId=${encodeURIComponent(
        sourceBranchId,
      )}&warehouseId=${encodeURIComponent(sourceWarehouseId)}`,
    )
      .then((body) => {
        if (!cancelled) setSourceItems(body.detail.rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSourceItems([]);
          setNotice(error instanceof Error ? error.message : "Source stock could not be loaded");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authoritative, request, sourceBranchId, sourceWarehouseId]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!id) {
        setDetail(null);
        return;
      }
      try {
        const body = await request<{ detail: TransferDetail }>(
          `/api/seramet/inventory/transfers/${encodeURIComponent(id)}`,
        );
        setDetail(body.detail);
        setSelectedId(id);
        setReceiptReference(`RCV-${Date.now().toString(36).toUpperCase()}`);
        setReceiptLines(
          body.detail.lines
            .map((line) => {
              const outstanding =
                Number(line.sent_quantity_minor) -
                Number(line.received_quantity_minor) -
                Number(line.damaged_quantity_minor) -
                Number(line.rejected_quantity_minor) -
                Number(line.missing_quantity_minor);
              return {
                transferLineId: line.id,
                received: outstanding > 0 ? quantityInput(outstanding) : "0",
                damaged: "0",
                rejected: "0",
                missing: "0",
              };
            })
            .filter((line) => Number(line.received) > 0),
        );
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Transfer detail could not be loaded");
      }
    },
    [request],
  );

  const sourceBranch = control.data.find((row) => row.branchId === sourceBranchId);
  const destinationBranch = control.data.find((row) => row.branchId === destinationBranchId);
  const sourceWarehouses = sourceBranch?.warehouses ?? [];
  const destinationWarehouses = destinationBranch?.warehouses ?? [];
  const branchNames = new Map(branchRecords.map((branch) => [branch.id, branch.name]));

  const open = rows.filter((row) => !["RECEIVED", "CANCELLED"].includes(row.status)).length;
  const inTransit = rows.filter(
    (row) => row.status === "IN_TRANSIT" || row.shipment_status === "PARTIALLY_RECEIVED",
  ).length;
  const exceptionQty = rows.reduce(
    (sum, row) =>
      sum +
      Number(row.damaged_quantity_minor ?? 0) +
      Number(row.rejected_quantity_minor ?? 0) +
      Number(row.missing_quantity_minor ?? 0),
    0,
  );
  const transferValue = rows.reduce((sum, row) => sum + Number(row.transfer_value_minor ?? 0), 0);

  const selectedItems = useMemo(
    () => new Set(lines.map((line) => line.inventoryItemId).filter(Boolean)),
    [lines],
  );

  async function dispatch() {
    const payloadLines = lines
      .filter((line) => line.inventoryItemId && Number(line.quantity) > 0)
      .map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantityMicro: toMicro(line.quantity),
      }));
    if (
      !sourceBranchId ||
      !sourceWarehouseId ||
      !destinationBranchId ||
      !destinationWarehouseId ||
      payloadLines.length === 0
    ) {
      setNotice("Source, destination and at least one positive transfer line are required.");
      return;
    }
    try {
      const body = await post<{
        transfer: { id: string; shipmentId: string; accountingTreatment?: string };
      }>("/api/seramet/inventory/transfers/dispatch", {
        sourceBranchId,
        sourceWarehouseId,
        destinationBranchId,
        destinationWarehouseId,
        idempotencyKey: crypto.randomUUID(),
        lines: payloadLines,
      });
      setNotice(
        `Transfer dispatched. Source stock was removed and is now in transit${
          body.transfer.accountingTreatment ? ` (${body.transfer.accountingTreatment})` : ""
        }.`,
      );
      setShowForm(false);
      setLines([{ inventoryItemId: "", quantity: "" }]);
      await Promise.all([load(), control.refresh()]);
      await loadDetail(body.transfer.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transfer could not be dispatched");
    }
  }

  async function receive() {
    if (!detail?.transfer.shipment_id || !receiptReference.trim()) return;
    const payloadLines = receiptLines
      .map((line) => ({
        transferLineId: line.transferLineId,
        receivedQuantityMicro: toMicro(line.received),
        damagedQuantityMicro: toMicro(line.damaged),
        rejectedQuantityMicro: toMicro(line.rejected),
        missingQuantityMicro: toMicro(line.missing),
      }))
      .filter(
        (line) =>
          line.receivedQuantityMicro +
            line.damagedQuantityMicro +
            line.rejectedQuantityMicro +
            line.missingQuantityMicro >
          0,
      );
    if (!payloadLines.length) {
      setNotice("Enter at least one received or exception quantity.");
      return;
    }
    try {
      await post(
        `/api/seramet/inventory/transfer-shipments/${encodeURIComponent(
          detail.transfer.shipment_id,
        )}/receive`,
        {
          receiptReference: receiptReference.trim(),
          idempotencyKey: crypto.randomUUID(),
          final: finalReceipt,
          lines: payloadLines,
        },
      );
      setNotice(
        finalReceipt
          ? "Transfer receipt posted. Received stock is now available at destination."
          : "Partial transfer receipt posted. Remaining stock stays in transit.",
      );
      await Promise.all([load(), control.refresh(), loadDetail(detail.transfer.id)]);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Transfer receipt could not be posted");
    }
  }

  return (
    <AppShell
      title="Stock transfers"
      subtitle={`${branchLabel} - controlled dispatch, in-transit stock and destination receipt`}
      actions={
        <>
          <Btn onClick={() => exportTransfers(rows)}>Export</Btn>
          <Btn
            variant="primary"
            disabled={!authoritative || control.status !== "ready"}
            onClick={() => setShowForm((value) => !value)}
          >
            {showForm ? "Close form" : "New transfer"}
          </Btn>
        </>
      }
    >
      {(notice || status === "loading" || control.error) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error || "Loading authoritative stock transfers..."}
        </div>
      )}

      {showForm && (
        <Panel className="mb-4">
          <PanelHead
            title="Dispatch stock transfer"
            sub="Dispatch removes stock from source immediately; destination stock is added only when received"
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Source branch"
              value={sourceBranchId}
              disabled={!isAllBranches}
              onChange={(value) => {
                setSourceBranchId(value);
                setSourceWarehouseId("");
                setLines([{ inventoryItemId: "", quantity: "" }]);
              }}
              options={control.data.map((row) => ({
                value: row.branchId,
                label: branchNames.get(row.branchId) ?? row.branchId,
              }))}
            />
            <Select
              label="Source warehouse"
              value={sourceWarehouseId}
              onChange={(value) => {
                setSourceWarehouseId(value);
                setLines([{ inventoryItemId: "", quantity: "" }]);
              }}
              options={sourceWarehouses.map((row) => ({ value: row.id, label: row.name }))}
            />
            <Select
              label="Destination branch"
              value={destinationBranchId}
              disabled={!isAllBranches}
              onChange={(value) => {
                setDestinationBranchId(value);
                setDestinationWarehouseId("");
              }}
              options={control.data.map((row) => ({
                value: row.branchId,
                label: branchNames.get(row.branchId) ?? row.branchId,
              }))}
            />
            <Select
              label="Destination warehouse"
              value={destinationWarehouseId}
              onChange={setDestinationWarehouseId}
              options={destinationWarehouses
                .filter(
                  (row) => row.id !== sourceWarehouseId || destinationBranchId !== sourceBranchId,
                )
                .map((row) => ({ value: row.id, label: row.name }))}
            />
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="mb-2 text-[12px] font-semibold">Transfer lines</div>
            <div className="grid gap-2">
              {lines.map((line, index) => {
                const selected = sourceItems.find((item) => item.item_id === line.inventoryItemId);
                return (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                    <select
                      value={line.inventoryItemId}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, inventoryItemId: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      className={inputClass}
                    >
                      <option value="">Select item</option>
                      {sourceItems.map((item) => (
                        <option
                          key={item.item_id}
                          value={item.item_id}
                          disabled={
                            selectedItems.has(item.item_id) && line.inventoryItemId !== item.item_id
                          }
                        >
                          {item.name} · available {quantity(item.quantity_available_minor)}{" "}
                          {item.unit_symbol ?? ""}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.quantity}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((entry, lineIndex) =>
                            lineIndex === index
                              ? { ...entry, quantity: event.target.value }
                              : entry,
                          ),
                        )
                      }
                      placeholder={
                        selected ? `Max ${quantity(selected.quantity_available_minor)}` : "Quantity"
                      }
                      className={inputClass}
                    />
                    <Btn
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))
                      }
                    >
                      Remove
                    </Btn>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between gap-2">
              <Btn
                onClick={() =>
                  setLines((current) => [...current, { inventoryItemId: "", quantity: "" }])
                }
              >
                Add line
              </Btn>
              <Btn variant="primary" onClick={() => void dispatch()}>
                Dispatch transfer
              </Btn>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Open transfers" value={open} />
        <Metric label="In transit" value={inTransit} invert={inTransit > 0} />
        <Metric
          label="Exception quantity"
          value={quantity(exceptionQty)}
          invert={exceptionQty > 0}
        />
        <Metric label="Transfer value" value={transferValue / 100} money />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel>
          <PanelHead
            title="Transfer register"
            sub="Select a transfer to inspect lines and receipts"
          />
          <DataTable
            cols={[
              "Transfer",
              "From",
              "To",
              { l: "Items", r: true },
              { l: "Value", r: true },
              "Status",
            ]}
          >
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`cursor-pointer hover:bg-secondary/50 ${
                  selectedId === row.id ? "bg-secondary/50" : ""
                }`}
                onClick={() => void loadDetail(row.id)}
              >
                <TD className="num font-semibold">{row.transfer_number}</TD>
                <TD>
                  <div>{row.source_warehouse_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {branchNames.get(row.source_branch_id) ?? row.source_branch_id}
                  </div>
                </TD>
                <TD>
                  <div>{row.destination_warehouse_name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {branchNames.get(row.destination_branch_id) ?? row.destination_branch_id}
                  </div>
                </TD>
                <TD className="num text-right">{row.item_count}</TD>
                <TD className="num text-right font-semibold">
                  {ksh(Number(row.transfer_value_minor ?? 0) / 100)}
                </TD>
                <TD>
                  <Status>{row.shipment_status ?? row.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>

        <Panel>
          <PanelHead
            title={detail ? detail.transfer.transfer_number : "Transfer details"}
            sub={detail ? "Dispatch and destination receipt trail" : "Select a transfer"}
          />
          {!detail ? (
            <div className="p-8 text-center text-[12px] text-muted-foreground">
              Select a transfer to view item lines and receipt controls.
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-2 gap-3 border-b border-border p-4 text-[12px]">
                <div>
                  <div className="text-muted-foreground">Source</div>
                  <div className="font-semibold">{detail.transfer.source_warehouse_name}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Destination</div>
                  <div className="font-semibold">{detail.transfer.destination_warehouse_name}</div>
                </div>
              </div>
              <DataTable cols={["Item", { l: "Sent", r: true }, { l: "Received", r: true }]}>
                {detail.lines.map((line) => (
                  <tr key={line.id}>
                    <TD>{line.item_name}</TD>
                    <TD className="num text-right">{quantity(line.sent_quantity_minor)}</TD>
                    <TD className="num text-right">{quantity(line.received_quantity_minor)}</TD>
                  </tr>
                ))}
              </DataTable>

              {detail.transfer.shipment_id &&
                ["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(
                  detail.transfer.shipment_status ?? detail.transfer.status,
                ) && (
                  <div className="border-t border-border p-4">
                    <div className="mb-3 text-[12px] font-semibold">Receive shipment</div>
                    <label className="mb-3 grid gap-1 text-[11px] font-semibold text-muted-foreground">
                      Receipt reference
                      <input
                        value={receiptReference}
                        onChange={(event) => setReceiptReference(event.target.value)}
                        className={inputClass}
                      />
                    </label>
                    <div className="grid gap-3">
                      {receiptLines.map((line) => {
                        const source = detail.lines.find((row) => row.id === line.transferLineId);
                        return (
                          <div
                            key={line.transferLineId}
                            className="rounded-md border border-border p-3"
                          >
                            <div className="mb-2 text-[12px] font-semibold">
                              {source?.item_name ?? line.transferLineId}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {(
                                [
                                  ["received", "Received"],
                                  ["damaged", "Damaged"],
                                  ["rejected", "Rejected"],
                                  ["missing", "Missing"],
                                ] as const
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  className="grid gap-1 text-[10px] font-semibold text-muted-foreground"
                                >
                                  {label}
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.001"
                                    value={line[key]}
                                    onChange={(event) =>
                                      setReceiptLines((current) =>
                                        current.map((entry) =>
                                          entry.transferLineId === line.transferLineId
                                            ? { ...entry, [key]: event.target.value }
                                            : entry,
                                        ),
                                      )
                                    }
                                    className={inputClass}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-[12px]">
                      <input
                        type="checkbox"
                        checked={finalReceipt}
                        onChange={(event) => setFinalReceipt(event.target.checked)}
                      />
                      Final receipt — all dispatched quantities are accounted for
                    </label>
                    <Btn className="mt-3 w-full" variant="primary" onClick={() => void receive()}>
                      Post receipt
                    </Btn>
                  </div>
                )}

              {detail.receipts.length > 0 && (
                <div className="border-t border-border p-4">
                  <div className="mb-2 text-[12px] font-semibold">Receipt history</div>
                  <div className="grid gap-2">
                    {detail.receipts.map((receipt) => (
                      <div
                        key={receipt.id}
                        className="rounded-md border border-border px-3 py-2 text-[11px]"
                      >
                        <div className="font-semibold">{receipt.receipt_reference}</div>
                        <div className="text-muted-foreground">
                          {new Date(receipt.received_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      >
        <option value="">Select {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function quantity(value: number) {
  return (Number(value ?? 0) / 1_000_000).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function quantityInput(value: number) {
  return String(Number(value ?? 0) / 1_000_000);
}

function toMicro(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1_000_000) : 0;
}

function exportTransfers(rows: TransferRow[]) {
  const data = [
    ["transfer", "source", "destination", "status", "items", "value", "sent", "received"],
    ...rows.map((row) => [
      row.transfer_number,
      row.source_warehouse_name,
      row.destination_warehouse_name,
      row.shipment_status ?? row.status,
      row.item_count,
      row.transfer_value_minor / 100,
      row.sent_quantity_minor / 1_000_000,
      row.received_quantity_minor / 1_000_000,
    ]),
  ];
  const csv = data
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `seramet-transfers-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(href);
}

const inputClass =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary disabled:opacity-60";
