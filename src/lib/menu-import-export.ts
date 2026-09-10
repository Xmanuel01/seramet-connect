import type { Product } from "@/lib/menu-product";
import { formatDateTime } from "@/lib/currency";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";

export type MenuImportSource = "csv" | "xlsx";
export type MenuImportSeverity = "error" | "warning";
export type MenuImportIssue = {
  row: number;
  field: string;
  severity: MenuImportSeverity;
  message: string;
};

export type MenuImportPreview = {
  sourceName: string;
  sourceType: MenuImportSource;
  importedAt: string;
  rowsRead: number;
  validRows: number;
  categories: string[];
  products: Product[];
  issues: MenuImportIssue[];
  canConfirm: boolean;
};

type RawMenuRow = Record<string, string>;

const requiredColumns = ["name", "category", "price"] as const;
const productionStations = ["MAIN KITCHEN", "GRILL", "BAR", "DESSERT", "DISPATCH", "NONE"] as const;
const truthy = new Set(["1", "yes", "true", "y", "on", "available"]);
const falsy = new Set(["0", "no", "false", "n", "off", "unavailable"]);

export async function parseMenuFile(
  file: File,
  branchNames = configuredBranchNames(),
): Promise<MenuImportPreview> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const rows = await parseXlsxRows(await file.arrayBuffer());
    return validateMenuRows(rows, file.name, "xlsx", branchNames);
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return validateMenuRows(parseCsvRows(await file.text()), file.name, "csv", branchNames);
  }
  return {
    sourceName: file.name,
    sourceType: "csv",
    importedAt: timestamp(),
    rowsRead: 0,
    validRows: 0,
    categories: [],
    products: [],
    issues: [
      { row: 0, field: "file", severity: "error", message: "Upload a .csv or .xlsx menu file" },
    ],
    canConfirm: false,
  };
}

export function parseMenuText(
  text: string,
  sourceName = "Pasted CSV",
  branchNames = configuredBranchNames(),
): MenuImportPreview {
  return validateMenuRows(parseCsvRows(text), sourceName, "csv", branchNames);
}

export function confirmMenuImport(currentProducts: Product[], preview: MenuImportPreview) {
  if (!preview.canConfirm) {
    return {
      products: currentProducts,
      imported: 0,
      replaced: 0,
      message: "Fix validation errors before confirming the menu import.",
    };
  }
  const byKey = new Map(currentProducts.map((product) => [menuKey(product), product]));
  let replaced = 0;
  preview.products.forEach((product) => {
    const key = menuKey(product);
    if (byKey.has(key)) replaced += 1;
    byKey.set(key, product);
  });
  return {
    products: Array.from(byKey.values()),
    imported: preview.products.length,
    replaced,
    message: `${preview.products.length} menu items confirmed, ${replaced} existing items updated.`,
  };
}

