import {
  MENU_IMPORT_TEMPLATE_VERSION,
  csvCell,
  menuImportHeaders,
  type MenuImportHeader,
} from "@/onboarding/menu-import-schema";

export type ManualMenuItemInput = {
  code: string;
  name: string;
  categoryCode: string;
  basePrice: string;
  currency: string;
  description?: string;
  sku?: string;
  stationCode?: string;
};

export function createManualMenuCsv(input: ManualMenuItemInput) {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const categoryCode = input.categoryCode.trim().toUpperCase();
  const basePrice = input.basePrice.trim();
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) {
    throw new Error("Item code must be 2–40 letters, numbers, hyphens or underscores.");
  }
  if (!name || name.length > 160) throw new Error("Enter an item name (up to 160 characters).");
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(categoryCode)) {
    throw new Error("Enter a valid category code.");
  }
  if (!/^\d+(?:\.\d{1,3})?$/.test(basePrice) || !Number.isFinite(Number(basePrice))) {
    throw new Error("Enter a valid non-negative selling price.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a valid currency.");
  const row: Record<MenuImportHeader, string> = Object.fromEntries(
    menuImportHeaders.map((header) => [header, ""]),
  ) as Record<MenuImportHeader, string>;
  Object.assign(row, {
    templateVersion: String(MENU_IMPORT_TEMPLATE_VERSION),
    itemCode: code,
    name,
    categoryCode,
    menuSection: categoryCode,
    description: input.description?.trim() ?? "",
    basePrice,
    currency,
    serviceChargeApplicable: "false",
    stationCode: input.stationCode?.trim() ?? "",
    sku: input.sku?.trim() || code,
    sellable: "true",
    available: "true",
    prepMinutes: "0",
    parLevel: "0",
  } satisfies Partial<Record<MenuImportHeader, string>>);
  return [
    menuImportHeaders.map(csvCell).join(","),
    menuImportHeaders.map((header) => csvCell(row[header])).join(","),
  ].join("\n");
}
