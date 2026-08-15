import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/wastage")({
  head: () => ({
    meta: [
      { title: "Wastage & Breakage - Seramet" },
      {
        name: "description",
        content: "Log food wastage and equipment breakage with photo evidence and approval.",
      },
      { property: "og:title", content: "Wastage & Breakage - Seramet" },
      {
        property: "og:description",
        content: "Waste and breakage capture with cost impact and approvals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Wastage,
});

const waste = [
  {
    id: "WST-0184",
    item: "Tomatoes",
    qty: "2.4 kg",
    reason: "Spoilage",
    branch: "Westlands",
    by: "Kelvin M.",
    cost: 288,
    status: "Approved",
  },
  {
    id: "WST-0183",
    item: "Chicken Biryani",
    qty: "2 portions",
    reason: "Order cancelled after cooking",
    branch: "Westlands",
    by: "Musa K.",
    cost: 804,
    status: "Pending",
  },
  {
    id: "WST-0182",
    item: "Beef Boneless",
    qty: "0.8 kg",
    reason: "Trim loss above standard",
    branch: "Ngong Road",
    by: "Peter K.",
    cost: 496,
    status: "Approved",
  },
];

const breakage = [
  {
    id: "BRK-0042",
    item: "Dinner plates",
    qty: "6 pcs",
    reason: "Dropped tray",
    branch: "Westlands",
    by: "Brian O.",
    value: 2400,
    status: "Pending",
  },
  {
    id: "BRK-0041",
    item: "Water glasses",
    qty: "3 pcs",
    reason: "Customer breakage",
    branch: "Terrace",
    by: "Joan A.",
    value: 900,
    status: "Approved",
  },
];

function Wastage() {
  return (
    <AppShell
      title="Wastage & breakage"
      subtitle="Cost leakage capture  -  this month"
      actions={
        <>
          <Btn>Log breakage</Btn>
          <Btn variant="primary">Log wastage</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Waste value (MTD)" value={18400} money delta={4.1} invert />
        <Metric label="Waste % of sales" value="0.9" suffix="%" delta={0.2} invert />
        <Metric label="Breakage value" value={6800} money delta={-14} invert />
        <Metric label="Awaiting approval" value={2} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelHead title="Food wastage" sub="Photo evidence required above KSh 500" />
          <DataTable
            cols={["Entry", "Item", "Quantity", "Reason", { l: "Cost", r: true }, "Status"]}
          >
            {waste.map((w) => (
              <tr key={w.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{w.id}</TD>
                <TD>{w.item}</TD>
                <TD className="num">{w.qty}</TD>
                <TD className="text-muted-foreground">{w.reason}</TD>
                <TD className="num text-right font-semibold">{ksh(w.cost)}</TD>
                <TD>
                  <Status>{w.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead title="Breakage" sub="Assets and smallwares" />
          <DataTable
            cols={["Entry", "Item", "Quantity", "Reason", { l: "Value", r: true }, "Status"]}
          >
            {breakage.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/50">
                <TD className="num font-semibold">{b.id}</TD>
                <TD>{b.item}</TD>
                <TD className="num">{b.qty}</TD>
                <TD className="text-muted-foreground">{b.reason}</TD>
                <TD className="num text-right font-semibold">{ksh(b.value)}</TD>
                <TD>
                  <Status>{b.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
      </div>
    </AppShell>
  );
}
