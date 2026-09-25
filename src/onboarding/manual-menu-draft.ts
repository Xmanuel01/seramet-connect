import { csvCell, MENU_IMPORT_TEMPLATE_VERSION, menuImportHeaders } from "./menu-import-schema";

export type ManualMenuItem = {
  itemCode: string;
  name: string;
  categoryCode: string;
  basePrice: string;
  currency: string;
  description?: string;
  stationCode?: string;
  sellable: boolean;
};

export function manualMenuCsv(item: ManualMenuItem): string {
  const code = item.itemCode.trim().toUpperCase();
  const name = item.name.trim();
  const category = item.categoryCode.trim().toUpperCase();
  const price = item.basePrice.trim();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) {
    throw new Error("Item code must be 2–40 letters, digits, dashes or underscores.");
  }
  if (name.length < 2 || name.length > 160) {
    throw new Error("Item name must be between 2 and 160 characters.");
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(category)) {
    throw new Error("Enter an existing or new category code.");
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$/.test(price)) {
    throw new Error("Enter a valid nonnegative selling price.");
  }
  if (!/^[A-Z]{3}$/.test(item.currency)) {
    throw new Error("Select a restaurant with a configured currency.");
  }
  const cells: Record<string, string> = {
    templateVersion: String(MENU_IMPORT_TEMPLATE_VERSION),
    itemCode: code,
    name,
    categoryCode: category,
    basePrice: price,
    currency: item.currency,
    description: item.description?.trim() ?? "",
    stationCode: item.stationCode ?? "",
    sellable: String(item.sellable),
    available: "true",
  };
  return [
    menuImportHeaders.map(csvCell).join(","),
    menuImportHeaders.map((header) => csvCell(cells[header] ?? "")).join(","),
  ].join("\n");
}
