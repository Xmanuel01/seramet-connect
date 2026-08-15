import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { inventoryItems, ksh } from "@/data/mock";
import { branchMetric, useAppContext, useBranchStores } from "@/lib/app-context";

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
  const [q, setQ] = useState("");
  const { branch, branchLabel } = useAppContext();
  const scopedItems = inventoryItems.map((item) => {
    const stock = Math.max(0.1, branchMetric(Math.round(item.stock * 10), branch) / 10);
    const par = Math.max(1, branchMetric(item.par, branch));
    const status = stock <= par * 0.35 ? "Critical" : stock <= par ? "Low" : "Healthy";
    return { ...item, stock, par, status };
  });
  const rows = scopedItems.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  const needsReorder = rows.filter((item) => item.status !== "Healthy");
  const inventoryValue = rows.reduce((sum, item) => sum + item.cost * item.stock, 0);
  const warehouseRows = useBranchStores([
    {
      w: "Westlands Main Store",
      qty: "12.6 kg",
      note: "PAR 30 kg  -  reorder 15 kg",
      store: "Westlands Main Store",
    },
    { w: "Westlands Kitchen", qty: "4.3 kg", note: "Reserved 2.0 kg", store: "Westlands Kitchen" },
    {
      w: "Ngong Main Store",
      qty: "8.2 kg",
      note: "Expected 20 kg tomorrow",
      store: "Ngong Main Store",
    },
  ]);
  return (
    <AppShell
      title="Inventory"
      subtitle={`${branchLabel} inventory  -  last count 3 days ago`}
      actions={
        <>
          <Btn>Import</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Add item</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Inventory value" value={inventoryValue} money delta={-2.1} />
        <Metric label="Low stock" value={needsReorder.length} delta={33} invert />
        <Metric label="Out of stock" value={rows.filter((item) => item.stock < 1).length} />
        <Metric
          label="Stock variance"
          value={branchMetric(-18400, branch)}
          money
          delta={12}
          invert
        />
        <Metric label="Waste value" value={branchMetric(9240, branch)} money delta={-8.2} invert />
        <Metric label="Incoming stock" value={branchMetric(214300, branch)} money delta={4.4} />
      </div>

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
          <Chips items={[`Branch: ${branch}`, "Status: Needs attention"]} />
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
            Showing {rows.length} of {branch === "All Branches" ? 154 : 77} items
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
            right={<Btn variant="primary">Generate PO</Btn>}
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
          <PanelHead title="Stock by warehouse" sub="Beef Boneless  -  MEAT-001" />
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
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
