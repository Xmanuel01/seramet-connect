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
import { inventoryItems, ksh, products } from "@/data/mock";
import { branchMetric, useAppContext } from "@/lib/app-context";

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

type Material = {
  id: string;
  name: string;
  category: string;
  unit: string;
  costPerUnit: number;
  yieldPct: number;
  par: number;
  mainStore: number;
  kitchen: number;
  counter: number;
  supplier: string;
  status: string;
};

type BomLine = {
  id: string;
  materialId: string;
  qty: number;
  station: string;
};

type RecipeCost = {
  productId: string;
  targetFoodCostPct: number;
  expectedSales: number;
  actualIssueMultiplier: number;
  lines: BomLine[];
};

type StockEntry = {
  id: string;
  date: string;
  type: "Receive" | "Issue to kitchen" | "Waste" | "Return to store";
  materialId: string;
  qty: number;
  note: string;
  by: string;
};

const materialStorageKey = "seramet.cost-control.materials.v1";
const recipeStorageKey = "seramet.cost-control.recipes.v1";
const stockEntryStorageKey = "seramet.cost-control.stock-entries.v1";

const categoryWaste: Record<string, number> = {
  Meat: 88,
  Produce: 82,
  Groceries: 96,
  Packaging: 100,
};

const materialSeeds: Material[] = inventoryItems.map((item, index) => {
  const yieldPct = categoryWaste[item.cat] ?? 94;
  return {
    id: item.sku,
    name: item.name,
    category: item.cat,
    unit: item.unit,
    costPerUnit: item.cost,
    yieldPct,
    par: item.par,
    mainStore: roundQty(item.stock * 0.58),
    kitchen: roundQty(item.stock * 0.34),
    counter: roundQty(item.stock * 0.08),
    supplier: item.supplier,
    status: index % 4 === 0 ? "Attention" : item.status,
  };
});

const baseRecipes: RecipeCost[] = [
  {
    productId: "p1",
    targetFoodCostPct: 32,
    expectedSales: 36,
    actualIssueMultiplier: 1.08,
    lines: [
      { id: "p1-1", materialId: "GROC-008", qty: 0.18, station: "Main kitchen" },
      { id: "p1-2", materialId: "MEAT-004", qty: 0.35, station: "Main kitchen" },
      { id: "p1-3", materialId: "GROC-014", qty: 0.05, station: "Main kitchen" },
      { id: "p1-4", materialId: "PROD-001", qty: 0.08, station: "Prep" },
      { id: "p1-5", materialId: "PROD-003", qty: 0.1, station: "Prep" },
    ],
  },
  {
    productId: "p3",
    targetFoodCostPct: 34,
    expectedSales: 22,
    actualIssueMultiplier: 1.14,
    lines: [
      { id: "p3-1", materialId: "MEAT-001", qty: 0.32, station: "Grill" },
      { id: "p3-2", materialId: "GROC-014", qty: 0.04, station: "Grill" },
      { id: "p3-3", materialId: "PROD-001", qty: 0.06, station: "Prep" },
    ],
  },
  {
    productId: "p6",
    targetFoodCostPct: 30,
    expectedSales: 64,
    actualIssueMultiplier: 0.97,
    lines: [
      { id: "p6-1", materialId: "GROC-002", qty: 0.08, station: "Main kitchen" },
      { id: "p6-2", materialId: "GROC-014", qty: 0.03, station: "Main kitchen" },
      { id: "p6-3", materialId: "PROD-003", qty: 0.05, station: "Prep" },
    ],
  },
  {
    productId: "p8",
    targetFoodCostPct: 28,
    expectedSales: 58,
    actualIssueMultiplier: 1.04,
    lines: [
      { id: "p8-1", materialId: "PROD-011", qty: 0.18, station: "Bar" },
      { id: "p8-2", materialId: "PACK-002", qty: 1, station: "Dispatch" },
    ],
  },
];

const initialEntries: StockEntry[] = [
  {
    id: "STK-0001",
    date: "2026-08-15",
    type: "Receive",
    materialId: "MEAT-004",
    qty: 18,
    note: "Morning supplier delivery",
    by: "Kelvin M.",
  },
  {
    id: "STK-0002",
    date: "2026-08-15",
    type: "Issue to kitchen",
    materialId: "GROC-008",
    qty: 12,
    note: "Lunch prep transfer",
    by: "Musa K.",
  },
  {
    id: "STK-0003",
    date: "2026-08-15",
    type: "Waste",
    materialId: "PROD-003",
    qty: 1.8,
    note: "Trim and soft tomatoes",
    by: "Chef Musa",
  },
];

const numberInputClass =
  "h-9 w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40";

