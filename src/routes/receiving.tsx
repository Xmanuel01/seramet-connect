import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/receiving")({
  head: () => ({
    meta: [
      { title: "Receiving - Seramet" },
      {
        name: "description",
        content: "Authoritative goods receiving with accepted, rejected and variance quantities.",
      },
    ],
  }),
  component: Receiving,
});

function Receiving() {
  const { branchId, branchLabel } = useAppContext();
  const control = useInventoryControlCentre(true);
  const data = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const available = useMemo(
    () =>
      (data?.procurement.purchaseOrders ?? []).filter((po) =>
        ["APPROVED", "PARTIALLY_RECEIVED", "PARTIAL"].includes(po.status),
      ),
    [data?.procurement.purchaseOrders],
  );
  const [selectedId, setSelectedId] = useState("");
  const [received, setReceived] = useState<Record<string, number>>({});
  const [rejected, setRejected] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available.some((po) => po.id === selectedId)) setSelectedId(available[0]?.id ?? "");
  }, [available, selectedId]);

  const po = available.find((item) => item.id === selectedId) ?? available[0];

  useEffect(() => {
    if (!po) {
      setReceived({});
      setRejected({});
      return;
    }
    setReceived(
      Object.fromEntries(
        po.lines.map((line) => [
          line.id,
          Math.max(
            0,
            (Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor)) /
              1_000_000,
          ),
        ]),
      ),
    );
    setRejected(Object.fromEntries(po.lines.map((line) => [line.id, 0])));
  }, [po]);

  const worksheet =
    po?.lines.map((line) => {
      const remainingMicro = Math.max(
        0,
        Number(line.ordered_quantity_minor) - Number(line.received_purchase_quantity_minor),
      );
      const receiveMicro = Math.max(0, Math.round((received[line.id] ?? 0) * 1_000_000));
      const rejectedMicro = Math.max(
        0,
        Math.min(receiveMicro, Math.round((rejected[line.id] ?? 0) * 1_000_000)),
      );
      const acceptedMicro = Math.max(0, receiveMicro - rejectedMicro);
      return {
        ...line,
        remainingMicro,
        receiveMicro,
        rejectedMicro,
        acceptedMicro,
        valueMinor: Math.round((acceptedMicro * Number(line.unit_price_minor)) / 1_000_000),
        over: Math.max(0, receiveMicro - remainingMicro),
      };
    }) ?? [];

  const expectedMinor = worksheet.reduce(
    (sum, line) =>
      sum + Math.round((line.remainingMicro * Number(line.unit_price_minor)) / 1_000_000),
    0,
  );
  const acceptedMinor = worksheet.reduce((sum, line) => sum + line.valueMinor, 0);
  const rejectedCount = worksheet.filter((line) => line.rejectedMicro > 0).length;
  const overCount = worksheet.filter((line) => line.over > 0).length;

  const postReceipt = async () => {
    if (!po) return;
    const lines = worksheet
      .filter((line) => line.receiveMicro > 0)
      .map((line) => ({
        purchaseOrderLineId: line.id,
        receivedPurchaseQuantityMicro: line.receiveMicro,
        acceptedPurchaseQuantityMicro: line.acceptedMicro,
        ...(line.rejectedMicro > 0 ? { rejectedPurchaseQuantityMicro: line.rejectedMicro } : {}),
        unitPriceMinor: Number(line.unit_price_minor),
        qualityStatus: line.rejectedMicro > 0 ? "PARTIAL_REJECTION" : "ACCEPTED",
      }));
    if (!lines.length) {
      setNotice("Enter at least one received quantity before posting.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await control.command("/api/seramet/procurement/goods-receipts", {
        branchId,
        warehouseId: po.warehouse_id,
        purchaseOrderId: po.id,
        supplierId: po.supplier_id,
        idempotencyKey: crypto.randomUUID(),
        lines,
      });
      setNotice(`${po.purchase_order_number} receipt posted. Inventory and PO progress were updated.`);
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
          {available.length > 1 && (
            <select
              value={po?.id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] font-semibold outline-none"
            >
              {available.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.purchase_order_number} - {item.supplier_name}
                </option>
              ))}
            </select>
          )}
          <Btn disabled={control.status === "loading"} onClick={() => void control.refresh()}>
            Refresh
          </Btn>
          <Btn variant="primary" disabled={!po || busy || overCount > 0} onClick={() => void postReceipt()}>
            Post receipt
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected value" value={expectedMinor / 100} money />
        <Metric label="Accepted value" value={acceptedMinor / 100} money />
        <Metric label="Rejected lines" value={rejectedCount} invert={rejectedCount > 0} />
        <Metric label="Over-receipt lines" value={overCount} invert={overCount > 0} />
      </div>

      {(notice || control.error) && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Receiving worksheet"
          sub="Record actual delivered quantity and separate accepted from rejected stock before posting."
          right={<Status>{po?.status ?? "WAITING"}</Status>}
        />
        {!po ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Approve a purchase order first. It will appear here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Remaining</TH>
                  <TH className="text-right">Receive now</TH>
                  <TH className="text-right">Reject</TH>
                  <TH className="text-right">Accept</TH>
                  <TH className="text-right">Accepted value</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {worksheet.map((line) => (
                  <tr key={line.id}>
                    <TD className="font-semibold">{line.item_name}</TD>
                    <TD className="num text-right">
                      {quantity(line.remainingMicro)} {line.unit_symbol ?? ""}
                    </TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.001"
                        value={received[line.id] ?? 0}
                        onChange={(event) =>
                          setReceived((current) => ({
                            ...current,
                            [line.id]: Number(event.target.value),
                          }))
                        }
                        className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary"
                      />
                    </TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        min={0}
                        max={received[line.id] ?? 0}
                        step="0.001"
                        value={rejected[line.id] ?? 0}
                        onChange={(event) =>
                          setRejected((current) => ({
                            ...current,
                            [line.id]: Number(event.target.value),
                          }))
                        }
                        className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary"
                      />
                    </TD>
                    <TD className="num text-right">
                      {quantity(line.acceptedMicro)} {line.unit_symbol ?? ""}
                    </TD>
                    <TD className="num text-right font-semibold">{ksh(line.valueMinor / 100)}</TD>
                    <TD>
                      <Status>
                        {line.over > 0
                          ? "OVER RECEIPT"
                          : line.rejectedMicro > 0
                            ? "PARTIAL REJECTION"
                            : "READY"}
                      </Status>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {overCount > 0 && (
        <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
          One or more lines exceed the remaining ordered quantity. The receipt is blocked here instead of silently bypassing the PO over-receipt policy.
        </div>
      )}
    </AppShell>
  );
}

function quantity(value: number) {
  return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 3 }).format(value / 1_000_000);
}
