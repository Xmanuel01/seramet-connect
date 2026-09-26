import { ServerOperationError } from "@/server/errors";
import type { MalwareScanner } from "@/server/environment";

export type ImportKind =
  | "BANK"
  | "SETTLEMENT"
  | "MENU"
  | "INVENTORY"
  | "SUPPLIER"
  | "STAFF"
  | "OPENING_STOCK"
  | "CONFIGURATION"
  | "HISTORICAL_SALES";

export type CleanScanEvidence = {
  status: "CLEAN";
  fileDigest: string;
  scannedAt: string;
  reference?: string;
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
  HISTORICAL_SALES: { maxBytes: 20 * 1024 * 1024, maxRows: 100_000, extensions: ["csv", "xlsx"] },
};

export async function validateImportFile(input: {
  kind: ImportKind;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  estimatedRows?: number;
  scanner?: MalwareScanner;
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
  if (!input.scanner) {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "File imports are unavailable until security scanning is configured",
    );
  }
  const digest = await sha256(input.bytes);
  let scan: Awaited<ReturnType<MalwareScanner["scan"]>>;
  try {
    scan = await withTimeout(
      input.scanner.scan({
        bytes: exactArrayBuffer(input.bytes),
        fileName: filename,
        contentType: normalizedType,
      }),
      10_000,
    );
  } catch {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "File security scanning is temporarily unavailable",
    );
  }
  if (scan.status === "ERROR") {
    throw new ServerOperationError(
      "EXTERNAL_SERVICE_UNAVAILABLE",
      503,
      "File security scanning is temporarily unavailable",
    );
  }
  if (scan.status !== "CLEAN") {
    throw new ServerOperationError("VALIDATION_FAILED", 422, "Import failed malware screening");
  }
  const scanEvidence: CleanScanEvidence = {
    status: "CLEAN",
    fileDigest: digest,
    scannedAt: new Date().toISOString(),
    ...(scan.reference ? { reference: scan.reference } : {}),
  };
  return {
    kind: input.kind,
    filename,
    extension,
    bytes: input.bytes.byteLength,
    maxRows: policy.maxRows,
    requiresPreview: true,
    digest,
    scanEvidence,
  };
}

export function requireCleanScanEvidence(report: unknown, fileDigest: string) {
  const evidence =
    report && typeof report === "object"
      ? (report as { cleanScan?: Partial<CleanScanEvidence> }).cleanScan
      : undefined;
  if (
    evidence?.status !== "CLEAN" ||
    evidence.fileDigest !== fileDigest ||
    typeof evidence.scannedAt !== "string" ||
    Number.isNaN(Date.parse(evidence.scannedAt))
  ) {
    throw new ServerOperationError(
      "CONFLICT",
      409,
      "This preview has no valid file security scan. Upload the file again.",
    );
  }
  return evidence as CleanScanEvidence;
}

function exactArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Malware scan timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
