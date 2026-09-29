import type { ServerActor } from "@/lib/seramet-auth";
import { parseCsvRows, parseXlsxRows } from "@/lib/menu-import-export";
import {
  HISTORICAL_SALES_TEMPLATE_VERSION,
  normalizeHistoricalSalesRows,
  unsupportedHistoricalSalesColumns,
} from "@/onboarding/historical-sales-import-schema";
import { parseMajorAmount, sumMinor } from "@/payments/money";
import { permissions } from "@/platform/permissions";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { validateImportFile } from "@/server/file-import-security";

export type HistoricalSalesIssue = { field: string; code: string; message: string };
export type HistoricalSalesPreviewRow = {
  rowNumber: number;
  rowKey: string;
  status: "VALID" | "WARNING" | "ERROR" | "COMMITTED";
  normalized: HistoricalSaleValue;
  errors: HistoricalSalesIssue[];
  warnings: HistoricalSalesIssue[];
};
export type HistoricalSalesPreview = {
  id: string;
  status: "VALIDATED" | "REJECTED" | "COMMITTING" | "COMMITTED" | "SKIPPED" | "FAILED";
  commitKey: string;
  sourceSystem: string;
  originalName: string;
  rowCount: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  grossSalesMinor: number;
  netSalesMinor: number;
  orderCount: number;
  canCommit: boolean;
  rows: HistoricalSalesPreviewRow[];
  createdAt: string;
};

type HistoricalSaleValue = {
  externalSaleReference: string;
  branchId: string;
  branchCode: string;
  businessDate: string;
  occurredAt?: string;
  currency: string;
  grossSalesMinor: number;
  discountsMinor: number;
  refundsMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  netSalesMinor: number;
  orderCount: number;
  channelCode?: string;
  paymentMethodReference?: string;
  notes?: string;
};

type PreviewInput = {
  sourceSystem: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
};

export class HistoricalSalesMigrationService {
  constructor(
    private readonly db: D1Database,
    private readonly actor: ServerActor,
  ) {}

