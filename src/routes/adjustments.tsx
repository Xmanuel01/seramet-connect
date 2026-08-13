import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/adjustments")({
  head: () => ({
    meta: [
      { title: "Stock Adjustments — Seramet" },
      { name: "description", content: "Controlled stock adjustments with mandatory reason codes and manager approval." },
      { property: "og:title", content: "Stock Adjustments — Seramet" },
      { property: "og:description", content: "Reason-coded stock adjustments with approval trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Adjustments,
});

const rows = [
  { id: "ADJ-0221", item: "Beef Boneless", qty: "-0.4 kg", reason: "Count variance", store: "Westlands Main", by: "Kelvin M.", value: -248, status: "Approved" },
  { id: "ADJ-0220", item: "Cooking Oil", qty: "-1.6 L", reason: "Spillage", store: "Westlands Kitchen", by: "Musa K.", value: -496, status: "Pending" },
  { id: "ADJ-0219", item: "Tomatoes", qty: "+2.0 kg", reason: "Receiving error correction", store: "Ngong Main", by: "Faith N.", value: 240, status: "Approved" },
  { id: "ADJ-0218", item: "Aluminium Foil", qty: "-1 roll", reason: "Damaged", store: "Westlands Main", by: "Kelvin M.", value: -340, status: "Rejected" },
];

function Adjustments() {
  return (
    <AppShell title="Stock adjustments" subtitle="Every adjustment requires a reason and is fully audited" actions={<><Btn>Export</Btn><Btn variant="danger">New adjustment</Btn></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Adjustments (30d)" value={42} delta={-9} invert />
        <Metric label="Net value impact" value={-18400} money invert delta={6} />
        <Metric label="Awaiting approval" value={1} />
        <Metric label="Rejected" value={3} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Adjustment register" sub="Immutable — corrections create new entries" />
        <DataTable cols={["Adjustment", "Item", { l: "Quantity", r: true }, "Reason", "Store", "Raised by", { l: "Value", r: true }, "Status"]}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD>{r.item}</TD>
              <TD className={"num text-right font-semibold " + (r.qty.startsWith("+") ? "text-success" : "text-danger")}>{r.qty}</TD>
              <TD className="text-muted-foreground">{r.reason}</TD>
              <TD className="text-muted-foreground">{r.store}</TD>
              <TD>{r.by}</TD>
              <TD className="num text-right">{ksh(r.value)}</TD>
              <TD><Status>{r.status}</Status></TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
