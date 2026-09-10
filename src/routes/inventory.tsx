import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory - Seramet" },
      {
        name: "description",
        content: "Stock value, PAR levels, variance and item management across warehouses.",
      },
      { property: "og:title", content: "Inventory - Seramet" },
      {
        property: "og:description",
        content: "Stock value, PAR levels, variance and item management.",
      },
    ],
  }),
  component: Inventory,
});

function Inventory() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState("");
  const {
    branch,
    branchId,
    branchLabel,
    currentUser,
    isAllBranches,
    matchesBranch,
    platformState,
    locale,
  } = useAppContext();
  const { state, mutate, backendStatus, persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const scopedItems = authoritative
    ? control.data.flatMap((branchData) =>
        branchData.items.map((item) => {
          const unit =
            branchData.units.find((row) => row.id === item.base_unit_id)?.symbol ?? "unit";
          const stock = item.quantity_minor / 1_000_000;
          const par = (item.target_quantity_minor ?? item.reorder_point_minor ?? 0) / 1_000_000;
          const reorder = (item.reorder_point_minor ?? 0) / 1_000_000;
          return {
            id: item.id,
            sku: item.sku ?? item.code,
            name: item.name,
            category: item.category_id ?? "Uncategorised",
            cat: item.category_id ?? "Uncategorised",
            unit,
            stock,
            par,
            averageCost: item.average_unit_cost_minor / 100,
            cost: item.average_unit_cost_minor / 100,
            supplier: "Not assigned",
            status: stock <= 0 ? "Out of stock" : stock <= reorder ? "Low stock" : "Healthy",
            warehouseId: item.warehouse_id,
            branchId: branchData.branchId,
          };
        }),
      )
    : TransactionEngine.getInventoryRows(state, branch).map((item) => ({
        ...item,
        cat: item.category,
        cost: item.averageCost,
        warehouseId: "",
        branchId,
      }));
  const rows = scopedItems.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const needsReorder = rows.filter((item) => item.status !== "Healthy");
  const inventoryValue = authoritative
    ? control.data.reduce((sum, row) => sum + row.summary.inventoryValueMinor / 100, 0)
    : rows.reduce((sum, item) => sum + item.cost * item.stock, 0);
  const wasteValue = state.wastageRecords
    .filter((entry) => matchesBranch(entry.branchId ?? entry.branch) && entry.status === "APPROVED")
    .reduce((sum, entry) => sum + entry.cost, 0);
  const incomingStock = state.purchaseOrders
    .filter(
      (po) =>
        matchesBranch(po.branchId ?? po.branch) && ["APPROVED", "PARTIAL"].includes(po.status),
    )
    .reduce(
      (sum, po) =>
        sum +
        po.lines.reduce(
          (lineSum, line) =>
            lineSum + Math.max(0, line.quantity - line.receivedQuantity) * line.unitCost,
          0,
        ),
      0,
    );
  const adjustmentVariance = state.stockMovements
    .filter(
      (movement) =>
        matchesBranch(movement.branchId ?? movement.branch) && movement.type === "ADJUSTMENT",
    )
    .reduce((sum, movement) => sum + movement.quantity * movement.unitCost, 0);
  const warehouseRows = authoritative
    ? control.data.flatMap((branchData) => {
        const groups = new Map<string, { quantity: number; value: number; reserved: number }>();
        for (const item of branchData.items) {
          const current = groups.get(item.warehouse_id) ?? { quantity: 0, value: 0, reserved: 0 };
          current.quantity += item.quantity_minor / 1_000_000;
          current.value += item.total_value_minor / 100;
          current.reserved += item.quantity_reserved_minor / 1_000_000;
          groups.set(item.warehouse_id, current);
        }
        return [...groups.entries()].map(([warehouseId, values]) => ({
          w:
            platformState.warehouses.find((warehouse) => warehouse.id === warehouseId)?.name ??
            warehouseId,
          qty: `${values.quantity.toLocaleString(locale, { maximumFractionDigits: 2 })} base units`,
          note: `${ksh(values.value)} value  -  ${values.reserved.toLocaleString(locale, { maximumFractionDigits: 2 })} reserved`,
        }));
      })
    : [];
  return (
    <AppShell
      title="Inventory"
      subtitle={`${branchLabel} inventory - authoritative stock balances and movements`}
      actions={
        <>
          <Btn onClick={() => void navigate({ to: "/menu-import" })}>Import</Btn>
          <Btn onClick={() => exportInventory(rows)}>Export</Btn>
          <Btn variant="primary" onClick={() => void navigate({ to: "/cost-control" })}>
            Add item
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Inventory value" value={inventoryValue} money />
        <Metric
          label="Low stock"
          value={
            authoritative
              ? control.data.reduce((sum, row) => sum + row.summary.lowStockCount, 0)
              : needsReorder.length
          }
          invert
        />
        <Metric
          label="Out of stock"
          value={
            authoritative
              ? control.data.reduce((sum, row) => sum + row.summary.outOfStockCount, 0)
              : rows.filter((item) => item.stock < 1).length
          }
        />
        <Metric
          label="Stock variance"
          value={Math.round(adjustmentVariance)}
          money
          invert={adjustmentVariance < 0}
        />
        <Metric label="Waste value" value={Math.round(wasteValue)} money invert={wasteValue > 0} />
        <Metric label="Incoming stock" value={Math.round(incomingStock)} money />
      </div>
      {(notice || control.error) && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error} Backend: {authoritative ? control.status : backendStatus}.
        </div>
      )}

      <Panel className="mt-4">
        <PanelHead
          title="Items"
          sub={`${rows.length} items  -  ${needsReorder.length} need reordering`}
          right={<Btn>Bulk actions</Btn>}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search item or SKU"
              className="w-full bg-transparent text-[13px] outline-none"
            />
          </div>
          <Chips
            items={[
              `Branch: ${branch}`,
              needsReorder.length > 0 ? "Status: Needs attention" : "Status: No exceptions",
            ]}
          />
        </div>
        <div className="grid gap-3 p-3 md:hidden">
          {rows.map((i) => (
            <article
              key={i.sku}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/items/$sku"
                    params={{ sku: i.sku }}
                    className="truncate text-[13px] font-bold hover:text-primary"
                  >
                    {i.name}
                  </Link>
                  <div className="num text-[11px] text-muted-foreground">
                    {i.sku} - {i.cat}
                  </div>
                </div>
                <Status>{i.status}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Stock </span>
                  <span className="num font-semibold">
                    {i.stock} {i.unit}
                  </span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">PAR </span>
                  <span className="num font-semibold">
                    {i.par} {i.unit}
                  </span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Unit cost </span>
                  <span className="num font-semibold">{ksh(i.cost)}</span>
                </div>
                <div className="rounded-md bg-secondary/60 px-2 py-1.5">
                  <span className="text-muted-foreground">Value </span>
                  <span className="num font-semibold">{ksh(i.cost * i.stock)}</span>
                </div>
              </div>
              <div className="mt-3 truncate text-[12px] text-muted-foreground">{i.supplier}</div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px]">
            <thead className="sticky top-0 bg-card">
              <tr>
                <TH>Item</TH>
                <TH>SKU</TH>
                <TH>Category</TH>
                <TH className="text-right">Stock</TH>
                <TH className="text-right">PAR</TH>
                <TH className="text-right">Unit cost</TH>
                <TH className="text-right">Value</TH>
                <TH>Supplier</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.sku} className="hover:bg-secondary/50">
                  <TD className="font-semibold">
                    <Link
                      to="/items/$sku"
                      params={{ sku: i.sku }}
                      className="text-foreground hover:text-primary"
                    >
                      {i.name}
                    </Link>
                  </TD>
                  <TD className="num text-muted-foreground">{i.sku}</TD>
                  <TD className="text-muted-foreground">{i.cat}</TD>
                  <TD className="num text-right">
                    {i.stock} {i.unit}
                  </TD>
                  <TD className="num text-right text-muted-foreground">
                    {i.par} {i.unit}
                  </TD>
                  <TD className="num text-right">{ksh(i.cost)}</TD>
                  <TD className="num text-right font-semibold">{ksh(i.cost * i.stock)}</TD>
                  <TD className="text-muted-foreground">{i.supplier}</TD>
                  <TD>
                    <Status>{i.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-muted-foreground">
          <span>
            Showing {rows.length} configured item{rows.length === 1 ? "" : "s"}
            {isAllBranches ? " across all branches" : ""}
          </span>
          <div className="flex gap-1.5">
            <Btn>Previous</Btn>
            <Btn>Next</Btn>
          </div>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead
            title="PAR shortfall"
            sub="Generate a purchase recommendation"
            right={
              <Btn
                variant="primary"
                onClick={() => {
                  if (authoritative) {
                    void control
                      .recalculate()
                      .then(() =>
                        setNotice("Forecast and purchase recommendation recalculation queued."),
                      )
                      .catch((error: unknown) =>
                        setNotice(
                          error instanceof Error
                            ? error.message
                            : "Recalculation could not be queued",
                        ),
                      );
                  } else {
                    const result = TransactionEngine.generatePurchaseOrders(
                      state,
                      branch,
                      currentUser.name,
                    );
                    void mutate("generatePurchaseOrders", { branch });
                    setNotice(
                      result.created.length > 0
                        ? `Created ${result.created.join(", ")} from live PAR shortfalls.`
                        : "No new PO created. Existing open POs already cover these supplier shortfalls.",
                    );
                  }
                }}
              >
                Generate PO
              </Btn>
            }
          />
          <table className="w-full">
            <thead>
              <tr>
                <TH>Item</TH>
                <TH className="text-right">Current</TH>
                <TH className="text-right">PAR</TH>
                <TH className="text-right">Suggested</TH>
                <TH>Status</TH>
              </tr>
            </thead>
            <tbody>
              {needsReorder.map((i) => (
                <tr key={i.sku}>
                  <TD className="font-semibold">{i.name}</TD>
                  <TD className="num text-right">
                    {i.stock} {i.unit}
                  </TD>
                  <TD className="num text-right text-muted-foreground">{i.par}</TD>
                  <TD className="num text-right font-semibold">
                    {Math.ceil(i.par - i.stock)} {i.unit}
                  </TD>
                  <TD>
                    <Status>{i.status}</Status>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="Stock by warehouse" sub="Authoritative branch and storage totals" />
          <ul className="divide-y divide-border">
            {warehouseRows.map((r) => (
              <li key={r.w} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-[13px] font-semibold">{r.w}</div>
                  <div className="text-[11px] text-muted-foreground">{r.note}</div>
                </div>
                <span className="num text-[14px] font-bold">{r.qty}</span>
              </li>
            ))}
            {!warehouseRows.length && (
              <li className="px-4 py-8 text-center text-[12px] text-muted-foreground">
                Warehouse totals will appear after the first stock movement.
              </li>
            )}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

function exportInventory(
  rows: Array<{
    sku: string;
    name: string;
    cat: string;
    stock: number;
    unit: string;
    cost: number;
    status: string;
  }>,
) {
  const values = [
    ["sku", "name", "category", "stock", "unit", "average_cost", "inventory_value", "status"],
    ...rows.map((row) => [
      row.sku,
      row.name,
      row.cat,
      row.stock,
      row.unit,
      row.cost,
      row.stock * row.cost,
      row.status,
    ]),
  ];
  const csv = values
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `seramet-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}