  async getState() {
    this.require();
    const committed = await this.db
      .prepare(
        `SELECT id,status,source_system,original_name,row_count,gross_sales_minor,net_sales_minor,
                order_count,committed_at,created_at
         FROM historical_sales_migrations WHERE tenant_id=? AND status='COMMITTED'
         ORDER BY committed_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId)
      .first<Record<string, unknown>>();
    const latest = await this.db
      .prepare(
        `SELECT id,status,source_system,original_name,row_count,gross_sales_minor,net_sales_minor,
                order_count,committed_at,created_at
         FROM historical_sales_migrations WHERE tenant_id=? ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(this.actor.tenantId)
      .first<Record<string, unknown>>();
    return { completed: Boolean(committed), committed, latest };
  }

  async preview(input: PreviewInput): Promise<HistoricalSalesPreview> {
    this.require();
    await this.assertNotCompleted();
    const sourceSystem = clean(input.sourceSystem);
    if (!sourceSystem || sourceSystem.length > 120) {
      throw validation("Enter the name of the previous POS (120 characters maximum)");
    }
    const file = await validateImportFile({
      kind: "HISTORICAL_SALES",
      filename: input.originalName,
      contentType: input.mimeType,
      bytes: input.bytes,
    });
    let rawRows: Array<Record<string, string>>;
    try {
      rawRows = await parseRows(input.bytes, file.extension);
    } catch {
      throw validation("Historical sales file could not be parsed within the safe workbook limits");
    }
    if (!rawRows.length) throw validation("Historical sales file has no data rows");
    if (rawRows.length > file.maxRows) throw validation("Historical sales row limit exceeded");
    assertSafeRows(rawRows);
    const unsupportedColumns = unsupportedHistoricalSalesColumns(rawRows);
    const rows = await this.validateRows(
      normalizeHistoricalSalesRows(rawRows),
      unsupportedColumns,
      sourceSystem,
    );
    const fingerprint = await sha256Text(
      JSON.stringify({ tenantId: this.actor.tenantId, fileDigest: file.digest, sourceSystem }),
    );
    const idempotencyKey = `historical-sales-preview:${fingerprint}`;
    const existing = await this.db
      .prepare("SELECT id FROM historical_sales_migrations WHERE tenant_id=? AND idempotency_key=?")
      .bind(this.actor.tenantId, idempotencyKey)
      .first<{ id: string }>();
    if (existing) return this.getPreview(existing.id);
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    const errorCount = rows.filter((row) => row.status === "ERROR").length;
    const warningCount = rows.filter((row) => row.status === "WARNING").length;
    const validRows = rows.filter((row) => row.status !== "ERROR");
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO historical_sales_migrations
            (tenant_id,id,status,source_system,original_name,mime_type,file_checksum,template_version,
             row_count,valid_count,warning_count,error_count,gross_sales_minor,net_sales_minor,
             order_count,report_json,idempotency_key,created_by,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          errorCount ? "REJECTED" : "VALIDATED",
          sourceSystem,
          file.filename,
          input.mimeType,
          file.digest,
          HISTORICAL_SALES_TEMPLATE_VERSION,
          rows.length,
          validRows.length,
          warningCount,
          errorCount,
          sumMinor(validRows.map((row) => row.normalized.grossSalesMinor)),
          sumMinor(validRows.map((row) => row.normalized.netSalesMinor)),
          validRows.reduce((total, row) => total + row.normalized.orderCount, 0),
          JSON.stringify({ unsupportedColumns, archivalOnly: true, requiresConfirmation: true }),
          idempotencyKey,
          this.actor.id,
          stamp,
          stamp,
        ),
      ...rows.map((row) =>
        this.db
          .prepare(
            `INSERT INTO historical_sales_migration_rows
              (tenant_id,migration_id,row_number,row_key,status,normalized_json,errors_json,warnings_json)
             VALUES (?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            id,
            row.rowNumber,
            row.rowKey,
            row.status,
            JSON.stringify(row.normalized),
            JSON.stringify(row.errors),
            JSON.stringify(row.warnings),
          ),
      ),
      this.audit("HISTORICAL_SALES_PREVIEWED", id, {
        sourceSystem,
        rows: rows.length,
        errors: errorCount,
      }),
    ]);
    return this.getPreview(id);
  }

  async commit(id: string, commitKey: string) {
    this.require();
    const migration = await this.db
      .prepare(
        `SELECT status,idempotency_key,source_system,created_by FROM historical_sales_migrations
         WHERE tenant_id=? AND id=?`,
      )
      .bind(this.actor.tenantId, id)
      .first<{
        status: string;
        idempotency_key: string;
        source_system: string;
        created_by: string;
      }>();
    if (!migration) throw validation("Historical sales preview was not found");
    if (migration.status === "COMMITTED")
      return { id, duplicate: true, status: "COMMITTED" as const };
    if (migration.status !== "VALIDATED")
      throw validation("Preview has errors or cannot be committed");
    if (migration.created_by !== this.actor.id) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        "Only the previewing user can commit this migration",
      );
    }
    if (commitKey !== `commit:${migration.idempotency_key}`) {
      throw validation("Commit key does not match this preview");
    }
    await this.assertNotCompleted();
    const rows = await this.db
      .prepare(
        `SELECT row_number,normalized_json FROM historical_sales_migration_rows
         WHERE tenant_id=? AND migration_id=? AND status IN ('VALID','WARNING') ORDER BY row_number`,
      )
      .bind(this.actor.tenantId, id)
      .all<{ row_number: number; normalized_json: string }>();
    const stamp = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          "UPDATE historical_sales_migrations SET status='COMMITTING',updated_at=? WHERE tenant_id=? AND id=? AND status='VALIDATED'",
        )
        .bind(stamp, this.actor.tenantId, id),
    ];
    for (const row of rows.results ?? []) {
      const value = JSON.parse(row.normalized_json) as HistoricalSaleValue;
      const recordId = await sha256Text(
        `${this.actor.tenantId}:${value.branchId}:${migration.source_system}:${value.externalSaleReference}`,
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO historical_sales_records
              (tenant_id,id,migration_id,branch_id,source_system,external_sale_reference,business_date,
               occurred_at,currency,gross_sales_minor,discounts_minor,refunds_minor,tax_minor,
               service_charge_minor,net_sales_minor,order_count,channel_code,payment_method_reference,
               metadata_json,imported_by,imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            this.actor.tenantId,
            `historical-sale:${recordId}`,
            id,
            value.branchId,
            migration.source_system,
            value.externalSaleReference,
            value.businessDate,
            value.occurredAt ?? null,
            value.currency,
            value.grossSalesMinor,
            value.discountsMinor,
            value.refundsMinor,
            value.taxMinor,
            value.serviceChargeMinor,
            value.netSalesMinor,
            value.orderCount,
            value.channelCode ?? null,
            value.paymentMethodReference ?? null,
            JSON.stringify({ notes: value.notes ?? null, archivalOnly: true }),
            this.actor.id,
            stamp,
          ),
        this.db
          .prepare(
            `UPDATE historical_sales_migration_rows SET status='COMMITTED'
             WHERE tenant_id=? AND migration_id=? AND row_number=?`,
          )
          .bind(this.actor.tenantId, id, row.row_number),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE historical_sales_migrations SET status='COMMITTED',committed_at=?,updated_at=?
           WHERE tenant_id=? AND id=? AND status='COMMITTING'`,
        )
        .bind(stamp, stamp, this.actor.tenantId, id),
      this.audit("HISTORICAL_SALES_COMMITTED", id, {
        sourceSystem: migration.source_system,
        rows: rows.results?.length ?? 0,
        archivalOnly: true,
      }),
    );
    try {
      await this.db.batch(statements);
    } catch {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Historical sales migration could not be committed; no partial records were retained",
      );
    }
    return { id, duplicate: false, status: "COMMITTED" as const, rows: rows.results?.length ?? 0 };
  }

