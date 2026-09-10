import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";

export const Route = createFileRoute("/receiving")({
  head: () => ({ meta: [{ title: "Receiving - Seramet" }] }),
  component: Receiving,
});

function Receiving() {
  const { branch, currentUser, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const available = useMemo(
    () =>
      state.purchaseOrders.filter(
        (po) =>
          matchesBranch(po.branchId ?? po.branch) &&
          (po.status === "APPROVED" || po.status === "PARTIAL"),
      ),
    [matchesBranch, state.purchaseOrders],
  );
  const [selectedId, setSelectedId] = useState("");
  const [received, setReceived] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!available.some((po) => po.id === selectedId)) setSelectedId(available[0]?.id ?? "");
  }, [available, selectedId]);

  const po = available.find((item) => item.id === selectedId) ?? available[0];

  useEffect(() => {
    if (!po) {
      setReceived({});
      return;
    }
    setReceived(
      Object.fromEntries(
        po.lines.map((line) => [line.sku, Math.max(0, line.quantity - line.receivedQuantity)]),
      ),
    );
  }, [po]);

  const worksheet =
    po?.lines.map((line) => {
      const remaining = Math.max(0, line.quantity - line.receivedQuantity);
      const quantity = Math.max(0, Math.min(received[line.sku] ?? 0, remaining));
      const variance = quantity - remaining;
      return {
        ...line,
        remaining,
        quantity,
        variance,
        value: Math.round(quantity * line.unitCost),
        status: Math.abs(variance) > 0.001 ? "Attention" : "Healthy",
      };
    }) ?? [];
  const expectedValue = worksheet.reduce((sum, line) => sum + line.remaining * line.unitCost, 0);
  const receivedValue = worksheet.reduce((sum, line) => sum + line.value, 0);
  const varianceValue = Math.abs(expectedValue - receivedValue);

  const postReceipt = () => {
    if (!po) return;
    void mutate("receivePurchaseOrder", { purchaseOrderId: po.id, quantities: received });
    setNotice(`${po.id} goods receipt posted. Inventory and PO receiving progress were updated.`);
  };

  return (
    <AppShell
      title="Receiving"
      subtitle={
        po
          ? `${po.id} - ${po.supplier} - ${po.branch}`
          : "No approved purchase order awaiting receipt"
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
                  {item.id} - {item.supplier}
                </option>
              ))}
            </select>
          )}
          <Btn disabled={!po}>Save draft</Btn>
          <Btn variant="primary" disabled={!po} onClick={postReceipt}>
            Post receipt
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Expected value" value={Math.round(expectedValue)} money />
        <Metric label="Received value" value={Math.round(receivedValue)} money />
        <Metric
          label="Variance"
          value={Math.round(varianceValue)}
          money
          invert={varianceValue > 0}
        />
        <Metric label="Lines checked" value={`${worksheet.length}/${worksheet.length}`} />
      </div>
      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice} Backend: {backendStatus}.
        </div>
      )}
      <Panel className="mt-4">
        <PanelHead
          title="Receiving worksheet"
          sub="Compare ordered, previously received and this delivery before posting"
          right={
            <Status>{po ? (po.status === "PARTIAL" ? "Partial" : "Draft") : "Waiting"}</Status>
          }
        />
        {!po ? (
          <div className="p-8 text-center text-[13px] text-muted-foreground">
            Approve a purchase order first. It will appear here automatically for receiving.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Remaining</TH>
                  <TH className="text-right">Receive now</TH>
                  <TH className="text-right">Variance</TH>
                  <TH className="text-right">Value</TH>
                  <TH>Status</TH>
                </tr>
              </thead>
              <tbody>
                {worksheet.map((line) => (
                  <tr key={line.sku}>
                    <TD className="font-semibold">{line.name}</TD>
                    <TD className="num text-right">
                      {line.remaining} {line.unit}
                    </TD>
                    <TD className="text-right">
                      <input
                        type="number"
                        min={0}
                        max={line.remaining}
                        step="0.01"
                        value={received[line.sku] ?? 0}
                        onChange={(event) =>
                          setReceived((current) => ({
                            ...current,
                            [line.sku]: Number(event.target.value),
                          }))
                        }
                        className="num h-8 w-28 rounded-md border border-border bg-card px-2 text-right text-[12px] outline-none focus:border-primary"
                      />
                      <span className="ml-1 text-[11px] text-muted-foreground">{line.unit}</span>
                    </TD>
                    <TD className="num text-right">
                      {line.variance === 0 ? "0" : `${line.variance.toFixed(2)} ${line.unit}`}
                    </TD>
                    <TD className="num text-right font-semibold">{ksh(line.value)}</TD>
                    <TD>
                      <Status>{line.status}</Status>
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
