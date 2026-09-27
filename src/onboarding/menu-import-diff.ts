/**
 * Pure, conservative item diff for the V4 import review step.
 * Missing optional upload fields mean "do not change", not "clear".
 * Caller MUST authorize the tenant and branch before passing live records.
 */
export type ComparedMenuItem = {
  code: string;
  name: string;
  categoryCode: string;
  sellingPriceMinor: number;
  currency: string;
  description?: string | null;
  sku?: string | null;
  barcode?: string | null;
  taxRuleId?: string | null;
  recipeReference?: string | null;
  modifierGroupReference?: string | null;
  stationId?: string | null;
  available?: boolean | null;
  branchPriceMinor?: number | null;
  serviceChargeApplicable?: boolean | null;
};

export type MenuItemDifference = {
  field: keyof ComparedMenuItem;
  current: string | number | boolean | null;
  uploaded: string | number | boolean | null;
  material: boolean;
};

const materialFields = new Set<keyof ComparedMenuItem>([
  "code",
  "categoryCode",
  "sellingPriceMinor",
  "currency",
  "sku",
  "barcode",
  "taxRuleId",
  "recipeReference",
  "modifierGroupReference",
  "stationId",
  "available",
  "branchPriceMinor",
  "serviceChargeApplicable",
]);
const compareFields: Array<keyof ComparedMenuItem> = [
  "name",
  "categoryCode",
  "sellingPriceMinor",
  "currency",
  "description",
  "sku",
  "barcode",
  "taxRuleId",
  "recipeReference",
  "modifierGroupReference",
  "stationId",
  "available",
  "branchPriceMinor",
  "serviceChargeApplicable",
];

function normalized(field: keyof ComparedMenuItem, value: unknown) {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  const trimmed = String(value ?? "").trim();
  if (field === "categoryCode" || field === "currency") return trimmed.toUpperCase();
  if (field === "name") return trimmed.replace(/\s+/g, " ");
  return trimmed;
}

/** Identical rows auto-skip; cosmetic changes default to Keep Current, never auto-write. */
export function classifyMenuItemChange(
  uploaded: ComparedMenuItem,
  existing: ComparedMenuItem | null,
): {
  classification: "NEW" | "IDENTICAL" | "COSMETIC_CHANGE" | "MATERIAL_CHANGE";
  changes: MenuItemDifference[];
} {
  if (!existing) return { classification: "NEW", changes: [] };
  if (normalized("code", uploaded.code) !== normalized("code", existing.code)) {
    return {
      classification: "MATERIAL_CHANGE",
      changes: [
        {
          field: "code",
          current: existing.code,
          uploaded: uploaded.code,
          material: true,
        },
      ],
    };
  }
  const changes: MenuItemDifference[] = [];
  for (const field of compareFields) {
    const rawProposed = uploaded[field];
    // Optional blank spreadsheet columns must not clear existing values by accident.
    if (rawProposed === undefined || rawProposed === null) continue;
    const current = normalized(field, existing[field]);
    const proposed = normalized(field, rawProposed);
    if (current === proposed) continue;
    changes.push({
      field,
      current,
      uploaded: proposed,
      material: materialFields.has(field),
    });
  }
  return {
    classification: changes.some((change) => change.material)
      ? "MATERIAL_CHANGE"
      : changes.length
        ? "COSMETIC_CHANGE"
        : "IDENTICAL",
    changes,
  };
}
