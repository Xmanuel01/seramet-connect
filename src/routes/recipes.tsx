import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, SearchInput } from "@/components/app/Tabs";
import { ksh } from "@/lib/currency";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useOperationalMenu } from "@/hooks/use-operational-menu";
import { useAppContext } from "@/lib/app-context";
import { TransactionEngine } from "@/lib/transaction-engine";

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

function Recipes() {
  const { activeTenantId, branch, branchId, branchRecords, currentUser, role } = useAppContext();
  const { state } = useTransactionEngine();
  const { items: menuItems } = useOperationalMenu({
    tenantId: activeTenantId,
    branchId,
    userId: currentUser.id,
    userName: currentUser.name,
    role,
  });
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const library = TransactionEngine.getRecipeLibrary(state, branch);
  const targetBranch =
    branchRecords.find((configuredBranch) => configuredBranch.id === branchId)?.name ?? branch;
  const rows = library.map((recipe) => {
    const product = menuItems.find((item) => item.id === recipe.productId);
    const price =
      (product?.branchPrices as Record<string, number | undefined> | undefined)?.[targetBranch] ??
      product?.price ??
      0;
    const margin = price > 0 ? ((price - recipe.cost) / price) * 100 : 0;
    return {
      ...recipe,
      price,
      margin,
      status: margin >= 60 ? "Healthy" : margin >= 50 ? "Attention" : "Critical",
    };
  });
  const selected = rows.find((item) => item.id === selectedRecipeId) ?? rows[0];
  const ingredientRows = useMemo(() => {
    if (!selected) return [];
    return selected.ingredients.map((ingredient) => {
      const inventory = state.inventory.find(
        (item) => item.branch === targetBranch && item.sku === ingredient.sku,
      );
      return {
        ...ingredient,
        name: inventory?.name ?? ingredient.sku,
        unit: inventory?.unit ?? "unit",
        unitCost: inventory?.averageCost ?? 0,
        cost: Math.round((inventory?.averageCost ?? 0) * ingredient.quantity),
      };
    });
  }, [selected, state.inventory, targetBranch]);
  const averageFoodCost = rows.length
    ? rows.reduce((sum, row) => sum + (row.price > 0 ? (row.cost / row.price) * 100 : 0), 0) /
      rows.length
    : 0;

  return (
    <AppShell
      title="Recipes"
      subtitle={`Costing and portion control - ${targetBranch}`}
      actions={
        <>
          <Btn>Import</Btn>
          <Btn variant="primary">New recipe</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Costed recipes" value={rows.length} />
        <Metric
          label="Average food cost"
          value={averageFoodCost.toFixed(1)}
          suffix="%"
          invert={averageFoodCost > 35}
        />
        <Metric label="Below target margin" value={rows.filter((r) => r.margin < 60).length} />
        <Metric
          label="Auto 86 risks"
          value={rows.filter((r) => (r.availablePortions ?? 999) <= 3).length}
          invert
        />
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
              { l: "Portions", r: true },
              "Status",
            ]}
          >
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-secondary/50"
                onClick={() => setSelectedRecipeId(r.id)}
              >
                <TD className="font-semibold">{r.dish}</TD>
                <TD className="text-muted-foreground">{r.yieldLabel}</TD>
                <TD className="num text-right">{ksh(r.cost)}</TD>
                <TD className="num text-right">{ksh(r.price)}</TD>
                <TD className="num text-right font-semibold">{r.margin.toFixed(1)}%</TD>
                <TD className="num text-right font-semibold">
                  {Number.isFinite(r.availablePortions) ? r.availablePortions : "-"}
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
            title={selected?.dish ?? "Recipe"}
            sub={`Recipe card - ${selected?.yieldLabel ?? ""}`}
            right={<Btn>Edit</Btn>}
          />
          <DataTable cols={["Ingredient", "Quantity", { l: "Cost", r: true }]}>
            {ingredientRows.map((line) => (
              <tr key={line.sku}>
                <TD>{line.name}</TD>
                <TD className="num text-muted-foreground">
                  {line.quantity} {line.unit}
                </TD>
                <TD className="num text-right">{ksh(line.cost)}</TD>
              </tr>
            ))}
          </DataTable>
          <div className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cost</span>
              <span className="num font-semibold">{ksh(selected?.cost ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Selling price</span>
              <span className="num font-semibold">{ksh(selected?.price ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Gross margin</span>
              <span className="num font-bold text-success">
                {(selected?.margin ?? 0).toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available portions</span>
              <span className="num font-bold">
                {selected && Number.isFinite(selected.availablePortions)
                  ? selected.availablePortions
                  : "-"}
              </span>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