  async skip(reason: string) {
    this.require();
    await this.assertNotCompleted();
    const cleanReason = clean(reason);
    if (cleanReason.length < 3 || cleanReason.length > 300) {
      throw validation("Give a short reason for skipping the optional migration");
    }
    const id = crypto.randomUUID();
    const stamp = new Date().toISOString();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO historical_sales_migrations
            (tenant_id,id,status,source_system,original_name,mime_type,file_checksum,template_version,
             report_json,idempotency_key,created_by,created_at,updated_at)
           VALUES (?,?,'SKIPPED','NOT_IMPORTED','Not imported','application/json','not-applicable',1,?,?,?,?,?)`,
        )
        .bind(
          this.actor.tenantId,
          id,
          JSON.stringify({ reason: cleanReason, optional: true }),
          `historical-sales-skip:${crypto.randomUUID()}`,
          this.actor.id,
          stamp,
          stamp,
        ),
      this.audit("HISTORICAL_SALES_SKIPPED", id, { reason: cleanReason }),
    ]);
    return { id, status: "SKIPPED" as const, canImportLater: true };
  }

  private async validateRows(
    rows: Array<Record<string, string>>,
    unsupportedColumns: string[],
    sourceSystem: string,
  ): Promise<HistoricalSalesPreviewRow[]> {
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=? AND active=1")
      .bind(this.actor.tenantId)
      .first<{ default_currency: string }>();
    if (!tenant) throw validation("Tenant configuration is unavailable");
    const branches = await this.db
      .prepare("SELECT id,code FROM branches WHERE tenant_id=? AND active=1")
      .bind(this.actor.tenantId)
      .all<{ id: string; code: string }>();
    const branchByCode = new Map(
      (branches.results ?? []).map((branch) => [branch.code.trim().toUpperCase(), branch]),
    );
    const existing = await this.db
      .prepare(
        "SELECT branch_id,source_system,external_sale_reference FROM historical_sales_records WHERE tenant_id=?",
      )
      .bind(this.actor.tenantId)
      .all<{ branch_id: string; source_system: string; external_sale_reference: string }>();
    const existingReferences = new Set(
      (existing.results ?? []).map((row) =>
        `${row.branch_id}:${row.source_system}:${row.external_sale_reference}`.toUpperCase(),
      ),
    );
    const liveDates = await this.db
      .prepare(
        `SELECT branch_id,business_date FROM invoices WHERE tenant_id=?
         UNION SELECT branch_id,business_date FROM orders WHERE tenant_id=?`,
      )
      .bind(this.actor.tenantId, this.actor.tenantId)
      .all<{ branch_id: string; business_date: string }>();
    const liveDateKeys = new Set(
      (liveDates.results ?? []).map((row) => `${row.branch_id}:${row.business_date}`),
    );
    const seen = new Set<string>();
    return rows.map((row, index) => {
      const errors: HistoricalSalesIssue[] = [];
      const warnings: HistoricalSalesIssue[] = unsupportedColumns.map((column) => ({
        field: column,
        code: "UNSUPPORTED_COLUMN",
        message: `Populated column ${column} is not imported; confirm it is not required before committing`,
      }));
      const externalSaleReference = clean(row.externalSaleReference);
      const templateVersion = clean(row.templateVersion);
      const branchCode = clean(row.branchCode).toUpperCase();
      const branch = branchByCode.get(branchCode);
      const businessDate = clean(row.businessDate);
      const currency = clean(row.currency).toUpperCase();
      if (!externalSaleReference)
        issue(errors, "externalSaleReference", "REQUIRED", "Sale reference is required");
      if (templateVersion && templateVersion !== String(HISTORICAL_SALES_TEMPLATE_VERSION)) {
        issue(
          errors,
          "templateVersion",
          "UNSUPPORTED_TEMPLATE_VERSION",
          `Supported historical sales template version is ${HISTORICAL_SALES_TEMPLATE_VERSION}`,
        );
      }
      if (!branch) issue(errors, "branchCode", "UNKNOWN_BRANCH", "Branch code is not configured");
      if (branch && !this.canUseBranch(branch.id)) {
        issue(errors, "branchCode", "BRANCH_SCOPE", "Branch is outside your authorized assignment");
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
        Number.isNaN(Date.parse(`${businessDate}T00:00:00Z`))
      ) {
        issue(errors, "businessDate", "INVALID_DATE", "Use a valid YYYY-MM-DD business date");
      }
      if (branch && liveDateKeys.has(`${branch.id}:${businessDate}`)) {
        issue(
          errors,
          "businessDate",
          "LIVE_DATA_OVERLAP",
          "This branch and date already contain Seramet orders or invoices",
        );
      }
      if (currency !== tenant.default_currency) {
        issue(
          errors,
          "currency",
          "CURRENCY_MISMATCH",
          `Historical sales must use tenant currency ${tenant.default_currency}`,
        );
      }
      const occurredAt = clean(row.occurredAt);
      if (occurredAt && Number.isNaN(Date.parse(occurredAt))) {
        issue(errors, "occurredAt", "INVALID_TIMESTAMP", "Use an ISO timestamp with timezone");
      }
      const grossSalesMinor = amount(row.grossAmount, currency, "grossAmount", errors);
      const discountsMinor = amount(row.discountAmount || "0", currency, "discountAmount", errors);
      const refundsMinor = amount(row.refundAmount || "0", currency, "refundAmount", errors);
      const taxMinor = amount(row.taxAmount || "0", currency, "taxAmount", errors);
      const serviceChargeMinor = amount(
        row.serviceChargeAmount || "0",
        currency,
        "serviceChargeAmount",
        errors,
      );
      const derivedNet = grossSalesMinor - discountsMinor - refundsMinor;
      const netSalesMinor = clean(row.netAmount)
        ? amount(row.netAmount, currency, "netAmount", errors)
        : derivedNet;
      if (derivedNet < 0)
        issue(errors, "netAmount", "NEGATIVE_NET", "Discounts and refunds exceed gross sales");
      if (clean(row.netAmount) && netSalesMinor !== derivedNet) {
        issue(
          errors,
          "netAmount",
          "TOTAL_MISMATCH",
          "Net amount must equal gross minus discounts and refunds",
        );
      }
      const orderCount = positiveInteger(row.orderCount || "1", "orderCount", errors);
      const key = branch
        ? `${branch.id}:${externalSaleReference}`.toUpperCase()
        : `${branchCode}:${externalSaleReference}`.toUpperCase();
      if (seen.has(key))
        issue(
          errors,
          "externalSaleReference",
          "DUPLICATE_ROW",
          "Sale reference is duplicated in this file",
        );
      seen.add(key);
      if (
        branch &&
        existingReferences.has(
          `${branch.id}:${sourceSystem}:${externalSaleReference}`.toUpperCase(),
        )
      ) {
        issue(
          errors,
          "externalSaleReference",
          "ALREADY_IMPORTED",
          "Sale reference was already imported",
        );
      }
      const normalized: HistoricalSaleValue = {
        externalSaleReference,
        branchId: branch?.id ?? "",
        branchCode,
        businessDate,
        ...(occurredAt ? { occurredAt } : {}),
        currency,
        grossSalesMinor,
        discountsMinor,
        refundsMinor,
        taxMinor,
        serviceChargeMinor,
        netSalesMinor,
        orderCount,
        ...(clean(row.channelCode) ? { channelCode: clean(row.channelCode).toUpperCase() } : {}),
        ...(clean(row.paymentMethodReference)
          ? { paymentMethodReference: clean(row.paymentMethodReference) }
          : {}),
        ...(clean(row.notes) ? { notes: clean(row.notes).slice(0, 500) } : {}),
      };
      return {
        rowNumber: index + 2,
        rowKey: key,
        status: errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID",
        normalized,
        errors,
        warnings,
      };
    });
  }

  private async getPreview(id: string): Promise<HistoricalSalesPreview> {
    const migration = await this.db
      .prepare("SELECT * FROM historical_sales_migrations WHERE tenant_id=? AND id=?")
      .bind(this.actor.tenantId, id)
      .first<Record<string, unknown>>();
    if (!migration) throw validation("Historical sales preview was not found");
    const rows = await this.db
      .prepare(
        "SELECT * FROM historical_sales_migration_rows WHERE tenant_id=? AND migration_id=? ORDER BY row_number LIMIT 1000",
      )
      .bind(this.actor.tenantId, id)
      .all<Record<string, unknown>>();
    return {
      id,
      status: String(migration.status) as HistoricalSalesPreview["status"],
      commitKey: `commit:${String(migration.idempotency_key)}`,
      sourceSystem: String(migration.source_system),
      originalName: String(migration.original_name),
      rowCount: Number(migration.row_count),
      validCount: Number(migration.valid_count),
      warningCount: Number(migration.warning_count),
      errorCount: Number(migration.error_count),
      grossSalesMinor: Number(migration.gross_sales_minor),
      netSalesMinor: Number(migration.net_sales_minor),
      orderCount: Number(migration.order_count),
      canCommit: migration.status === "VALIDATED" && Number(migration.error_count) === 0,
      rows: (rows.results ?? []).map((row) => ({
        rowNumber: Number(row.row_number),
        rowKey: String(row.row_key),
        status: String(row.status) as HistoricalSalesPreviewRow["status"],
        normalized: JSON.parse(String(row.normalized_json)) as HistoricalSaleValue,
        errors: JSON.parse(String(row.errors_json)) as HistoricalSalesIssue[],
        warnings: JSON.parse(String(row.warnings_json)) as HistoricalSalesIssue[],
      })),
      createdAt: String(migration.created_at),
    };
  }

  private async assertNotCompleted() {
    const completed = await this.db
      .prepare(
        "SELECT id FROM historical_sales_migrations WHERE tenant_id=? AND status='COMMITTED'",
      )
      .bind(this.actor.tenantId)
      .first<{ id: string }>();
    if (completed)
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Previous POS sales have already been migrated for this restaurant",
      );
  }

  private canUseBranch(branchId: string) {
    return this.actor.branchScope.type === "ALL" || this.actor.assignedBranchIds.includes(branchId);
  }

  private require() {
    if (!this.actor.permissions.includes(permissions.setupHistoricalSalesImport)) {
      throw new ServerOperationError(
        "PERMISSION_DENIED",
        403,
        "Historical sales import permission is required",
      );
    }
  }

  private audit(action: string, entityId: string, metadata: Record<string, unknown>) {
    return this.db
      .prepare(
        `INSERT INTO audit_events
          (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
           correlation_id,session_id,metadata_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        this.actor.tenantId,
        crypto.randomUUID(),
        this.actor.branchId || null,
        this.actor.id,
        this.actor.deviceId ?? null,
        action,
        "HISTORICAL_SALES_MIGRATION",
        entityId,
        "Authenticated optional onboarding migration",
        crypto.randomUUID(),
        this.actor.sessionId ?? null,
        JSON.stringify(metadata),
        new Date().toISOString(),
      );
  }
}

