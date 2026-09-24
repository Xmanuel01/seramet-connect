import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import {
  type ProcurementOrderRow,
  useProcurementControlCentre,
} from "@/procurement/use-procurement-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/receiving")({
  head: () => ({
    meta: [
      { title: "Receiving - Seramet" },
      {
        name: "description",
        content:
          "Authoritative goods receiving with partial receipts, accepted/rejected quantities and lot controls.",
      },
    ],
  }),
  component: Receiving,
});

type ReceiveLineState = {
  received: string;
  accepted: string;
  rejected: string;
  unitPrice: string;
  lotNumber: string;
  expiryDate: string;
  notes: string;
};

type DisplayOrder = ProcurementOrderRow & { branchId: string };

function Receiving() {
  const { branchId, branchLabel, currentUser, isAllBranches } = useAppContext();
  const control = useProcurementControlCentre(true);
  const [selectedId, setSelectedId] = useState("");
  const [lineState, setLineState] = useState<Record<string, ReceiveLineState>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const available = useMemo<DisplayOrder[]>(
    () =>
      control.data.flatMap((branch) =>
        branch.purchaseOrders
          .filter((po) => ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status))
          .map((po) => ({ ...po, branchId: branch.branchId })),
      ),
    [control.data],
  );

  useEffect(() => {
    if (!available.some((po) => po.id === selectedId)) {
      setSelectedId(available[0]?.id ?? "");
    }
  }, [available, selectedId]);

  const po = available.find((row) => row.id === selectedId) ?? available[0];

  useEffect(() => {
    if (!po) {
      setLineState({});
      return;
    }
    setLineState(
      Object.fromEntries(
        po.lines.map((line) => {
          const remainingMicro = Math.max(
            0,
            Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor),
          );
          const remaining = remainingMicro / 1_000_000;
          return [
            line.id,
            {
              received: remaining > 0 ? String(remaining) : "0",
              accepted: remaining > 0 ? String(remaining) : "0",
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
  }, [po?.id]);

  const worksheet =
    po?.lines.map((line) => {
      const state = lineState[line.id] ?? {
        received: "0",
        accepted: "0",
        rejected: "0",
        unitPrice: String(Number(line.unit_price_minor) / 100),
        lotNumber: "",
        expiryDate: "",
        notes: "",
      };
      const remainingMicro = Math.max(
        0,
        Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor),
      );
      const receivedMicro = Math.max(0, Math.round(Number(state.received || 0) * 1_000_000));
      const acceptedMicro = Math.max(0, Math.round(Number(state.accepted || 0) * 1_000_000));
      const rejectedMicro = Math.max(0, Math.round(Number(state.rejected || 0) * 1_000_000));
      const unitPriceMinor = Math.max(0, Math.round(Number(state.unitPrice || 0) * 100));
      const validQuantities =
        receivedMicro > 0 &&
        acceptedMicro + rejectedMicro <= receivedMicro &&
        acceptedMicro <= receivedMicro;
      return {
        ...line,
        state,
        remainingMicro,
        receivedMicro,
        acceptedMicro,
        rejectedMicro,
        unitPriceMinor,
        valueMinor: Math.round((acceptedMicro * unitPriceMinor) / 1_000_000),
        validQuantities,
      };
    }) ?? [];

  const activeLines = worksheet.filter((line) => line.receivedMicro > 0);
  const expectedMinor = worksheet.reduce(
    (sum, line) =>
      sum +
      Math.round(
        (line.remainingMicro * Number(line.unit_price_minor)) /
          1_000_000,
      ),
    0,
  );
  const acceptedMinor = activeLines.reduce((sum, line) => sum + line.valueMinor, 0);
  const rejectedQuantity = activeLines.reduce(
    (sum, line) => sum + line.rejectedMicro / 1_000_000,
    0,
  );
  const canReceive = currentUser.permissions.includes(permissions.procurementReceive);
  const validSubmission =
    Boolean(po) &&
    !isAllBranches &&
    canReceive &&
    activeLines.length > 0 &&
    activeLines.every((line) => line.validQuantities);

  const updateLine = (lineId: string, patch: Partial<ReceiveLineState>) => {
    setLineState((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] ?? {
          received: "0",
          accepted: "0",
          rejected: "0",
          unitPrice: "0",
          lotNumber: "",
          expiryDate: "",
          notes: "",
        }),
        ...patch,
      },
    }));
  };

  const postReceipt = async () => {
    if (!po || !validSubmission) return;
    setBusy(true);
    setNotice("");
    try {
      await control.command("/api/seramet/procurement/goods-receipts", {
        branchId: po.branchId,
        warehouseId: po.warehouse_id,
        purchaseOrderId: po.id,
        supplierId: po.supplier_id,
        idempotencyKey: crypto.randomUUID(),
        lines: activeLines.map((line) => ({
          purchaseOrderLineId: line.id,
          receivedPurchaseQuantityMicro: line.receivedMicro,
          acceptedPurchaseQuantityMicro: line.acceptedMicro,
          rejectedPurchaseQuantityMicro: line.rejectedMicro,
          unitPriceMinor: line.unitPriceMinor,
          ...(line.state.lotNumber.trim() ? { lotNumber: line.state.lotNumber.trim() } : {}),
          ...(line.state.expiryDate ? { expiryDate: line.state.expiryDate } : {}),
          ...(line.state.notes.trim() ? { notes: line.state.notes.trim() } : {}),
          qualityStatus: line.rejectedMicro > 0 ? "PARTIAL_REJECTION" : "ACCEPTED",
        })),
      });
      setNotice(
        `${po.purchase_order_number} receipt posted. Inventory, PO progress and supplier price history were updated.`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Goods receipt could not be posted");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Receiving"
      subtitle={po ? `${po.purchase_order_number} - ${po.supplier_name} - ${branchLabel}` : branchLabel}
      actions={
        <>
          <Btn onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          {available.length > 1 && (
            <select
              value={po?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
            >
              {available.map((row) => (
                <option key={`${row.branchId}:${row.id}`} value={row.id}>
                  {row.purchase_order_number} - {row.supplier_name}
                </option>
              ))}
            </select>
          )}
          <Btn
            variant="primary"
            disabled={!validSubmission || busy}
            onClick={() => void postReceipt()}
          >
            <PackageCheck className="h-4 w-4" /> Post receipt
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected value" value={expectedMinor / 100} money />
        <Metric label="Accepted value" value={acceptedMinor / 100} money />
        <Metric label="Rejected quantity" value={rejectedQuantity.toFixed(3)} />
        <Metric
          label="Lines receiving"
          value={`${activeLines.length}/${worksheet.filter((line) => line.remainingMicro > 0).length}`}
        />
      </div>

      {(notice || control.error || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            control.error ||
            "Receiving is transactional. Switch to a single branch before posting a goods receipt."}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Receiving worksheet"
          sub="Record what arrived, what was accepted and what was rejected before stock is posted"
          right={<Status>{po?.status ?? "WAITING"}</Status>}
        />
        {control.status === "loading" ? (
          <div className="p-6 text-[13px] text-muted-foreground">Loading approved purchase orders...</div>
        ) : !po ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            No approved or partially received purchase order is awaiting receipt.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1260px]">
              <thead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Ordered</TH>
                  <TH className="text-right">Previously received</TH>
                  <TH className="text-right">Remaining</TH>
                  <TH className="text-right">Arrived now</TH>
                  <TH className="text-right">Accepted</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH className="text-right">Unit cost</TH>
                  <TH>Lot</TH>
                  <TH>Expiry</TH>
                  <TH className="text-right">Accepted value</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {worksheet.map((line) => {
                  const remaining = line.remainingMicro / 1_000_000;
                  return (
                    <tr key={line.id}>
                      <TD className="font-semibold">{line.item_name}</TD>
                      <TD className="num text-right">
                        {(Number(line.ordered_quantity_minor) / 1_000_000).toLocaleString()}{" "}
                        {line.unit_symbol ?? "unit"}
                      </TD>
                      <TD className="num text-right text-muted-foreground">
                        {(Number(line.received_purchase_quantity_minor) / 1_000_000).toLocaleString()}{" "}
                        {line.unit_symbol ?? "unit"}
                      </TD>
                      <TD className="num text-right">
                        {remaining.toLocaleString()} {line.unit_symbol ?? "unit"}
                      </TD>
                      <TD className="text-right">
                        <QuantityInput
                          value={line.state.received}
                          max={remaining}
                          onChange={(value) => {
                            const next = Math.max(0, Number(value || 0));
                            updateLine(line.id, {
                              received: value,
                              accepted: String(Math.min(next, Number(line.state.accepted || 0))),
                            });
                          }}
                        />
                      </TD>
                      <TD className="text-right">
                        <QuantityInput
                          value={line.state.accepted}
                          max={Number(line.state.received || 0)}
                          onChange={(value) => updateLine(line.id, { accepted: value })}
                        />
                      </TD>
                      <TD className="text-right">
                        <QuantityInput
                          value={line.state.rejected}
                          max={Number(line.state.received || 0)}
                          onChange={(value) => updateLine(line.id, { rejected: value })}
                        />
                      </TD>
                      <TD className="text-right">
                        <input
                          inputMode="decimal"
                          value={line.state.unitPrice}
                          onChange={(event) => updateLine(line.id, { unitPrice: event.target.value })}
                          className={numberInputClass}
                        />
                      </TD>
                      <TD>
                        <input
                          value={line.state.lotNumber}
                          onChange={(event) => updateLine(line.id, { lotNumber: event.target.value })}
                          className={textInputClass}
                          placeholder="Optional"
                        />
                      </TD>
                      <TD>
                        <input
                          type="date"
                          value={line.state.expiryDate}
                          onChange={(event) => updateLine(line.id, { expiryDate: event.target.value })}
                          className={textInputClass}
                        />
                      </TD>
                      <TD className="num text-right font-semibold">{ksh(line.valueMinor / 100)}</TD>
                      <TD>
                        <Status>
                          {line.receivedMicro === 0
                            ? "SKIP"
                            : line.validQuantities
                              ? line.rejectedMicro > 0
                                ? "PARTIAL REJECTION"
                                : "READY"
                              : "CHECK QUANTITIES"}
                        </Status>
                      </TD>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}

function QuantityInput({
  value,
  max,
  onChange,
}: {
  value: string;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={Math.max(0, max)}
      step="0.001"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={numberInputClass}
    />
  );
}

const numberInputClass =
  "num h-8 w-24 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary";
const textInputClass =
  "h-8 w-28 rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:border-primary";
