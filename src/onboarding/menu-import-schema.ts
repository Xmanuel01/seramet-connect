export const MENU_IMPORT_TEMPLATE_VERSION = 2;
export const MENU_IMPORTER_VERSION = "menu-import-v2";

export const menuImportHeaders = [
  "templateVersion",
  "itemCode",
  "name",
  "categoryCode",
  "menuSection",
  "description",
  "basePrice",
  "currency",
  "taxCode",
  "serviceChargeApplicable",
  "unitOfMeasure",
  "stationCode",
  "kitchenPrinterGroup",
  "recipeCode",
  "modifierGroupCode",
  "barcode",
  "sku",
  "sellable",
  "branchCode",
  "branchPrice",
  "available",
  "channels",
  "prepMinutes",
  "parLevel",
  "imageFilename",
] as const;

export type MenuImportHeader = (typeof menuImportHeaders)[number];
export type MenuImportTargetMode = "TENANT_MASTER" | "SELECTED_BRANCHES" | "ROW_BRANCHES";

const legacyAliases: Record<string, MenuImportHeader> = {
  code: "itemCode",
  itemcode: "itemCode",
  itemname: "name",
  category: "categoryCode",
  price: "basePrice",
  sellingprice: "basePrice",
  tax: "taxCode",
  taxcategory: "taxCode",
  taxrule: "taxCode",
  servicecharge: "serviceChargeApplicable",
  unit: "unitOfMeasure",
  station: "stationCode",
  productionstation: "stationCode",
  recipe: "recipeCode",
  recipereference: "recipeCode",
  modifiergroup: "modifierGroupCode",
  modifiergroupreference: "modifierGroupCode",
  channelavailability: "channels",
  prep: "prepMinutes",
  par: "parLevel",
};

const canonicalByNormalized = new Map(
  menuImportHeaders.map((header) => [normalizeMenuImportHeader(header), header] as const),
);

export function resolveMenuImportHeader(value: string): MenuImportHeader | undefined {
  const normalized = normalizeMenuImportHeader(value);
  return canonicalByNormalized.get(normalized) ?? legacyAliases[normalized];
}

export function normalizeMenuImportHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function createCanonicalMenuTemplate() {
  const sample: Record<MenuImportHeader, string> = {
    templateVersion: String(MENU_IMPORT_TEMPLATE_VERSION),
    itemCode: "ITEM-001",
    name: "Example item",
    categoryCode: "CATEGORY",
    menuSection: "DEFAULT",
    description: "Replace this row with an actual menu item",
    basePrice: "0",
    currency: "",
    taxCode: "",
    serviceChargeApplicable: "false",
    unitOfMeasure: "",
    stationCode: "",
    kitchenPrinterGroup: "",
    recipeCode: "",
    modifierGroupCode: "",
    barcode: "",
    sku: "ITEM-001",
    sellable: "true",
    branchCode: "",
    branchPrice: "",
    available: "true",
    channels: "",
    prepMinutes: "0",
    parLevel: "0",
    imageFilename: "",
  };
  return [
    menuImportHeaders.map(csvCell).join(","),
    menuImportHeaders.map((header) => csvCell(sample[header])).join(","),
  ].join("\n");
}

export function menuTemplateVersion(rows: Array<Record<string, string>>) {
  const firstPopulated = rows.find((row) => Object.values(row).some((value) => value.trim()));
  const supplied = Object.entries(firstPopulated ?? {}).find(
    ([header]) => resolveMenuImportHeader(header) === "templateVersion",
  )?.[1];
  if (!supplied) return { version: 1, legacy: true };
  const version = Number(supplied);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Menu templateVersion must be a positive integer");
  }
  if (version > MENU_IMPORT_TEMPLATE_VERSION) {
    throw new Error(
      `Menu template version ${version} is newer than supported version ${MENU_IMPORT_TEMPLATE_VERSION}`,
    );
  }
  return { version, legacy: version < MENU_IMPORT_TEMPLATE_VERSION };
}

export function unsupportedPopulatedMenuColumns(rows: Array<Record<string, string>>) {
  const unsupported = new Set<string>();
  for (const row of rows) {
    for (const [header, value] of Object.entries(row)) {
      if (value.trim() && !resolveMenuImportHeader(header)) unsupported.add(header);
    }
  }
  return [...unsupported].sort();
}

export function csvCell(value: string) {
  const safe = /^[=+@]/.test(value) || /^-\D/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