export function exportMenuToCsv(items: Product[], branch?: string) {
  const branchNames = configuredBranchNames();
  const headers = [
    "itemCode",
    "sku",
    "name",
    "category",
    "price",
    "prep",
    "productionStation",
    "popular",
    "out",
    ...branchNames.map((name) => `${branchColumnPrefix(name)}Price`),
    ...branchNames.map((name) => `${branchColumnPrefix(name)}Available`),
    "imageFilename",
    "imageUrl",
  ];
  const rows = items.map((item) => [
    item.itemCode ?? "",
    item.sku ?? "",
    item.name,
    item.category,
    String(branch ? (item.branchPrices?.[branch] ?? item.price) : item.price),
    String(item.prep),
    item.productionStation ?? "NONE",
    item.popular ? "yes" : "no",
    item.out ? "yes" : "no",
    ...branchNames.map((name) => String(item.branchPrices?.[name] ?? "")),
    ...branchNames.map((name) => (item.branchAvailability?.[name] === false ? "no" : "yes")),
    item.imageFilename ?? "",
    item.imageUrl ?? "",
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportMenuImportTemplate(branchNames = configuredBranchNames()) {
  const headers = [
    "itemCode",
    "name",
    "category",
    "menuSection",
    "description",
    "price",
    "costPrice",
    "taxCategory",
    "unitOfMeasure",
    "productionStation",
    "kitchenPrinterGroup",
    "modifierGroup",
    "barcode",
    "sku",
    ...branchNames.map((name) => `${branchColumnPrefix(name)}Available`),
    "channelAvailability",
    "status",
    "prep",
    "par",
    "imageFilename",
    ...branchNames.map((name) => `${branchColumnPrefix(name)}Price`),
  ];
  const sample = [
    "ITEM-001",
    "Example item",
    "CATEGORY",
    "DEFAULT",
    "Replace this row with an actual menu item",
    "0",
    "0",
    "",
    "unit",
    "",
    "",
    "",
    "",
    "ITEM-001",
    ...branchNames.map(() => "yes"),
    "",
    "active",
    "18",
    "20",
    "",
    ...branchNames.map(() => "0"),
  ];
  return [headers, sample].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportMenuErrorReport(preview: MenuImportPreview) {
  const headers = ["sourceName", "row", "field", "severity", "message"];
  const rows = preview.issues.map((issue) => [
    preview.sourceName,
    String(issue.row || ""),
    issue.field,
    issue.severity,
    issue.message,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function validateMenuRows(
  rows: RawMenuRow[],
  sourceName: string,
  sourceType: MenuImportSource,
  branchNames = configuredBranchNames(),
): MenuImportPreview {
  const issues: MenuImportIssue[] = [];
  const products: Product[] = [];
  const seen = new Set<string>();
  const headers = Object.keys(rows[0] ?? {});

  requiredColumns.forEach((column) => {
    if (!headers.includes(column)) {
      issues.push({
        row: 0,
        field: column,
        severity: "error",
        message: `Missing required column: ${column}`,
      });
    }
  });

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = clean(row["name"]);
    const category = clean(row["category"]);
    const price = parseMoney(row["price"]);
    const prep = parseWholeNumber(row["prep"] || "0");
    const station = normalizeStation(
      row["productionstation"] || row["productionStation"] || row["station"],
    );
    const rowIssues: MenuImportIssue[] = [];

    if (!name)
      rowIssues.push({
        row: rowNumber,
        field: "name",
        severity: "error",
        message: "Menu item name is required",
      });
    if (!category)
      rowIssues.push({
        row: rowNumber,
        field: "category",
        severity: "error",
        message: "Category is required",
      });
    if (price === null || price <= 0)
      rowIssues.push({
        row: rowNumber,
        field: "price",
        severity: "error",
        message: "Price must be a positive number",
      });
    if (prep === null || prep < 0)
      rowIssues.push({
        row: rowNumber,
        field: "prep",
        severity: "error",
        message: "Prep time must be zero or greater",
      });
    if (!station)
      rowIssues.push({
        row: rowNumber,
        field: "productionStation",
        severity: "error",
        message: `Production station must be one of ${productionStations.join(", ")}`,
      });

    const duplicateKey = `${name.toLowerCase()}::${category.toLowerCase()}`;
    if (seen.has(duplicateKey)) {
      rowIssues.push({
        row: rowNumber,
        field: "name",
        severity: "error",
        message: "Duplicate item in this import",
      });
    }
    if (station === "BAR" && !category.toLowerCase().includes("drink")) {
      rowIssues.push({
        row: rowNumber,
        field: "productionStation",
        severity: "warning",
        message: "BAR station is usually used for drink categories",
      });
    }

    issues.push(...rowIssues);
    if (
      rowIssues.some((issue) => issue.severity === "error") ||
      price === null ||
      prep === null ||
      !station
    )
      return;

    seen.add(duplicateKey);
    const branchPrices = Object.fromEntries(
      branchNames.flatMap((branchName) => {
        const value = parseOptionalMoney(row[`${branchColumnPrefix(branchName)}Price`]);
        return value === undefined ? [] : [[branchName, value]];
      }),
    ) as Record<string, number>;
    const branchAvailability = Object.fromEntries(
      branchNames.flatMap((branchName) => {
        const value = parseAvailability(row[`${branchColumnPrefix(branchName)}Available`]);
        return value === undefined ? [] : [[branchName, value]];
      }),
    ) as Record<string, boolean>;
    products.push(
      stripUndefined({
        id: slugify(`${category}-${name}`),
        itemCode: clean(row["itemcode"] || row["itemCode"]),
        sku: clean(row["sku"]),
        name,
        category,
        price,
        prep,
        imageFilename: clean(row["imagefilename"] || row["imageFilename"]),
        imageUrl: clean(row["imageurl"] || row["imageUrl"]),
        popular: parseBoolean(row["popular"]),
        out: parseBoolean(row["out"]),
        productionStation: station,
        ...(Object.keys(branchPrices).length ? { branchPrices } : {}),
        ...(Object.keys(branchAvailability).length ? { branchAvailability } : {}),
        importSource: "menu-import" as const,
      }) as Product,
    );
  });

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return {
    sourceName,
    sourceType,
    importedAt: timestamp(),
    rowsRead: rows.length,
    validRows: products.length,
    categories: Array.from(new Set(products.map((product) => product.category))).sort(),
    products,
    issues,
    canConfirm: rows.length > 0 && errorCount === 0,
  };
}

export function parseCsvRows(text: string): RawMenuRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const headers = (rows.shift() ?? []).map((header) => normalizeHeader(header));
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, clean(values[index] ?? "")])),
  );
}

