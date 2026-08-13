import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/returns")({
  head: () => ({
    meta: [
      { title: "Returns — Seramet" },
      { name: "description", content: "Track returned items, reasons, stock impact and manager authorisation." },
      { property: "og:title", content: "Returns — Seramet" },
      { property: "og:description", content: "Returned items with reason codes and stock impact." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Returns,
});

const rows = [
  { id: "RT-0311", order: "#1798", item: "Chicken Biryani ×1", reason: "Cold on arrival", branch: "Westlands", by: "Joan A.", value: 1200, restock: "No", status: "Approved" },
  { id: "RT-0310", order: "#1774", item: "Soda 500ml ×3", reason: "Wrong item served", branch: "Ngong Road", by: "Amina W.", value: 450, restock: "Yes", status: "Approved" },
  { id: "RT-0309", order: "#1769", item: "Grilled Tilapia ×1", reason: "Quality complaint", branch: "Westlands", by: "Cecilia W.", value: 1400, restock: "No", status: "Pending" },
  { id: "RT-0308", order: "#1742", item: "Chips ×2", reason: "Customer changed mind", branch: "Ngong Road", by: "Brian O.", value: 500, restock: "No", status: "Rejected" },
];

function Returns() {
  return (
    <AppShell title="Returns" subtitle="Item-level returns and stock impact" actions={<><Btn>Export</Btn><Btn variant="primary">Log return</Btn></>}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Returns this month" value={31} delta={-12} invert />
        <Metric label="Return value" value={38400} money delta={-8.2} invert />
        <Metric label="Restocked" value="34%" />
        <Metric label="Awaiting approval" value={1} />
      </div>
      <Panel className="mt-4">
        <PanelHead title="Return register" sub="Reason codes drive kitchen quality reporting" />
        <DataTable cols={["Return", "Order", "Item", "Reason", "Branch", "Logged by", { l: "Value", r: true }, "Restocked", "Status"]}>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-secondary/50">
              <TD className="num font-semibold">{r.id}</TD>
              <TD className="num text-muted-foreground">{r.order}</TD>
              <TD>{r.item}</TD>
              <TD className="text-muted-foreground">{r.reason}</TD>
              <TD className="text-muted-foreground">{r.branch}</TD>
              <TD>{r.by}</TD>
              <TD className="num text-right font-semibold">{ksh(r.value)}</TD>
              <TD>{r.restock}</TD>
              <TD><Status>{r.status}</Status></TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
    </AppShell>
  );
}
