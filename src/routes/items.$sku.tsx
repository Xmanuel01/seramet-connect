import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Tabs } from "@/components/app/Tabs";
import { inventoryItems, ksh } from "@/data/mock";

export const Route = createFileRoute("/items/$sku")({
  head: () => ({
    meta: [
      { title: "Item Detail - Seramet" },
      {
        name: "description",
        content:
          "Item overview, stock by warehouse, pricing, recipe usage, suppliers and movement history.",
      },
      { property: "og:title", content: "Item Detail - Seramet" },
      {
        property: "og:description",
        content: "Stock, pricing, suppliers and movement for a single item.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItemDetail,
});

const stockByStore = [
  { store: "Westlands Main Store", available: 12.6, reserved: 2.0, expected: 40, par: 30 },
  { store: "Westlands Kitchen", available: 4.3, reserved: 0, expected: 0, par: 6 },
  { store: "Ngong Main Store", available: 8.2, reserved: 1.5, expected: 0, par: 20 },
];

const movement = [
  {
    date: "13 Aug 09:12",
    type: "Issue to kitchen",
    qty: "-4.0 kg",
    by: "Kelvin M.",
    ref: "ISS-2211",
  },
  {
    date: "12 Aug 16:40",
    type: "Goods received",
    qty: "+30.0 kg",
    by: "Kelvin M.",
    ref: "GRN-0912",
  },
  { date: "12 Aug 11:05", type: "Wastage", qty: "-0.8 kg", by: "Musa K.", ref: "WST-0182" },
  { date: "11 Aug 08:22", type: "Transfer out", qty: "-6.0 kg", by: "Kelvin M.", ref: "TRF-0341" },
];

function ItemDetail() {
  const { sku } = Route.useParams();
  const item = (inventoryItems.find((i) => i.sku === sku) ?? inventoryItems[0])!;
  return (
    <AppShell
      title={item.name}
      subtitle={`${item.sku}  -  ${item.cat}  -  supplied by ${item.supplier}`}
      actions={
        <>
          <Btn>Adjust stock</Btn>
          <Btn>Transfer</Btn>
          <Btn variant="primary">Edit item</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="On hand" value={`${item.stock} ${item.unit}`} />
        <Metric label="PAR level" value={`${item.par} ${item.unit}`} />
        <Metric label="Unit cost" value={item.cost} money delta={12} invert />
        <Metric label="Stock value" value={Math.round(item.stock * item.cost)} money />
        <Metric label="Weekly usage" value={`38 ${item.unit}`} delta={6.2} />
        <Metric label="Days cover" value="2.3" suffix=" days" />
      </div>

      <div className="mt-4">
        <Tabs tabs={["Overview", "Stock", "Pricing", "Recipe", "Suppliers", "Movement", "History"]}>
          {(tab) => (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <Panel>
                {tab === "Movement" || tab === "History" ? (
                  <>
                    <PanelHead title="Stock movement" sub="Most recent transactions" />
                    <DataTable
                      cols={["Date", "Type", { l: "Quantity", r: true }, "User", "Reference"]}
                    >
                      {movement.map((m) => (
                        <tr key={m.ref} className="hover:bg-secondary/50">
                          <TD className="num text-muted-foreground">{m.date}</TD>
                          <TD className="font-semibold">{m.type}</TD>
                          <TD
                            className={
                              "num text-right font-semibold " +
                              (m.qty.startsWith("+") ? "text-success" : "text-danger")
                            }
                          >
                            {m.qty}
                          </TD>
                          <TD>{m.by}</TD>
                          <TD className="num text-muted-foreground">{m.ref}</TD>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                ) : tab === "Pricing" ? (
                  <>
                    <PanelHead title="Cost history" sub="Purchase price movement" />
                    <DataTable
                      cols={[
                        "Date",
                        "Supplier",
                        { l: "Unit cost", r: true },
                        { l: "Change", r: true },
                      ]}
                    >
                      {[
                        ["12 Aug", "Main Meat Supplier", 620, "+12%"],
                        ["28 Jul", "Main Meat Supplier", 554, "+3%"],
                        ["09 Jul", "Main Meat Supplier", 538, "0%"],
                      ].map((r) => (
                        <tr key={String(r[0])}>
                          <TD className="num text-muted-foreground">{r[0]}</TD>
                          <TD>{r[1]}</TD>
                          <TD className="num text-right">{ksh(Number(r[2]))}</TD>
                          <TD className="num text-right font-semibold">{r[3]}</TD>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                ) : tab === "Recipe" ? (
                  <>
                    <PanelHead title="Used in recipes" sub="Consumption per portion" />
                    <DataTable
                      cols={[
                        "Dish",
                        { l: "Per portion", r: true },
                        { l: "Portions sold (7d)", r: true },
                        { l: "Usage", r: true },
                      ]}
                    >
                      {[
                        ["Beef Dry Fry", "0.22 kg", 62, "13.6 kg"],
                        ["Beef Pilau", "0.18 kg", 74, "13.3 kg"],
                        ["Beef Samosa", "0.05 kg", 140, "7.0 kg"],
                      ].map((r) => (
                        <tr key={String(r[0])}>
                          <TD className="font-semibold">{r[0]}</TD>
                          <TD className="num text-right">{r[1]}</TD>
                          <TD className="num text-right">{r[2]}</TD>
                          <TD className="num text-right font-semibold">{r[3]}</TD>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                ) : tab === "Suppliers" ? (
                  <>
                    <PanelHead title="Suppliers" sub="Preferred supplier listed first" />
                    <DataTable
                      cols={[
                        "Supplier",
                        "Lead time",
                        { l: "Last price", r: true },
                        "On-time",
                        "Status",
                      ]}
                    >
                      {[
                        ["Main Meat Supplier", "1 day", 620, "88%", "Attention"],
                        ["Samwest", "2 days", 648, "96%", "Healthy"],
                      ].map((r) => (
                        <tr key={String(r[0])}>
                          <TD className="font-semibold">{r[0]}</TD>
                          <TD className="text-muted-foreground">{r[1]}</TD>
                          <TD className="num text-right">{ksh(Number(r[2]))}</TD>
                          <TD className="num">{r[3]}</TD>
                          <TD>
                            <Status>{String(r[4])}</Status>
                          </TD>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                ) : (
                  <>
                    <PanelHead title="Stock by warehouse" sub="Available, reserved and expected" />
                    <DataTable
                      cols={[
                        "Warehouse",
                        { l: "Available", r: true },
                        { l: "Reserved", r: true },
                        { l: "Expected", r: true },
                        { l: "PAR", r: true },
                        "Status",
                      ]}
                    >
                      {stockByStore.map((s) => (
                        <tr key={s.store} className="hover:bg-secondary/50">
                          <TD className="font-semibold">{s.store}</TD>
                          <TD className="num text-right">
                            {s.available} {item.unit}
                          </TD>
                          <TD className="num text-right text-muted-foreground">
                            {s.reserved} {item.unit}
                          </TD>
                          <TD className="num text-right text-muted-foreground">
                            {s.expected} {item.unit}
                          </TD>
                          <TD className="num text-right">
                            {s.par} {item.unit}
                          </TD>
                          <TD>
                            <Status>
                              {s.available < s.par * 0.5
                                ? "Critical"
                                : s.available < s.par
                                  ? "Low"
                                  : "Healthy"}
                            </Status>
                          </TD>
                        </tr>
                      ))}
                    </DataTable>
                  </>
                )}
              </Panel>
              <Panel>
                <PanelHead title="Item summary" right={<Status>{item.status}</Status>} />
                <dl className="divide-y divide-border text-[13px]">
                  {[
                    ["SKU", item.sku],
                    ["Category", item.cat],
                    ["Unit", item.unit],
                    ["Preferred supplier", item.supplier],
                    ["Reorder level", `${Math.round(item.par * 0.5)} ${item.unit}`],
                    [
                      "Suggested order",
                      `${Math.max(0, Math.round(item.par - item.stock))} ${item.unit}`,
                    ],
                    ["Last counted", "11 Aug 2026"],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex items-center justify-between px-4 py-2.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="num font-semibold">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="border-t border-border p-3">
                  <Btn variant="primary" className="w-full">
                    Add to purchase order
                  </Btn>
                </div>
              </Panel>
            </div>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
