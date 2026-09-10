import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Calculator,
  ClipboardList,
  Download,
  PackagePlus,
  Plus,
  ReceiptText,
  Save,
  Search,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { DataTable } from "@/components/app/Tabs";
import { Btn, Chips, Metric, Panel, PanelHead, Segmented, Status, TD } from "@/components/app/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber, ksh } from "@/lib/currency";
import { branchMetric, useAppContext } from "@/lib/app-context";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useOperationalMenu } from "@/hooks/use-operational-menu";
import { useInventoryControlCentre } from "@/inventory/use-inventory-control-centre";
import { TransactionEngine } from "@/lib/transaction-engine";
import type {
  CostBomLine as BomLine,
  CostControlSnapshot,
  CostMaterial as Material,
  CostRecipe as RecipeCost,
  CostStockEntry as StockEntry,
} from "@/cost-control/types";

export const Route = createFileRoute("/cost-control")({
  head: () => ({
    meta: [
      { title: "Cost Control - Seramet" },
      {
        name: "description",
        content: "Restaurant raw material costing, recipe BOMs, yield, wastage and margin control.",
      },
      { property: "og:title", content: "Cost Control - Seramet" },
      {
        property: "og:description",
        content: "Professional restaurant costing controls for ingredients, BOMs and variances.",
      },
    ],
  }),
  component: CostControl,
});

const numberInputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40";

