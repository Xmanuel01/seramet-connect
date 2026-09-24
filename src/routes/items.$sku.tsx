import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/app/EmptyState";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable, Tabs } from "@/components/app/Tabs";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useInventoryItemDetail } from "@/inventory/use-inventory-item-detail";
import { useAppContext } from "@/lib/app-context";
import { ksh } from "@/lib/currency";

export const Route = createFileRoute("/items/$sku")({
  head: () => ({
    meta: [
      { title: "Item Detail - Seramet" },
      {
        name: "description",
        content: "Authoritative item stock, valuation, recipes and immutable movement history.",
      },
    ],
  }),
  component: ItemDetail,
});

function ItemDetail() {
  const navigate = useNavigate();
  const { sku } = Route.useParams();
  const { branchLabel, isAllBranches } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const detail = useInventoryItemDetail(authoritative, sku);

  if (!authoritative) {
    return (
      <AppShell title="Item detail" subtitle={`Inventory item ${sku}`}>
        <EmptyState
          title="Authoritative inventory is unavailable"
          description="Connect the server database to review live stock, valuation and movement history."
        />
      </AppShell>
    );
  }

  if (detail.status === "loading" || detail.status === "idle") {
    return (
      <AppShell title="Item detail" subtitle={`Inventory item ${sku}`}>
        <div className="rounded-lg border border-border bg-secondary/30 px-4 py-8 text-center text-[12px] text-muted-foreground">
          Loading authoritative inventory item...
        </div>
      </AppShell>
    );
  }

  if (detail.error || detail.data.length === 0) {
    return (
      <AppShell title="Item detail" subtitle={`Inventory item ${sku}`}>
        <EmptyState
          title="Inventory item not found"
          description={detail.error || "Create or import the item before opening its stock and costing history."}
        />
      </AppShell>
    );
  }

  const item = detail.data[0]!.item;
  const balances = detail.data.flatMap((branch) =>
    branch.balances.map((balance) => ({ ...balance, branchId: branch.branchId })),
  );
  const movements = detail.data
    .flatMap((branch) =>
      branch.movements.map((movement) => ({ ...movement, branchId: branch.branchId })),
    )
    .sort((a, b) =>
      String(b.occurred_at ?? b.business_date ?? "").localeCompare(
        String(a.occurred_at ?? a.business_date ?? ""),
      ),
    );
  const recipes = [
    ...new Map(
      detail.data
        .flatMap((branch) => branch.recipes)
        .map((recipe) => [`${recipe.id}:${recipe.recipe_version_id}`, recipe]),
    ).values(),
  ];

  const onHandMicro = balances.reduce((sum, row) => sum + row.quantity_minor, 0);
  const availableMicro = balances.reduce((sum, row) => sum + row.quantity_available_minor, 0);
  const reservedMicro = balances.reduce((sum, row) => sum + row.quantity_reserved_minor, 0);
  const parMicro = balances.reduce(
    (sum, row) => sum + Number(row.target_quantity_minor ?? row.reorder_point_minor ?? 0),
    0,
  );
  const totalValueMinor = balances.reduce((sum, row) => sum + row.total_value_minor, 0);
  const weightedUnitCostMinor =
    onHandMicro > 0 ? Math.round((totalValueMinor * 1_000_000) / onHandMicro) : 0;
  const unit = item.base_unit_symbol ?? "unit";

  return (
    <AppShell
      title={item.name}
      subtitle={`${item.sku ?? item.code} - ${branchLabel}`}
      actions={
        <>
          <Btn onClick={() => void navigate({ to: "/adjustments" })}>Adjust stock</Btn>
          <Btn onClick={() => void navigate({ to: "/transfers" })}>Transfer</Btn>
          <Btn variant="primary" onClick={() => void navigate({ to: "/inventory-items" })}>
            Back to items
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="On hand" value={`${formatQuantity(onHandMicro)} ${unit}`} />
        <Metric label="Available" value={`${formatQuantity(availableMicro)} ${unit}`} />
        <Metric label="Reserved" value={`${formatQuantity(reservedMicro)} ${unit}`} />
        <Metric label="PAR target" value={`${formatQuantity(parMicro)} ${unit}`} />
        <Metric label="Unit cost" value={weightedUnitCostMinor / 100} money />
        <Metric label="Stock value" value={totalValueMinor / 100} money />
      </div>

      <div className="mt-4">
        <Tabs tabs={["Stock", "Movement", "Recipes", "Supplier"]}>
          {(tab) => (
            <Panel>
              {tab === "Movement" ? (
                <>
                  <PanelHead title="Stock movement" sub="Latest immutable inventory ledger entries" />
                  <DataTable
                    cols={[
                      "Date",
                      ...(isAllBranches ? ["Branch"] : []),
                      "Type",
                      { l: "Quantity", r: true },
                      { l: "Value", r: true },
                      "Reference",
                      "Reason",
                    ]}
                  >
                    {movements.map((movement) => (
                      <tr key={`${movement.branchId}:${movement.id}`} className="hover:bg-secondary/50">
                        <TD className="num text-muted-foreground">
                          {movement.occurred_at ?? movement.business_date ?? "—"}
                        </TD>
                        {isAllBranches && <TD className="num text-muted-foreground">{movement.branchId}</TD>}
                        <TD className="font-semibold">{movement.movement_type}</TD>
                        <TD className="num text-right font-semibold">
                          {formatQuantity(movement.quantity_minor)} {unit}
                        </TD>
                        <TD className="num text-right">
                          {movement.total_cost_minor == null ? "—" : ksh(movement.total_cost_minor / 100)}
                        </TD>
                        <TD className="num text-muted-foreground">
                          {movement.source_type}:{movement.source_id}
                        </TD>
                        <TD className="text-muted-foreground">{movement.reason || "—"}</TD>
                      </tr>
                    ))}
                  </DataTable>
                </>
              ) : tab === "Recipes" ? (
                <>
                  <PanelHead title="Recipe usage" sub="Active recipe versions using this inventory item" />
                  <DataTable cols={["Recipe", "Version", "Yield", { l: "Ingredient qty", r: true }]}>
                    {recipes.map((recipe) => (
                      <tr key={`${recipe.id}:${recipe.recipe_version_id}`}>
                        <TD className="font-semibold">{recipe.name}</TD>
                        <TD className="num">v{recipe.version}</TD>
                        <TD className="num">
                          {formatQuantity(recipe.yield_quantity_minor)} {recipe.yield_unit_symbol ?? ""}
                        </TD>
                        <TD className="num text-right">
                          {formatQuantity(recipe.quantity_minor)} {recipe.component_unit_symbol ?? unit}
                        </TD>
                      </tr>
                    ))}
                  </DataTable>
                  {!recipes.length && (
                    <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                      This item is not used by an active recipe version.
                    </div>
                  )}
                </>
              ) : tab === "Supplier" ? (
                <>
                  <PanelHead title="Supplier" sub="Preferred source and item-master configuration" />
                  <div className="grid gap-3 p-4 md:grid-cols-2">
                    <Info label="Preferred supplier" value={item.preferred_supplier_name || "Not assigned"} />
                    <Info label="Purchase unit" value={item.purchase_unit_id || "Same as base / not configured"} />
                    <Info label="Barcode" value={item.barcode || "Not configured"} />
                    <Info label="Expiry tracking" value={item.track_expiry ? "Enabled" : "Disabled"} />
                  </div>
                </>
              ) : (
                <>
                  <PanelHead title="Stock by warehouse" sub="Authoritative balance and PAR by storage location" />
                  <DataTable
                    cols={[
                      ...(isAllBranches ? ["Branch"] : []),
                      "Warehouse",
                      { l: "On hand", r: true },
                      { l: "Available", r: true },
                      { l: "Reserved", r: true },
                      { l: "Reorder", r: true },
                      { l: "PAR", r: true },
                      { l: "Unit cost", r: true },
                      { l: "Value", r: true },
                      "Status",
                    ]}
                  >
                    {balances.map((row) => {
                      const reorder = Number(row.reorder_point_minor ?? 0);
                      const status =
                        row.quantity_minor <= 0
                          ? "Out of stock"
                          : reorder > 0 && row.quantity_minor <= reorder
                            ? "Low stock"
                            : "Healthy";
                      return (
                        <tr key={`${row.branchId}:${row.warehouse_id}`}>
                          {isAllBranches && <TD className="num text-muted-foreground">{row.branchId}</TD>}
                          <TD className="font-semibold">{row.warehouse_name}</TD>
                          <TD className="num text-right">{formatQuantity(row.quantity_minor)} {unit}</TD>
                          <TD className="num text-right">{formatQuantity(row.quantity_available_minor)} {unit}</TD>
                          <TD className="num text-right">{formatQuantity(row.quantity_reserved_minor)} {unit}</TD>
                          <TD className="num text-right">{formatQuantity(reorder)} {unit}</TD>
                          <TD className="num text-right">
                            {formatQuantity(Number(row.target_quantity_minor ?? 0))} {unit}
                          </TD>
                          <TD className="num text-right">{ksh(row.average_unit_cost_minor / 100)}</TD>
                          <TD className="num text-right font-semibold">{ksh(row.total_value_minor / 100)}</TD>
                          <TD><Status>{status}</Status></TD>
                        </tr>
                      );
                    })}
                  </DataTable>
                  {!balances.length && (
                    <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
                      This item exists in the catalogue but has no stock movement in the selected branch yet.
                    </div>
                  )}
                </>
              )}
            </Panel>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}

function formatQuantity(quantityMicro: number) {
  return (quantityMicro / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-[13px] font-semibold">{value}</div>
    </div>
  );
}
