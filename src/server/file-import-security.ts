import { ServerOperationError } from "@/server/errors";

export type ImportKind =
  | "BANK"
  | "SETTLEMENT"
  | "MENU"
  | "INVENTORY"
  | "SUPPLIER"
  | "STAFF"
  | "OPENING_STOCK"
  | "CONFIGURATION";

export type MalwareScanAdapter = {
  scan(input: { bytes: Uint8Array; filename: string; contentType: string }): Promise<{
    clean: boolean;
    reference?: string;
  }>;
};

const limits: Record<ImportKind, { maxBytes: number; maxRows: number; extensions: string[] }> = {
  BANK: { maxBytes: 10 * 1024 * 1024, maxRows: 50_000, extensions: ["csv", "ofx", "xlsx"] },
  SETTLEMENT: { maxBytes: 20 * 1024 * 1024, maxRows: 100_000, extensions: ["csv", "xlsx"] },
  MENU: { maxBytes: 10 * 1024 * 1024, maxRows: 25_000, extensions: ["csv", "xlsx"] },
  INVENTORY: { maxBytes: 15 * 1024 * 1024, maxRows: 50_000, extensions: ["csv", "xlsx"] },
  SUPPLIER: { maxBytes: 10 * 1024 * 1024, maxRows: 25_000, extensions: ["csv", "xlsx"] },
  STAFF: { maxBytes: 10 * 1024 * 1024, maxRows: 25_000, extensions: ["csv", "xlsx"] },
  OPENING_STOCK: { maxBytes: 15 * 1024 * 1024, maxRows: 50_000, extensions: ["csv", "xlsx"] },
  CONFIGURATION: { maxBytes: 2 * 1024 * 1024, maxRows: 10_000, extensions: ["json"] },
};

export async function validateImportFile(input: {
  kind: ImportKind;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  estimatedRows?: number;
  scanner?: MalwareScanAdapter;
}) {
  const policy = limits[input.kind];
  const filename = input.filename.trim();
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new ServerOperationError("VALIDATION_FAILED", 400, "Import filename is unsafe");
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!policy.extensions.includes(extension)) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      415,
      `.${extension || "unknown"} is not allowed for ${input.kind}`,
    );
  }
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > policy.maxBytes) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      413,
      "Import file size is outside the permitted range",
    );
  }
  if ((input.estimatedRows ?? 0) > policy.maxRows) {
    throw new ServerOperationError("VALIDATION_FAILED", 413, "Import row limit exceeded");
  }
  const normalizedType = input.contentType.split(";")[0]?.trim().toLowerCase();
  const allowedMime = new Set([
    "text/csv",
    "application/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/x-ofx",
    "application/octet-stream",
  ]);
  if (!normalizedType || !allowedMime.has(normalizedType)) {
    throw new ServerOperationError("VALIDATION_FAILED", 415, "Import MIME type is not allowed");
  }
  if (extension === "xlsx" && !(input.bytes[0] === 0x50 && input.bytes[1] === 0x4b)) {
    throw new ServerOperationError("VALIDATION_FAILED", 400, "Workbook signature is invalid");
  }
  if (input.scanner) {
    const scan = await input.scanner.scan({
      bytes: input.bytes,
      filename,
      contentType: normalizedType,
    });
    if (!scan.clean)
      throw new ServerOperationError("VALIDATION_FAILED", 422, "Import failed malware screening");
  }
  return {
    kind: input.kind,
    filename,
    extension,
    bytes: input.bytes.byteLength,
    maxRows: policy.maxRows,
    requiresPreview: true,
    digest: await sha256(input.bytes),
  };
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
