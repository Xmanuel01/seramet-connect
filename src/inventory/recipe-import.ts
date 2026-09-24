import { QUANTITY_SCALE } from "@/inventory/quantity";
import type { RecipeDefinitionInput } from "@/inventory/types";
import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import { parseMajorAmount } from "@/payments/money";

type LookupRow = {
  id: string;
  code?: string | null;
  sku?: string | null;
  name: string;
};

type UnitRow = LookupRow & { symbol: string };
type BranchRow = { id: string; code?: string | null; name: string };
type ExistingRecipe = {
  id: string;
  menu_item_id: string | null;
  production_item_id: string | null;
  branch_override_id: string | null;
};

export type RecipeImportContext = {
  currency: string;
  menuItems: LookupRow[];
  inventoryItems: Array<LookupRow & { base_unit_id: string }>;
  units: UnitRow[];
  recipes: Array<LookupRow & ExistingRecipe>;
  branches: BranchRow[];
  activeBranchId: string;
};

export type RecipeImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type RecipeImportPreview = {
  sourceName: string;
  rowsRead: number;
  recipeCount: number;
  definitions: RecipeDefinitionInput[];
  issues: RecipeImportIssue[];
  canImport: boolean;
};

type RawRow = Record<string, string>;

export async function parseRecipeImportFile(
  file: File,
  context: RecipeImportContext,
): Promise<RecipeImportPreview> {
  const lower = file.name.toLowerCase();
  let rows: RawRow[];
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    rows = parseCsvRows(await file.text());
  } else if (lower.endsWith(".xlsx")) {
    rows = await parseXlsxRows(await file.arrayBuffer());
  } else {
    return {
      sourceName: file.name,
      rowsRead: 0,
      recipeCount: 0,
      definitions: [],
      issues: [{ row: 0, field: "file", message: "Upload a CSV or XLSX recipe file" }],
      canImport: false,
    };
  }
  return buildRecipeImportPreview(rows, file.name, context);
}

export function createRecipeImportTemplate() {
  const headers = [
    "recipe",
    "menuItem",
    "productionItem",
    "branch",
    "yieldQuantity",
    "yieldUnit",
    "ingredient",
    "subRecipe",
    "ingredientQuantity",
    "ingredientUnit",
    "wastePercent",
    "optional",
    "packagingCost",
    "overheadCost",
  ];
  const example = [
    "Sample Dish",
    "MENU-001",
    "",
    "",
    "1",
    "piece",
    "ING-001",
    "",
    "0.25",
    "kg",
    "2",
    "no",
    "0",
    "0",
  ];
  return [headers, example].map((row) => row.map(csvCell).join(",")).join("\n");
}

