import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Btn, Metric, Panel, PanelHead, Status, TD } from "@/components/app/ui";
import { DataTable } from "@/components/app/Tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createRecipeImportTemplate,
  parseRecipeImportFile,
  type RecipeImportPreview,
} from "@/inventory/recipe-import";
import { QUANTITY_SCALE } from "@/inventory/quantity";
import {
  type RecipeBranchLibrary,
  type RecipeComponentRow,
  type RecipeInventoryOption,
  type RecipeLibraryRow,
  type RecipeMenuOption,
  type RecipeUnitOption,
  useRecipeControlCentre,
} from "@/inventory/use-recipe-control-centre";
import { useTransactionEngine } from "@/hooks/use-transaction-engine";
import { useAppContext } from "@/lib/app-context";
import { formatMinor, majorFromMinor, parseMajorAmount } from "@/payments/money";
import { permissions } from "@/platform/permissions";

export const Route = createFileRoute("/recipes")({
  head: () => ({
    meta: [
      { title: "Recipes - Seramet" },
      {
        name: "description",
        content: "Authoritative recipe costing, versioning, portion control and import.",
      },
    ],
  }),
  component: Recipes,
});

type EditorComponent = {
  key: string;
  type: "INVENTORY" | "SUB_RECIPE";
  referenceId: string;
  quantity: string;
  unitId: string;
  wastePercent: string;
  optional: boolean;
};

