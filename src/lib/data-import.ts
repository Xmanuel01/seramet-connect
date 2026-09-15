import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import type { ImportDataset, ImportField } from "@/lib/import-datasets";

export type ImportSourceKind = "csv" | "xlsx" | "pdf" | "image";
export type ImportSeverity = "error" | "warning";

export type ImportIssue = {
  row: number;
  field: string;
  severity: ImportSeverity;
  message: string;
};

export type ImportRow = Record<string, string>;

export type ImportPreview = {
  datasetId: string;
  datasetLabel: string;
  sourceName: string;
  sourceKind: ImportSourceKind;
  importedAt: string;
  rowsRead: number;
  validRows: number;
  rows: ImportRow[];
  issues: ImportIssue[];
  unmappedColumns: string[];
  canConfirm: boolean;
  extraction?: { model: string; notes: string };
};

const truthy = new Set(["1", "yes", "true", "y", "on", "available", "in"]);
const falsy = new Set(["0", "no", "false", "n", "off", "unavailable", "out"]);

export function importSourceKind(fileName: string, mimeType = ""): ImportSourceKind | null {
  const name = fileName.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || mimeType === "text/csv") return "csv";
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
  if (name.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (/\.(png|jpe?g|webp|heic|bmp|tiff?)$/.test(name) || mimeType.startsWith("image/"))
    return "image";
  return null;
}

export function emptyPreview(
  dataset: ImportDataset,
  sourceName: string,
  message: string,
): ImportPreview {
  return {
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    sourceName,
    sourceKind: "csv",
    importedAt: new Date().toISOString(),
    rowsRead: 0,
    validRows: 0,
    rows: [],
    issues: [{ row: 0, field: "file", severity: "error", message }],
    unmappedColumns: [],
    canConfirm: false,
  };
}

export function normaliseKey(header: string) {
  return header
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
}

function matchField(raw: ImportRow, field: ImportField) {
  const target = normaliseKey(field.key);
  const label = normaliseKey(field.label);
  for (const [key, value] of Object.entries(raw)) {
    const normalised = normaliseKey(key);
    if (normalised === target || normalised === label) return value;
  }
  for (const [key, value] of Object.entries(raw)) {
    const normalised = normaliseKey(key);
    if (normalised.includes(target) || target.includes(normalised)) return value;
  }
  return "";
}

export function validateImportRows(
  rawRows: ImportRow[],
  dataset: ImportDataset,
  sourceName: string,
  sourceKind: ImportSourceKind,
  extraction?: { model: string; notes: string },
): ImportPreview {
  const issues: ImportIssue[] = [];
  const rows: ImportRow[] = [];
  const known = new Set(
    dataset.fields.flatMap((field) => [normaliseKey(field.key), normaliseKey(field.label)]),
  );
  const unmappedColumns = Array.from(
    new Set(
      rawRows
        .flatMap((row) => Object.keys(row))
        .filter((key) => !known.has(normaliseKey(key)) && key.trim().length > 0),
    ),
  );

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const mapped: ImportRow = {};
    let rowValid = true;

    dataset.fields.forEach((field) => {
      const value = String(matchField(raw, field) ?? "").trim();
      if (!value) {
        if (field.required) {
          rowValid = false;
          issues.push({
            row: rowNumber,
            field: field.key,
            severity: "error",
            message: `${field.label} is required`,
          });
        }
        mapped[field.key] = "";
        return;
      }
      if (field.type === "number") {
        const numeric = Number(value.replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(numeric)) {
          rowValid = false;
          issues.push({
            row: rowNumber,
            field: field.key,
            severity: "error",
            message: `${field.label} must be a number (got "${value}")`,
          });
          mapped[field.key] = value;
          return;
        }
        mapped[field.key] = String(numeric);
        return;
      }
      if (field.type === "date") {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          issues.push({
            row: rowNumber,
            field: field.key,
            severity: "warning",
            message: `${field.label} "${value}" is not a recognised date and was kept as text`,
          });
          mapped[field.key] = value;
          return;
        }
        mapped[field.key] = parsed.toISOString().slice(0, 10);
        return;
      }
      if (field.type === "boolean") {
        const lower = value.toLowerCase();
        mapped[field.key] = truthy.has(lower) ? "yes" : falsy.has(lower) ? "no" : value;
        return;
      }
      mapped[field.key] = value;
    });

    if (rowValid) rows.push(mapped);
  });

  if (rawRows.length === 0) {
    issues.push({
      row: 0,
      field: "file",
      severity: "error",
      message: "No data rows were found in this document",
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  return {
    datasetId: dataset.id,
    datasetLabel: dataset.label,
    sourceName,
    sourceKind,
    importedAt: new Date().toISOString(),
    rowsRead: rawRows.length,
    validRows: rows.length,
    rows,
    issues,
    unmappedColumns,
    canConfirm: rows.length > 0 && errorCount === 0,
    ...(extraction ? { extraction } : {}),
  };
}

export function parseImportText(text: string, dataset: ImportDataset, sourceName = "Pasted CSV") {
  return validateImportRows(parseCsvRows(text), dataset, sourceName, "csv");
}

export async function parseSpreadsheetImport(file: File, dataset: ImportDataset) {
  const kind = importSourceKind(file.name, file.type);
  if (kind === "xlsx") {
    return validateImportRows(
      await parseXlsxRows(await file.arrayBuffer()),
      dataset,
      file.name,
      "xlsx",
    );
  }
  if (kind === "csv") {
    return validateImportRows(parseCsvRows(await file.text()), dataset, file.name, "csv");
  }
  return emptyPreview(dataset, file.name, "Unsupported file type for direct parsing");
}

export function importTemplateCsv(dataset: ImportDataset) {
  return `${dataset.fields.map((field) => field.key).join(",")}\n${dataset.sampleCsv
    .split("\n")
    .slice(1)
    .join("\n")}`;
}

export function importErrorReportCsv(preview: ImportPreview) {
  const rows = preview.issues.map((issue) => [
    String(issue.row),
    issue.field,
    issue.severity,
    issue.message,
  ]);
  return [["row", "field", "severity", "message"], ...rows]
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function previewToCsv(preview: ImportPreview, dataset: ImportDataset) {
  const headers = dataset.fields.map((field) => field.key);
  const rows = preview.rows.map((row) => headers.map((header) => row[header] ?? ""));
  return [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export async function fileToDataUrl(file: File) {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 8192) {
    binary += String.fromCharCode(...buffer.subarray(index, index + 8192));
  }
  const mime =
    file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/png");
  return `data:${mime};base64,${btoa(binary)}`;
}
