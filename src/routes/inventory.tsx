import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Chips, Metric, Panel, PanelHead, Status, TD, TH } from "@/components/app/ui";
import { inventoryItems, ksh } from "@/data/mock";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Seramet" },
      { name: "description", content: "Stock value, PAR levels, variance and item management across warehouses." },
      { property: "og:title", content: "Inventory — Seramet" },
      { property: "og:description", content: "Stock value, PAR levels, variance and item management." },
    ],
  }),
  component: Inventory,
});

function Inventory() {
  const [q, setQ] = useState("");
  const rows = inventoryItems.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <AppShell
      title="Inventory"
      subtitle="Westlands Main Store · last count 3 days ago"
      actions={
        <>
          <Btn>Import</Btn>
          <Btn>Export</Btn>
          <Btn variant="primary">Add item</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="Inventory value" value={1284600} money delta={-2.1} />
        <Metric label="Low stock" value={4} delta={33} invert />
        <Metric label="Out of stock" value={1} />
        <Metric label="Stock variance" value={-18400} money delta={12} invert />
        <Metric label="Waste value" value={9240} money delta={-8.2} invert />
        <Metric label="Incoming stock" value={214300} money delta={4.4} />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Items"
          sub={`${rows.length} items · 3 need reordering`}
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
          <Chips items={["Branch: Westlands", "Status: Needs attention"]} />
        </div>
        <div className="overflow-x-auto">
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
                  <TD className="font-semibold">{i.name}</TD>
                  <TD className="num text-muted-foreground">{i.sku}</TD>
                  <TD className="text-muted-foreground">{i.cat}</TD>
                  <TD className="num text-right">{i.stock} {i.unit}</TD>
                  <TD className="num text-right text-muted-foreground">{i.par} {i.unit}</TD>
                  <TD className="num text-right">{ksh(i.cost)}</TD>
                  <TD className="num text-right font-semibold">{ksh(i.cost * i.stock)}</TD>
                  <TD className="text-muted-foreground">{i.supplier}</TD>
                  <TD><Status>{i.status}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 text-[12px] text-muted-foreground">
          <span>Showing {rows.length} of 154 items</span>
          <div className="flex gap-1.5">
            <Btn>Previous</Btn>
            <Btn>Next</Btn>
          </div>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="PAR shortfall" sub="Generate a purchase recommendation" right={<Btn variant="primary">Generate PO</Btn>} />
          <table className="w-full">
            <thead><tr><TH>Item</TH><TH className="text-right">Current</TH><TH className="text-right">PAR</TH><TH className="text-right">Suggested</TH><TH>Status</TH></tr></thead>
            <tbody>
              {inventoryItems.filter((i) => i.status !== "Healthy").map((i) => (
                <tr key={i.sku}>
                  <TD className="font-semibold">{i.name}</TD>
                  <TD className="num text-right">{i.stock} {i.unit}</TD>
                  <TD className="num text-right text-muted-foreground">{i.par}</TD>
                  <TD className="num text-right font-semibold">{Math.ceil(i.par - i.stock)} {i.unit}</TD>
                  <TD><Status>{i.status}</Status></TD>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <PanelHead title="Stock by warehouse" sub="Beef Boneless · MEAT-001" />
          <ul className="divide-y divide-border">
            {[
              { w: "Westlands Main Store", qty: "12.6 kg", note: "PAR 30 kg · reorder 15 kg" },
              { w: "Westlands Kitchen", qty: "4.3 kg", note: "Reserved 2.0 kg" },
              { w: "Ngong Main Store", qty: "8.2 kg", note: "Expected 20 kg tomorrow" },
            ].map((r) => (
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