function Recipes() {
  const {
    branchId,
    branchLabel,
    branchRecords,
    currency,
    hasPermission,
    isAllBranches,
  } = useAppContext();
  const { persistenceMode } = useTransactionEngine();
  const authoritative = persistenceMode === "authoritative";
  const control = useRecipeControlCentre(authoritative);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ key: string; recipe: RecipeLibraryRow | null } | null>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const activeData =
    control.data.find((entry) => entry.branchId === branchId) ?? control.data[0] ?? null;
  const rows = useMemo(
    () =>
      control.data
        .flatMap((entry) =>
          entry.library.recipes.map((recipe) => ({
            ...recipe,
            sourceBranchId: entry.branchId,
          })),
        )
        .filter((recipe, index, all) => all.findIndex((candidate) => candidate.id === recipe.id) === index),
    [control.data],
  );
  const filtered = rows.filter((recipe) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [
      recipe.name,
      recipe.menu_item_name,
      recipe.menu_item_code,
      recipe.production_item_name,
      recipe.production_item_code,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
  const selected =
    rows.find((recipe) => recipe.id === selectedRecipeId) ??
    filtered[0] ??
    rows[0] ??
    null;
  const averageFoodCost = rows.length
    ? rows.reduce((sum, recipe) => sum + foodCostPercent(recipe), 0) / rows.length
    : 0;
  const belowMargin = rows.filter((recipe) => marginPercent(recipe) < 60).length;
  const auto86Risks = rows.filter(
    (recipe) =>
      recipe.current_version_id &&
      recipe.available_output_quantity_minor <= 3 * QUANTITY_SCALE,
  ).length;
  const canManage =
    authoritative &&
    !isAllBranches &&
    hasPermission(permissions.inventoryCostControlManage);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice("");
    try {
      await task();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Recipe operation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Recipes"
      subtitle={`Costing, versioning and portion control - ${branchLabel}`}
      actions={
        <>
          <Btn disabled={!canManage || busy} onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Btn>
          <Btn disabled={!authoritative || busy} onClick={() => void control.refresh()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
          <Btn
            variant="primary"
            disabled={!canManage || busy}
            onClick={() => setEditor({ key: crypto.randomUUID(), recipe: null })}
          >
            <Plus className="h-4 w-4" /> New recipe
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Costed recipes" value={rows.filter((recipe) => !recipe.costing_error).length} />
        <Metric
          label="Average food cost"
          value={averageFoodCost.toFixed(1)}
          suffix="%"
          invert={averageFoodCost > 35}
        />
        <Metric label="Below target margin" value={belowMargin} />
        <Metric label="Auto 86 risks" value={auto86Risks} invert />
      </div>

      {(notice || control.error || !authoritative || isAllBranches) && (
        <div className="mt-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-[12px] text-muted-foreground">
          {notice ||
            control.error ||
            (!authoritative
              ? "Recipe management requires the authoritative Seramet server."
              : "All branches is read-only. Select a branch to create, edit or import recipes.")}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHead
            title="Recipe library"
            sub={`${filtered.length} recipe${filtered.length === 1 ? "" : "s"} shown`}
            right={
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search dish or code..."
                className="h-9 w-[220px] max-w-full rounded-md border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring/40"
              />
            }
          />
          <DataTable
            cols={[
              "Dish",
              "Version",
              "Yield",
              { l: "Cost", r: true },
              { l: "Price", r: true },
              { l: "Margin", r: true },
              { l: "Available", r: true },
              "Status",
            ]}
          >
            {filtered.map((recipe) => {
              const margin = marginPercent(recipe);
              return (
                <tr
                  key={recipe.id}
                  className={`cursor-pointer hover:bg-secondary/50 ${
                    selected?.id === recipe.id ? "bg-accent/40" : ""
                  }`}
                  onClick={() => setSelectedRecipeId(recipe.id)}
                >
                  <TD>
                    <div className="font-semibold">{recipe.name || targetName(recipe)}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {targetCode(recipe)}
                    </div>
                  </TD>
                  <TD className="num">{recipe.version ? `v${recipe.version}` : "—"}</TD>
                  <TD className="text-muted-foreground">{yieldLabel(recipe)}</TD>
                  <TD className="num text-right">
                    {recipe.costing_error ? "Needs review" : formatMinor(recipe.cost_minor, currency)}
                  </TD>
                  <TD className="num text-right">
                    {recipe.selling_price_minor == null
                      ? "—"
                      : formatMinor(Number(recipe.selling_price_minor), currency)}
                  </TD>
                  <TD className="num text-right font-semibold">
                    {recipe.selling_price_minor ? `${margin.toFixed(1)}%` : "—"}
                  </TD>
                  <TD className="num text-right font-semibold">
                    {formatQuantity(recipe.available_output_quantity_minor)}{" "}
                    {recipe.yield_unit_symbol ?? ""}
                  </TD>
                  <TD>
                    <Status>{recipeStatus(recipe)}</Status>
                  </TD>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <TD colSpan={8} className="py-10 text-center text-muted-foreground">
                  {control.status === "loading"
                    ? "Loading authoritative recipes…"
                    : search
                      ? "No recipes match this search."
                      : "No recipes have been configured for this branch."}
                </TD>
              </tr>
            )}
          </DataTable>
        </Panel>

        <Panel className="self-start">
          <PanelHead
            title={selected?.name ?? "Recipe"}
            sub={selected ? `${yieldLabel(selected)} · v${selected.version ?? "—"}` : "Select a recipe"}
            right={
              selected ? (
                <Btn
                  disabled={!canManage || busy}
                  onClick={() => setEditor({ key: crypto.randomUUID(), recipe: selected })}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </Btn>
              ) : undefined
            }
          />
          {selected ? (
            <>
              {selected.costing_error && (
                <div className="m-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-[12px]">
                  {selected.costing_error}
                </div>
              )}
              <DataTable cols={["Ingredient", "Quantity", { l: "Cost", r: true }]}>
                {selected.components.map((line) => (
                  <tr key={line.id}>
                    <TD>
                      <div>{componentName(line)}</div>
                      {line.optional ? (
                        <div className="text-[10px] uppercase text-muted-foreground">Optional</div>
                      ) : null}
                    </TD>
                    <TD className="num text-muted-foreground">
                      {formatQuantity(line.quantity_minor)} {line.unit_symbol ?? ""}
                      {line.waste_factor_bps
                        ? ` + ${(line.waste_factor_bps / 100).toFixed(1)}% waste`
                        : ""}
                    </TD>
                    <TD className="num text-right">
                      {line.component_costing_error
                        ? "Review"
                        : formatMinor(line.component_cost_minor, currency)}
                    </TD>
                  </tr>
                ))}
              </DataTable>
              <div className="space-y-1.5 border-t border-border px-4 py-3 text-[13px]">
                <SummaryLine
                  label="Ingredient + overhead cost"
                  value={
                    selected.costing_error ? "Needs review" : formatMinor(selected.cost_minor, currency)
                  }
                />
                <SummaryLine
                  label="Selling price"
                  value={
                    selected.selling_price_minor == null
                      ? "Not linked"
                      : formatMinor(Number(selected.selling_price_minor), currency)
                  }
                />
                <SummaryLine
                  label="Gross margin"
                  value={
                    selected.selling_price_minor
                      ? `${marginPercent(selected).toFixed(1)}%`
                      : "—"
                  }
                  strong
                />
                <SummaryLine
                  label="Available output"
                  value={`${formatQuantity(selected.available_output_quantity_minor)} ${
                    selected.yield_unit_symbol ?? ""
                  }`}
                  strong
                />
                <SummaryLine
                  label="Target"
                  value={`${targetName(selected)} · ${selected.production_item_id ? "Prep item" : "Menu item"}`}
                />
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-[12px] text-muted-foreground">
              Select a recipe to inspect its current version and ingredients.
            </div>
          )}
        </Panel>
      </div>

      {editor && activeData && (
        <RecipeEditorDialog
          key={editor.key}
          open
          busy={busy}
          recipe={editor.recipe}
          branchData={activeData}
          currency={currency}
          onOpenChange={(open) => {
            if (!open) setEditor(null);
          }}
          onSave={(body) =>
            void run(
              async () => {
                const result = await control.command<{ recipe: { recipeId: string } }>(
                  "/api/seramet/inventory/recipes/save",
                  body,
                );
                setSelectedRecipeId(result.recipe.recipeId);
                setEditor(null);
              },
              editor.recipe
                ? "New immutable recipe version saved."
                : "Recipe created with its first costed version.",
            )
          }
        />
      )}

      {activeData && (
        <RecipeImportDialog
          open={importOpen}
          busy={busy}
          branchData={activeData}
          branches={branchRecords.map((branch) => ({
            id: branch.id,
            name: branch.name,
            code: "code" in branch ? String(branch.code ?? "") : "",
          }))}
          branchId={branchId}
          currency={currency}
          onOpenChange={setImportOpen}
          onCommit={(preview) =>
            void run(
              async () => {
                const result = await control.command<{
                  import: { imported: number; failed: number; results: Array<{ error?: string }> };
                }>("/api/seramet/inventory/recipes/import", {
                  idempotencyKey: `recipe-import:${crypto.randomUUID()}`,
                  recipes: preview.definitions,
                });
                const failedMessages = result.import.results
                  .flatMap((row) => (row.error ? [row.error] : []))
                  .slice(0, 3);
                if (result.import.failed) {
                  throw new Error(
                    `${result.import.imported} recipes imported; ${result.import.failed} failed. ${failedMessages.join(
                      " · ",
                    )}`,
                  );
                }
                setImportOpen(false);
              },
              `${preview.recipeCount} recipes imported as authoritative recipe versions.`,
            )
          }
        />
      )}
    </AppShell>
  );
}

function RecipeEditorDialog({
  open,
  busy,
  recipe,
  branchData,
  currency,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  busy: boolean;
  recipe: RecipeLibraryRow | null;
  branchData: RecipeBranchLibrary;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const library = branchData.library;
  const isEdit = Boolean(recipe);
  const initialTargetType = recipe?.production_item_id ? "PRODUCTION" : "MENU";
  const [name, setName] = useState(recipe?.name ?? "");
  const [targetType, setTargetType] = useState<"MENU" | "PRODUCTION">(initialTargetType);
  const [targetId, setTargetId] = useState(
    recipe?.production_item_id ?? recipe?.menu_item_id ?? library.menuItems[0]?.id ?? "",
  );
  const [yieldQuantity, setYieldQuantity] = useState(
    recipe?.yield_quantity_minor ? formatQuantity(recipe.yield_quantity_minor) : "1",
  );
  const [yieldUnitId, setYieldUnitId] = useState(
    recipe?.yield_unit_id ?? library.units[0]?.id ?? "",
  );
  const [packagingCost, setPackagingCost] = useState(
    recipe?.packaging_cost_minor
      ? String(majorFromMinor(Number(recipe.packaging_cost_minor), currency))
      : "0",
  );
  const [overheadCost, setOverheadCost] = useState(
    recipe?.production_overhead_minor
      ? String(majorFromMinor(Number(recipe.production_overhead_minor), currency))
      : "0",
  );
  const [components, setComponents] = useState<EditorComponent[]>(
    recipe?.components.length
      ? recipe.components.map(componentToDraft)
      : [emptyComponent(library.inventoryItems[0], library.units)],
  );
  const [localError, setLocalError] = useState("");

  const targetOptions =
    targetType === "MENU"
      ? library.menuItems.map((item) => ({ id: item.id, label: `${item.code} · ${item.name}` }))
      : library.inventoryItems.map((item) => ({
          id: item.id,
          label: `${item.code} · ${item.name}`,
        }));

  const save = () => {
    setLocalError("");
    try {
      if (!name.trim()) throw new Error("Recipe name is required");
      if (!targetId) throw new Error("Select the menu or production item this recipe produces");
      if (!yieldUnitId) throw new Error("Select a yield unit");
      const parsedYield = toMicro(yieldQuantity);
      const parsedComponents = components.map((component, index) => {
        if (!component.referenceId) throw new Error(`Ingredient ${index + 1} is not selected`);
        if (!component.unitId) throw new Error(`Ingredient ${index + 1} needs a unit`);
        const waste = Number(component.wastePercent || "0");
        if (!Number.isFinite(waste) || waste < 0 || waste > 1000) {
          throw new Error(`Ingredient ${index + 1} waste percent is invalid`);
        }
        return {
          ...(component.type === "INVENTORY"
            ? { inventoryItemId: component.referenceId }
            : { subRecipeId: component.referenceId }),
          quantityMicro: toMicro(component.quantity),
          unitId: component.unitId,
          wasteFactorBps: Math.round(waste * 100),
          optional: component.optional,
        };
      });
      onSave({
        ...(recipe ? { recipeId: recipe.id } : {}),
        ...(targetType === "MENU" ? { menuItemId: targetId } : { productionItemId: targetId }),
        ...(recipe?.branch_override_id ? { branchOverrideId: recipe.branch_override_id } : {}),
        name: name.trim(),
        yieldQuantityMicro: parsedYield,
        yieldUnitId,
        packagingCostMinor: parseMajorAmount(packagingCost || "0", currency),
        productionOverheadMinor: parseMajorAmount(overheadCost || "0", currency),
        components: parsedComponents,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Recipe is invalid");
    }
  };

  const changeTargetType = (next: "MENU" | "PRODUCTION") => {
    if (isEdit) return;
    setTargetType(next);
    setTargetId(
      next === "MENU"
        ? library.menuItems[0]?.id ?? ""
        : library.inventoryItems[0]?.id ?? "",
    );
  };

  const updateComponent = (key: string, patch: Partial<EditorComponent>) =>
    setComponents((current) =>
      current.map((component) => (component.key === key ? { ...component, ...patch } : component)),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe ? `Edit ${recipe.name}` : "New recipe"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Recipe name">
            <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Recipe target">
            <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-2">
              <select
                className={inputClass}
                value={targetType}
                disabled={isEdit}
                onChange={(event) => changeTargetType(event.target.value as "MENU" | "PRODUCTION")}
              >
                <option value="MENU">Menu item</option>
                <option value="PRODUCTION">Prep item</option>
              </select>
              <select
                className={inputClass}
                value={targetId}
                disabled={isEdit}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">Select target</option>
                {targetOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Yield quantity">
            <input
              className={inputClass}
              type="number"
              min="0.000001"
              step="0.001"
              value={yieldQuantity}
              onChange={(event) => setYieldQuantity(event.target.value)}
            />
          </Field>
          <Field label="Yield unit">
            <UnitSelect units={library.units} value={yieldUnitId} onChange={setYieldUnitId} />
          </Field>
          <Field label={`Packaging cost (${currency})`}>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.01"
              value={packagingCost}
              onChange={(event) => setPackagingCost(event.target.value)}
            />
          </Field>
          <Field label={`Production overhead (${currency})`}>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.01"
              value={overheadCost}
              onChange={(event) => setOverheadCost(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 rounded-lg border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-bold">Ingredients & sub-recipes</div>
              <div className="text-[11px] text-muted-foreground">
                Quantities are for the full recipe yield above.
              </div>
            </div>
            <Btn
              onClick={() =>
                setComponents((current) => [
                  ...current,
                  emptyComponent(library.inventoryItems[0], library.units),
                ])
              }
            >
              <Plus className="h-4 w-4" /> Add ingredient
            </Btn>
          </div>
          <div className="divide-y divide-border">
            {components.map((component, index) => {
              const referenceOptions =
                component.type === "INVENTORY"
                  ? library.inventoryItems.map((item) => ({
                      id: item.id,
                      label: `${item.code} · ${item.name}`,
                    }))
                  : library.recipes
                      .filter((candidate) => candidate.id !== recipe?.id)
                      .map((candidate) => ({
                        id: candidate.id,
                        label: candidate.name,
                      }));
              return (
                <div key={component.key} className="grid gap-2 p-3 lg:grid-cols-[120px_1.7fr_110px_140px_95px_90px_36px]">
                  <select
                    className={inputClass}
                    value={component.type}
                    onChange={(event) => {
                      const type = event.target.value as EditorComponent["type"];
                      const firstInventory = library.inventoryItems[0];
                      const firstRecipe = library.recipes.find((candidate) => candidate.id !== recipe?.id);
                      updateComponent(component.key, {
                        type,
                        referenceId: type === "INVENTORY" ? firstInventory?.id ?? "" : firstRecipe?.id ?? "",
                        unitId:
                          type === "INVENTORY"
                            ? firstInventory?.base_unit_id ?? library.units[0]?.id ?? ""
                            : firstRecipe?.yield_unit_id ?? library.units[0]?.id ?? "",
                      });
                    }}
                  >
                    <option value="INVENTORY">Ingredient</option>
                    <option value="SUB_RECIPE">Sub-recipe</option>
                  </select>
                  <select
                    className={inputClass}
                    value={component.referenceId}
                    onChange={(event) => {
                      const referenceId = event.target.value;
                      const inventory = library.inventoryItems.find((item) => item.id === referenceId);
                      const subRecipe = library.recipes.find((item) => item.id === referenceId);
                      updateComponent(component.key, {
                        referenceId,
                        unitId:
                          component.type === "INVENTORY"
                            ? inventory?.base_unit_id ?? component.unitId
                            : subRecipe?.yield_unit_id ?? component.unitId,
                      });
                    }}
                  >
                    <option value="">Select</option>
                    {referenceOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Ingredient ${index + 1} quantity`}
                    className={inputClass}
                    type="number"
                    min="0.000001"
                    step="0.001"
                    value={component.quantity}
                    onChange={(event) => updateComponent(component.key, { quantity: event.target.value })}
                  />
                  <UnitSelect
                    units={library.units}
                    value={component.unitId}
                    onChange={(unitId) => updateComponent(component.key, { unitId })}
                  />
                  <input
                    aria-label={`Ingredient ${index + 1} waste percent`}
                    className={inputClass}
                    type="number"
                    min="0"
                    step="0.1"
                    value={component.wastePercent}
                    onChange={(event) =>
                      updateComponent(component.key, { wastePercent: event.target.value })
                    }
                    title="Waste %"
                  />
                  <label className="flex h-10 items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={component.optional}
                      onChange={(event) =>
                        updateComponent(component.key, { optional: event.target.checked })
                      }
                    />
                    Optional
                  </label>
                  <button
                    type="button"
                    className="flex h-10 items-center justify-center rounded-md text-danger hover:bg-danger/10 disabled:opacity-30"
                    disabled={components.length === 1}
                    onClick={() =>
                      setComponents((current) =>
                        current.filter((candidate) => candidate.key !== component.key),
                      )
                    }
                    aria-label="Remove ingredient"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {localError && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {localError}
          </div>
        )}
        <div className="mt-4 rounded-md bg-secondary/50 p-3 text-[12px] text-muted-foreground">
          {recipe
            ? "Saving creates a new immutable recipe version. Historical production and costing keep their original version."
            : "The first version becomes active immediately. Production uses only the active version."}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn variant="primary" disabled={busy} onClick={save}>
            {recipe ? "Save new version" : "Create recipe"}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecipeImportDialog({
  open,
  busy,
  branchData,
  branches,
  branchId,
  currency,
  onOpenChange,
  onCommit,
}: {
  open: boolean;
  busy: boolean;
  branchData: RecipeBranchLibrary;
  branches: Array<{ id: string; name: string; code?: string | null }>;
  branchId: string;
  currency: string;
  onOpenChange: (open: boolean) => void;
  onCommit: (preview: RecipeImportPreview) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<RecipeImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [localError, setLocalError] = useState("");

  const handleFile = async (file: File) => {
    setParsing(true);
    setLocalError("");
    try {
      const result = await parseRecipeImportFile(file, {
        currency,
        menuItems: branchData.library.menuItems,
        inventoryItems: branchData.library.inventoryItems,
        units: branchData.library.units,
        recipes: branchData.library.recipes.map((recipe) => ({
          ...recipe,
          code: recipe.menu_item_code ?? recipe.production_item_code ?? "",
        })),
        branches,
        activeBranchId: branchId,
      });
      setPreview(result);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Recipe file could not be parsed");
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import recipes</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Canonical recipe spreadsheet</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                CSV or XLSX. One row per ingredient; repeat recipe-level fields for every ingredient.
              </div>
            </div>
            <Btn
              onClick={() =>
                downloadText("seramet-recipe-template.csv", createRecipeImportTemplate())
              }
            >
              <Download className="h-4 w-4" /> Template
            </Btn>
          </div>
          <button
            type="button"
            disabled={busy || parsing}
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex min-h-28 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-secondary/30 text-sm hover:bg-secondary/50 disabled:opacity-50"
          >
            <FileSpreadsheet className="mb-2 h-6 w-6 text-primary" />
            {parsing ? "Validating file…" : "Choose CSV or XLSX"}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = "";
            }}
          />
        </div>

        {localError && (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {localError}
          </div>
        )}

        {preview && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Metric label="Rows read" value={preview.rowsRead} />
              <Metric label="Recipes" value={preview.recipeCount} />
              <Metric label="Errors" value={preview.issues.length} invert />
            </div>
            {preview.issues.length ? (
              <div className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-border">
                {preview.issues.slice(0, 100).map((issue, index) => (
                  <div
                    key={`${issue.row}:${issue.field}:${index}`}
                    className="border-b border-border px-3 py-2 text-[12px] last:border-b-0"
                  >
                    <strong>Row {issue.row || "file"} · {issue.field}</strong>
                    <div className="text-muted-foreground">{issue.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[12px]">
                Validation passed. Existing target recipes will receive a new version; new targets
                will create a recipe.
              </div>
            )}
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Btn disabled={busy || parsing} onClick={() => onOpenChange(false)}>
            Close
          </Btn>
          <Btn
            variant="primary"
            disabled={busy || parsing || !preview?.canImport}
            onClick={() => preview && onCommit(preview)}
          >
            Import {preview?.recipeCount ?? 0} recipes
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnitSelect({
  units,
  value,
  onChange,
}: {
  units: RecipeUnitOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select unit</option>
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {unit.symbol} · {unit.name}
        </option>
      ))}
    </select>
  );
}

function componentToDraft(component: RecipeComponentRow): EditorComponent {
  return {
    key: crypto.randomUUID(),
    type: component.inventory_item_id ? "INVENTORY" : "SUB_RECIPE",
    referenceId: component.inventory_item_id ?? component.sub_recipe_id ?? "",
    quantity: formatQuantity(component.quantity_minor),
    unitId: component.unit_id,
    wastePercent: String(component.waste_factor_bps / 100),
    optional: Boolean(component.optional),
  };
}

function emptyComponent(
  inventory: RecipeInventoryOption | undefined,
  units: RecipeUnitOption[],
): EditorComponent {
  return {
    key: crypto.randomUUID(),
    type: "INVENTORY",
    referenceId: inventory?.id ?? "",
    quantity: "1",
    unitId: inventory?.base_unit_id ?? units[0]?.id ?? "",
    wastePercent: "0",
    optional: false,
  };
}

function componentName(component: RecipeComponentRow) {
  return component.inventory_item_name ?? component.sub_recipe_name ?? "Unknown component";
}

function targetName(recipe: RecipeLibraryRow) {
  return recipe.menu_item_name ?? recipe.production_item_name ?? recipe.name ?? "Unlinked recipe";
}

function targetCode(recipe: RecipeLibraryRow) {
  return (
    recipe.menu_item_code ??
    recipe.menu_item_sku ??
    recipe.production_item_code ??
    recipe.production_item_sku ??
    "No target code"
  );
}

function yieldLabel(recipe: RecipeLibraryRow) {
  if (!recipe.yield_quantity_minor) return "No active version";
  return `${formatQuantity(recipe.yield_quantity_minor)} ${recipe.yield_unit_symbol ?? ""}`.trim();
}

function marginPercent(recipe: RecipeLibraryRow) {
  const price = Number(recipe.selling_price_minor ?? 0);
  if (price <= 0) return 0;
  return ((price - Number(recipe.cost_minor ?? 0)) / price) * 100;
}

function foodCostPercent(recipe: RecipeLibraryRow) {
  const price = Number(recipe.selling_price_minor ?? 0);
  if (price <= 0) return 0;
  return (Number(recipe.cost_minor ?? 0) / price) * 100;
}

function recipeStatus(recipe: RecipeLibraryRow) {
  if (!recipe.current_version_id || recipe.costing_error) return "Needs review";
  if (recipe.available_output_quantity_minor <= 0) return "86 risk";
  const margin = marginPercent(recipe);
  if (!recipe.selling_price_minor) return "Unpriced";
  return margin >= 60 ? "Healthy" : margin >= 50 ? "Attention" : "Critical";
}

function formatQuantity(value: number) {
  return (Number(value) / QUANTITY_SCALE).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function toMicro(value: string) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero");
  const scaled = Math.round(quantity * QUANTITY_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("Quantity is outside the supported range");
  return scaled;
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`num text-right ${strong ? "font-bold" : "font-semibold"}`}>{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-[12px] font-semibold text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary";