function CostControl() {
  const { activeTenantId, branch, branchId, branchLabel, currentUser, platformState } =
    useAppContext();
  const { state, mutate, persistenceMode } = useTransactionEngine();
  const { items: menuItems } = useOperationalMenu({
    tenantId: activeTenantId,
    branchId,
    userId: currentUser.id,
    userName: currentUser.name,
    role: currentUser.role,
  });
  const authoritative = persistenceMode === "authoritative";
  const control = useInventoryControlCentre(authoritative);
  const [view, setView] = useState("Raw materials");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const snapshot = state.costControlSnapshots.find(
    (row) => row.tenantId === activeTenantId && row.branchId === branchId,
  );
  const serverData = control.data.find((row) => row.branchId === branchId) ?? control.data[0];
  const developmentMaterials = useMemo<Material[]>(
    () =>
      TransactionEngine.getInventoryRows(state, branch).map((item) => ({
        id: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        costPerUnit: item.averageCost,
        yieldPct: 100,
        par: item.par,
        mainStore: item.stock,
        kitchen: 0,
        counter: 0,
        supplier: item.supplier || "Not assigned",
        status: item.status,
      })),
    [branch, state],
  );
  const authoritativeMaterials = useMemo<Material[]>(() => {
    const grouped = new Map<string, Material>();
    for (const branchData of control.data) {
      for (const item of branchData.items) {
        const unit = branchData.units.find((row) => row.id === item.base_unit_id)?.symbol ?? "unit";
        const existing = grouped.get(item.id);
        const quantity = item.quantity_minor / 1_000_000;
        const value = item.total_value_minor / 100;
        if (existing) {
          const priorValue = existing.costPerUnit * existing.mainStore;
          existing.mainStore += quantity;
          existing.costPerUnit = existing.mainStore ? (priorValue + value) / existing.mainStore : 0;
          existing.par += (item.target_quantity_minor ?? item.reorder_point_minor ?? 0) / 1_000_000;
          continue;
        }
        const reorder = (item.reorder_point_minor ?? 0) / 1_000_000;
        grouped.set(item.id, {
          id: item.id,
          name: item.name,
          category: item.category_id ?? "Uncategorised",
          unit,
          costPerUnit: item.average_unit_cost_minor / 100,
          yieldPct: 100,
          par: (item.target_quantity_minor ?? item.reorder_point_minor ?? 0) / 1_000_000,
          mainStore: quantity,
          kitchen: 0,
          counter: 0,
          supplier: "Not assigned",
          status: quantity <= 0 ? "Out of stock" : quantity <= reorder ? "Attention" : "Healthy",
        });
      }
    }
    return [...grouped.values()];
  }, [control.data]);
  const materials = authoritative
    ? authoritativeMaterials
    : (snapshot?.materials ?? developmentMaterials);
  const recipes = (authoritative ? [] : (snapshot?.recipes ?? [])).filter((recipe) =>
    menuItems.some((item) => item.id === recipe.productId),
  );
  const entries = authoritative
    ? (serverData?.controlCentre.movements ?? []).map(serverMovementEntry)
    : (snapshot?.stockEntries ?? []);
  const [selectedRecipeId, setSelectedRecipeId] = useState(recipes[0]?.productId ?? "");
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);

  const scopedMaterials = useMemo(
    () =>
      materials.map((item) => ({
        ...item,
        mainStore: authoritative
          ? item.mainStore
          : branchMetric(Math.round(item.mainStore * 10), branch) / 10,
        kitchen: authoritative
          ? item.kitchen
          : branchMetric(Math.round(item.kitchen * 10), branch) / 10,
        counter: authoritative
          ? item.counter
          : branchMetric(Math.round(item.counter * 10), branch) / 10,
      })),
    [authoritative, branch, materials],
  );

  const visibleMaterials = scopedMaterials.filter((item) => {
    const haystack = `${item.id} ${item.name} ${item.category} ${item.supplier}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const recipeRows = recipes.map((recipe) => recipeSummary(recipe, scopedMaterials, menuItems));
  const selectedRecipe =
    recipes.find((recipe) => recipe.productId === selectedRecipeId) ?? recipes[0];
  const selectedProduct = selectedRecipe
    ? productFor(selectedRecipe.productId, menuItems)
    : undefined;
  const selectedRecipeSummary = selectedRecipe
    ? recipeSummary(selectedRecipe, scopedMaterials, menuItems)
    : undefined;
  const totalInventoryValue = visibleMaterials.reduce(
    (sum, item) => sum + stockQty(item) * edibleUnitCost(item),
    0,
  );
  const theoreticalCost = recipeRows.reduce((sum, row) => sum + row.cost * row.expectedSales, 0);
  const actualCost = recipeRows.reduce((sum, row) => sum + row.actualCost, 0);
  const revenue = recipeRows.reduce((sum, row) => sum + row.price * row.expectedSales, 0);
  const summary = control.data.reduce(
    (total, row) => ({
      inventoryValueMinor: total.inventoryValueMinor + row.summary.inventoryValueMinor,
      varianceMinor: total.varianceMinor + row.summary.varianceMinor,
      actualFoodCostBps: total.actualFoodCostBps + row.summary.actualFoodCostBps,
      theoreticalFoodCostBps: total.theoreticalFoodCostBps + row.summary.theoreticalFoodCostBps,
    }),
    { inventoryValueMinor: 0, varianceMinor: 0, actualFoodCostBps: 0, theoreticalFoodCostBps: 0 },
  );
  const summaryCount = Math.max(1, control.data.length);
  const foodCostPct = authoritative
    ? summary.actualFoodCostBps / summaryCount / 100
    : revenue === 0
      ? 0
      : (actualCost / revenue) * 100;
  const idealFoodCostPct = authoritative
    ? summary.theoreticalFoodCostBps / summaryCount / 100
    : revenue === 0
      ? 0
      : (theoreticalCost / revenue) * 100;
  const variancePct = revenue === 0 ? 0 : ((actualCost - theoreticalCost) / revenue) * 100;

  const persistSnapshot = (
    next: Pick<CostControlSnapshot, "materials" | "recipes" | "stockEntries">,
  ) =>
    void mutate("replaceCostControlSnapshot", {
      snapshot: {
        id: `cost-control:${branchId}`,
        tenantId: activeTenantId,
        branchId,
        ...next,
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name,
      },
    });
  const addMaterial = (material: Material) => {
    if (!authoritative) {
      persistSnapshot({ materials: [...materials, material], recipes, stockEntries: entries });
      return;
    }
    void (async () => {
      try {
        setNotice("Saving material...");
        let unit = serverData?.units.find(
          (row) => row.symbol.toLowerCase() === material.unit.toLowerCase(),
        );
        if (!unit) {
          const unitResult = await control.command<{ unit: { id: string } }>(
            "/api/seramet/inventory/units",
            {
              code: material.unit.replace(/[^a-z0-9]/gi, "").toUpperCase() || "UNIT",
              name: material.unit,
              symbol: material.unit,
              dimension: "OTHER",
            },
          );
          unit = {
            id: unitResult.unit.id,
            code: material.unit,
            name: material.unit,
            symbol: material.unit,
            dimension: "OTHER",
            base_scale_numerator: 1,
            base_scale_denominator: 1,
          };
        }
        const itemResult = await control.command<{ item: { id: string } }>(
          "/api/seramet/inventory/items",
          {
            code: material.id,
            sku: material.id,
            name: material.name,
            categoryId: material.category,
            baseUnitId: unit.id,
            purchaseUnitId: unit.id,
            storageUnitId: unit.id,
            issueUnitId: unit.id,
            trackInventory: true,
            metadata: { edibleYieldBps: Math.round(material.yieldPct * 100) },
          },
        );
        const warehouse = platformState.warehouses.find(
          (row) => row.branchId === branchId && row.active,
        );
        if (warehouse && material.mainStore > 0) {
          await control.command("/api/seramet/inventory/movements", {
            branchId,
            warehouseId: warehouse.id,
            inventoryItemId: itemResult.item.id,
            movementType: "OPENING",
            quantityBaseMicro: Math.round(material.mainStore * 1_000_000),
            unitCostMinor: Math.round(material.costPerUnit * 100),
            sourceType: "ITEM_SETUP",
            sourceId: itemResult.item.id,
            idempotencyKey: `item-opening:${itemResult.item.id}`,
            reason: "Opening quantity entered during item setup",
          });
        }
        setNotice(`${material.name} saved to authoritative inventory.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Material could not be saved");
      }
    })();
  };
  const addEntry = (entry: StockEntry) => {
    if (authoritative) {
      void postAuthoritativeEntry(entry, serverData, branchId, control.command)
        .then(() => setNotice("Stock movement posted and cost analytics queued."))
        .catch((error: unknown) =>
          setNotice(error instanceof Error ? error.message : "Stock movement failed"),
        );
      return;
    }
    persistSnapshot({
      stockEntries: [entry, ...entries],
      recipes,
      materials: materials.map((material) =>
        material.id === entry.materialId ? applyStockEntry(material, entry) : material,
      ),
    });
  };
  const addBomLine = (line: BomLine) => {
    if (!selectedRecipe) return;
    persistSnapshot({
      materials,
      stockEntries: entries,
      recipes: recipes.map((recipe) =>
        recipe.productId === selectedRecipe.productId
          ? { ...recipe, lines: [...recipe.lines, line] }
          : recipe,
      ),
    });
  };

  return (
    <AppShell
      title="Cost Control"
      subtitle={`${branchLabel} recipe costing, raw materials and variance control`}
      actions={
        <>
          <Btn onClick={() => exportCostControl(materials, entries)}>
            <Download className="h-4 w-4" /> Export costing
          </Btn>
          <Btn onClick={() => setEntryDialogOpen(true)}>
            <ClipboardList className="h-4 w-4" /> Stock entry
          </Btn>
          <Btn variant="primary" onClick={() => setMaterialDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Add material
          </Btn>
        </>
      }
    >
      {(notice || control.error) && (
        <div className="mb-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice || control.error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Actual food cost"
          value={foodCostPct.toFixed(1)}
          suffix="%"
          delta={roundOne(variancePct)}
          invert
          note="vs ideal recipe cost"
        />
        <Metric label="Ideal food cost" value={idealFoodCostPct.toFixed(1)} suffix="%" />
        <Metric
          label="Variance exposure"
          value={authoritative ? summary.varianceMinor / 100 : actualCost - theoreticalCost}
          money
          invert
        />
        <Metric
          label="Raw material value"
          value={authoritative ? summary.inventoryValueMinor / 100 : totalInventoryValue}
          money
        />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Kitchen costing workspace"
          sub="Ingredient master data, BOMs, stock movements and actual-vs-theoretical control"
          right={<Status>{variancePct > 1 ? "Attention" : "Healthy"}</Status>}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <Segmented
            options={["Raw materials", "Recipe BOM", "Prep plan", "Stock entries", "Variance"]}
            value={view}
            onChange={setView}
          />
          <div className="ml-auto flex h-9 min-w-[220px] items-center gap-2 rounded-md border border-border bg-card px-3 md:min-w-[320px]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search materials, recipes or entries"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            />
          </div>
        </div>
        <div className="border-b border-border px-4 py-3">
          <Chips
            items={[
              `Scope: ${branchLabel}`,
              "Method: Weighted average",
              "Yield adjusted",
              `Today: ${formatDate(new Date())}`,
            ]}
          />
        </div>
        <div className="p-4">
          {view === "Raw materials" && (
            <RawMaterialsView
              materials={visibleMaterials}
              onAdd={() => setMaterialDialogOpen(true)}
            />
          )}
          {view === "Recipe BOM" && authoritative && (
            <AuthoritativeRecipeView rows={serverData?.controlCentre.recipes ?? []} />
          )}
          {view === "Recipe BOM" &&
            !authoritative &&
            selectedRecipe &&
            selectedProduct &&
            selectedRecipeSummary && (
              <RecipeBomView
                rows={recipeRows}
                selectedRecipe={selectedRecipe}
                selectedProduct={selectedProduct}
                selectedSummary={selectedRecipeSummary}
                materials={scopedMaterials}
                onSelectRecipe={setSelectedRecipeId}
                onAddLine={addBomLine}
              />
            )}
          {view === "Prep plan" && (
            <PrepPlanView
              rows={serverData?.controlCentre.prepRecommendations ?? []}
              authoritative={authoritative}
            />
          )}
          {view === "Stock entries" && (
            <StockEntriesView
              entries={entries.filter((entry) => entryMatches(entry, materials, query))}
              materials={materials}
              onAdd={() => setEntryDialogOpen(true)}
            />
          )}
          {view === "Variance" && authoritative ? (
            <AuthoritativeVarianceView rows={serverData?.controlCentre.consumption ?? []} />
          ) : (
            view === "Variance" && (
              <VarianceView
                rows={recipeRows.filter((row) =>
                  row.dish.toLowerCase().includes(query.toLowerCase()),
                )}
              />
            )
          )}
        </div>
      </Panel>

      <MaterialDialog
        open={materialDialogOpen}
        onOpenChange={setMaterialDialogOpen}
        onSave={addMaterial}
      />
      <StockEntryDialog
        open={entryDialogOpen}
        onOpenChange={setEntryDialogOpen}
        materials={materials}
        user={currentUser.name}
        onSave={addEntry}
      />
    </AppShell>
  );
}

type ServerControlData = ReturnType<typeof useInventoryControlCentre>["data"][number];

function serverMovementEntry(row: Record<string, unknown>): StockEntry {
  const movementType = String(row["movement_type"] ?? "OTHER");
  const type: StockEntry["type"] =
    movementType === "PURCHASE_RECEIPT" || movementType === "OPENING"
      ? "Receive"
      : ["WASTAGE", "BREAKAGE", "EXPIRY"].includes(movementType)
        ? "Waste"
        : movementType === "RETURN_TO_SUPPLIER" || movementType === "CUSTOMER_RETURN"
          ? "Return to store"
          : "Issue to kitchen";
  return {
    id: String(row["id"] ?? ""),
    date: String(row["business_date"] ?? ""),
    type,
    materialId: String(row["inventory_item_id"] ?? ""),
    qty: Math.abs(Number(row["quantity_minor"] ?? 0)) / 1_000_000,
    note: String(row["reason"] ?? row["source_type"] ?? "Inventory movement"),
    by: String(row["source_type"] ?? "Server operation"),
  };
}

async function postAuthoritativeEntry(
  entry: StockEntry,
  serverData: ServerControlData | undefined,
  branchId: string,
  command: (path: string, body: unknown) => Promise<unknown>,
) {
  const item = serverData?.items.find((row) => row.id === entry.materialId);
  if (!item) throw new Error("The selected material is not available in this branch");
  const quantityMicro = Math.round(entry.qty * 1_000_000);
  if (entry.type === "Waste") {
    await command("/api/seramet/inventory/wastage", {
      branchId,
      warehouseId: item.warehouse_id,
      inventoryItemId: item.id,
      quantityMicro,
      reasonCode: entry.note,
      idempotencyKey: crypto.randomUUID(),
    });
    return;
  }
  const positive = entry.type === "Receive" || entry.type === "Return to store";
  await command("/api/seramet/inventory/movements", {
    branchId,
    warehouseId: item.warehouse_id,
    inventoryItemId: item.id,
    movementType:
      entry.type === "Receive"
        ? "MANUAL_ADJUSTMENT"
        : entry.type === "Return to store"
          ? "CUSTOMER_RETURN"
          : "MANUAL_ADJUSTMENT",
    quantityBaseMicro: positive ? quantityMicro : -quantityMicro,
    unitCostMinor: item.average_unit_cost_minor,
    sourceType: "COST_CONTROL_ENTRY",
    sourceId: entry.id,
    idempotencyKey: crypto.randomUUID(),
    reason: entry.note,
  });
}

function AuthoritativeRecipeView({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <Panel className="overflow-hidden shadow-none">
      <PanelHead title="Recipe versions" sub="Effective, server-controlled recipe definitions" />
      <DataTable cols={["Recipe", "Version", "Effective from", { l: "Yield", r: true }, "Status"]}>
        {rows.map((row) => (
          <tr key={String(row["id"])}>
            <TD>
              <div className="font-semibold">{String(row["name"] ?? row["id"])}</div>
              <div className="text-[11px] text-muted-foreground">
                {String(row["menu_item_id"] ?? row["production_item_id"] ?? "Unlinked")}
              </div>
            </TD>
            <TD className="num">{row["version"] == null ? "-" : String(row["version"])}</TD>
            <TD className="text-muted-foreground">
              {row["effective_from"] ? formatDate(String(row["effective_from"])) : "Not versioned"}
            </TD>
            <TD className="num text-right">
              {row["yield_quantity_minor"] == null
                ? "-"
                : `${Number(row["yield_quantity_minor"]) / 1_000_000} ${String(row["yield_unit_id"] ?? "")}`}
            </TD>
            <TD>
              <Status>{row["active_version_id"] ? "Active" : "Needs version"}</Status>
            </TD>
          </tr>
        ))}
      </DataTable>
      {!rows.length && (
        <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
          No authoritative recipes are configured for this branch.
        </div>
      )}
    </Panel>
  );
}

function AuthoritativeVarianceView({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <Panel className="overflow-hidden shadow-none">
      <PanelHead
        title="Actual vs theoretical"
        sub="Posted inventory consumption with explained and unexplained variance"
      />
      <DataTable
        cols={[
          "Material",
          { l: "Actual", r: true },
          { l: "Theoretical", r: true },
          { l: "Variance", r: true },
          { l: "Value", r: true },
          "Quality",
        ]}
      >
        {rows.map((row, index) => (
          <tr key={`${String(row["inventory_item_id"])}:${String(row["period_end"])}:${index}`}>
            <TD>
              <div className="font-semibold">
                {String(row["item_name"] ?? row["inventory_item_id"])}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {String(row["period_start"])} to {String(row["period_end"])}
              </div>
            </TD>
            <TD className="num text-right">{formatMicro(row["actual_quantity_minor"])}</TD>
            <TD className="num text-right">{formatMicro(row["theoretical_quantity_minor"])}</TD>
            <TD className="num text-right">{formatMicro(row["unexplained_quantity_minor"])}</TD>
            <TD className="num text-right font-semibold">
              {ksh(Number(row["variance_value_minor"] ?? 0) / 100)}
            </TD>
            <TD>
              <Status>{String(row["quality"] ?? "INSUFFICIENT_DATA")}</Status>
            </TD>
          </tr>
        ))}
      </DataTable>
      {!rows.length && (
        <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
          No completed consumption period is available yet.
        </div>
      )}
    </Panel>
  );
}

function PrepPlanView({
  rows,
  authoritative,
}: {
  rows: Array<Record<string, unknown>>;
  authoritative: boolean;
}) {
  return (
    <Panel className="overflow-hidden shadow-none">
      <PanelHead
        title="Daily prep plan"
        sub="Demand, prepared inventory and configured safety buffer"
      />
      <DataTable
        cols={[
          "Prep item",
          { l: "Required", r: true },
          { l: "Prepared", r: true },
          { l: "Safety", r: true },
          { l: "Recommended", r: true },
          "Station",
          "Status",
        ]}
      >
        {rows.map((row) => (
          <tr key={String(row["id"])}>
            <TD>
              <div className="font-semibold">
                {String(row["recipe_name"] ?? row["output_item_name"] ?? row["recipe_id"])}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {String(row["business_date"] ?? "")}
              </div>
            </TD>
            <TD className="num text-right">{formatMicro(row["forecast_required_minor"])}</TD>
            <TD className="num text-right">{formatMicro(row["prepared_available_minor"])}</TD>
            <TD className="num text-right">{formatMicro(row["safety_buffer_minor"])}</TD>
            <TD className="num text-right font-semibold">
              {formatMicro(row["recommended_batch_minor"])}
            </TD>
            <TD className="text-muted-foreground">{String(row["station_id"] ?? "Not assigned")}</TD>
            <TD>
              <Status>{String(row["quality"] ?? row["status"] ?? "INSUFFICIENT_DATA")}</Status>
            </TD>
          </tr>
        ))}
      </DataTable>
      {!rows.length && (
        <div className="px-4 py-8 text-center text-[12px] text-muted-foreground">
          {authoritative
            ? "No prep recommendation is available. Configure production recipes and complete a sales period first."
            : "Prep recommendations are generated by the authoritative inventory worker."}
        </div>
      )}
    </Panel>
  );
}

function exportCostControl(materials: Material[], entries: StockEntry[]) {
  const rows = [
    ["record_type", "id", "name_or_type", "quantity", "unit_or_date", "value_or_note"],
    ...materials.map((item) => [
      "material",
      item.id,
      item.name,
      stockQty(item),
      item.unit,
      edibleUnitCost(item),
    ]),
    ...entries.map((entry) => [
      "movement",
      entry.id,
      entry.type,
      entry.qty,
      entry.date,
      entry.note,
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `seramet-cost-control-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(href);
}

function formatMicro(value: unknown) {
  return formatNumber(Number(value ?? 0) / 1_000_000, { maximumFractionDigits: 3 });
}

function RawMaterialsView({ materials, onAdd }: { materials: Material[]; onAdd: () => void }) {
  const lowCount = materials.filter((item) => stockQty(item) <= item.par).length;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="overflow-hidden shadow-none">
        <PanelHead
          title="Raw materials"
          sub="Cost, yield, storage split and reorder status"
          right={
            <Btn onClick={onAdd}>
              <PackagePlus className="h-4 w-4" /> New item
            </Btn>
          }
        />
        <DataTable
          cols={[
            "Material",
            "Category",
            "Unit",
            { l: "Edible cost", r: true },
            { l: "Main store", r: true },
            { l: "Kitchen", r: true },
            { l: "Counter", r: true },
            { l: "Total", r: true },
            "Status",
          ]}
          mobileCards={materials.map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border bg-card p-3 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {item.id} - {item.category} - {item.supplier}
                  </div>
                </div>
                <Status>{materialStatus(item)}</Status>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <InfoTile label="Edible cost" value={`${ksh(edibleUnitCost(item))}/${item.unit}`} />
                <InfoTile label="Total stock" value={`${stockQty(item)} ${item.unit}`} />
                <InfoTile label="Yield" value={`${item.yieldPct}%`} />
                <InfoTile label="PAR" value={`${item.par} ${item.unit}`} />
              </div>
            </article>
          ))}
        >
          {materials.map((item) => (
            <tr key={item.id} className="hover:bg-secondary/50">
              <TD>
                <div className="font-semibold">{item.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {item.id} - {item.supplier}
                </div>
              </TD>
              <TD className="text-muted-foreground">{item.category}</TD>
              <TD className="num">{item.unit}</TD>
              <TD className="num text-right font-semibold">{ksh(edibleUnitCost(item))}</TD>
              <TD className="num text-right">
                {item.mainStore} {item.unit}
              </TD>
              <TD className="num text-right">
                {item.kitchen} {item.unit}
              </TD>
              <TD className="num text-right">
                {item.counter} {item.unit}
              </TD>
              <TD className="num text-right font-semibold">
                {stockQty(item)} {item.unit}
              </TD>
              <TD>
                <Status>{materialStatus(item)}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel className="self-start shadow-none">
        <PanelHead title="Control alerts" sub={`${lowCount} materials need action`} />
        <div className="space-y-3 p-4">
          {materials
            .filter((item) => materialStatus(item) !== "Healthy")
            .slice(0, 4)
            .map((item) => (
              <div key={item.id} className="rounded-lg border border-border bg-secondary/40 p-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  {item.name}
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {stockQty(item)} {item.unit} on hand against PAR {item.par} {item.unit}. Latest
                  edible cost is {ksh(edibleUnitCost(item))}/{item.unit}.
                </p>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function RecipeBomView({
  rows,
  selectedRecipe,
  selectedProduct,
  selectedSummary,
  materials,
  onSelectRecipe,
  onAddLine,
}: {
  rows: ReturnType<typeof recipeSummary>[];
  selectedRecipe: RecipeCost;
  selectedProduct: ReturnType<typeof productFor>;
  selectedSummary: ReturnType<typeof recipeSummary>;
  materials: Material[];
  onSelectRecipe: (id: string) => void;
  onAddLine: (line: BomLine) => void;
}) {
  const [lineMaterial, setLineMaterial] = useState(materials[0]?.id ?? "");
  const [lineQty, setLineQty] = useState("0.1");
  const selectedMaterial = materials.find((material) => material.id === lineMaterial);
  const addLine = () => {
    const qty = Number(lineQty);
    if (!selectedMaterial || Number.isNaN(qty) || qty <= 0) return;
    onAddLine({
      id: `${selectedRecipe.productId}-${Date.now()}`,
      materialId: selectedMaterial.id,
      qty,
      station: selectedProduct.productionStation?.replace("_", " ") ?? "Main kitchen",
    });
    setLineQty("0.1");
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Panel className="overflow-hidden shadow-none">
        <PanelHead
          title="Recipe costing"
          sub="Calculated from raw material edible cost and recipe quantities"
        />
        <DataTable
          cols={[
            "Dish",
            "Station",
            { l: "Recipe cost", r: true },
            { l: "Selling price", r: true },
            { l: "Food cost", r: true },
            { l: "Suggested price", r: true },
            "Status",
          ]}
        >
          {rows.map((row) => (
            <tr
              key={row.productId}
              onClick={() => onSelectRecipe(row.productId)}
              className={cn(
                "cursor-pointer hover:bg-secondary/50",
                row.productId === selectedRecipe.productId && "bg-accent/45",
              )}
            >
              <TD className="font-semibold">{row.dish}</TD>
              <TD className="text-muted-foreground">{row.station}</TD>
              <TD className="num text-right">{ksh(row.cost)}</TD>
              <TD className="num text-right">{ksh(row.price)}</TD>
              <TD className="num text-right font-semibold">{row.foodCostPct.toFixed(1)}%</TD>
              <TD className="num text-right">{ksh(row.suggestedPrice)}</TD>
              <TD>
                <Status>{row.status}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel className="self-start shadow-none">
        <PanelHead
          title={selectedProduct.name}
          sub={`Target food cost ${selectedRecipe.targetFoodCostPct}%`}
          right={<Calculator className="h-4 w-4 text-muted-foreground" />}
        />
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <InfoTile label="Recipe cost" value={ksh(selectedSummary.cost)} />
            <InfoTile label="Gross margin" value={`${selectedSummary.marginPct.toFixed(1)}%`} />
            <InfoTile label="Selling price" value={ksh(selectedSummary.price)} />
            <InfoTile label="Suggested" value={ksh(selectedSummary.suggestedPrice)} />
          </div>
          <div className="rounded-lg border border-border">
            {selectedRecipe.lines.map((line) => {
              const material = materials.find((item) => item.id === line.materialId);
              if (!material) return null;
              return (
                <div
                  key={line.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{material.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {line.qty} {material.unit} - {line.station}
                    </div>
                  </div>
                  <div className="num text-right text-[13px] font-semibold">
                    {ksh(lineCost(line, material))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid gap-2">
            <select
              value={lineMaterial}
              onChange={(event) => setLineMaterial(event.target.value)}
              className={numberInputClass}
            >
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} ({material.unit})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={lineQty}
                onChange={(event) => setLineQty(event.target.value)}
                className={numberInputClass}
                inputMode="decimal"
              />
              <Btn variant="primary" onClick={addLine}>
                <Plus className="h-4 w-4" /> Add
              </Btn>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function StockEntriesView({
  entries,
  materials,
  onAdd,
}: {
  entries: StockEntry[];
  materials: Material[];
  onAdd: () => void;
}) {
  return (
    <Panel className="overflow-hidden shadow-none">
      <PanelHead
        title="Stock entries"
        sub="Receipts, kitchen issues, wastage and returns that affect actual cost"
        right={
          <Btn onClick={onAdd}>
            <Plus className="h-4 w-4" /> Post entry
          </Btn>
        }
      />
      <DataTable
        cols={[
          "Date",
          "Type",
          "Material",
          { l: "Quantity", r: true },
          "Entered by",
          "Note",
          "Status",
        ]}
      >
        {entries.map((entry) => {
          const material = materials.find((item) => item.id === entry.materialId);
          return (
            <tr key={entry.id} className="hover:bg-secondary/50">
              <TD className="num">{entry.date}</TD>
              <TD className="font-semibold">{entry.type}</TD>
              <TD className="font-semibold">{material?.name ?? entry.materialId}</TD>
              <TD className="num text-right">
                {entry.qty} {material?.unit ?? ""}
              </TD>
              <TD>{entry.by}</TD>
              <TD className="text-muted-foreground">{entry.note}</TD>
              <TD>
                <Status>{entry.type === "Waste" ? "Attention" : "Completed"}</Status>
              </TD>
            </tr>
          );
        })}
      </DataTable>
    </Panel>
  );
}

function VarianceView({ rows }: { rows: ReturnType<typeof recipeSummary>[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="overflow-hidden shadow-none">
        <PanelHead
          title="Actual vs theoretical"
          sub="Compares recipe standard cost against stock actually issued"
        />
        <DataTable
          cols={[
            "Dish",
            { l: "Sold", r: true },
            { l: "Theoretical", r: true },
            { l: "Actual issue", r: true },
            { l: "Variance", r: true },
            "Status",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.productId} className="hover:bg-secondary/50">
              <TD className="font-semibold">{row.dish}</TD>
              <TD className="num text-right">{row.expectedSales}</TD>
              <TD className="num text-right">{ksh(row.cost * row.expectedSales)}</TD>
              <TD className="num text-right">{ksh(row.actualCost)}</TD>
              <TD
                className={cn(
                  "num text-right font-semibold",
                  row.variance > 0 ? "text-danger" : "text-success",
                )}
              >
                {ksh(row.variance)}
              </TD>
              <TD>
                <Status>{row.variancePct > 2 ? "Variance_review" : "Healthy"}</Status>
              </TD>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel className="self-start shadow-none">
        <PanelHead title="Variance playbook" sub="What the kitchen manager should investigate" />
        <div className="space-y-3 p-4 text-[12px]">
          {[
            [
              "Portion control",
              "Check portion tools and trim standards when actual issue exceeds the configured recipe tolerance.",
            ],
            [
              "Yield loss",
              "Review supplier quality when edible yield drops below the expected butcher/prep percentage.",
            ],
            [
              "Waste posting",
              "Capture spoilage, staff meals, remakes and cancelled KOT items before end-of-day close.",
            ],
          ].map(([title, body]) => (
            <div key={title} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="font-semibold">{title}</div>
              <p className="mt-1 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MaterialDialog({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (material: Material) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    category: "Groceries",
    unit: "kg",
    costPerUnit: "0",
    yieldPct: "100",
    par: "0",
    mainStore: "0",
    kitchen: "0",
    counter: "0",
    supplier: "",
  });

  const save = () => {
    const name = form.name.trim();
    if (!name) return;
    onSave({
      id: materialId(name),
      name,
      category: form.category.trim() || "Uncategorised",
      unit: form.unit.trim() || "unit",
      costPerUnit: numeric(form.costPerUnit),
      yieldPct: clamp(numeric(form.yieldPct), 1, 100),
      par: numeric(form.par),
      mainStore: numeric(form.mainStore),
      kitchen: numeric(form.kitchen),
      counter: numeric(form.counter),
      supplier: form.supplier.trim() || "Unassigned supplier",
      status: "Healthy",
    });
    onOpenChange(false);
    setForm({
      ...form,
      name: "",
      costPerUnit: "0",
      par: "0",
      mainStore: "0",
      kitchen: "0",
      counter: "0",
      supplier: "",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border-border bg-card">
        <DialogHeader>
          <DialogTitle>Add raw material</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Item name"
            value={form.name}
            onChange={(value) => setForm({ ...form, name: value })}
          />
          <Field
            label="Supplier"
            value={form.supplier}
            onChange={(value) => setForm({ ...form, supplier: value })}
          />
          <Field
            label="Category"
            value={form.category}
            onChange={(value) => setForm({ ...form, category: value })}
          />
          <Field
            label="Unit of measure"
            value={form.unit}
            onChange={(value) => setForm({ ...form, unit: value })}
          />
          <Field
            label="Cost per unit"
            value={form.costPerUnit}
            onChange={(value) => setForm({ ...form, costPerUnit: value })}
          />
          <Field
            label="Edible yield %"
            value={form.yieldPct}
            onChange={(value) => setForm({ ...form, yieldPct: value })}
          />
          <Field
            label="PAR level"
            value={form.par}
            onChange={(value) => setForm({ ...form, par: value })}
          />
          <Field
            label="Main store qty"
            value={form.mainStore}
            onChange={(value) => setForm({ ...form, mainStore: value })}
          />
          <Field
            label="Kitchen qty"
            value={form.kitchen}
            onChange={(value) => setForm({ ...form, kitchen: value })}
          />
          <Field
            label="Counter qty"
            value={form.counter}
            onChange={(value) => setForm({ ...form, counter: value })}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn variant="primary" onClick={save}>
            <Save className="h-4 w-4" /> Save material
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StockEntryDialog({
  open,
  onOpenChange,
  materials,
  user,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: Material[];
  user: string;
  onSave: (entry: StockEntry) => void;
}) {
  const [materialIdValue, setMaterialIdValue] = useState(materials[0]?.id ?? "");
  const [type, setType] = useState<StockEntry["type"]>("Issue to kitchen");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  const save = () => {
    const amount = numeric(qty);
    if (!materialIdValue || amount <= 0 || !note.trim()) return;
    onSave({
      id: `STK-${String(Date.now()).slice(-6)}`,
      date: new Date().toISOString().slice(0, 10),
      type,
      materialId: materialIdValue,
      qty: amount,
      note: note.trim(),
      by: user,
    });
    setQty("1");
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-border bg-card">
        <DialogHeader>
          <DialogTitle>Post stock entry</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[12px] font-semibold">
            Material
            <select
              value={materialIdValue}
              onChange={(event) => setMaterialIdValue(event.target.value)}
              className={numberInputClass}
            >
              {materials.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} ({material.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[12px] font-semibold">
            Entry type
            <select
              value={type}
              onChange={(event) => setType(event.target.value as StockEntry["type"])}
              className={numberInputClass}
            >
              <option>Receive</option>
              <option>Issue to kitchen</option>
              <option>Waste</option>
              <option>Return to store</option>
            </select>
          </label>
          <Field label="Quantity" value={qty} onChange={setQty} />
          <label className="grid gap-1.5 text-[12px] font-semibold">
            Reason
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-24 rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              placeholder="Reason, supplier reference or prep note"
              required
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn
            variant="primary"
            disabled={!materialIdValue || numeric(qty) <= 0 || !note.trim()}
            onClick={save}
          >
            <ReceiptText className="h-4 w-4" /> Post entry
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={numberInputClass}
      />
    </label>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 px-2 py-1.5">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </div>
      <div className="num truncate text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function recipeSummary(
  recipe: RecipeCost,
  materials: Material[],
  menuItems: import("@/lib/menu-product").Product[],
) {
  const product = productFor(recipe.productId, menuItems);
  const cost = recipe.lines.reduce((sum, line) => {
    const material = materials.find((item) => item.id === line.materialId);
    return material ? sum + lineCost(line, material) : sum;
  }, 0);
  const foodCostPct = product.price === 0 ? 0 : (cost / product.price) * 100;
  const marginPct = product.price === 0 ? 0 : ((product.price - cost) / product.price) * 100;
  const suggestedPrice =
    recipe.targetFoodCostPct === 0
      ? product.price
      : Math.ceil(cost / (recipe.targetFoodCostPct / 100) / 10) * 10;
  const actualCost = cost * recipe.expectedSales * recipe.actualIssueMultiplier;
  const theoreticalCost = cost * recipe.expectedSales;
  const variance = actualCost - theoreticalCost;
  const variancePct = theoreticalCost === 0 ? 0 : (variance / theoreticalCost) * 100;
  const status =
    foodCostPct <= recipe.targetFoodCostPct
      ? "Healthy"
      : foodCostPct <= recipe.targetFoodCostPct + 4
        ? "Attention"
        : "Critical";
  return {
    productId: recipe.productId,
    dish: product.name,
    station: product.productionStation?.replace("_", " ") ?? "Main kitchen",
    cost,
    price: product.price,
    foodCostPct,
    marginPct,
    suggestedPrice,
    expectedSales: recipe.expectedSales,
    actualCost,
    variance,
    variancePct,
    status,
  };
}

function productFor(productId: string, menuItems: import("@/lib/menu-product").Product[]) {
  const product = menuItems.find((item) => item.id === productId);
  if (!product) throw new Error(`Menu item ${productId} is not available in the active catalog`);
  return product;
}

function lineCost(line: BomLine, material: Material) {
  return line.qty * edibleUnitCost(material);
}

function edibleUnitCost(material: Material) {
  return material.costPerUnit / Math.max(0.01, material.yieldPct / 100);
}

function stockQty(material: Material) {
  return roundQty(material.mainStore + material.kitchen + material.counter);
}

function materialStatus(material: Material) {
  const total = stockQty(material);
  if (total <= material.par * 0.35) return "Critical";
  if (total <= material.par) return "Attention";
  return "Healthy";
}

function applyStockEntry(material: Material, entry: StockEntry): Material {
  if (entry.type === "Receive")
    return { ...material, mainStore: roundQty(material.mainStore + entry.qty) };
  if (entry.type === "Issue to kitchen")
    return {
      ...material,
      mainStore: roundQty(Math.max(0, material.mainStore - entry.qty)),
      kitchen: roundQty(material.kitchen + entry.qty),
    };
  if (entry.type === "Return to store")
    return {
      ...material,
      kitchen: roundQty(Math.max(0, material.kitchen - entry.qty)),
      mainStore: roundQty(material.mainStore + entry.qty),
    };
  return { ...material, kitchen: roundQty(Math.max(0, material.kitchen - entry.qty)) };
}

function entryMatches(entry: StockEntry, materials: Material[], query: string) {
  const material = materials.find((item) => item.id === entry.materialId);
  const haystack =
    `${entry.id} ${entry.type} ${entry.note} ${entry.by} ${material?.name ?? ""}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function materialId(name: string) {
  return `MAT-${name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 10)}-${String(Date.now()).slice(-4)}`;
}

function numeric(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function roundQty(value: number) {
  return Math.round(value * 100) / 100;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
