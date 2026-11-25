import type { D1Database } from "@/server/database/d1";
import { validateLogo, type ReceiptLogo } from "../../printing-core/thermal-layout.mjs";

/**
 * Receipt logos are 1-bit images printed above bills, receipts and invoices.
 * They live in document_templates under their own document type so no schema
 * change is needed. Configuration loading skips them, so the image bytes never
 * travel with every settings snapshot; only printing and the Printers page
 * read them.
 */
export const RECEIPT_LOGO_DOCUMENT_TYPE = "RECEIPT_LOGO";
const LAYOUT_VERSION = "logo-v1";

export type ReceiptLogoScope = "COMPANY" | "BRANCH";
export type StoredReceiptLogo = ReceiptLogo & { updatedAt: string; updatedBy: string };

export function receiptLogoId(scope: ReceiptLogoScope, branchId: string) {
  return scope === "BRANCH" ? `receipt-logo:branch:${branchId}` : "receipt-logo:company";
}

function parseStored(payload: string | undefined): StoredReceiptLogo | undefined {
  if (!payload) return undefined;
  try {
    const value = JSON.parse(payload) as StoredReceiptLogo;
    const logo = { width: value.width, height: value.height, data: value.data };
    validateLogo(logo);
    return {
      ...logo,
      updatedAt: String(value.updatedAt ?? ""),
      updatedBy: String(value.updatedBy ?? ""),
    };
  } catch {
    // A damaged row prints no logo rather than blocking the receipt.
    return undefined;
  }
}

export async function readReceiptLogos(db: D1Database, tenantId: string, branchId: string) {
  const rows = await db
    .prepare(
      "SELECT id,payload_json FROM document_templates WHERE tenant_id=? AND document_type=? AND active=1 AND id IN (?,?)",
    )
    .bind(
      tenantId,
      RECEIPT_LOGO_DOCUMENT_TYPE,
      receiptLogoId("COMPANY", branchId),
      receiptLogoId("BRANCH", branchId),
    )
    .all<{ id: string; payload_json: string }>();
  const byId = new Map((rows.results ?? []).map((row) => [row.id, row.payload_json]));
  const company = parseStored(byId.get(receiptLogoId("COMPANY", branchId)));
  const branch = parseStored(byId.get(receiptLogoId("BRANCH", branchId)));
  return { ...(company ? { company } : {}), ...(branch ? { branch } : {}) };
}

/** The logo a branch prints: its own, else the company logo, else none. */
export async function effectiveReceiptLogo(
  db: D1Database,
  tenantId: string,
  branchId: string,
): Promise<ReceiptLogo | undefined> {
  const { company, branch } = await readReceiptLogos(db, tenantId, branchId);
  const chosen = branch ?? company;
  return chosen ? { width: chosen.width, height: chosen.height, data: chosen.data } : undefined;
}

export function saveReceiptLogoStatement(
  db: D1Database,
  input: {
    tenantId: string;
    branchId: string;
    scope: ReceiptLogoScope;
    logo: ReceiptLogo;
    actorId: string;
    now: string;
  },
) {
  const payload: StoredReceiptLogo = {
    width: input.logo.width,
    height: input.logo.height,
    data: input.logo.data,
    updatedAt: input.now,
    updatedBy: input.actorId,
  };
  return db
    .prepare(
      `INSERT INTO document_templates (tenant_id,id,branch_id,document_type,layout_version,active,payload_json)
       VALUES (?,?,?,?,?,1,?)
       ON CONFLICT(tenant_id,id) DO UPDATE SET payload_json=excluded.payload_json, active=1`,
    )
    .bind(
      input.tenantId,
      receiptLogoId(input.scope, input.branchId),
      input.scope === "BRANCH" ? input.branchId : null,
      RECEIPT_LOGO_DOCUMENT_TYPE,
      LAYOUT_VERSION,
      JSON.stringify(payload),
    );
}

export function deleteReceiptLogoStatement(
  db: D1Database,
  tenantId: string,
  branchId: string,
  scope: ReceiptLogoScope,
) {
  return db
    .prepare("DELETE FROM document_templates WHERE tenant_id=? AND id=? AND document_type=?")
    .bind(tenantId, receiptLogoId(scope, branchId), RECEIPT_LOGO_DOCUMENT_TYPE);
}