function CostControl() {
  const { branch, branchLabel, currentUser } = useAppContext();
  const [view, setView] = useState("Raw materials");
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useStoredState<Material[]>(materialStorageKey, materialSeeds);
  const [recipes, setRecipes] = useStoredState<RecipeCost[]>(recipeStorageKey, baseRecipes);
  const [entries, setEntries] = useStoredState<StockEntry[]>(stockEntryStorageKey, initialEntries);
  const [selectedRecipeId, setSelectedRecipeId] = useState(
    recipes[0]?.productId ?? products[0]?.id ?? "",
  );
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);

  const scopedMaterials = useMemo(
    () =>
      materials.map((item) => ({
        ...item,
        mainStore: branchMetric(Math.round(item.mainStore * 10), branch) / 10,
        kitchen: branchMetric(Math.round(item.kitchen * 10), branch) / 10,
        counter: branchMetric(Math.round(item.counter * 10), branch) / 10,
      })),
    [branch, materials],
  );

  const visibleMaterials = scopedMaterials.filter((item) => {
    const haystack = `${item.id} ${item.name} ${item.category} ${item.supplier}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  const recipeRows = recipes.map((recipe) => recipeSummary(recipe, scopedMaterials));
  const selectedRecipe =
    recipes.find((recipe) => recipe.productId === selectedRecipeId) ?? recipes[0];
  const selectedProduct = selectedRecipe ? productFor(selectedRecipe.productId) : undefined;
  const selectedRecipeSummary = selectedRecipe
    ? recipeSummary(selectedRecipe, scopedMaterials)
    : undefined;
  const totalInventoryValue = visibleMaterials.reduce(
    (sum, item) => sum + stockQty(item) * edibleUnitCost(item),
    0,
  );
  const theoreticalCost = recipeRows.reduce((sum, row) => sum + row.cost * row.expectedSales, 0);
  const actualCost = recipeRows.reduce((sum, row) => sum + row.actualCost, 0);
  const revenue = recipeRows.reduce((sum, row) => sum + row.price * row.expectedSales, 0);
  const foodCostPct = revenue === 0 ? 0 : (actualCost / revenue) * 100;
  const idealFoodCostPct = revenue === 0 ? 0 : (theoreticalCost / revenue) * 100;
  const variancePct = revenue === 0 ? 0 : ((actualCost - theoreticalCost) / revenue) * 100;

  const addMaterial = (material: Material) => setMaterials((current) => [...current, material]);
  const addEntry = (entry: StockEntry) => {
    setEntries((current) => [entry, ...current]);
    setMaterials((current) =>
      current.map((material) =>
        material.id === entry.materialId ? applyStockEntry(material, entry) : material,
      ),
    );
  };
  const addBomLine = (line: BomLine) => {
    if (!selectedRecipe) return;
    setRecipes((current) =>
      current.map((recipe) =>
        recipe.productId === selectedRecipe.productId
          ? { ...recipe, lines: [...recipe.lines, line] }
          : recipe,
      ),
    );
  };

  return (
    <AppShell
      title="Cost Control"
      subtitle={`${branchLabel} recipe costing, raw materials and variance control`}
      actions={
        <>
          <Btn>
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
        <Metric label="Variance exposure" value={actualCost - theoreticalCost} money invert />
        <Metric label="Raw material value" value={totalInventoryValue} money />
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="Kitchen costing workspace"
          sub="Ingredient master data, BOMs, stock movements and actual-vs-theoretical control"
          right={<Status>{variancePct > 1 ? "Attention" : "Healthy"}</Status>}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <Segmented
            options={["Raw materials", "Recipe BOM", "Stock entries", "Variance"]}
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
              `Today: ${new Date().toLocaleDateString("en-KE")}`,
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
          {view === "Recipe BOM" && selectedRecipe && selectedProduct && selectedRecipeSummary && (
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
          {view === "Stock entries" && (
            <StockEntriesView
              entries={entries.filter((entry) => entryMatches(entry, materials, query))}
              materials={materials}
              onAdd={() => setEntryDialogOpen(true)}
            />
          )}
          {view === "Variance" && (
            <VarianceView
              rows={recipeRows.filter((row) =>
                row.dish.toLowerCase().includes(query.toLowerCase()),
              )}
            />
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
              "Check ladles, scoops and protein trim standards where actual issue exceeds recipe by more than 2%.",
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
    if (!materialIdValue || amount <= 0) return;
    onSave({
      id: `STK-${String(Date.now()).slice(-6)}`,
      date: new Date().toISOString().slice(0, 10),
      type,
      materialId: materialIdValue,
      qty: amount,
      note: note.trim() || `${type} posted from Cost Control`,
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
            Note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-24 rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              placeholder="Reason, supplier reference or prep note"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Btn onClick={() => onOpenChange(false)}>Close</Btn>
          <Btn variant="primary" onClick={save}>
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

function useStoredState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as T) : fallback;
    } catch {
      return fallback;
    }
  });

  const setStoredValue = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
      if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(resolved));
      return resolved;
    });
  };

  return [value, setStoredValue] as const;
}

function recipeSummary(recipe: RecipeCost, materials: Material[]) {
  const product = productFor(recipe.productId);
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

function productFor(productId: string) {
  return products.find((product) => product.id === productId) ?? products[0]!;
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
