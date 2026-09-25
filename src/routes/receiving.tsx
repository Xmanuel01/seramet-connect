import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw, RotateCcw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { formatDate, formatNumber, ksh } from "@/lib/currency";
import { useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import {
  type ProcurementOrderRow,
  useInventoryControlCentre,
} from "@/inventory/use-inventory-control-centre";

export const Route = createFileRoute("/receiving")({
  head: () => ({
    meta: [
      { title: "Receiving - Seramet" },
      {
        name: "description",
        content:
          "Authoritative goods receiving with quantity, price, quality, lot and expiry controls.",
      },
    ],
  }),
  component: Receiving,
});

type ReceiptLineDraft = {
  received: string;
  rejected: string;
  unitPrice: string;
  lotNumber: string;
  expiryDate: string;
  notes: string;
};

function Receiving() {
  const { branchId, branchLabel } = useAppContext();
  const { persistenceMode, backendStatus } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const data = control.data.find((row) => row.branchId === branchId) ?? control.data[0];

  const available = useMemo(
    () =>
      (data?.procurement.purchaseOrders ?? []).filter((row) =>
        ["APPROVED", "PARTIALLY_RECEIVED"].includes(row.status),
      ),
    [data?.procurement.purchaseOrders],
  );

  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Record<string, ReceiptLineDraft>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available.some((row) => row.id === selectedId)) {
      setSelectedId(available[0]?.id ?? "");
    }
  }, [available, selectedId]);

  const po = available.find((row) => row.id === selectedId) ?? available[0];
  const poRevision =
    po?.lines.map((line) => `${line.id}:${line.received_purchase_quantity_minor}`).join("|") ??
    "";

  const resetDraft = () => {
    if (!po) {
      setDraft({});
      return;
    }
    setDraft(
      Object.fromEntries(
        po.lines.map((line) => {
          const remainingMicro = Math.max(
            0,
            Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor),
          );
          return [
            line.id,
            {
              received: String(remainingMicro / 1_000_000),
              rejected: "0",
              unitPrice: String(Number(line.unit_price_minor) / 100),
              lotNumber: "",
              expiryDate: "",
              notes: "",
            },
          ];
        }),
      ),
    );
  };

  useEffect(() => {
    resetDraft();
    setIdempotencyKey(crypto.randomUUID());
  }, [po?.id, poRevision]);

  const worksheet =
    po?.lines.map((line) => {
      const entry = draft[line.id] ?? emptyDraft(line);
      const received = nonNegativeNumber(entry.received);
      const rejected = Math.min(received, nonNegativeNumber(entry.rejected));
      const accepted = Math.max(0, received - rejected);
      const unitPrice = nonNegativeNumber(entry.unitPrice);
      const orderedMicro = Number(line.ordered_quantity_minor);
      const previouslyReceivedMicro = Number(line.received_purchase_quantity_minor);
      const remainingMicro = Math.max(0, orderedMicro - previouslyReceivedMicro);
      const acceptedMicro = Math.round(accepted * 1_000_000);
      const receivedMicro = Math.round(received * 1_000_000);
      const rejectedMicro = Math.round(rejected * 1_000_000);
      const maxAcceptedMicro = receiptAcceptedLimitMicro(po, line);
      const item = data?.items.find((row) => row.id === line.inventory_item_id);
      const expiryRequired = Boolean(item?.track_expiry && acceptedMicro > 0);
      const hasTraceability =
        !expiryRequired || Boolean(entry.lotNumber.trim() && entry.expiryDate);
      const withinPolicy = !Number.isFinite(maxAcceptedMicro) || acceptedMicro <= maxAcceptedMicro;
      const valid =
        receivedMicro > 0 &&
        rejectedMicro <= receivedMicro &&
        withinPolicy &&
        unitPrice >= 0 &&
        hasTraceability;
      const valueMinor = Math.round(accepted * unitPrice * 100);
      const orderedPrice = Number(line.unit_price_minor) / 100;
      const priceVariance = unitPrice - orderedPrice;
      return {
        ...line,
        entry,
        item,
        received,
        rejected,
        accepted,
        receivedMicro,
        rejectedMicro,
        acceptedMicro,
        remainingMicro,
        maxAcceptedMicro,
        unitPrice,
        valueMinor,
        priceVariance,
        expiryRequired,
        withinPolicy,
        valid,
      };
    }) ?? [];

  const expectedMinor = worksheet.reduce(
    (sum, line) =>
      sum + Math.round((line.remainingMicro * Number(line.unit_price_minor)) / 1_000_000),
    0,
  );
  const acceptedMinor = worksheet.reduce((sum, line) => sum + line.valueMinor, 0);
  const rejectedLines = worksheet.filter((line) => line.rejectedMicro > 0).length;
  const postingLines = worksheet.filter((line) => line.receivedMicro > 0);
  const invalidLines = postingLines.filter((line) => !line.valid);
  const receipts = data?.procurement.receipts ?? [];

  const patchLine = (lineId: string, patch: Partial<ReceiptLineDraft>) => {
    setDraft((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] ?? emptyDraft(po?.lines.find((line) => line.id === lineId))),
        ...patch,
      },
    }));
  };

  const postReceipt = async () => {
    if (!po || !postingLines.length || invalidLines.length || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await control.command("/api/seramet/procurement/goods-receipts", {
        branchId,
        warehouseId: po.warehouse_id,
        purchaseOrderId: po.id,
        supplierId: po.supplier_id,
        idempotencyKey,
        lines: postingLines.map((line) => ({
          purchaseOrderLineId: line.id,
          receivedPurchaseQuantityMicro: line.receivedMicro,
          acceptedPurchaseQuantityMicro: line.acceptedMicro,
          rejectedPurchaseQuantityMicro: line.rejectedMicro,
          unitPriceMinor: Math.round(line.unitPrice * 100),
          ...(line.entry.lotNumber.trim() ? { lotNumber: line.entry.lotNumber.trim() } : {}),
          ...(line.entry.expiryDate ? { expiryDate: line.entry.expiryDate } : {}),
          qualityStatus:
            line.rejectedMicro > 0
              ? line.acceptedMicro > 0
                ? "PARTIAL_REJECTION"
                : "REJECTED"
              : "ACCEPTED",
          ...(line.entry.notes.trim() ? { notes: line.entry.notes.trim() } : {}),
        })),
      });
      setNotice(
        `${po.purchase_order_number} receipt posted. Inventory, supplier pricing and PO progress were updated.`,
      );
      setIdempotencyKey(crypto.randomUUID());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Goods receipt could not be posted");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Receiving"
      subtitle={
        po
          ? `${po.purchase_order_number} - ${po.supplier_name} - ${branchLabel}`
          : `No approved purchase order awaiting receipt - ${branchLabel}`
      }
      actions={
        <>
          <Link to="/purchase-orders">
            <Btn>Purchase orders</Btn>
          </Link>
          <Btn disabled={!authoritative} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn disabled={!po || busy} onClick={resetDraft}>
            <RotateCcw className="h-4 w-4" /> Reset
          </Btn>
          <Btn
            variant="primary"
            disabled={
              !authoritative ||
              !po || busy || postingLines.length === 0 ||
              invalidLines.length > 0
            }
            onClick={() => void postReceipt()}
          >
            <PackageCheck className="h-4 w-4" /> Post receipt
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected remaining" value={Math.round(expectedMinor / 100)} money />
        <Metric label="Accepted now" value={Math.round(acceptedMinor / 100)} money />
        <Metric label="Rejected lines" value={rejectedLines} invert={rejectedLines > 0} />
        <Metric
          label="Lines ready"
          value={`${postingLines.length - invalidLines.length}/${postingLines.length}`}
          invert={invalidLines.length > 0}
        />
      </div>

      {(!authoritative || notice || control.error) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {!authoritative
            ? `Receiving requires the authoritative server database. Backend: ${backendStatus}.`
            : notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Receiving worksheet"
          sub="Record the physical delivery, rejected quantity, actual supplier price and traceability before posting"
          right={
            available.length > 1 ? (
              <select
                value={po?.id ?? ""}
                onChange={(event) => setSelectedId(event.target.value)}
                className="h-9 rounded-md border border-border bg-card px-3 text-[12px] font-semibold outline-none"
              >
                {available.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.purchase_order_number} - {row.supplier_name}
                  </option>
                ))}
              </select>
            ) : (
              <Status>{po ? displayStatus(po.status) : "Waiting"}</Status>
            )
          }
        />

        {!po ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Approve a purchase order first. Approved and partially received orders will appear here
            automatically.
          </div>
        ) : (
          <>
            <div className="grid gap-3 border-b border-border px-4 py-3 sm:grid-cols-4">
              <Info label="Supplier" value={po.supplier_name} />
              <Info label="Warehouse" value={warehouseName(data, po.warehouse_id)} />
              <Info
                label="Expected"
                value={po.expected_at ? formatDate(po.expected_at) : "Not specified"}
              />
              <Info label="Over-receipt" value={overReceiptLabel(po)} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px]">
                <thead>
                  <tr>
                    <TH>Item</TH>
                    <TH className="text-right">Ordered</TH>
                    <TH className="text-right">Previously received</TH>
                    <TH className="text-right">Remaining</TH>
                    <TH className="text-right">Receive now</TH>
                    <TH className="text-right">Reject</TH>
                    <TH className="text-right">Accept</TH>
                    <TH className="text-right">Unit price</TH>
                    <TH>Lot / batch</TH>
                    <TH>Expiry</TH>
                    <TH>Notes</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {worksheet.map((line) => {
                    const unit = line.unit_symbol ?? "unit";
                    const status = line.valid
                      ? line.rejectedMicro > 0
                        ? "Exception"
                        : "Ready"
                      : line.receivedMicro === 0
                        ? "Skipped"
                        : "Attention";
                    return (
                      <tr key={line.id}>
                        <TD>
                          <div className="font-semibold">{line.item_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {line.sku ?? "No SKU"}
                            {line.expiryRequired ? " · lot + expiry required" : ""}
                          </div>
                        </TD>
                        <TD className="num text-right">
                          {quantity(line.ordered_quantity_minor)} {unit}
                        </TD>
                        <TD className="num text-right">
                          {quantity(line.received_purchase_quantity_minor)} {unit}
                        </TD>
                        <TD className="num text-right">
                          {quantity(line.remainingMicro)} {unit}
                        </TD>
                        <TD className="text-right">
                          <QuantityInput
                            value={line.entry.received}
                            unit={unit}
                            onChange={(value) => patchLine(line.id, { received: value })}
                          />
                        </TD>
                        <TD className="text-right">
                          <QuantityInput
                            value={line.entry.rejected}
                            unit={unit}
                            onChange={(value) => patchLine(line.id, { rejected: value })}
                          />
                        </TD>
                        <TD className="num text-right font-semibold">
                          {formatNumber(line.accepted, { maximumFractionDigits: 3 })} {unit}
                        </TD>
                        <TD className="text-right">
                          <input
                            inputMode="decimal"
                            value={line.entry.unitPrice}
                            onChange={(event) =>
                              patchLine(line.id, { unitPrice: event.target.value })
                            }
                            className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary"
                          />
                          {Math.abs(line.priceVariance) > 0.001 && (
                            <div className="mt-1 text-[10px] text-warning">
                              {line.priceVariance > 0 ? "+" : ""}
                              {ksh(line.priceVariance)}
                            </div>
                          )}
                        </TD>
                        <TD>
                          <input
                            value={line.entry.lotNumber}
                            onChange={(event) =>
                              patchLine(line.id, { lotNumber: event.target.value })
                            }
                            className={inputClass}
                            placeholder={line.expiryRequired ? "Required" : "Optional"}
                          />
                        </TD>
                        <TD>
                          <input
                            type="date"
                            value={line.entry.expiryDate}
                            onChange={(event) =>
                              patchLine(line.id, { expiryDate: event.target.value })
                            }
                            className={inputClass}
                          />
                        </TD>
                        <TD>
                          <input
                            value={line.entry.notes}
                            onChange={(event) => patchLine(line.id, { notes: event.target.value })}
                            className={inputClass}
                            placeholder="Optional"
                          />
                        </TD>
                        <TD>
                          <Status>{status}</Status>
                          {!line.withinPolicy && (
                            <div className="mt-1 max-w-36 text-[10px] text-destructive">
                              Accepted quantity exceeds this PO's over-receipt policy.
                            </div>
                          )}
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <div className="text-[12px] text-muted-foreground">
                Receipt key <span className="num">{idempotencyKey.slice(0, 8)}</span>
              </div>
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Accepted value
                </div>
                <div className="num text-[18px] font-bold">{ksh(acceptedMinor / 100)}</div>
              </div>
            </div>
          </>
        )}
      </Panel>

      <Panel className="mt-4">
        <PanelHead title="Receipt history" sub="Posted goods receipts for this branch" />
        {!receipts.length ? (
          <div className="p-6 text-center text-[12px] text-muted-foreground">
            No goods receipts have been posted in this branch yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px]">
              <thead>
                <tr>
                  <TH>Receipt</TH>
                  <TH>Purchase order</TH>
                  <TH>Supplier</TH>
                  <TH>Business date</TH>
                  <TH className="text-right">Lines</TH>
                  <TH className="text-right">Value</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <TD className="num font-semibold">{receipt.receipt_number}</TD>
                    <TD className="num">{receipt.purchase_order_number}</TD>
                    <TD>{receipt.supplier_name}</TD>
                    <TD className="text-muted-foreground">{formatDate(receipt.business_date)}</TD>
                    <TD className="num text-right">{Number(receipt.line_count)}</TD>
                    <TD className="num text-right font-semibold">
                      {ksh(Number(receipt.total_minor) / 100)}
                    </TD>
                    <TD>
                      <Status>{displayStatus(receipt.status)}</Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}

type BranchData = ReturnType<typeof useInventoryControlCentre>["data"][number];

function emptyDraft(line?: ProcurementOrderRow["lines"][number]): ReceiptLineDraft {
  if (!line) {
    return {
      received: "0",
      rejected: "0",
      unitPrice: "0",
      lotNumber: "",
      expiryDate: "",
      notes: "",
    };
  }
  const remainingMicro = Math.max(
    0,
    Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor),
  );
  return {
    received: String(remainingMicro / 1_000_000),
    rejected: "0",
    unitPrice: String(Number(line.unit_price_minor) / 100),
    lotNumber: "",
    expiryDate: "",
    notes: "",
  };
}

function receiptAcceptedLimitMicro(
  order: ProcurementOrderRow,
  line: ProcurementOrderRow["lines"][number],
) {
  const ordered = Number(line.ordered_quantity_minor);
  const received = Number(line.received_purchase_quantity_minor);
  if (order.over_receipt_policy === "ALLOW_WITH_APPROVAL") return Number.POSITIVE_INFINITY;
  if (order.over_receipt_policy === "ALLOW_WITH_TOLERANCE") {
    const maximum = Math.floor(
      (ordered * (10_000 + Number(order.over_receipt_tolerance_bps))) / 10_000,
    );
    return Math.max(0, maximum - received);
  }
  return Math.max(0, ordered - received);
}

function overReceiptLabel(order: ProcurementOrderRow) {
  if (order.over_receipt_policy === "ALLOW_WITH_APPROVAL") return "Allowed with approval";
  if (order.over_receipt_policy === "ALLOW_WITH_TOLERANCE") {
    return `Tolerance ${formatNumber(Number(order.over_receipt_tolerance_bps) / 100, {
      maximumFractionDigits: 2,
    })}%`;
  }
  return "Not allowed";
}

function QuantityInput({
  value,
  unit,
  onChange,
}: {
  value: string;
  unit: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="num h-8 w-24 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary"
      />
      <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>
    </>
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

function nonNegativeNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function displayStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function warehouseName(data: BranchData | undefined, id: string) {
  return data?.warehouses.find((row) => row.id === id)?.name ?? id;
}

const inputClass =
  "h-8 w-32 rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:border-primary";
