import type { ServerActor } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { normalizeTransactionState, type TransactionState } from "@/lib/transaction-engine";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { D1Database } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";

export type SnapshotMigrationReport = {
  sourceSchema: string;
  sourceChecksum: string;
  targetTenantId: string;
  recordsRead: Record<string, number>;
  recordsMigrated: Record<string, number>;
  recordsSkipped: Array<{ collection: string; id?: string; reason: string }>;
  duplicates: string[];
  invalidReferences: string[];
  financialTotalsBefore: FinancialTotals;
  financialTotalsAfter: FinancialTotals;
  inventoryQuantityBefore: number;
  inventoryQuantityAfter: number;
  status: "PREVIEW" | "SUCCEEDED";
};

type FinancialTotals = {
  invoiceTotal: number;
  confirmedPayments: number;
  receiptTotal: number;
  journalDebits: number;
  journalCredits: number;
};

export class SnapshotMigrationService {
  constructor(
    private readonly database: D1Database,
    private readonly repository: TransactionRepository,
  ) {}

  async preview(input: { source: unknown; actor: ServerActor; branchMap: Record<string, string> }) {
    const source = parseSource(input.source);
    const checksum = await sha256(JSON.stringify(source));
    const mapped = mapSnapshot(source, input.actor, input.branchMap);
    const report = createReport(source, mapped.state, checksum, mapped.invalidReferences);
    return { state: mapped.state, report };
  }

  async apply(input: {
    source: unknown;
    actor: ServerActor;
    branchMap: Record<string, string>;
    correlationId?: string;
  }) {
    const { state, report } = await this.preview(input);
    if (report.invalidReferences.length) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Snapshot contains branch references that are not mapped",
      );
    }
    const idempotencyKey = `snapshot-migration:${report.sourceChecksum}`;
    await this.repository.commitMutation({
      actor: input.actor,
      action: "replaceState",
      payload: { state },
      idempotencyKey,
      requestHash: report.sourceChecksum,
      correlationId: input.correlationId ?? crypto.randomUUID(),
      ...(input.actor.deviceId ? { deviceId: input.actor.deviceId } : {}),
    });
    const completed = { ...report, status: "SUCCEEDED" as const };
    const stamp = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT INTO data_migration_runs
          (tenant_id,id,source_schema,source_checksum,status,report_json,created_by,created_at,completed_at)
         VALUES (?,?,?,?, 'SUCCEEDED', ?,?,?,?)
         ON CONFLICT(tenant_id,source_checksum) DO UPDATE SET
           status='SUCCEEDED', report_json=excluded.report_json, completed_at=excluded.completed_at`,
      )
      .bind(
        input.actor.tenantId,
        crypto.randomUUID(),
        report.sourceSchema,
        report.sourceChecksum,
        JSON.stringify(completed),
        input.actor.id,
        stamp,
        stamp,
      )
      .run();
    return completed;
  }
}

function parseSource(value: unknown): TransactionState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ServerOperationError("VALIDATION_FAILED", 400, "Snapshot must be a JSON object");
  }
  const source = structuredClone(value) as Partial<TransactionState>;
  for (const required of ["orders", "bills", "payments", "inventory"] as const) {
    if (!Array.isArray(source[required])) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        `Snapshot collection ${required} is missing`,
      );
    }
  }
  return source as TransactionState;
}

function mapSnapshot(
  source: TransactionState,
  actor: ServerActor,
  branchMap: Record<string, string>,
) {
  const next = structuredClone(source) as TransactionState;
  next.tenantId = actor.tenantId;
  const invalidReferences = new Set<string>();
  const configuration = getConfigurationRepository();
  const mapRecord = (record: Record<string, unknown>) => {
    record["tenantId"] = actor.tenantId;
    const sourceBranch = string(record["branchId"]) ?? string(record["branch"]);
    if (!sourceBranch) return;
    const targetBranchId =
      branchMap[sourceBranch] ??
      (actor.assignedBranchIds.includes(sourceBranch) ? sourceBranch : undefined);
    if (!targetBranchId || !actor.assignedBranchIds.includes(targetBranchId)) {
      invalidReferences.add(sourceBranch);
      return;
    }
    record["branchId"] = targetBranchId;
    record["branch"] = configuration.getBranch(actor.tenantId, targetBranchId).name;
  };
  for (const value of Object.values(next)) {
    if (Array.isArray(value))
      value.forEach((record) => mapRecord(record as Record<string, unknown>));
  }
  if (next.paymentOperations) {
    for (const value of Object.values(next.paymentOperations)) {
      if (Array.isArray(value))
        value.forEach((record) => mapRecord(record as Record<string, unknown>));
    }
  }
  return { state: normalizeTransactionState(next), invalidReferences: [...invalidReferences] };
}

function createReport(
  source: TransactionState,
  target: TransactionState,
  checksum: string,
  invalidReferences: string[],
): SnapshotMigrationReport {
  const recordsRead = collectionCounts(source);
  const recordsMigrated = collectionCounts(target);
  return {
    sourceSchema: `transaction-state-v${source.schemaVersion ?? 2}`,
    sourceChecksum: checksum,
    targetTenantId: target.tenantId!,
    recordsRead,
    recordsMigrated,
    recordsSkipped: [],
    duplicates: duplicateIds(target),
    invalidReferences,
    financialTotalsBefore: financialTotals(source),
    financialTotalsAfter: financialTotals(target),
    inventoryQuantityBefore: source.inventory.reduce((total, item) => total + item.stock, 0),
    inventoryQuantityAfter: target.inventory.reduce((total, item) => total + item.stock, 0),
    status: "PREVIEW",
  };
}

function collectionCounts(state: TransactionState) {
  return Object.fromEntries(
    Object.entries(state)
      .filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, (value as unknown[]).length]),
  );
}

function duplicateIds(state: TransactionState) {
  const duplicates: string[] = [];
  for (const [collection, value] of Object.entries(state)) {
    if (!Array.isArray(value)) continue;
    const seen = new Set<string>();
    for (const item of value as Array<{ id?: string }>) {
      if (!item.id) continue;
      if (seen.has(item.id)) duplicates.push(`${collection}:${item.id}`);
      seen.add(item.id);
    }
  }
  return duplicates;
}

function financialTotals(state: TransactionState): FinancialTotals {
  return {
    invoiceTotal: state.bills.reduce((total, bill) => total + bill.total, 0),
    confirmedPayments: state.payments.reduce((total, payment) => total + payment.amount, 0),
    receiptTotal: state.receipts.reduce((total, receipt) => total + receipt.paidAmount, 0),
    journalDebits: state.journalEntries.reduce(
      (total, entry) => total + entry.lines.reduce((sum, line) => sum + line.debit, 0),
      0,
    ),
    journalCredits: state.journalEntries.reduce(
      (total, entry) => total + entry.lines.reduce((sum, line) => sum + line.credit, 0),
      0,
    ),
  };
}

function string(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
