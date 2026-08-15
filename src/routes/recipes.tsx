import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/data/mock";

export const Route = createFileRoute("/recipes")({
  head: () => ({
    meta: [
      { title: "Recipes - Seramet" },
      { name: "description", content: "Recipe costing, portion control and live margin per dish." },
      { property: "og:title", content: "Recipes - Seramet" },
      { property: "og:description", content: "Costed recipes with portion control and margins." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Recipes,
});

const recipes = [
  { dish: "Chicken Biryani", yield: "1 portion", cost: 402, price: 1200, status: "Healthy" },
  { dish: "Beef Dry Fry", yield: "1 portion", cost: 468, price: 950, status: "Attention" },
  { dish: "Fish Curry", yield: "1 portion", cost: 512, price: 1150, status: "Attention" },
  { dish: "Bhajia", yield: "1 plate", cost: 96, price: 350, status: "Healthy" },
  { dish: "Passion Juice", yield: "400 ml", cost: 74, price: 300, status: "Healthy" },
];

const lines = [
  { ing: "Basmati Rice", qty: "0.18 kg", cost: 43 },
  { ing: "Chicken Whole", qty: "0.35 kg", cost: 168 },
  { ing: "Cooking Oil", qty: "0.05 L", cost: 16 },
  { ing: "Red Onions", qty: "0.12 kg", cost: 11 },
  { ing: "Tomatoes", qty: "0.10 kg", cost: 12 },
  { ing: "Spice mix & sundries", qty: "1 portion", cost: 152 },
];

function Recipes() {
  return (
    <AppShell
      title="Recipes"
      subtitle="Costing and portion control"
      actions={
        <>
          <Btn>Import</Btn>
          <Btn variant="primary">New recipe</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Costed recipes" value={86} />
        <Metric label="Average food cost" value="33.4" suffix="%" delta={3.1} invert />
        <Metric label="Below target margin" value={7} />
        <Metric label="Cost changes (7d)" value={12} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHead title="Recipe library" right={<SearchInput placeholder="Search dish..." />} />
          <DataTable
            cols={[
              "Dish",
              "Yield",
              { l: "Cost", r: true },
              { l: "Price", r: true },
              { l: "Margin", r: true },
              "Status",
            ]}
          >
            {recipes.map((r) => (
              <tr key={r.dish} className="hover:bg-secondary/50">
                <TD className="font-semibold">{r.dish}</TD>
                <TD className="text-muted-foreground">{r.yield}</TD>
                <TD className="num text-right">{ksh(r.cost)}</TD>
                <TD className="num text-right">{ksh(r.price)}</TD>
                <TD className="num text-right font-semibold">
                  {Math.round(((r.price - r.cost) / r.price) * 100)}%
                </TD>
                <TD>
                  <Status>{r.status}</Status>
                </TD>
              </tr>
            ))}
          </DataTable>
        </Panel>
        <Panel>
          <PanelHead
            title="Chicken Biryani"
            sub="Recipe card  -  1 portion"
            right={<Btn>Edit</Btn>}
          />
          <DataTable cols={["Ingredient", "Quantity", { l: "Cost", r: true }]}>
            {lines.map((l) => (
              <tr key={l.ing}>
                <TD>{l.ing}</TD>
                <TD className="num text-muted-foreground">{l.qty}</TD>
                <TD className="num text-right">{ksh(l.cost)}</TD>
              </tr>
            ))}
          </DataTable>
          <div className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cost</span>
              <span className="num font-semibold">{ksh(402)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selling price</span>
              <span className="num font-semibold">{ksh(1200)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross margin</span>
              <span className="num font-bold text-success">66.5%</span>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
