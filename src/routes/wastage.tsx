import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";

export const Route = createFileRoute("/wastage")({
  head: () => ({
    meta: [
      { title: "Wastage & Breakage - Seramet" },
      { name: "description", content: "Log food wastage and equipment breakage with approval." },
      { property: "og:title", content: "Wastage & Breakage - Seramet" },
      {
        property: "og:description",
        content: "Waste and breakage capture with cost impact and approvals.",
      },
    ],
  }),
  component: Wastage,
});

function Wastage() {
  const { branch, currentUser, isAllBranches, matchesBranch } = useAppContext();
  const { state, mutate, backendStatus } = useTransactionEngine();
  const targetBranch = isAllBranches ? currentUser.branch : branch;
  const [mode, setMode] = useState<"waste" | "breakage" | null>(null);
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [breakageItem, setBreakageItem] = useState("");
  const [breakageValue, setBreakageValue] = useState("");
  const [notice, setNotice] = useState("");

  const branchInventory = TransactionEngine.getInventoryRows(state, targetBranch);
  const waste = state.wastageRecords.filter((item) => matchesBranch(item.branchId ?? item.branch));
  const breakage = state.breakageRecords.filter((item) =>
    matchesBranch(item.branchId ?? item.branch),
  );
  const wasteValue = waste
    .filter((item) => item.status === "APPROVED")
    .reduce((sum, item) => sum + item.cost, 0);
  const breakageValueTotal = breakage
    .filter((item) => item.status === "APPROVED")
    .reduce((sum, item) => sum + item.value, 0);
  const pending =
    waste.filter((item) => item.status === "PENDING").length +
    breakage.filter((item) => item.status === "PENDING").length;
  const selectedStock = useMemo(
    () => branchInventory.find((item) => item.sku === sku),
    [branchInventory, sku],
  );

  const submitWaste = () => {
    if (!selectedStock || Number(quantity) <= 0 || !reason.trim()) {
      setNotice("Select an inventory item, enter a positive quantity and provide a reason.");
      return;
    }
    void mutate("recordWastage", {
      input: {
        branch: targetBranch,
        sku: selectedStock.sku,
        item: selectedStock.name,
        quantity: Number(quantity),
        unit: selectedStock.unit,
        reason: reason.trim(),
        requestedBy: currentUser.name,
      },
    });
    setNotice("Wastage recorded for manager approval. Inventory will reduce only when approved.");
    setMode(null);
    setReason("");
  };

  const submitBreakage = () => {
    if (
      !breakageItem.trim() ||
      Number(quantity) <= 0 ||
      Number(breakageValue) < 0 ||
      !reason.trim()
    ) {
      setNotice("Enter the damaged item, quantity, value and reason.");
      return;
    }
    void mutate("recordBreakage", {
      input: {
        branch: targetBranch,
        item: breakageItem.trim(),
        quantity: Number(quantity),
        unit: "pcs",
        reason: reason.trim(),
        value: Number(breakageValue),
        requestedBy: currentUser.name,
      },
    });
    setNotice("Breakage recorded for manager approval.");
    setMode(null);
    setReason("");
    setBreakageItem("");
    setBreakageValue("");
  };

  return (
    <AppShell
      title="Wastage & breakage"
      subtitle={`Cost leakage capture - ${branch}`}
      actions={
        <>
          <Btn onClick={() => setMode(mode === "breakage" ? null : "breakage")}>Log breakage</Btn>
          <Btn variant="primary" onClick={() => setMode(mode === "waste" ? null : "waste")}>
            Log wastage
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Waste value" value={wasteValue} money invert={wasteValue > 0} />
        <Metric label="Waste entries" value={waste.length} />
        <Metric
          label="Breakage value"
          value={breakageValueTotal}
          money
          invert={breakageValueTotal > 0}
        />
        <Metric label="Awaiting approval" value={pending} invert={pending > 0} />
      </div>

      {mode && (
        <Panel className="mt-4">
          <PanelHead
            title={mode === "waste" ? "Log food / inventory wastage" : "Log breakage"}
            sub="Creates an auditable approval request"
          />
          <div className="grid gap-3 p-4 md:grid-cols-4">
            {mode === "waste" ? (
              <select
                value={sku}
                onChange={(event) => setSku(event.target.value)}
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
              >
                <option value="">Select inventory item</option>
                {branchInventory.map((item) => (
                  <option key={item.sku} value={item.sku}>
                    {item.name} - {item.stock} {item.unit}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={breakageItem}
                onChange={(event) => setBreakageItem(event.target.value)}
                placeholder="Damaged item"
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
              />
            )}
            <input
              type="number"
              min="0"
              step="0.01"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="Quantity"
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
            />
            {mode === "breakage" ? (
              <input
                type="number"
                min="0"
                value={breakageValue}
                onChange={(event) => setBreakageValue(event.target.value)}
                placeholder="Estimated value"
                className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
              />
            ) : (
              <div className="flex h-9 items-center rounded-md border border-border bg-secondary/40 px-3 text-[12px] text-muted-foreground">
                Est. cost:{" "}
                {ksh(Math.round(Number(quantity || 0) * (selectedStock?.averageCost ?? 0)))}
              </div>
            )}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason"
              className="h-9 rounded-md border border-border bg-card px-3 text-[13px] outline-none"
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Btn onClick={() => setMode(null)}>Cancel</Btn>
            <Btn variant="primary" onClick={mode === "waste" ? submitWaste : submitBreakage}>
              Submit for approval
            </Btn>
          </div>
        </Panel>
      )}

      {notice && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice} Backend: {backendStatus}.
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHead
            title="Food wastage"
            sub="Approved entries post a stock movement automatically"
          />
          <DataTable
            cols={[
              "Entry",
              "Item",
              "Quantity",
              "Reason",
              { l: "Cost", r: true },
              "Status",
              "Action",
            ]}
          >
            {waste.map((w) => (
              <tr key={w.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{w.id}</TD>
                <TD>{w.item}</TD>
                <TD className="num">
                  {w.quantity} {w.unit}
                </TD>
                <TD className="text-muted-foreground">{w.reason}</TD>
                <TD className="num text-right font-semibold">{ksh(w.cost)}</TD>
                <TD>
                  <Status>{w.status}</Status>
                </TD>
                <TD>
                  {w.status === "PENDING" ? (
                    <button
                      type="button"
                      onClick={() => void mutate("approveWastage", { wastageId: w.id })}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      Approve
                    </button>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">-</span>
                  )}
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead title="Breakage" sub="Assets and smallwares" />
          <DataTable
            cols={[
              "Entry",
              "Item",
              "Quantity",
              "Reason",
              { l: "Value", r: true },
              "Status",
              "Action",
            ]}
          >
            {breakage.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{b.id}</TD>
                <TD>{b.item}</TD>
                <TD className="num">
                  {b.quantity} {b.unit}
                </TD>
                <TD className="text-muted-foreground">{b.reason}</TD>
                <TD className="num text-right font-semibold">{ksh(b.value)}</TD>
                <TD>
                  <Status>{b.status}</Status>
                </TD>
                <TD>
                  {b.status === "PENDING" ? (
                    <button
                      type="button"
                      onClick={() => void mutate("approveBreakage", { breakageId: b.id })}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      Approve
                    </button>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">-</span>
                  )}
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    </AppShell>
  );
}