export async function parseXlsxRows(buffer: ArrayBuffer): Promise<RawMenuRow[]> {
  const files = await readZipEntries(buffer);
  const workbook = files.get("xl/workbook.xml") ?? "";
  const rels = files.get("xl/_rels/workbook.xml.rels") ?? "";
  const firstSheetTarget =
    firstMatch(rels, /Target="([^"]*worksheets\/sheet\d+\.xml)"/) ??
    firstMatch(workbook, /sheetId="1"[^>]*r:id="([^"]+)"/);
  const sheetPath = firstSheetTarget?.startsWith("xl/")
    ? firstSheetTarget
    : `xl/${firstSheetTarget ?? "worksheets/sheet1.xml"}`;
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml") ?? "");
  return sheetXmlToRows(
    files.get(sheetPath.replace(/\\/g, "/")) ?? files.get("xl/worksheets/sheet1.xml") ?? "",
    sharedStrings,
  );
}

async function readZipEntries(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const entries = new Map<string, string>();
  let eocd = -1;
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file: missing ZIP directory");
  const totalEntries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();

  for (let count = 0; count < totalEntries; count += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameBytes = new Uint8Array(buffer, cursor + 46, nameLength);
    const fileName = decoder.decode(nameBytes);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataStart, compressedSize);
    if (method === 0) {
      entries.set(fileName, decoder.decode(compressed));
    } else if (method === 8) {
      entries.set(fileName, decoder.decode(await inflateRaw(compressed)));
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(bytes: Uint8Array) {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseSharedStrings(xml: string) {
  return [...xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    decodeXml(
      [...(match[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => part[1] ?? "")
        .join(""),
    ),
  );
}

function sheetXmlToRows(xml: string, sharedStrings: string[]): RawMenuRow[] {
  const table = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
    .map((rowMatch) => {
      const values: string[] = [];
      [...(rowMatch[1] ?? "").matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].forEach(
        (cellMatch, fallbackIndex) => {
          const attrs = cellMatch[1] ?? "";
          const columnRef = firstMatch(attrs, /r="([A-Z]+)\d+"/);
          const index = columnRef ? columnToIndex(columnRef) : fallbackIndex;
          const type = firstMatch(attrs, /t="([^"]+)"/);
          const body = cellMatch[2] ?? "";
          const raw =
            firstMatch(body, /<v[^>]*>([\s\S]*?)<\/v>/) ??
            firstMatch(body, /<t[^>]*>([\s\S]*?)<\/t>/) ??
            "";
          values[index] = type === "s" ? (sharedStrings[Number(raw)] ?? "") : decodeXml(raw);
        },
      );
      return values;
    })
    .filter((row) => row.some((value) => clean(value)));
  const headers = (table.shift() ?? []).map((header) => normalizeHeader(header));
  return table.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, clean(values[index] ?? "")])),
  );
}

function columnToIndex(column: string) {
  return [...column].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function normalizeHeader(header: string) {
  return clean(header)
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^./, (char) => char.toLowerCase());
}

function normalizeStation(value?: string) {
  const station = clean(value).replace(/-/g, " ").replace(/\s+/g, " ").toUpperCase();
  return productionStations.find((item) => item === station);
}

function parseMoney(value?: string) {
  const cleaned = clean(value).replace(/ksh/gi, "").replace(/,/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalMoney(value?: string) {
  const parsed = parseMoney(value);
  return parsed && parsed > 0 ? parsed : undefined;
}

function parseWholeNumber(value?: string) {
  const cleaned = clean(value);
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseBoolean(value?: string) {
  const normalized = clean(value).toLowerCase();
  if (truthy.has(normalized)) return true;
  if (falsy.has(normalized)) return false;
  return undefined;
}

function parseAvailability(value?: string) {
  const parsed = parseBoolean(value);
  return parsed === undefined ? undefined : parsed;
}

function menuKey(product: Product) {
  return `${product.category.toLowerCase()}::${product.name.toLowerCase()}`;
}

function slugify(value: string) {
  return `mi-${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function clean(value?: string) {
  return (value ?? "").trim();
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function firstMatch(value: string, pattern: RegExp) {
  return pattern.exec(value)?.[1];
}

function timestamp() {
  return formatDateTime(new Date(), { hour12: false });
}

function configuredBranchNames() {
  const repository = getConfigurationRepository();
  const tenant = repository.snapshot().tenants.find((candidate) => candidate.active);
  return tenant ? repository.listBranches(tenant.id).map((branch) => branch.name) : [];
}

function branchColumnPrefix(branchName: string) {
  return branchName.replace(/[^a-z0-9]/gi, "").replace(/^./, (char) => char.toLowerCase());
}

function stripUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
