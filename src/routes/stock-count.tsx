import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { inventoryItems, ksh } from "@/data/mock";

export const Route = createFileRoute("/stock-count")({
  head: () => ({
    meta: [
      { title: "Stock Count - Seramet" },
      {
        name: "description",
        content:
          "Tablet-friendly stock counting with fast numeric entry and variance highlighting.",
      },
      { property: "og:title", content: "Stock Count - Seramet" },
      {
        property: "og:description",
        content: "Count sheets with instant variance and value impact.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockCount,
});

function StockCount() {
  const [counts, setCounts] = useState<Record<string, string>>({
    "MEAT-001": "12.2",
    "GROC-014": "8.4",
    "GROC-002": "18",
    "PROD-003": "5.1",
  });
  const rows = inventoryItems.map((i) => {
    const physical =
      counts[i.sku] === undefined || counts[i.sku] === "" ? null : Number(counts[i.sku]);
    const variance = physical === null ? null : +(physical - i.stock).toFixed(2);
    return { ...i, physical, variance };
  });
  const counted = rows.filter((r) => r.physical !== null).length;
  const varianceValue = rows.reduce((s, r) => s + (r.variance ?? 0) * r.cost, 0);

  return (
    <AppShell
      title="Stock count SC-2026-0042"
      subtitle="Westlands Main Store  -  started 07:10 by Kelvin M."
      actions={
        <>
          <Btn>Save draft</Btn>
          <Btn variant="primary">Submit for approval</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Items in sheet" value={rows.length} />
        <Metric
          label="Counted"
          value={counted}
          note={`${rows.length - counted} remaining`}
          delta={0}
        />
        <Metric label="Variance value" value={Math.round(varianceValue)} money />
        <Metric
          label="Items with variance"
          value={rows.filter((r) => r.variance !== null && r.variance !== 0).length}
        />
      </div>
      <Panel className="mt-4">
        <PanelHead
          title="Count sheet"
          sub="Enter physical quantity - variance is calculated live"
        />
        <DataTable
          cols={[
            "Item",
            "SKU",
            "Unit",
            { l: "Expected", r: true },
            { l: "Physical", r: true },
            { l: "Variance", r: true },
            { l: "Value impact", r: true },
            "Reason",
          ]}
        >
          {rows.map((r) => (
            <tr key={r.sku} className="hover:bg-secondary/50">
              <TD className="font-semibold">{r.name}</TD>
              <TD className="num text-muted-foreground">{r.sku}</TD>
              <TD className="text-muted-foreground">{r.unit}</TD>
              <TD className="num text-right">{r.stock}</TD>
              <TD className="text-right">
                <input
                  inputMode="decimal"
                  value={counts[r.sku] ?? ""}
                  onChange={(e) => setCounts((c) => ({ ...c, [r.sku]: e.target.value }))}
                  className="num h-9 w-24 rounded-md border border-border bg-card px-2 text-right text-[14px] font-semibold outline-none focus:ring-2 focus:ring-ring/40"
                  placeholder="-"
                />
              </TD>
              <TD
                className={
                  "num text-right font-semibold " +
                  (r.variance === null
                    ? "text-muted-foreground"
                    : r.variance === 0
                      ? "text-success"
                      : Math.abs(r.variance) > r.stock * 0.05
                        ? "text-danger"
                        : "text-warning")
                }
              >
                {r.variance === null ? "-" : r.variance > 0 ? `+${r.variance}` : r.variance}
              </TD>
              <TD className="num text-right">
                {r.variance === null || r.variance === 0
                  ? "-"
                  : ksh(Math.round(r.variance * r.cost))}
              </TD>
              <TD>
                {r.variance !== null && r.variance !== 0 ? (
                  <select className="h-8 rounded-md border border-border bg-card px-2 text-[12px]">
                    <option>Select reason</option>
                    <option>Wastage not logged</option>
                    <option>Over-portioning</option>
                    <option>Receiving error</option>
                    <option>Theft suspected</option>
                  </select>
                ) : (
                  <Status>Healthy</Status>
                )}
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
