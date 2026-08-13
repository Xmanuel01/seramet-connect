import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { inventoryItems, ksh } from "@/data/mock";

export const Route = createFileRoute("/par")({
  head: () => ({
    meta: [
      { title: "PAR Levels — Seramet" },
      { name: "description", content: "Minimum, PAR and maximum levels per item with automatic purchase recommendations." },
      { property: "og:title", content: "PAR Levels — Seramet" },
      { property: "og:description", content: "PAR management and suggested order quantities." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Par,
});

function Par() {
  const rows = inventoryItems.map((i) => ({
    ...i,
    min: Math.round(i.par * 0.5),
    max: Math.round(i.par * 1.5),
    suggested: Math.max(0, Math.round(i.par - i.stock)),
  }));
  const orderValue = rows.reduce((s, r) => s + r.suggested * r.cost, 0);
  return (
    <AppShell
      title="PAR levels"
      subtitle="Replenishment thresholds and purchase recommendations"
      actions={<><Btn>Edit PAR</Btn><Btn variant="primary">Generate purchase recommendation</Btn></>}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Items below PAR" value={rows.filter((r) => r.stock < r.par).length} />
        <Metric label="Critical items" value={rows.filter((r) => r.status === "Critical").length} />
        <Metric label="Suggested order value" value={Math.round(orderValue)} money />
        <Metric label="Stock health" value="72" suffix="/100" delta={-4} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="PAR table" sub="Suggested order tops stock back up to PAR" right={<Btn>Select all critical</Btn>} />
        <DataTable cols={["Item", "Unit", { l: "Current", r: true }, { l: "Minimum", r: true }, { l: "PAR", r: true }, { l: "Maximum", r: true }, { l: "Suggested order", r: true }, "Supplier", "Status"]}>
          {rows.map((r) => (
            <tr key={r.sku} className="hover:bg-secondary/50">
              <TD className="font-semibold">{r.name}</TD>
              <TD className="text-muted-foreground">{r.unit}</TD>
              <TD className="num text-right">{r.stock}</TD>
              <TD className="num text-right text-muted-foreground">{r.min}</TD>
              <TD className="num text-right">{r.par}</TD>
              <TD className="num text-right text-muted-foreground">{r.max}</TD>
              <TD className="num text-right font-bold">{r.suggested || "—"}</TD>
              <TD className="text-muted-foreground">{r.supplier}</TD>
              <TD><Status>{r.status}</Status></TD>
            </tr>
          ))}
        </DataTable>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="text-[13px] text-muted-foreground">
            Recommended purchase value <span className="num text-[16px] font-bold text-foreground">{ksh(Math.round(orderValue))}</span>
          </div>
          <Btn variant="primary">Create purchase orders by supplier</Btn>
        </div>
      </Panel>
    </AppShell>
  );
}
