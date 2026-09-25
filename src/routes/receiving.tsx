import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/receiving")({
  head: () => ({ meta: [{ title: "Receiving - Seramet" }] }),
  component: Receiving,
});

function Receiving() {
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const branch = control.data.find((row) => row.branchId === branchId) ?? control.data[0];

  const available = useMemo(
    () =>
      (branch?.procurement.purchaseOrders ?? []).filter((purchaseOrder) =>
        ["APPROVED", "PARTIALLY_RECEIVED"].includes(purchaseOrder.status),
      ),
    [branch],
  );

  const [selectedId, setSelectedId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!available.some((purchaseOrder) => purchaseOrder.id === selectedId)) {
      setSelectedId(available[0]?.id ?? "");
    }
  }, [available, selectedId]);

  const purchaseOrder = available.find((row) => row.id === selectedId) ?? available[0];

  useEffect(() => {
    if (!purchaseOrder) {
      setQuantities({});
      return;
    }

    setQuantities(
      Object.fromEntries(
        purchaseOrder.lines.map((line) => [
          line.id,
          Math.max(
            0,
            (Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor)) /
              1_000_000,
          ),
        ]),
      ),
    );
  }, [purchaseOrder]);

  const worksheet = (purchaseOrder?.lines ?? []).map((line) => {
    const remaining = Math.max(
      0,
      (Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor)) /
        1_000_000,
    );
    const receiveNow = Math.max(0, Number(quantities[line.id] ?? 0));

    return {
      ...line,
      remaining,
      receiveNow,
      valueMinor: Math.round(receiveNow * Number(line.unit_price_minor)),
    };
  });

  const expectedValueMinor = worksheet.reduce(
    (sum, line) => sum + line.remaining * Number(line.unit_price_minor),
    0,
  );
  const receivingValueMinor = worksheet.reduce((sum, line) => sum + line.valueMinor, 0);

  async function postReceipt() {
    if (!purchaseOrder) return;

    const lines = worksheet
      .filter((line) => line.receiveNow > 0)
      .map((line) => ({
        purchaseOrderLineId: line.id,
        receivedPurchaseQuantityMicro: Math.round(line.receiveNow * 1_000_000),
        acceptedPurchaseQuantityMicro: Math.round(line.receiveNow * 1_000_000),
        rejectedPurchaseQuantityMicro: 0,
        unitPriceMinor: Number(line.unit_price_minor),
        qualityStatus: "ACCEPTED",
      }));

    if (lines.length === 0) {
      setNotice("Enter at least one received quantity.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      await control.command("/api/seramet/procurement/goods-receipts", {
        branchId,
        warehouseId: purchaseOrder.warehouse_id,
        purchaseOrderId: purchaseOrder.id,
        supplierId: purchaseOrder.supplier_id,
        idempotencyKey: "receipt:" + purchaseOrder.id + ":" + crypto.randomUUID(),
        lines,
      });
      setNotice(
        "Goods receipt posted. Accepted quantities, inventory value and PO progress were updated atomically.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Receipt failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Receiving"
      subtitle={
        purchaseOrder
          ? purchaseOrder.purchase_order_number +
            " - " +
            purchaseOrder.supplier_name +
            " - " +
            branchLabel
          : "No approved purchase order awaiting receipt - " + branchLabel
      }
      actions={
        <>
          {available.length > 1 && (
            <select
              value={purchaseOrder?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold"
            >
              {available.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.purchase_order_number} - {row.supplier_name}
                </option>
              ))}
            </select>
          )}
          <Btn onClick={() => void control.refresh()}>Refresh</Btn>
          <Btn
            variant="primary"
            disabled={!purchaseOrder || busy}
            onClick={() => void postReceipt()}
          >
            Post receipt
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected value" value={Math.round(expectedValueMinor) / 100} money />
        <Metric label="Receive now" value={Math.round(receivingValueMinor) / 100} money />
        <Metric label="Open POs" value={available.length} />
        <Metric label="Lines checked" value={worksheet.length} />
      </div>

      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice}
        </div>
      )}

      <Panel className="mt-4 overflow-x-auto">
        <PanelHead
          title="Receiving worksheet"
          sub={
            control.error ||
            "Partial receipt, over-receipt policy and idempotency are enforced by the server"
          }
          right={<Status>{purchaseOrder?.status?.replaceAll("_", " ") ?? "WAITING"}</Status>}
        />
        {!purchaseOrder ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Approve a purchase order first.
          </div>
        ) : (
          <table className="w-full min-w-[820px]">
            <thead>
              <tr>
                <TH>Item</TH>
                <TH className="text-right">Ordered</TH>
                <TH className="text-right">Previously received</TH>
                <TH className="text-right">Remaining</TH>
                <TH className="text-right">Receive now</TH>
                <TH className="text-right">Value</TH>
              </tr>
            </thead>
            <tbody>
              {worksheet.map((line) => (
                <tr key={line.id}>
                  <TD className="font-semibold">{line.item_name}</TD>
                  <TD className="num text-right">
                    {(Number(line.ordered_quantity_minor) / 1_000_000).toFixed(3)}{" "}
                    {line.unit_symbol ?? ""}
                  </TD>
                  <TD className="num text-right">
                    {(Number(line.received_purchase_quantity_minor) / 1_000_000).toFixed(3)}
                  </TD>
                  <TD className="num text-right">{line.remaining.toFixed(3)}</TD>
                  <TD className="text-right">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={quantities[line.id] ?? 0}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.id]: Number(event.target.value),
                        }))
                      }
                      className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right"
                    />
                  </TD>
                  <TD className="num text-right font-semibold">{ksh(line.valueMinor / 100)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </AppShell>
  );
}
