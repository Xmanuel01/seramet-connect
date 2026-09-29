import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

export class DocumentNumberingService {
  constructor(private readonly db: D1Database) {}

  async next(input: {
    tenantId: string;
    branchId?: string;
    documentType: string;
    businessDate: string;
    format?: string;
    branchCode?: string;
    prefix?: string;
    padding?: number;
  }) {
    const branchId = input.branchId ?? "";
    const year = input.businessDate.slice(0, 4);
    const periodKey = year;
    const configuredFormat =
      input.format ?? `${input.prefix ?? input.documentType}-{BRANCH}-{YYYY}-{SEQUENCE}`;
    const row = await this.db
      .prepare(
        `INSERT INTO document_sequences
          (tenant_id, branch_id, document_type, period_key, format, next_value, block_size, updated_at)
         VALUES (?, ?, ?, ?, ?, 2, 1, ?)
         ON CONFLICT(tenant_id, branch_id, document_type, period_key) DO UPDATE SET
           next_value = document_sequences.next_value + 1,
           updated_at = excluded.updated_at
         RETURNING next_value - 1 AS allocated_value, format`,
      )
      .bind(
        input.tenantId,
        branchId,
        input.documentType,
        periodKey,
        configuredFormat,
        new Date().toISOString(),
      )
      .first<{ allocated_value: number; format: string }>();
    if (!row) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        `Document sequence ${input.documentType} could not be allocated`,
      );
    }
    const format = input.format ?? row.format;
    const number = format
      .replaceAll("{BRANCH}", input.branchCode ?? (branchId || "TENANT"))
      .replaceAll("{YYYY}", year)
      .replaceAll("{SEQUENCE}", String(row.allocated_value).padStart(input.padding ?? 6, "0"));
    return { number, sequence: row.allocated_value, periodKey };
  }
}
