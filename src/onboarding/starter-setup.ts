import { stableId } from "@/onboarding/onboarding-service";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";

// Records the guided onboarding creates when the owner finishes, so a new restaurant can bill
// and print from day one. Both are starting points the owner or their accountant can change.

export const starterDocumentTypes = ["KOT", "BILL", "RECEIPT", "INVOICE"] as const;
export const STARTER_TEMPLATE_LAYOUT = "seramet-approved-v1";

export type StandardAccount = {
  mappingKey: string;
  code: string;
  name: string;
  accountType: "CASH" | "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "COGS" | "EXPENSE";
};

/**
 * One account for every mapping the Setup Centre requires. Types follow what the POS invoice
 * ledger and financial reports accept: receivables are assets, tax payable is a liability and
 * sales and service charge are revenue. Discounts and refunds are contra-revenue.
 */
export const standardRestaurantChart: readonly StandardAccount[] = [
  { mappingKey: "CASH", code: "1000", name: "Cash on hand", accountType: "CASH" },
  { mappingKey: "PAYMENT_CLEARING", code: "1010", name: "Payment clearing", accountType: "ASSET" },
  {
    mappingKey: "CUSTOMER_RECEIVABLE",
    code: "1100",
    name: "Customer receivables",
    accountType: "ASSET",
  },
  { mappingKey: "INVENTORY", code: "1200", name: "Inventory", accountType: "ASSET" },
  {
    mappingKey: "RECOVERABLE_TAX",
    code: "1300",
    name: "Recoverable input tax",
    accountType: "ASSET",
  },
  {
    mappingKey: "SUPPLIER_PAYABLE",
    code: "2000",
    name: "Supplier payables",
    accountType: "LIABILITY",
  },
  { mappingKey: "TAX_PAYABLE", code: "2100", name: "Tax payable", accountType: "LIABILITY" },
  {
    mappingKey: "OPENING_BALANCE",
    code: "3000",
    name: "Opening balance equity",
    accountType: "EQUITY",
  },
  {
    mappingKey: "SALES_REVENUE",
    code: "4000",
    name: "Food and beverage sales",
    accountType: "REVENUE",
  },
  {
    mappingKey: "SERVICE_CHARGE",
    code: "4100",
    name: "Service charge income",
    accountType: "REVENUE",
  },
  {
    mappingKey: "DELIVERY_FEES",
    code: "4200",
    name: "Delivery fee income",
    accountType: "REVENUE",
  },
  { mappingKey: "DISCOUNTS", code: "4900", name: "Discounts given", accountType: "REVENUE" },
  { mappingKey: "REFUNDS", code: "4910", name: "Refunds and returns", accountType: "REVENUE" },
  { mappingKey: "COGS", code: "5000", name: "Cost of goods sold", accountType: "COGS" },
  { mappingKey: "WASTAGE", code: "5100", name: "Wastage", accountType: "EXPENSE" },
  {
    mappingKey: "INVENTORY_VARIANCE",
    code: "5110",
    name: "Inventory variance",
    accountType: "EXPENSE",
  },
  {
    mappingKey: "PAYMENT_PROCESSING_FEES",
    code: "6000",
    name: "Payment processing fees",
    accountType: "EXPENSE",
  },
  {
    mappingKey: "MARKETPLACE_COMMISSION",
    code: "6100",
    name: "Marketplace commissions",
    accountType: "EXPENSE",
  },
];

/** Tenant-wide default layouts for any document type that has no active template yet. */
export async function starterTemplateStatements(db: D1Database, tenantId: string) {
  const existing = await db
    .prepare("SELECT DISTINCT document_type FROM document_templates WHERE tenant_id=? AND active=1")
    .bind(tenantId)
    .all<{ document_type: string }>();
  const present = new Set((existing.results ?? []).map((row) => row.document_type));
  return starterDocumentTypes
    .filter((type) => !present.has(type))
    .map((type) =>
      db
        .prepare(
          `INSERT INTO document_templates
            (tenant_id,id,branch_id,document_type,layout_version,active,payload_json)
           VALUES (?,?,NULL,?,?,1,?)
           ON CONFLICT(tenant_id,id) DO UPDATE SET active=1`,
        )
        .bind(
          tenantId,
          // Same identity the Setup Centre gives this type and layout, so edits update this row.
          stableId("document-template", `tenant:${type}:${STARTER_TEMPLATE_LAYOUT}`),
          type,
          STARTER_TEMPLATE_LAYOUT,
          JSON.stringify({ width: "80mm", copies: 1, source: "guided-onboarding" }),
        ),
    );
}

/**
 * Accounts and owner-approved mappings for the standard chart. A mapping already configured and
 * approved (for example by an accountant) is never replaced, and an existing account is reused
 * only when its type and currency match.
 */
export async function standardChartStatements(
  db: D1Database,
  input: { tenantId: string; actorId: string; currency: string; stamp: string },
) {
  const [mappings, accounts] = await Promise.all([
    db
      .prepare(
        `SELECT mapping_key,status,finance_signoff_status FROM setup_account_mappings
         WHERE tenant_id=? AND scope_key='TENANT'`,
      )
      .bind(input.tenantId)
      .all<{ mapping_key: string; status: string; finance_signoff_status: string }>(),
    db
      .prepare("SELECT id,code,account_type,currency,active FROM accounts WHERE tenant_id=?")
      .bind(input.tenantId)
      .all<{ id: string; code: string; account_type: string; currency: string; active: number }>(),
  ]);
  const approved = new Set(
    (mappings.results ?? [])
      .filter((row) => row.status === "CONFIGURED" && row.finance_signoff_status === "APPROVED")
      .map((row) => row.mapping_key),
  );
  const byCode = new Map((accounts.results ?? []).map((row) => [row.code, row]));
  const statements: D1PreparedStatement[] = [];
  for (const account of standardRestaurantChart) {
    if (approved.has(account.mappingKey)) continue;
    let code = account.code;
    let existing = byCode.get(code);
    if (
      existing &&
      (existing.account_type !== account.accountType ||
        existing.currency !== input.currency ||
        existing.active !== 1)
    ) {
      code = `${account.code}-STD`;
      existing = byCode.get(code);
    }
    const accountId = existing?.id ?? stableId("account", `standard:${code}`);
    if (!existing) {
      statements.push(
        db
          .prepare(
            `INSERT INTO accounts (tenant_id,id,branch_id,code,name,account_type,currency,active,payload_json)
             VALUES (?,?,NULL,?,?,?,?,1,?)`,
          )
          .bind(
            input.tenantId,
            accountId,
            code,
            account.name,
            account.accountType,
            input.currency,
            JSON.stringify({ source: "standard-restaurant-chart" }),
          ),
      );
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO setup_account_mappings
            (tenant_id,id,branch_id,scope_key,mapping_key,requirement,account_id,status,
             finance_signoff_status,signed_off_by,signed_off_at,updated_by,updated_at)
           VALUES (?,?,NULL,'TENANT',?,'REQUIRED',?,'CONFIGURED','APPROVED',?,?,?,?)
           ON CONFLICT(tenant_id,scope_key,mapping_key) DO UPDATE SET account_id=excluded.account_id,
             status='CONFIGURED',finance_signoff_status='APPROVED',
             signed_off_by=excluded.signed_off_by,signed_off_at=excluded.signed_off_at,
             updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
        )
        .bind(
          input.tenantId,
          stableId("account-map", `tenant:${account.mappingKey}`),
          account.mappingKey,
          accountId,
          input.actorId,
          input.stamp,
          input.actorId,
          input.stamp,
        ),
    );
  }
  return statements;
}