async function parseRows(bytes: Uint8Array, extension: string) {
  if (extension === "xlsx") {
    return parseXlsxRows(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  }
  return parseCsvRows(new TextDecoder().decode(bytes));
}

function assertSafeRows(rows: Array<Record<string, string>>) {
  for (const row of rows) {
    if (Object.keys(row).length > 100) throw validation("Historical sales column limit exceeded");
    if (Object.values(row).some((value) => value.length > 10_000)) {
      throw validation("Historical sales cell length limit exceeded");
    }
  }
}

function amount(value: string, currency: string, field: string, errors: HistoricalSalesIssue[]) {
  try {
    const parsed = parseMajorAmount(clean(value).replace(/,/g, ""), currency || "XXX");
    if (parsed < 0) throw new Error("negative");
    return parsed;
  } catch {
    issue(errors, field, "INVALID_AMOUNT", `${field} must be a non-negative monetary amount`);
    return 0;
  }
}

function positiveInteger(value: string, field: string, errors: HistoricalSalesIssue[]) {
  if (!/^\d+$/.test(clean(value)) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    issue(errors, field, "INVALID_INTEGER", `${field} must be a positive whole number`);
    return 1;
  }
  return Number(value);
}

function issue(target: HistoricalSalesIssue[], field: string, code: string, message: string) {
  target.push({ field, code, message });
}

function clean(value?: string) {
  return (value ?? "").trim();
}

function validation(message: string) {
  return new ServerOperationError("VALIDATION_FAILED", 400, message);
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