function buildRecipeImportPreview(
  rows: RawRow[],
  sourceName: string,
  context: RecipeImportContext,
): RecipeImportPreview {
  const issues: RecipeImportIssue[] = [];
  const groups = new Map<
    string,
    {
      firstRow: number;
      name: string;
      menuItemId?: string;
      productionItemId?: string;
      branchOverrideId?: string;
      yieldQuantityMicro: number;
      yieldUnitId: string;
      packagingCostMinor: number;
      productionOverheadMinor: number;
      components: RecipeDefinitionInput["components"];
      componentKeys: Set<string>;
    }
  >();

  if (rows.length > 5_000) {
    issues.push({ row: 0, field: "file", message: "Recipe import is limited to 5,000 rows" });
  }

  rows.slice(0, 5_000).forEach((row, index) => {
    const rowNumber = index + 2;
    const name = clean(row["recipe"] || row["recipename"]);
    const menuRef = clean(row["menuitem"] || row["menu"]);
    const productionRef = clean(row["productionitem"] || row["outputitem"]);
    const branchRef = clean(row["branch"]);
    const yieldQuantity = positiveNumber(row["yieldquantity"]);
    const yieldUnit = resolveOne(row["yieldunit"], context.units, ["id", "code", "symbol", "name"]);
    const ingredient = resolveOne(
      row["ingredient"],
      context.inventoryItems,
      ["id", "code", "sku", "name"],
    );
    const subRecipe = resolveOne(row["subrecipe"], context.recipes, ["id", "code", "name"]);
    const componentQuantity = positiveNumber(row["ingredientquantity"] || row["quantity"]);
    const componentUnit = resolveOne(
      row["ingredientunit"] || row["unit"],
      context.units,
      ["id", "code", "symbol", "name"],
    );
    const wastePercent = numberOrZero(row["wastepercent"]);
    const optional = parseBoolean(row["optional"]);
    const menu = menuRef
      ? resolveOne(menuRef, context.menuItems, ["id", "code", "sku", "name"])
      : null;
    const production = productionRef
      ? resolveOne(productionRef, context.inventoryItems, ["id", "code", "sku", "name"])
      : null;
    const branch = branchRef
      ? resolveOne(branchRef, context.branches, ["id", "code", "name"])
      : null;

    const rowIssues: RecipeImportIssue[] = [];
    if (!name) rowIssues.push(issue(rowNumber, "recipe", "Recipe name is required"));
    if (Boolean(menuRef) === Boolean(productionRef)) {
      rowIssues.push(
        issue(
          rowNumber,
          "menuItem/productionItem",
          "Provide exactly one menu item or production item",
        ),
      );
    }
    if (menuRef && !menu) rowIssues.push(issue(rowNumber, "menuItem", "Menu item was not found"));
    if (productionRef && !production) {
      rowIssues.push(issue(rowNumber, "productionItem", "Production inventory item was not found"));
    }
    if (!(yieldQuantity && yieldQuantity > 0)) {
      rowIssues.push(issue(rowNumber, "yieldQuantity", "Yield quantity must be greater than zero"));
    }
    if (!yieldUnit) rowIssues.push(issue(rowNumber, "yieldUnit", "Yield unit was not found"));
    if (branchRef && !branch) rowIssues.push(issue(rowNumber, "branch", "Branch was not found"));
    if (Boolean(clean(row["ingredient"])) === Boolean(clean(row["subrecipe"]))) {
      rowIssues.push(
        issue(
          rowNumber,
          "ingredient/subRecipe",
          "Provide exactly one inventory ingredient or sub-recipe",
        ),
      );
    }
    if (clean(row["ingredient"]) && !ingredient) {
      rowIssues.push(issue(rowNumber, "ingredient", "Inventory ingredient was not found"));
    }
    if (clean(row["subrecipe"]) && !subRecipe) {
      rowIssues.push(issue(rowNumber, "subRecipe", "Sub-recipe was not found"));
    }
    if (!(componentQuantity && componentQuantity > 0)) {
      rowIssues.push(
        issue(rowNumber, "ingredientQuantity", "Ingredient quantity must be greater than zero"),
      );
    }
    if (!componentUnit) {
      rowIssues.push(issue(rowNumber, "ingredientUnit", "Ingredient unit was not found"));
    }
    if (wastePercent < 0 || wastePercent > 1000) {
      rowIssues.push(issue(rowNumber, "wastePercent", "Waste percent must be between 0 and 1000"));
    }

    let packagingCostMinor = 0;
    let productionOverheadMinor = 0;
    try {
      packagingCostMinor = clean(row["packagingcost"])
        ? parseMajorAmount(row["packagingcost"], context.currency)
        : 0;
      productionOverheadMinor = clean(row["overheadcost"])
        ? parseMajorAmount(row["overheadcost"], context.currency)
        : 0;
      if (packagingCostMinor < 0 || productionOverheadMinor < 0) {
        throw new Error("Recipe costs cannot be negative");
      }
    } catch (error) {
      rowIssues.push(
        issue(
          rowNumber,
          "packagingCost/overheadCost",
          error instanceof Error ? error.message : "Invalid recipe cost",
        ),
      );
    }

    issues.push(...rowIssues);
    if (rowIssues.length || !yieldUnit || !componentUnit || !componentQuantity || !yieldQuantity) {
      return;
    }

    const targetId = menu?.id ?? production?.id ?? "";
    const branchId = branch?.id ?? "";
    const groupKey = [name.toLowerCase(), menu ? "MENU" : "PRODUCTION", targetId, branchId].join("|");
    const existingGroup = groups.get(groupKey);
    const componentKey = ingredient ? `inventory:${ingredient.id}` : `recipe:${subRecipe?.id}`;

    if (existingGroup) {
      if (
        existingGroup.yieldQuantityMicro !== toMicro(yieldQuantity) ||
        existingGroup.yieldUnitId !== yieldUnit.id ||
        existingGroup.packagingCostMinor !== packagingCostMinor ||
        existingGroup.productionOverheadMinor !== productionOverheadMinor
      ) {
        issues.push(
          issue(
            rowNumber,
            "recipe",
            "Rows for one recipe must use the same yield and recipe-level costs",
          ),
        );
        return;
      }
      if (existingGroup.componentKeys.has(componentKey)) {
        issues.push(
          issue(rowNumber, "ingredient", "The same component appears more than once in this recipe"),
        );
        return;
      }
      existingGroup.componentKeys.add(componentKey);
      existingGroup.components.push({
        ...(ingredient
          ? { inventoryItemId: ingredient.id }
          : { subRecipeId: subRecipe!.id }),
        quantityMicro: toMicro(componentQuantity),
        unitId: componentUnit.id,
        wasteFactorBps: Math.round(wastePercent * 100),
        optional,
      });
      return;
    }

    groups.set(groupKey, {
      firstRow: rowNumber,
      name,
      ...(menu ? { menuItemId: menu.id } : { productionItemId: production!.id }),
      ...(branch ? { branchOverrideId: branch.id } : {}),
      yieldQuantityMicro: toMicro(yieldQuantity),
      yieldUnitId: yieldUnit.id,
      packagingCostMinor,
      productionOverheadMinor,
      components: [
        {
          ...(ingredient
            ? { inventoryItemId: ingredient.id }
            : { subRecipeId: subRecipe!.id }),
          quantityMicro: toMicro(componentQuantity),
          unitId: componentUnit.id,
          wasteFactorBps: Math.round(wastePercent * 100),
          optional,
        },
      ],
      componentKeys: new Set([componentKey]),
    });
  });

  const definitions = Array.from(groups.values()).map((group) => {
    const existing = context.recipes.find(
      (recipe) =>
        (group.menuItemId ? recipe.menu_item_id === group.menuItemId : true) &&
        (group.productionItemId
          ? recipe.production_item_id === group.productionItemId
          : recipe.production_item_id == null) &&
        (recipe.branch_override_id ?? "") === (group.branchOverrideId ?? ""),
    );
    return {
      ...(existing ? { recipeId: existing.id } : {}),
      ...(group.menuItemId ? { menuItemId: group.menuItemId } : {}),
      ...(group.productionItemId ? { productionItemId: group.productionItemId } : {}),
      ...(group.branchOverrideId ? { branchOverrideId: group.branchOverrideId } : {}),
      name: group.name,
      yieldQuantityMicro: group.yieldQuantityMicro,
      yieldUnitId: group.yieldUnitId,
      packagingCostMinor: group.packagingCostMinor,
      productionOverheadMinor: group.productionOverheadMinor,
      components: group.components,
    } satisfies RecipeDefinitionInput;
  });

  return {
    sourceName,
    rowsRead: rows.length,
    recipeCount: definitions.length,
    definitions,
    issues,
    canImport: rows.length > 0 && definitions.length > 0 && issues.length === 0,
  };
}

function resolveOne<T extends Record<string, unknown>>(
  value: string | undefined,
  rows: T[],
  fields: string[],
): T | null {
  const needle = clean(value).toLowerCase();
  if (!needle) return null;
  const exact = rows.filter((row) =>
    fields.some((field) => clean(String(row[field] ?? "")).toLowerCase() === needle),
  );
  return exact.length === 1 ? exact[0]! : null;
}

function positiveNumber(value: string | undefined) {
  const parsed = Number(clean(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberOrZero(value: string | undefined) {
  const normalized = clean(value);
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseBoolean(value: string | undefined) {
  return new Set(["1", "true", "yes", "y", "on"]).has(clean(value).toLowerCase());
}

function toMicro(value: number) {
  const scaled = Math.round(value * QUANTITY_SCALE);
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error("Quantity is outside range");
  return scaled;
}

function issue(row: number, field: string, message: string): RecipeImportIssue {
  return { row, field, message };
}

function clean(value: string | undefined) {
  return String(value ?? "").trim();
}

function csvCell(value: string) {
  const safe = /^[=+@]/.test(value) || /^-\D/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
