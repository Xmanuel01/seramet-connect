import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Tabs } from "@/components/app/Tabs";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/items/$sku")({
  head: () => ({
    meta: [
      { title: "Item Detail - Seramet" },
      {
        name: "description",
        content: "Authoritative item stock, valuation, recipes and movement history.",
      },
    ],
  }),
  component: ItemDetail,
});

function ItemDetail() {
  const { sku } = Route.useParams();
  const { state } = useTransactionEngine();
  const { branchLabel, matchesBranch } = useAppContext();
  const stockRows = state.inventory.filter(
    (row) => row.sku === sku && matchesBranch(row.branchId ?? row.branch),
  );
  const item = stockRows[0];
  const movements = state.stockMovements.filter(
    (row) => row.sku === sku && matchesBranch(row.branchId ?? row.branch),
  );
  const recipes = state.recipes.filter((recipe) =>
    recipe.ingredients.some((ingredient) => ingredient.sku === sku),
  );

  if (!item) {
    return (
      <AppShell title="Item detail" subtitle={`Inventory item ${sku}`}>
        <EmptyState
          title="Inventory item not found"
          description="Create or import the item before opening its stock and costing history."
        />
      </AppShell>
    );
  }

  const onHand = stockRows.reduce((sum, row) => sum + row.stock, 0);
  const par = stockRows.reduce((sum, row) => sum + row.par, 0);
  const stockValue = Math.round(
    stockRows.reduce((sum, row) => sum + row.stock * row.averageCost, 0),
  );

  return (
    <AppShell
      title={item.name}
      subtitle={`${item.sku} - ${item.category} - ${branchLabel}`}
      actions={
        <>
          <Btn>Adjust stock</Btn>
          <Btn>Transfer</Btn>
          <Btn variant="primary">Edit item</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="On hand" value={`${onHand} ${item.unit}`} />
        <Metric label="PAR level" value={`${par} ${item.unit}`} />
        <Metric label="Unit cost" value={item.averageCost} money />
        <Metric label="Stock value" value={stockValue} money />
        <Metric label="Warehouses" value={stockRows.length} />
        <Metric label="Recipe usage" value={recipes.length} />
      </div>

      <div className="mt-4">
        <Tabs tabs={["Stock", "Movement", "Recipes", "Supplier"]}>
          {(tab) => (
            <Panel>
              {tab === "Movement" ? (
                <>
                  <PanelHead title="Stock movement" sub="Authoritative movement ledger" />
                  <DataTable
                    cols={["Date", "Type", { l: "Quantity", r: true }, "Actor", "Reference"]}
                  >
                    {movements.map((movement) => (
                      <tr key={movement.id} className="hover:bg-secondary/50">
                        <TD className="num text-muted-foreground">{movement.createdAt}</TD>
                        <TD className="font-semibold">{movement.type}</TD>
                        <TD className="num text-right font-semibold">
                          {movement.quantity} {movement.unit}
                        </TD>
                        <TD>{movement.actor}</TD>
                        <TD className="num text-muted-foreground">{movement.reference}</TD>
                      </tr>
                    ))}
                  </DataTable>
                </>
              ) : tab === "Recipes" ? (
                <>
                  <PanelHead title="Recipe usage" sub="Active recipes using this inventory item" />
                  <DataTable cols={["Recipe", "Yield", { l: "Quantity", r: true }]}>
                    {recipes.map((recipe) => {
                      const ingredient = recipe.ingredients.find((row) => row.sku === sku);
                      return (
                        <tr key={recipe.id}>
                          <TD className="font-semibold">{recipe.dish}</TD>
                          <TD>{recipe.yieldLabel}</TD>
                          <TD className="num text-right">
                            {ingredient?.quantity ?? 0} {item.unit}
                          </TD>
                        </tr>
                      );
                    })}
                  </DataTable>
                </>
              ) : tab === "Supplier" ? (
                <>
                  <PanelHead title="Supplier" sub="Current inventory source assignment" />
                  <div className="p-4 text-[13px]">
                    <div className="font-semibold">{item.supplier || "Not configured"}</div>
                    <div className="mt-1 text-muted-foreground">
                      Current weighted unit cost: {ksh(item.averageCost)} per {item.unit}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <PanelHead title="Stock by warehouse" sub="Current authoritative balance" />
                  <DataTable
                    cols={[
                      "Warehouse / branch",
                      { l: "On hand", r: true },
                      { l: "PAR", r: true },
                      { l: "Unit cost", r: true },
                      "Status",
                    ]}
                  >
                    {stockRows.map((row) => (
                      <tr key={`${row.branchId ?? row.branch}-${row.sku}`}>
                        <TD className="font-semibold">{row.branch}</TD>
                        <TD className="num text-right">
                          {row.stock} {row.unit}
                        </TD>
                        <TD className="num text-right">
                          {row.par} {row.unit}
                        </TD>
                        <TD className="num text-right">{ksh(row.averageCost)}</TD>
                        <TD>
                          <Status>
                            {row.stock <= row.par * 0.35
                              ? "Critical"
                              : row.stock <= row.par
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
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
