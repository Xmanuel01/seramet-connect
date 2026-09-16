import {
  applyServerMutation,
  type IdempotencyRecord,
  type ProviderWebhookEvent,
  type TransactionMutationCommit,
  type TransactionMutationResult,
  type TransactionRepository,
} from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  normalizeTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import type { ServerActor } from "@/lib/seramet-auth";
import { emptyPaymentOperationsState } from "@/payments/payment-state";
import type { D1Database, D1PreparedStatement } from "@/server/database/d1";
import { ServerOperationError } from "@/server/errors";
import { authoritativeBusinessDate } from "@/server/business-date";
import { QUANTITY_SCALE, quantityCostMinor } from "@/inventory/quantity";
import { parseMajorAmount } from "@/payments/money";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { CURRENT_SCHEMA_VERSION } from "@/server/database/schema-version";

const ROOT_ENTITY = "state:root";
const IDEMPOTENCY_ENTITY = "system:api-idempotency";
const PROVIDER_EVENT_ENTITY = "system:provider-event";

const transactionCollections = [
  "orders",
  "bills",
  "paymentIntents",
  "payments",
  "receipts",
  "marketplaceReceivables",
  "marketplaceCharges",
  "productionAmendments",
  "externalTransactions",
  "reconciliationMatches",
  "journalEntries",
  "cashDrawers",
  "refunds",
  "auditEvents",
  "inventory",
  "recipes",
  "stockMovements",
  "purchaseOrders",
  "wastageRecords",
  "breakageRecords",
  "employees",
  "attendanceRecords",
  "costControlSnapshots",
] as const;

const paymentCollections = [
  "accounts",
  "intents",
  "transactions",
  "allocations",
  "collections",
  "drawerSessions",
  "cashMovements",
  "bankTransactions",
  "settlementBatches",
  "settlementLines",
  "reconciliationSessions",
  "matches",
  "exceptions",
  "refunds",
  "disputes",
  "journals",
  "dayCloses",
  "storedValueAccounts",
  "customerAccounts",
  "customerAccountEntries",
  "auditEvents",
  "fraudFlags",
] as const;

type AuthoritativeRow = {
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  business_date: string | null;
  status: string | null;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type RevisionRow = { revision: number };

type PersistedEntity = {
  entityType: string;
  entityId: string;
  branchId?: string;
  businessDate?: string;
  status?: string;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
};

export class D1AuthoritativeTransactionRepository implements TransactionRepository {
  readonly authoritative = true;

  constructor(private readonly db: D1Database) {}

  async migrate() {
    let row: { version: number | null } | null;
    try {
      row = await this.db
        .prepare("SELECT MAX(version) AS version FROM schema_migrations")
        .first<{ version: number | null }>();
    } catch {
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        503,
        "Authoritative schema is unavailable; run versioned migrations before startup",
      );
    }
    if ((row?.version ?? 0) < CURRENT_SCHEMA_VERSION) {
      throw new ServerOperationError(
        "DATABASE_UNAVAILABLE",
        503,
        `Database schema ${row?.version ?? 0} is behind required version ${CURRENT_SCHEMA_VERSION}`,
      );
    }
  }

  async loadState(tenantId: string) {
    await this.assertTenant(tenantId);
    const rows = await this.loadRows(tenantId);
    return reconstructState(tenantId, rows);
  }

  async saveState(state: TransactionState, actor: ServerActor, reason: string) {
    if (state.tenantId !== actor.tenantId) {
      throw new ServerOperationError(
        "TENANT_SCOPE_VIOLATION",
        403,
        "Cross-tenant state write denied",
      );
    }
    await this.persistState({
      state,
      actor,
      action: "SERVER_STATE_COMMAND",
      idempotencyKey: `server:${crypto.randomUUID()}`,
      requestHash: await sha256(JSON.stringify({ reason, state })),
      correlationId: crypto.randomUUID(),
      reason,
    });
  }

  async commitMutation(input: TransactionMutationCommit): Promise<TransactionMutationResult> {
    const cached = await this.readMutationCommit(input.actor.tenantId, input.idempotencyKey);
    if (cached) {
      if (cached.requestHash !== input.requestHash) {
        throw new ServerOperationError(
          "DUPLICATE",
          409,
          "Idempotency key was already used for a different request",
        );
      }
      return { state: cached.state, revision: cached.revision, duplicate: true };
    }

    const { state: current, revision: baseRevision } = await this.loadStateAtStableRevision(
      input.actor.tenantId,
    );
    if (input.expectedRevision !== undefined && input.expectedRevision !== baseRevision) {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Authoritative state changed concurrently; reload and retry the command",
      );
    }
    const authoritative = await this.authoritativeMutationInput(current, input);
    const next = applyServerMutation(current, input.action, authoritative, input.actor);
    try {
      const revision = await this.persistState({
        state: next,
        actor: input.actor,
        action: input.action,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        correlationId: input.correlationId,
        reason: `Mutation ${input.action}`,
        requiredBaseRevision: baseRevision,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      });
      return { state: next, revision, duplicate: false };
    } catch (error) {
      const duplicate = await this.readMutationCommit(input.actor.tenantId, input.idempotencyKey);
      if (duplicate) {
        if (duplicate.requestHash !== input.requestHash) {
          throw new ServerOperationError(
            "DUPLICATE",
            409,
            "Idempotency key was already used for a different request",
          );
        }
        return { state: duplicate.state, revision: duplicate.revision, duplicate: true };
      }
      if (isConstraintError(error)) {
        throw new ServerOperationError(
          "CONFLICT",
          409,
          "Authoritative state changed concurrently; reload and retry the command",
        );
      }
      throw error;
    }
  }

  async revision(tenantId: string) {
    await this.assertTenant(tenantId);
    const row = await this.db
      .prepare("SELECT revision FROM tenant_state_read_models WHERE tenant_id = ?")
      .bind(tenantId)
      .first<RevisionRow>();
    return row?.revision ?? 0;
  }

  async getIdempotency(tenantId: string, key: string) {
    await this.assertTenant(tenantId);
    const row = await this.db
      .prepare(
        "SELECT payload_json FROM authoritative_records WHERE tenant_id = ? AND entity_type = ? AND entity_id = ?",
      )
      .bind(tenantId, IDEMPOTENCY_ENTITY, key)
      .first<{ payload_json: string }>();
    return row ? (JSON.parse(row.payload_json) as IdempotencyRecord) : null;
  }

  async saveIdempotency(record: IdempotencyRecord) {
    await this.assertTenant(record.tenantId);
    const stamp = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO authoritative_records
          (tenant_id, entity_type, entity_id, payload_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(tenant_id, entity_type, entity_id) DO NOTHING`,
      )
      .bind(record.tenantId, IDEMPOTENCY_ENTITY, record.key, JSON.stringify(record), stamp, stamp)
      .run();
  }

  async appendProviderEvent(event: ProviderWebhookEvent) {
    await this.assertTenant(event.tenantId);
    await this.db
      .prepare(
        `INSERT INTO authoritative_records
          (tenant_id, entity_type, entity_id, status, payload_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(tenant_id, entity_type, entity_id) DO NOTHING`,
      )
      .bind(
        event.tenantId,
        PROVIDER_EVENT_ENTITY,
        event.id,
        event.processed ? "PROCESSED" : "RECEIVED",
        JSON.stringify(event),
        event.receivedAt,
        event.receivedAt,
      )
      .run();
  }

  private async persistState(input: {
    state: TransactionState;
    actor: ServerActor;
    action: string;
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    requiredBaseRevision?: number;
    deviceId?: string;
    reason: string;
  }) {
    await this.assertTenant(input.actor.tenantId);
    const tenantId = input.actor.tenantId;
    const [currentRows, observedRevision] = await Promise.all([
      this.loadRows(tenantId),
      this.revision(tenantId),
    ]);
    const baseRevision = input.requiredBaseRevision ?? observedRevision;
    if (observedRevision !== baseRevision) {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Authoritative state changed concurrently; reload and retry the command",
      );
    }
    const currentDomainRows = currentRows.filter((row) => isStateEntity(row.entity_type));
    const currentByKey = new Map(
      currentDomainRows.map((row) => [`${row.entity_type}:${row.entity_id}`, row]),
    );
    const nextEntities = flattenState(input.state);
    const nextKeys = new Set(nextEntities.map((item) => `${item.entityType}:${item.entityId}`));
    const stamp = new Date().toISOString();
    const newRevision = baseRevision + 1;
    const responseJson = JSON.stringify({ state: input.state, revision: newRevision });
    const statements: D1PreparedStatement[] = [];

    statements.push(
      ...(await this.legacyInventoryBridgeStatements(
        tenantId,
        nextEntities,
        currentByKey,
        input,
        stamp,
      )),
    );
    statements.push(
      ...(await this.crmTransactionBridgeStatements(
        tenantId,
        nextEntities,
        currentByKey,
        input,
        stamp,
      )),
    );
    statements.push(
      ...(await this.reservationDepositBridgeStatements(
        tenantId,
        nextEntities,
        currentByKey,
        input,
        stamp,
      )),
    );
    statements.push(...this.fxPaymentBridgeStatements(tenantId, nextEntities, currentByKey, stamp));

    statements.push(
      this.db
        .prepare(
          `INSERT INTO mutation_commits
            (tenant_id, id, idempotency_key, action, actor_id, device_id, correlation_id,
             base_revision, new_revision, request_hash, response_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          tenantId,
          crypto.randomUUID(),
          input.idempotencyKey,
          input.action,
          input.actor.id,
          input.deviceId ?? null,
          input.correlationId,
          baseRevision,
          newRevision,
          input.requestHash,
          responseJson,
          stamp,
        ),
    );

    for (const entity of nextEntities) {
      const key = `${entity.entityType}:${entity.entityId}`;
      const current = currentByKey.get(key);
      if (current?.payload_json === entity.payloadJson) continue;
      statements.push(upsertEntity(this.db, tenantId, entity, current?.version ?? 0));
    }
    for (const row of currentDomainRows) {
      if (nextKeys.has(`${row.entity_type}:${row.entity_id}`)) continue;
      statements.push(
        this.db
          .prepare(
            "DELETE FROM authoritative_records WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? AND version = ?",
          )
          .bind(tenantId, row.entity_type, row.entity_id, row.version),
      );
    }

    statements.push(
      this.db
        .prepare(
          `INSERT INTO tenant_state_read_models
            (tenant_id, schema_version, revision, payload_json, updated_by, updated_at)
           VALUES (?, 3, ?, ?, ?, ?)
           ON CONFLICT(tenant_id) DO UPDATE SET
             schema_version = excluded.schema_version,
             revision = excluded.revision,
             payload_json = excluded.payload_json,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at
           WHERE tenant_state_read_models.revision = ?`,
        )
        .bind(
          tenantId,
          newRevision,
          JSON.stringify(input.state),
          input.actor.id,
          stamp,
          baseRevision,
        ),
    );
    statements.push(
      this.db
        .prepare(
          `INSERT INTO audit_events
            (tenant_id, id, branch_id, actor_id, device_id, action, entity_type, entity_id,
             before_hash, after_hash, reason, correlation_id, session_id, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'TRANSACTION_STATE', ?, ?, ?, ?, ?, ?, '{}', ?)`,
        )
        .bind(
          tenantId,
          crypto.randomUUID(),
          input.actor.branchId ?? null,
          input.actor.id,
          input.deviceId ?? null,
          input.action,
          input.idempotencyKey,
          await sha256(JSON.stringify(currentDomainRows.map((row) => row.payload_json))),
          await sha256(JSON.stringify(input.state)),
          input.reason,
          input.correlationId,
          input.actor.sessionId ?? null,
          stamp,
        ),
    );

    await this.db.batch(statements);
    return newRevision;
  }

  private async loadStateAtStableRevision(tenantId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.revision(tenantId);
      const state = await this.loadState(tenantId);
      const after = await this.revision(tenantId);
      if (before === after) return { state, revision: after };
    }
    throw new ServerOperationError(
      "CONFLICT",
      409,
      "Authoritative state changed while the command was being prepared",
    );
  }

  private async legacyInventoryBridgeStatements(
    tenantId: string,
    nextEntities: PersistedEntity[],
    currentByKey: Map<string, AuthoritativeRow>,
    input: {
      actor: ServerActor;
      correlationId: string;
    },
    stamp: string,
  ) {
    const statements: D1PreparedStatement[] = [];
    const newMovements = nextEntities.filter(
      (entity) =>
        entity.entityType === "state:stockMovements" &&
        !currentByKey.has(`${entity.entityType}:${entity.entityId}`),
    );
    for (const entity of newMovements) {
      const payload = parseObject(entity.payloadJson);
      const sku = stringValue(payload["sku"]);
      const branchReference =
        entity.branchId ?? stringValue(payload["branchId"]) ?? stringValue(payload["branch"]);
      const movementType = legacyMovementType(stringValue(payload["type"]));
      const rawQuantity = numberValue(payload["quantity"]);
      const rawUnitCost = numberValue(payload["unitCost"]);
      if (
        !sku ||
        !branchReference ||
        !movementType ||
        rawQuantity === null ||
        rawUnitCost === null
      ) {
        statements.push(
          dataQualityStatement(
            this.db,
            tenantId,
            entity.entityId,
            "LEGACY_MOVEMENT_INVALID",
            "Legacy stock movement could not be normalized",
            stamp,
          ),
        );
        continue;
      }
      const branch = await this.db
        .prepare(
          `SELECT id,timezone,business_day_cutoff_minutes FROM branches
           WHERE tenant_id=? AND active=1 AND (id=? OR code=? OR name=?)
           ORDER BY CASE WHEN id=? THEN 0 WHEN code=? THEN 1 ELSE 2 END LIMIT 1`,
        )
        .bind(
          tenantId,
          branchReference,
          branchReference,
          branchReference,
          branchReference,
          branchReference,
        )
        .first<{ id: string; timezone: string; business_day_cutoff_minutes: number }>();
      const item = await this.db
        .prepare(
          "SELECT id,default_warehouse_id FROM inventory_items WHERE tenant_id=? AND sku=? AND active=1",
        )
        .bind(tenantId, sku)
        .first<{ id: string; default_warehouse_id: string | null }>();
      if (!branch || !item) {
        statements.push(
          dataQualityStatement(
            this.db,
            tenantId,
            entity.entityId,
            !branch ? "LEGACY_MOVEMENT_UNMAPPED_BRANCH" : "LEGACY_MOVEMENT_UNMAPPED_ITEM",
            !branch
              ? "Legacy stock movement branch is not mapped to an active branch"
              : `Legacy stock movement SKU ${sku} is not mapped to an inventory item`,
            stamp,
            branch?.id,
          ),
        );
        continue;
      }
      const warehouse = await this.db
        .prepare(
          `SELECT id FROM warehouses WHERE tenant_id=? AND branch_id=? AND active=1
           ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,id LIMIT 1`,
        )
        .bind(tenantId, branch.id, item.default_warehouse_id)
        .first<{ id: string }>();
      if (!warehouse) {
        statements.push(
          dataQualityStatement(
            this.db,
            tenantId,
            entity.entityId,
            "LEGACY_MOVEMENT_WAREHOUSE_MISSING",
            "Legacy stock movement has no active warehouse",
            stamp,
            branch.id,
          ),
        );
        continue;
      }
      const quantityMicro = Math.round(rawQuantity * QUANTITY_SCALE);
      const unitCostMinor = Math.round(rawUnitCost * 100);
      if (
        !Number.isSafeInteger(quantityMicro) ||
        quantityMicro === 0 ||
        !Number.isSafeInteger(unitCostMinor) ||
        unitCostMinor < 0
      ) {
        statements.push(
          dataQualityStatement(
            this.db,
            tenantId,
            entity.entityId,
            "LEGACY_MOVEMENT_PRECISION_INVALID",
            "Legacy stock movement exceeds normalized integer precision",
            stamp,
            branch.id,
          ),
        );
        continue;
      }
      const totalCostMinor = quantityCostMinor(quantityMicro, unitCostMinor);
      const occurredAt = stringValue(payload["createdAt"]) ?? entity.createdAt;
      const businessDate = authoritativeBusinessDate({
        occurredAt,
        timezone: branch.timezone,
        cutoffMinutes: branch.business_day_cutoff_minutes,
      });
      const movementId = `legacy:${entity.entityId}`;
      const idempotencyKey = `legacy-stock:${entity.entityId}`;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO inventory_movements
              (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,
               source_type,source_id,idempotency_key,correlation_id,payload_json,created_at,
               unit_cost_minor,total_cost_minor,business_date,occurred_at,actor_id,reason,negative_override)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
          )
          .bind(
            tenantId,
            movementId,
            branch.id,
            warehouse.id,
            item.id,
            movementType,
            quantityMicro,
            "TRANSACTION_STATE",
            stringValue(payload["reference"]) ?? entity.entityId,
            idempotencyKey,
            input.correlationId,
            JSON.stringify({ compatibilitySource: "PASS_5_TRANSACTION_STATE" }),
            occurredAt,
            unitCostMinor,
            totalCostMinor,
            businessDate,
            occurredAt,
            input.actor.id,
            stringValue(payload["reason"]) ?? null,
          ),
        this.db
          .prepare(
            `INSERT INTO inventory_recalculation_events
              (tenant_id,id,branch_id,event_type,entity_type,entity_id,idempotency_key,status,
               correlation_id,payload_json,created_at)
             VALUES (?,?,?,?,?,?,?,'PENDING',?,'{}',?)
             ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
          )
          .bind(
            tenantId,
            crypto.randomUUID(),
            branch.id,
            "TRANSACTION_STATE_MOVEMENT",
            "INVENTORY_ITEM",
            item.id,
            `inventory-recalc:${idempotencyKey}`,
            input.correlationId,
            occurredAt,
          ),
      );
      const mapping = await this.db
        .prepare(
          `SELECT inventory_account_id,cogs_account_id,wastage_account_id,variance_account_id,
                  accounting_mode
           FROM inventory_account_mappings WHERE tenant_id=? AND active=1
             AND (branch_id=? OR branch_id IS NULL)
           ORDER BY CASE WHEN branch_id=? THEN 0 ELSE 1 END LIMIT 1`,
        )
        .bind(tenantId, branch.id, branch.id)
        .first<{
          inventory_account_id: string;
          cogs_account_id: string;
          wastage_account_id: string;
          variance_account_id: string;
          accounting_mode: string;
        }>();
      const accounts = legacyMovementAccounts(movementType, quantityMicro, mapping);
      const valueMinor = Math.abs(totalCostMinor);
      if (accounts && valueMinor > 0) {
        const tenant = await this.db
          .prepare("SELECT default_currency FROM tenants WHERE id=?")
          .bind(tenantId)
          .first<{ default_currency: string }>();
        if (!tenant?.default_currency) throw new Error("Tenant default currency is not configured");
        const journalId = `inventory:${movementId}`;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO journal_entries
                (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
                 correlation_id,payload_json,created_at)
               VALUES (?,?,?,?,?,?,'DRAFT',?,?,'{}',?)`,
            )
            .bind(
              tenantId,
              journalId,
              branch.id,
              "INVENTORY_MOVEMENT",
              movementId,
              businessDate,
              `${movementType} inventory posting`,
              input.correlationId,
              occurredAt,
            ),
          this.db
            .prepare(
              `INSERT INTO journal_lines
                (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
               VALUES (?,?,?,?,?,?,?,'{}')`,
            )
            .bind(tenantId, journalId, 1, accounts.debit, valueMinor, 0, tenant.default_currency),
          this.db
            .prepare(
              `INSERT INTO journal_lines
                (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
               VALUES (?,?,?,?,?,?,?,'{}')`,
            )
            .bind(tenantId, journalId, 2, accounts.credit, 0, valueMinor, tenant.default_currency),
          this.db
            .prepare(
              "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
            )
            .bind(occurredAt, tenantId, journalId),
        );
      } else if (!mapping) {
        statements.push(
          dataQualityStatement(
            this.db,
            tenantId,
            entity.entityId,
            "INVENTORY_ACCOUNT_MAPPING_MISSING",
            "Inventory movement posted without a configured accounting mapping",
            stamp,
            branch.id,
          ),
        );
      }
    }
    return statements;
  }

  private async crmTransactionBridgeStatements(
    tenantId: string,
    nextEntities: PersistedEntity[],
    currentByKey: Map<string, AuthoritativeRow>,
    input: {
      actor: ServerActor;
      correlationId: string;
      action: string;
      idempotencyKey: string;
    },
    stamp: string,
  ) {
    const statements: D1PreparedStatement[] = [];
    const deterministicallyAttributedOrders = new Set<string>();
    const tenant = await this.db
      .prepare("SELECT default_currency FROM tenants WHERE id=? AND active=1")
      .bind(tenantId)
      .first<{ default_currency: string }>();
    if (!tenant?.default_currency) {
      throw new ServerOperationError("VALIDATION_FAILED", 400, "Tenant currency is not configured");
    }

    const customerValueActionTypes: Record<string, string> = {
      applyVoucherRedemption: "VOUCHER",
      applyGiftCardRedemption: "GIFT_CARD",
      applyLoyaltyReward: "LOYALTY",
    };
    const guestValueTransaction =
      input.action === "createGuestOrder"
        ? nextEntities.find((entity) => {
            if (
              entity.entityType !== "payments:transactions" ||
              currentByKey.has(`${entity.entityType}:${entity.entityId}`)
            ) {
              return false;
            }
            const transaction = parseObject(entity.payloadJson);
            const metadata = isRecord(transaction["metadata"]) ? transaction["metadata"] : {};
            return transaction["status"] === "CONFIRMED" && Boolean(metadata["customerValueType"]);
          })
        : undefined;
    const guestValueMetadata = guestValueTransaction
      ? parseObject(guestValueTransaction.payloadJson)["metadata"]
      : undefined;
    const expectedValueType =
      customerValueActionTypes[input.action] ??
      (isRecord(guestValueMetadata)
        ? stringValue(guestValueMetadata["customerValueType"])
        : undefined);
    if (expectedValueType) {
      const valueTransactions = nextEntities.filter((entity) => {
        if (
          entity.entityType !== "payments:transactions" ||
          currentByKey.has(`${entity.entityType}:${entity.entityId}`)
        ) {
          return false;
        }
        const transaction = parseObject(entity.payloadJson);
        const metadata = isRecord(transaction["metadata"]) ? transaction["metadata"] : {};
        return (
          transaction["status"] === "CONFIRMED" &&
          transaction["direction"] === "COLLECTION" &&
          metadata["customerValueType"] === expectedValueType
        );
      });
      if (valueTransactions.length !== 1) {
        throw new ServerOperationError(
          "INVALID_STATE_TRANSITION",
          409,
          "Customer-value redemption did not produce exactly one confirmed transaction",
        );
      }
      for (const entity of valueTransactions) {
        const transaction = parseObject(entity.payloadJson);
        const metadata = isRecord(transaction["metadata"]) ? transaction["metadata"] : {};
        const valueType = stringValue(metadata["customerValueType"]);
        const valueId = stringValue(metadata["customerValueId"]);
        const amountMinor = numberValue(transaction["amountMinor"]);
        const currency = stringValue(transaction["currency"]);
        const branchId = entity.branchId ?? stringValue(transaction["branchId"]);
        const invoiceId = stringValue(transaction["merchantReference"]);
        const orderId = stringValue(metadata["orderId"]);
        const customerId = stringValue(metadata["customerId"]);
        const debitAccountId = stringValue(metadata["debitAccountId"]);
        const receivableAccountId = stringValue(metadata["receivableAccountId"]);
        const businessDate = stringValue(metadata["businessDate"]);
        if (
          !valueType ||
          !valueId ||
          amountMinor === null ||
          !Number.isSafeInteger(amountMinor) ||
          amountMinor <= 0 ||
          !currency ||
          !branchId ||
          !invoiceId ||
          !orderId ||
          !debitAccountId ||
          !receivableAccountId ||
          !businessDate
        ) {
          throw new ServerOperationError(
            "VALIDATION_FAILED",
            400,
            "Authoritative customer-value transaction is incomplete",
          );
        }
        const journalId = `crm-value:${entity.entityId}`;
        const ledgerId = `crm-value-ledger:${entity.entityId}`;
        if (valueType === "GIFT_CARD") {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO gift_card_ledger
                  (tenant_id,id,gift_card_id,branch_id,entry_type,amount_minor,currency,
                   source_type,source_id,actor_id,business_date,reason,idempotency_key,
                   correlation_id,journal_entry_id,created_at)
                 VALUES (?,?,?,?,'REDEEM',? ,?,'PAYMENT_TRANSACTION',?,?,?,
                   'Gift card redeemed through authoritative payment',?,?,?,?)`,
              )
              .bind(
                tenantId,
                ledgerId,
                valueId,
                branchId,
                -amountMinor,
                currency,
                entity.entityId,
                input.actor.id,
                businessDate,
                `${input.action}:${input.idempotencyKey}`,
                input.correlationId,
                journalId,
                stamp,
              ),
            this.db
              .prepare(
                `UPDATE gift_cards SET status=CASE WHEN (SELECT COALESCE(SUM(amount_minor),0)
                   FROM gift_card_ledger WHERE tenant_id=? AND gift_card_id=?)=0
                   THEN 'REDEEMED' ELSE 'ACTIVE' END,updated_at=?
                 WHERE tenant_id=? AND id=?`,
              )
              .bind(tenantId, valueId, stamp, tenantId, valueId),
          );
        } else if (valueType === "VOUCHER") {
          const voucherIssueId = stringValue(metadata["voucherIssueId"]);
          statements.push(
            this.db
              .prepare(
                `INSERT INTO voucher_redemptions
                  (tenant_id,id,voucher_definition_id,voucher_issue_id,customer_id,branch_id,
                   order_id,invoice_id,channel,discount_minor,currency,status,actor_id,
                   idempotency_key,correlation_id,redeemed_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?)`,
              )
              .bind(
                tenantId,
                ledgerId,
                valueId,
                voucherIssueId ?? null,
                customerId ?? null,
                branchId,
                orderId,
                invoiceId,
                stringValue(metadata["channel"]) ?? "UNSPECIFIED",
                amountMinor,
                currency,
                input.actor.id,
                `${input.action}:${input.idempotencyKey}`,
                input.correlationId,
                stamp,
              ),
          );
          if (voucherIssueId) {
            statements.push(
              this.db
                .prepare(
                  `UPDATE voucher_issues SET status=CASE WHEN EXISTS (
                     SELECT 1 FROM voucher_redemptions r JOIN voucher_definitions d
                       ON d.tenant_id=r.tenant_id AND d.id=r.voucher_definition_id
                     WHERE r.tenant_id=? AND r.id=? AND r.status='CONFIRMED' AND d.single_use=1)
                     THEN 'REDEEMED' ELSE status END WHERE tenant_id=? AND id=?`,
                )
                .bind(tenantId, ledgerId, tenantId, voucherIssueId),
            );
          }
          const campaign = await this.db
            .prepare(
              `SELECT c.id FROM voucher_definitions v JOIN campaigns c
                 ON c.tenant_id=v.tenant_id AND c.id=v.campaign_id
               WHERE v.tenant_id=? AND v.id=? AND c.status<>'CANCELLED'`,
            )
            .bind(tenantId, valueId)
            .first<{ id: string }>();
          if (campaign) {
            const delivery = customerId
              ? await this.db
                  .prepare(
                    `SELECT d.id FROM campaign_deliveries d JOIN campaign_audiences a
                       ON a.tenant_id=d.tenant_id AND a.id=d.audience_id
                     WHERE d.tenant_id=? AND d.campaign_id=? AND a.customer_id=?
                       AND d.status IN ('SENT','DELIVERED')
                     ORDER BY COALESCE(d.delivered_at,d.sent_at,d.updated_at) DESC LIMIT 1`,
                  )
                  .bind(tenantId, campaign.id, customerId)
                  .first<{ id: string }>()
              : null;
            deterministicallyAttributedOrders.add(orderId);
            statements.push(
              this.db
                .prepare(
                  `INSERT INTO campaign_events
                    (tenant_id,id,campaign_id,delivery_id,customer_id,event_type,provider_event_id,
                     attribution_type,source_type,source_id,payload_json,occurred_at,created_at)
                   VALUES (?,?,?,?,?,'CONVERSION',?,'ATTRIBUTED_BY_RULE','ORDER',?,?,?,?)
                   ON CONFLICT(tenant_id,provider_event_id) DO NOTHING`,
                )
                .bind(
                  tenantId,
                  `campaign-voucher:${entity.entityId}`,
                  campaign.id,
                  delivery?.id ?? null,
                  customerId ?? null,
                  `voucher-conversion:${entity.entityId}`,
                  orderId,
                  JSON.stringify({
                    evidence: "CAMPAIGN_VOUCHER_REDEMPTION",
                    voucherDefinitionId: valueId,
                  }),
                  stamp,
                  stamp,
                ),
            );
          }
        } else if (valueType === "LOYALTY") {
          const programId = stringValue(metadata["programId"]);
          const points = numberValue(metadata["points"]);
          if (
            !customerId ||
            !programId ||
            points === null ||
            !Number.isSafeInteger(points) ||
            points <= 0
          ) {
            throw new ServerOperationError(
              "VALIDATION_FAILED",
              400,
              "Loyalty redemption is incomplete",
            );
          }
          statements.push(
            this.db
              .prepare(
                `INSERT INTO loyalty_ledger
                  (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,
                   source_id,business_date,reason,actor_id,correlation_id,idempotency_key,created_at)
                 VALUES (?,?,?,?,?,'REDEEM',?,'PAYMENT_TRANSACTION',?,?,'Reward redeemed at checkout',?,?,?,?)`,
              )
              .bind(
                tenantId,
                ledgerId,
                customerId,
                programId,
                branchId,
                -points,
                entity.entityId,
                businessDate,
                input.actor.id,
                input.correlationId,
                `${input.action}:${input.idempotencyKey}`,
                stamp,
              ),
          );
        }
        statements.push(
          this.db
            .prepare(
              `INSERT INTO journal_entries
                (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
                 correlation_id,payload_json,created_at)
               VALUES (?,?,?,?,?,?,'DRAFT',?,?,'{}',?)`,
            )
            .bind(
              tenantId,
              journalId,
              branchId,
              `${valueType}_REDEMPTION`,
              entity.entityId,
              businessDate,
              `${valueType.replace("_", " ")} redemption`,
              input.correlationId,
              stamp,
            ),
          this.db
            .prepare(
              `INSERT INTO journal_lines
                (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
               VALUES (?,?,?,?,?,0,?,'{}')`,
            )
            .bind(tenantId, journalId, 1, debitAccountId, amountMinor, currency),
          this.db
            .prepare(
              `INSERT INTO journal_lines
                (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
               VALUES (?,?,?,?,0,?,?, '{}')`,
            )
            .bind(tenantId, journalId, 2, receivableAccountId, amountMinor, currency),
          this.db
            .prepare(
              "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
            )
            .bind(stamp, tenantId, journalId),
          this.db
            .prepare(
              `INSERT INTO audit_events
                (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
                 correlation_id,session_id,metadata_json,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              tenantId,
              crypto.randomUUID(),
              branchId,
              input.actor.id,
              input.actor.deviceId ?? null,
              `${valueType}_REDEEMED_AT_CHECKOUT`,
              "PAYMENT_TRANSACTION",
              entity.entityId,
              "Authoritative customer-value redemption",
              input.correlationId,
              input.actor.sessionId ?? null,
              JSON.stringify({ valueType, valueId, amountMinor, currency }),
              stamp,
            ),
        );
      }
    }

    const completedOrders = nextEntities.filter((entity) => {
      if (entity.entityType !== "state:orders") return false;
      const next = parseObject(entity.payloadJson);
      const current = currentByKey.get(`${entity.entityType}:${entity.entityId}`);
      const before = current ? parseObject(current.payload_json) : {};
      return isCompletedCustomerOrder(next) && !isCompletedCustomerOrder(before);
    });

    for (const entity of completedOrders) {
      const order = parseObject(entity.payloadJson);
      const customerId = stringValue(order["customerId"]);
      const branchId = entity.branchId ?? stringValue(order["branchId"]);
      if (!customerId || !branchId) continue;
      const [customer, branch] = await Promise.all([
        this.db
          .prepare("SELECT id,status FROM customers WHERE tenant_id=? AND id=?")
          .bind(tenantId, customerId)
          .first<{ id: string; status: string }>(),
        this.db
          .prepare(
            `SELECT id,brand_id,timezone,business_day_cutoff_minutes FROM branches
             WHERE tenant_id=? AND id=? AND active=1`,
          )
          .bind(tenantId, branchId)
          .first<{
            id: string;
            brand_id: string | null;
            timezone: string;
            business_day_cutoff_minutes: number;
          }>(),
      ]);
      if (!customer || customer.status === "BLOCKED") {
        throw new ServerOperationError(
          "TENANT_SCOPE_VIOLATION",
          403,
          "Linked customer is unavailable for this tenant",
        );
      }
      if (!branch) {
        throw new ServerOperationError(
          "TENANT_SCOPE_VIOLATION",
          403,
          "Order branch is unavailable",
        );
      }
      const occurredAt = stringValue(order["updatedAt"]) ?? entity.updatedAt;
      const businessDate = authoritativeBusinessDate({
        occurredAt,
        timezone: branch.timezone,
        cutoffMinutes: branch.business_day_cutoff_minutes,
      });
      const total = numberValue(order["total"]);
      if (total === null || total < 0) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Completed order total is invalid",
        );
      }
      const grossMinor = parseMajorAmount(total, tenant.default_currency);
      const bill = nextEntities.find((candidate) => {
        if (candidate.entityType !== "state:bills") return false;
        return stringValue(parseObject(candidate.payloadJson)["orderId"]) === entity.entityId;
      });
      const discountMinor = bill
        ? nextEntities.reduce((sum, candidate) => {
            if (candidate.entityType !== "payments:transactions") return sum;
            const payment = parseObject(candidate.payloadJson);
            const metadata = isRecord(payment["metadata"]) ? payment["metadata"] : {};
            return payment["status"] === "CONFIRMED" &&
              payment["direction"] === "COLLECTION" &&
              payment["merchantReference"] === bill.entityId &&
              ["VOUCHER", "LOYALTY"].includes(String(metadata["customerValueType"] ?? ""))
              ? sum + (numberValue(payment["amountMinor"]) ?? 0)
              : sum;
          }, 0)
        : 0;
      const netMinor = Math.max(0, grossMinor - discountMinor);
      const channel = stringValue(order["channel"]) ?? "UNSPECIFIED";
      const lines = Array.isArray(order["lines"]) ? order["lines"] : [];
      const itemSummary = lines.flatMap((line) => {
        if (!isRecord(line)) return [];
        const name = stringValue(line["name"]);
        const quantity = numberValue(line["quantity"]);
        return name && quantity !== null ? [{ name, quantity }] : [];
      });
      const linkId = `crm-order:${entity.entityId}`;
      statements.push(
        this.db
          .prepare(
            `INSERT INTO customer_transaction_links
              (tenant_id,id,customer_id,branch_id,source_type,source_id,link_source,business_date,
               currency,gross_minor,net_minor,refund_minor,discount_minor,completed,channel,
               item_summary_json,correlation_id,created_at,updated_at)
             VALUES (?,?,?,?,'ORDER',?,'POS_SELECTED',?,?,?,?,0,?,1,?,?,?,?,?)
             ON CONFLICT(tenant_id,source_type,source_id) DO NOTHING`,
          )
          .bind(
            tenantId,
            linkId,
            customerId,
            branchId,
            entity.entityId,
            businessDate,
            tenant.default_currency,
            grossMinor,
            netMinor,
            discountMinor,
            channel,
            JSON.stringify(itemSummary),
            input.correlationId,
            occurredAt,
            occurredAt,
          ),
        this.db
          .prepare(
            `UPDATE customers SET last_activity_at=CASE
               WHEN last_activity_at IS NULL OR last_activity_at<? THEN ? ELSE last_activity_at END,
               updated_at=? WHERE tenant_id=? AND id=?`,
          )
          .bind(occurredAt, occurredAt, stamp, tenantId, customerId),
        this.db
          .prepare(
            `INSERT INTO customer_journey_events
              (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
               occurred_at,created_at)
             VALUES (?,? ,?,?,'ORDER_COMPLETED','ORDER',?,'Completed customer order',?,?)
             ON CONFLICT(tenant_id,event_type,source_type,source_id) DO NOTHING`,
          )
          .bind(
            tenantId,
            `journey-order:${entity.entityId}`,
            customerId,
            branchId,
            entity.entityId,
            occurredAt,
            stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO crm_recalculation_events
              (tenant_id,id,branch_id,event_type,entity_type,entity_id,idempotency_key,status,
               correlation_id,payload_json,created_at)
             VALUES (?,?,?,'ORDER_COMPLETED','CUSTOMER',?,?,'PENDING',?,'{}',?)
             ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
          )
          .bind(
            tenantId,
            crypto.randomUUID(),
            branchId,
            customerId,
            `crm-recalc:order:${entity.entityId}`,
            input.correlationId,
            stamp,
          ),
        this.db
          .prepare(
            `INSERT INTO audit_events
              (tenant_id,id,branch_id,actor_id,device_id,action,entity_type,entity_id,reason,
               correlation_id,session_id,metadata_json,created_at)
             VALUES (?,?,?,?,?,'CRM_CUSTOMER_TRANSACTION_LINKED','CUSTOMER_TRANSACTION_LINK',?,
               'Completed authoritative order',?,?,'{}',?)`,
          )
          .bind(
            tenantId,
            crypto.randomUUID(),
            branchId,
            input.actor.id,
            input.actor.deviceId ?? null,
            linkId,
            input.correlationId,
            input.actor.sessionId ?? null,
            stamp,
          ),
      );

      if (!deterministicallyAttributedOrders.has(entity.entityId)) {
        const crmFlag = await this.db
          .prepare(
            `SELECT configuration_json FROM feature_flags
             WHERE tenant_id=? AND key='crm.enabled' AND enabled=1`,
          )
          .bind(tenantId)
          .first<{ configuration_json: string }>();
        const crmConfiguration = crmFlag ? parseObject(crmFlag.configuration_json) : {};
        const attributionWindowDays = numberValue(
          crmConfiguration["campaignAttributionWindowDays"],
        );
        if (
          attributionWindowDays !== null &&
          Number.isSafeInteger(attributionWindowDays) &&
          attributionWindowDays > 0 &&
          attributionWindowDays <= 365
        ) {
          const occurredAtMs = Date.parse(occurredAt);
          if (Number.isFinite(occurredAtMs)) {
            const windowStart = new Date(
              occurredAtMs - attributionWindowDays * 86_400_000,
            ).toISOString();
            const correlated = await this.db
              .prepare(
                `SELECT d.id AS delivery_id,d.campaign_id,
                        COALESCE(d.delivered_at,d.sent_at,d.updated_at) AS evidence_at
                 FROM campaign_deliveries d JOIN campaign_audiences a
                   ON a.tenant_id=d.tenant_id AND a.id=d.audience_id
                 JOIN campaigns c ON c.tenant_id=d.tenant_id AND c.id=d.campaign_id
                 WHERE d.tenant_id=? AND a.customer_id=? AND d.status IN ('SENT','DELIVERED')
                   AND c.status IN ('ACTIVE','COMPLETED')
                   AND COALESCE(d.delivered_at,d.sent_at,d.updated_at)>=?
                   AND COALESCE(d.delivered_at,d.sent_at,d.updated_at)<=?
                   AND (c.branch_scope_json='[]' OR EXISTS (
                     SELECT 1 FROM json_each(c.branch_scope_json) WHERE value=?))
                 ORDER BY evidence_at DESC,d.id DESC LIMIT 1`,
              )
              .bind(tenantId, customerId, windowStart, occurredAt, branchId)
              .first<{ delivery_id: string; campaign_id: string; evidence_at: string }>();
            if (correlated) {
              statements.push(
                this.db
                  .prepare(
                    `INSERT INTO campaign_events
                      (tenant_id,id,campaign_id,delivery_id,customer_id,event_type,
                       provider_event_id,attribution_type,source_type,source_id,payload_json,
                       occurred_at,created_at)
                     VALUES (?,?,?,?,?,'CONVERSION',?,'CORRELATED','ORDER',?,?,?,?)
                     ON CONFLICT(tenant_id,provider_event_id) DO NOTHING`,
                  )
                  .bind(
                    tenantId,
                    `campaign-correlated:${entity.entityId}`,
                    correlated.campaign_id,
                    correlated.delivery_id,
                    customerId,
                    `correlated-order:${entity.entityId}`,
                    entity.entityId,
                    JSON.stringify({
                      evidence: "ORDER_WITHIN_CONFIGURED_POST_DELIVERY_WINDOW",
                      evidenceAt: correlated.evidence_at,
                      windowDays: attributionWindowDays,
                      causalClaim: false,
                    }),
                    occurredAt,
                    stamp,
                  ),
              );
            }
          }
        }
      }

      const programs = await this.db
        .prepare(
          `SELECT id,earning_type,spend_minor_per_point,minimum_spend_minor,rounding_policy,
                  expiry_type,expiry_days,expiry_date,eligible_branches_json,eligible_channels_json
           FROM loyalty_programs WHERE tenant_id=? AND status='ACTIVE' AND effective_from<=?
             AND (expires_at IS NULL OR expires_at>?)
             AND (scope_type='TENANT' OR (scope_type='BRAND' AND brand_id=?)
               OR (scope_type='BRANCH' AND branch_id=?))`,
        )
        .bind(tenantId, occurredAt, occurredAt, branch.brand_id ?? "", branchId)
        .all<CrmLoyaltyProgramRow>();
      for (const program of programs.results ?? []) {
        if (
          !crmProgramEligible(program, branchId, channel) ||
          netMinor < program.minimum_spend_minor
        ) {
          continue;
        }
        const tier = await this.db
          .prepare(
            `SELECT t.points_multiplier_numerator,t.points_multiplier_denominator
             FROM customer_loyalty_memberships m JOIN loyalty_tiers t
               ON t.tenant_id=m.tenant_id AND t.id=m.tier_id
             WHERE m.tenant_id=? AND m.customer_id=? AND m.program_id=?
               AND m.status='ACTIVE' LIMIT 1`,
          )
          .bind(tenantId, customerId, program.id)
          .first<{ points_multiplier_numerator: number; points_multiplier_denominator: number }>();
        const points = crmEarnedPoints(program, netMinor, tier);
        if (points <= 0) continue;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO loyalty_ledger
                (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,
                 source_id,business_date,expires_at,reason,actor_id,correlation_id,idempotency_key,
                 created_at)
               VALUES (?,?,?,?,?,'EARN',?,'ORDER',?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
            )
            .bind(
              tenantId,
              crypto.randomUUID(),
              customerId,
              program.id,
              branchId,
              points,
              entity.entityId,
              businessDate,
              crmPointsExpiry(program, occurredAt),
              "Completed paid transaction",
              input.actor.id,
              input.correlationId,
              `crm-order-earn:${entity.entityId}:${program.id}`,
              occurredAt,
            ),
        );
      }
    }

    const confirmedRefunds = nextEntities.filter((entity) => {
      if (entity.entityType !== "payments:refunds") return false;
      const next = parseObject(entity.payloadJson);
      const current = currentByKey.get(`${entity.entityType}:${entity.entityId}`);
      const before = current ? parseObject(current.payload_json) : {};
      return next["status"] === "CONFIRMED" && before["status"] !== "CONFIRMED";
    });
    for (const refundEntity of confirmedRefunds) {
      const refund = parseObject(refundEntity.payloadJson);
      const originalTransactionId = stringValue(refund["originalTransactionId"]);
      const refundAmountMinor = numberValue(refund["amountMinor"]);
      const currency = stringValue(refund["currency"]);
      if (
        !originalTransactionId ||
        refundAmountMinor === null ||
        !Number.isSafeInteger(refundAmountMinor) ||
        refundAmountMinor <= 0 ||
        !currency
      ) {
        throw new ServerOperationError("VALIDATION_FAILED", 400, "Confirmed refund is incomplete");
      }
      const originalEntity = nextEntities.find(
        (candidate) =>
          candidate.entityType === "payments:transactions" &&
          candidate.entityId === originalTransactionId,
      );
      if (!originalEntity) {
        throw new ServerOperationError(
          "INVALID_STATE_TRANSITION",
          409,
          "Original payment is unavailable",
        );
      }
      const original = parseObject(originalEntity.payloadJson);
      const originalAmountMinor = numberValue(original["amountMinor"]);
      const originalMetadata = isRecord(original["metadata"]) ? original["metadata"] : {};
      if (!originalAmountMinor || originalAmountMinor < refundAmountMinor) {
        throw new ServerOperationError(
          "INVALID_STATE_TRANSITION",
          409,
          "Refund exceeds original payment",
        );
      }
      const allocations = nextEntities
        .filter((candidate) => {
          if (candidate.entityType !== "payments:allocations") return false;
          return (
            stringValue(parseObject(candidate.payloadJson)["paymentTransactionId"]) ===
            originalTransactionId
          );
        })
        .map((candidate) => ({ entity: candidate, payload: parseObject(candidate.payloadJson) }));
      let distributedMinor = 0;
      for (const [index, allocation] of allocations.entries()) {
        const invoiceId = stringValue(allocation.payload["invoiceId"]);
        const allocatedMinor = numberValue(allocation.payload["amountMinor"]);
        if (!invoiceId || allocatedMinor === null || allocatedMinor <= 0) continue;
        const shareMinor =
          index === allocations.length - 1
            ? refundAmountMinor - distributedMinor
            : Math.floor((refundAmountMinor * allocatedMinor) / originalAmountMinor);
        distributedMinor += shareMinor;
        if (shareMinor <= 0) continue;
        const billEntity = nextEntities.find(
          (candidate) => candidate.entityType === "state:bills" && candidate.entityId === invoiceId,
        );
        const bill = billEntity ? parseObject(billEntity.payloadJson) : {};
        const orderIds = Array.isArray(bill["orderIds"])
          ? bill["orderIds"].filter((value): value is string => typeof value === "string")
          : [];
        for (const orderId of orderIds) {
          const orderEntity = nextEntities.find(
            (candidate) =>
              candidate.entityType === "state:orders" && candidate.entityId === orderId,
          );
          const order = orderEntity ? parseObject(orderEntity.payloadJson) : {};
          const customerId = stringValue(order["customerId"]);
          const branchId =
            refundEntity.branchId ??
            stringValue(refund["branchId"]) ??
            stringValue(order["branchId"]);
          const orderTotal = numberValue(order["total"]);
          const orderGrossMinor = orderTotal === null ? 0 : parseMajorAmount(orderTotal, currency);
          if (!customerId || !branchId || orderGrossMinor <= 0) continue;
          statements.push(
            this.db
              .prepare(
                `UPDATE customer_transaction_links SET refund_minor=refund_minor+?,
                   net_minor=MAX(0,net_minor-?),updated_at=?
                 WHERE tenant_id=? AND source_type='ORDER' AND source_id=? AND customer_id=?`,
              )
              .bind(shareMinor, shareMinor, stamp, tenantId, orderId, customerId),
            this.db
              .prepare(
                `INSERT INTO customer_journey_events
                  (tenant_id,id,customer_id,branch_id,event_type,source_type,source_id,summary,
                   occurred_at,created_at)
                 VALUES (?,?,?,?,'REFUND_CONFIRMED','REFUND',?,'Confirmed payment refund',?,?)
                 ON CONFLICT(tenant_id,event_type,source_type,source_id) DO NOTHING`,
              )
              .bind(
                tenantId,
                `journey-refund:${refundEntity.entityId}:${orderId}`,
                customerId,
                branchId,
                `${refundEntity.entityId}:${orderId}`,
                stamp,
                stamp,
              ),
            this.db
              .prepare(
                `INSERT INTO crm_recalculation_events
                  (tenant_id,id,branch_id,event_type,entity_type,entity_id,idempotency_key,status,
                   correlation_id,payload_json,created_at)
                 VALUES (?,?,?,'REFUND_CONFIRMED','CUSTOMER',?,?,'PENDING',?,'{}',?)
                 ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
              )
              .bind(
                tenantId,
                crypto.randomUUID(),
                branchId,
                customerId,
                `crm-recalc:refund:${refundEntity.entityId}:${orderId}`,
                input.correlationId,
                stamp,
              ),
          );
          const earns = await this.db
            .prepare(
              `SELECT id,program_id,points FROM loyalty_ledger
               WHERE tenant_id=? AND customer_id=? AND source_type='ORDER' AND source_id=?
                 AND entry_type='EARN'`,
            )
            .bind(tenantId, customerId, orderId)
            .all<{ id: string; program_id: string; points: number }>();
          for (const earn of earns.results ?? []) {
            const points =
              shareMinor >= orderGrossMinor
                ? earn.points
                : Math.min(earn.points, Math.ceil((earn.points * shareMinor) / orderGrossMinor));
            if (points <= 0) continue;
            statements.push(
              this.db
                .prepare(
                  `INSERT INTO loyalty_ledger
                    (tenant_id,id,customer_id,program_id,branch_id,entry_type,points,source_type,
                     source_id,source_entry_id,business_date,reason,actor_id,correlation_id,
                     idempotency_key,created_at)
                   VALUES (?,?,?,?,?,'REVERSAL',?,'REFUND',?,?,?,'Points reversed for confirmed refund',?,?,?,?)
                   ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
                )
                .bind(
                  tenantId,
                  `loyalty-refund:${refundEntity.entityId}:${earn.id}`,
                  customerId,
                  earn.program_id,
                  branchId,
                  -points,
                  refundEntity.entityId,
                  earn.id,
                  stamp.slice(0, 10),
                  input.actor.id,
                  input.correlationId,
                  `loyalty-refund:${refundEntity.entityId}:${earn.id}`,
                  stamp,
                ),
            );
          }
          if (refundAmountMinor >= originalAmountMinor) {
            const restorableVouchers = await this.db
              .prepare(
                `SELECT r.id,r.voucher_definition_id,r.voucher_issue_id,r.customer_id,r.branch_id,
                        r.order_id,r.invoice_id,r.channel,r.discount_minor,r.currency
                 FROM voucher_redemptions r JOIN voucher_definitions d
                   ON d.tenant_id=r.tenant_id AND d.id=r.voucher_definition_id
                 WHERE r.tenant_id=? AND r.order_id=? AND r.status='CONFIRMED'
                   AND d.refund_policy='RESTORE_ON_FULL_REFUND'`,
              )
              .bind(tenantId, orderId)
              .all<Record<string, unknown>>();
            for (const voucher of restorableVouchers.results ?? []) {
              const reversalId = `voucher-refund:${refundEntity.entityId}:${String(voucher["id"])}`;
              statements.push(
                this.db
                  .prepare(
                    `INSERT INTO voucher_redemptions
                      (tenant_id,id,voucher_definition_id,voucher_issue_id,customer_id,branch_id,
                       order_id,invoice_id,channel,discount_minor,currency,status,source_redemption_id,
                       actor_id,idempotency_key,correlation_id,redeemed_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,'REVERSED',?,?,?,?,?)
                     ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
                  )
                  .bind(
                    tenantId,
                    reversalId,
                    voucher["voucher_definition_id"],
                    voucher["voucher_issue_id"],
                    voucher["customer_id"],
                    voucher["branch_id"],
                    voucher["order_id"],
                    voucher["invoice_id"],
                    voucher["channel"],
                    voucher["discount_minor"],
                    voucher["currency"],
                    voucher["id"],
                    input.actor.id,
                    reversalId,
                    input.correlationId,
                    stamp,
                  ),
              );
              if (voucher["voucher_issue_id"]) {
                statements.push(
                  this.db
                    .prepare(
                      "UPDATE voucher_issues SET status='ACTIVE' WHERE tenant_id=? AND id=? AND status='REDEEMED'",
                    )
                    .bind(tenantId, voucher["voucher_issue_id"]),
                );
              }
            }
          }
          const attributed = await this.db
            .prepare(
              `SELECT id,campaign_id,delivery_id,attribution_type FROM campaign_events
               WHERE tenant_id=? AND customer_id=? AND source_type='ORDER' AND source_id=?
                 AND event_type IN ('CONVERSION','REDEMPTION')`,
            )
            .bind(tenantId, customerId, orderId)
            .all<{
              id: string;
              campaign_id: string;
              delivery_id: string | null;
              attribution_type: "ATTRIBUTED_BY_RULE" | "CORRELATED" | "UNKNOWN" | null;
            }>();
          for (const event of attributed.results ?? []) {
            statements.push(
              this.db
                .prepare(
                  `INSERT INTO campaign_events
                    (tenant_id,id,campaign_id,delivery_id,customer_id,event_type,provider_event_id,
                     attribution_type,source_type,source_id,payload_json,occurred_at,created_at)
                   VALUES (?,?,?,?,?,'ATTRIBUTION_REVERSED',?,?,'REFUND',?,'{}',?,?)
                   ON CONFLICT(tenant_id,provider_event_id) DO NOTHING`,
                )
                .bind(
                  tenantId,
                  `campaign-refund:${refundEntity.entityId}:${event.id}`,
                  event.campaign_id,
                  event.delivery_id,
                  customerId,
                  `refund:${refundEntity.entityId}:${event.id}`,
                  event.attribution_type ?? "UNKNOWN",
                  refundEntity.entityId,
                  stamp,
                  stamp,
                ),
            );
          }
        }
      }
      if (originalMetadata["customerValueType"] === "GIFT_CARD") {
        const giftCardId = stringValue(originalMetadata["giftCardId"]);
        const liabilityAccountId = stringValue(originalMetadata["debitAccountId"]);
        const receivableAccountId = stringValue(originalMetadata["receivableAccountId"]);
        const branchId = refundEntity.branchId ?? stringValue(refund["branchId"]);
        const businessDate = stringValue(originalMetadata["businessDate"]) ?? stamp.slice(0, 10);
        if (giftCardId && liabilityAccountId && receivableAccountId && branchId) {
          const ledgerId = `gift-refund:${refundEntity.entityId}`;
          const journalId = `gift-refund-journal:${refundEntity.entityId}`;
          statements.push(
            this.db
              .prepare(
                `INSERT INTO gift_card_ledger
                  (tenant_id,id,gift_card_id,branch_id,entry_type,amount_minor,currency,source_type,
                   source_id,source_entry_id,actor_id,business_date,reason,idempotency_key,
                   correlation_id,journal_entry_id,created_at)
                 VALUES (?,?,?,?,'REFUND',? ,?,'REFUND',?,?,?,?,
                   'Gift-card value restored after confirmed refund',?,?,?,?)
                 ON CONFLICT(tenant_id,idempotency_key) DO NOTHING`,
              )
              .bind(
                tenantId,
                ledgerId,
                giftCardId,
                branchId,
                refundAmountMinor,
                currency,
                refundEntity.entityId,
                `crm-value-ledger:${originalTransactionId}`,
                input.actor.id,
                businessDate,
                ledgerId,
                input.correlationId,
                journalId,
                stamp,
              ),
            this.db
              .prepare(
                `INSERT INTO journal_entries
                  (tenant_id,id,branch_id,source_type,source_id,business_date,status,description,
                   correlation_id,payload_json,created_at)
                 VALUES (?,?,?,?,?,?,'DRAFT','Gift-card refund restoration',?,'{}',?)`,
              )
              .bind(
                tenantId,
                journalId,
                branchId,
                "GIFT_CARD_REFUND",
                refundEntity.entityId,
                businessDate,
                input.correlationId,
                stamp,
              ),
            this.db
              .prepare(
                `INSERT INTO journal_lines
                  (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
                 VALUES (?,?,?,?,?,0,?,'{}')`,
              )
              .bind(tenantId, journalId, 1, receivableAccountId, refundAmountMinor, currency),
            this.db
              .prepare(
                `INSERT INTO journal_lines
                  (tenant_id,journal_entry_id,line_number,account_id,debit_minor,credit_minor,currency,payload_json)
                 VALUES (?,?,?,?,0,?,?, '{}')`,
              )
              .bind(tenantId, journalId, 2, liabilityAccountId, refundAmountMinor, currency),
            this.db
              .prepare(
                "UPDATE journal_entries SET status='POSTED',posted_at=? WHERE tenant_id=? AND id=? AND status='DRAFT'",
              )
              .bind(stamp, tenantId, journalId),
            this.db
              .prepare(
                "UPDATE gift_cards SET status='ACTIVE',updated_at=? WHERE tenant_id=? AND id=?",
              )
              .bind(stamp, tenantId, giftCardId),
          );
        }
      }
    }
    return statements;
  }

  private async reservationDepositBridgeStatements(
    tenantId: string,
    nextEntities: PersistedEntity[],
    currentByKey: Map<string, AuthoritativeRow>,
    input: {
      actor: ServerActor;
      correlationId: string;
      action: string;
      idempotencyKey: string;
    },
    stamp: string,
  ) {
    if (input.action !== "applyReservationDeposit") return [];
    const applications = nextEntities.filter((entity) => {
      if (
        entity.entityType !== "payments:transactions" ||
        currentByKey.has(`${entity.entityType}:${entity.entityId}`)
      ) {
        return false;
      }
      const transaction = parseObject(entity.payloadJson);
      const metadata = isRecord(transaction["metadata"]) ? transaction["metadata"] : {};
      return (
        transaction["direction"] === "ADJUSTMENT" &&
        transaction["status"] === "CONFIRMED" &&
        Boolean(metadata["reservationDepositId"])
      );
    });
    if (applications.length !== 1) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "Deposit application did not produce exactly one adjustment transaction",
      );
    }
    const entity = applications[0]!;
    const transaction = parseObject(entity.payloadJson);
    const metadata = isRecord(transaction["metadata"]) ? transaction["metadata"] : {};
    const depositId = stringValue(metadata["reservationDepositId"]);
    const orderId = stringValue(metadata["orderId"]);
    const invoiceId = stringValue(transaction["merchantReference"]);
    const amountMinor = numberValue(transaction["amountMinor"]);
    const currency = stringValue(transaction["currency"]);
    const branchId = entity.branchId ?? stringValue(transaction["branchId"]);
    if (
      !depositId ||
      !orderId ||
      !invoiceId ||
      amountMinor === null ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      !currency ||
      !branchId
    ) {
      throw new ServerOperationError("VALIDATION_FAILED", 400, "Deposit application is incomplete");
    }
    return [
      this.db
        .prepare(
          `INSERT INTO reservation_deposit_applications
            (tenant_id,id,branch_id,deposit_id,order_id,invoice_id,payment_transaction_id,
             amount_minor,currency,idempotency_key,applied_by,applied_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          tenantId,
          `deposit-application:${entity.entityId}`,
          branchId,
          depositId,
          orderId,
          invoiceId,
          entity.entityId,
          amountMinor,
          currency,
          input.idempotencyKey,
          input.actor.id,
          stamp,
        ),
      this.db
        .prepare(
          `UPDATE reservation_deposits SET status='APPLIED',updated_at=?
           WHERE tenant_id=? AND id=? AND status='CONFIRMED'`,
        )
        .bind(stamp, tenantId, depositId),
    ];
  }

  private async loadRows(tenantId: string) {
    const result = await this.db
      .prepare(
        `SELECT entity_type, entity_id, branch_id, business_date, status, payload_json,
                version, created_at, updated_at
         FROM authoritative_records WHERE tenant_id = ?`,
      )
      .bind(tenantId)
      .all<AuthoritativeRow>();
    return result.results ?? [];
  }

  private async assertTenant(tenantId: string) {
    await this.migrate();
    const tenant = await this.db
      .prepare("SELECT id FROM tenants WHERE id = ? AND active = 1")
      .bind(tenantId)
      .first<{ id: string }>();
    if (!tenant) {
      throw new ServerOperationError("TENANT_SCOPE_VIOLATION", 403, "Tenant is not active");
    }
  }

  private async readMutationCommit(tenantId: string, idempotencyKey: string) {
    await this.assertTenant(tenantId);
    const row = await this.db
      .prepare(
        `SELECT request_hash, response_json, new_revision
         FROM mutation_commits WHERE tenant_id = ? AND idempotency_key = ?`,
      )
      .bind(tenantId, idempotencyKey)
      .first<{ request_hash: string; response_json: string; new_revision: number }>();
    if (!row) return null;
    const parsed = JSON.parse(row.response_json) as { state: TransactionState; revision?: number };
    return {
      requestHash: row.request_hash,
      state: normalizeTransactionState(parsed.state),
      revision: parsed.revision ?? row.new_revision,
    };
  }

  private async authoritativeMutationInput(
    state: TransactionState,
    input: TransactionMutationCommit,
  ) {
    const payload = structuredClone(input.payload) as Record<string, unknown>;
    const nested = isRecord(payload["input"]) ? payload["input"] : undefined;
    const draft = isRecord(payload["draft"]) ? payload["draft"] : undefined;
    const nestedInvoiceId = stringValue(nested?.["invoiceId"]);
    const nestedInvoice = nestedInvoiceId
      ? state.bills.find((candidate) => candidate.id === nestedInvoiceId)
      : undefined;
    const requestedBranchId =
      stringValue(nested?.["branchId"]) ??
      nestedInvoice?.branchId ??
      stringValue(draft?.["branchId"]) ??
      stringValue(payload["branchId"]) ??
      input.actor.branchId;
    const branch = await this.db
      .prepare(
        `SELECT timezone, business_day_cutoff_minutes FROM branches
         WHERE tenant_id = ? AND id = ? AND active = 1`,
      )
      .bind(input.actor.tenantId, requestedBranchId)
      .first<{ timezone: string; business_day_cutoff_minutes: number }>();
    if (!branch) {
      throw new ServerOperationError(
        "TENANT_SCOPE_VIOLATION",
        403,
        "Mutation branch is unavailable",
      );
    }
    const businessDate = authoritativeBusinessDate({
      timezone: branch.timezone,
      cutoffMinutes: branch.business_day_cutoff_minutes,
    });
    if (
      nested &&
      ["prepareDayClose", "recordPeriodClose", "automaticPaymentMatching"].includes(input.action)
    ) {
      nested["businessDate"] = businessDate;
    }
    const locked = state.paymentOperations?.dayCloses.some(
      (day) =>
        day.branchId === requestedBranchId &&
        day.businessDate === businessDate &&
        day.status === "CLOSED",
    );
    if (locked && financiallyLockedActions.has(input.action)) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "The authoritative business date is closed; reopen it with permission and a reason",
      );
    }
    if (
      nested &&
      ["applyVoucherRedemption", "applyGiftCardRedemption", "applyLoyaltyReward"].includes(
        input.action,
      )
    ) {
      payload["input"] = await this.authoritativeCustomerValueInput({
        state,
        input,
        requested: nested,
        branchId: requestedBranchId,
        businessDate,
      });
    }
    if (nested && input.action === "applyReservationDeposit") {
      payload["input"] = await this.authoritativeReservationDepositInput({
        state,
        input,
        requested: nested,
        branchId: requestedBranchId,
        businessDate,
      });
    }
    if (input.action === "applyConfiguredPayment") {
      return this.authoritativeConfiguredPaymentInput({
        state,
        input,
        requested: payload,
        branchId: requestedBranchId,
      });
    }
    const guestVoucher = isRecord(payload["voucher"]) ? payload["voucher"] : undefined;
    if (input.action === "createGuestOrder" && draft && guestVoucher) {
      payload["customerValueInput"] = await this.authoritativeGuestVoucherInput({
        input,
        draft,
        requested: guestVoucher,
        branchId: requestedBranchId,
        businessDate,
      });
    }
    return payload;
  }

  private fxPaymentBridgeStatements(
    tenantId: string,
    nextEntities: PersistedEntity[],
    currentByKey: Map<string, AuthoritativeRow>,
    stamp: string,
  ) {
    const statements: D1PreparedStatement[] = [];
    for (const entity of nextEntities) {
      const key = `${entity.entityType}:${entity.entityId}`;
      if (entity.entityType === "payments:transactions" && !currentByKey.has(key)) {
        const transaction = parseObject(entity.payloadJson);
        const evidence = isRecord(transaction["currencyEvidence"])
          ? transaction["currencyEvidence"]
          : null;
        if (evidence && transaction["direction"] === "COLLECTION") {
          statements.push(
            this.db
              .prepare(
                `INSERT INTO payment_currency_snapshots
                  (tenant_id,payment_transaction_id,quote_id,branch_id,invoice_id,base_currency,
                   base_amount_minor,tender_currency,tender_amount_minor,cash_tendered_minor,
                   change_given_minor,change_currency,rate_numerator,rate_denominator,rate_source_id,
                   rate_timestamp,rounding_adjustment_minor,refund_rate_policy,created_at)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .bind(
                tenantId,
                entity.entityId,
                stringValue(evidence["quoteId"]),
                stringValue(transaction["branchId"]),
                stringValue(evidence["invoiceId"]),
                stringValue(evidence["baseCurrency"]),
                numberValue(evidence["baseAmountMinor"]),
                stringValue(evidence["tenderCurrency"]),
                numberValue(evidence["tenderAmountMinor"]),
                numberValue(evidence["cashTenderedMinor"]),
                numberValue(evidence["changeGivenMinor"]),
                stringValue(evidence["changeCurrency"]),
                numberValue(evidence["rateNumerator"]),
                numberValue(evidence["rateDenominator"]),
                stringValue(evidence["rateSourceId"]),
                stringValue(evidence["rateTimestamp"]),
                numberValue(evidence["roundingAdjustmentMinor"]) ?? 0,
                stringValue(evidence["refundRatePolicy"]) ?? "ORIGINAL_RATE",
                stringValue(transaction["createdAt"]) ?? stamp,
              ),
          );
        }
      }
      if (entity.entityType !== "payments:drawerSessions") continue;
      const drawer = parseObject(entity.payloadJson);
      if (!currentByKey.has(key)) {
        statements.push(
          this.db
            .prepare(
              `INSERT INTO cash_drawer_sessions
                (tenant_id,id,branch_id,device_id,employee_id,status,opening_float_minor,
                 expected_cash_minor,counted_cash_minor,variance_minor,version,payload_json,
                 opened_at,closed_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?)
               ON CONFLICT(tenant_id,id) DO NOTHING`,
            )
            .bind(
              tenantId,
              entity.entityId,
              stringValue(drawer["branchId"]),
              stringValue(drawer["deviceId"]) ?? null,
              stringValue(drawer["employeeId"]),
              "OPEN",
              numberValue(drawer["openingFloatMinor"]) ?? 0,
              numberValue(drawer["expectedCashMinor"]) ?? 0,
              null,
              null,
              entity.payloadJson,
              stringValue(drawer["openedAt"]) ?? stamp,
              null,
            ),
        );
      }
      const balances = isRecord(drawer["currencyBalances"]) ? drawer["currencyBalances"] : {};
      for (const [currency, rawBalance] of Object.entries(balances)) {
        if (!isRecord(rawBalance)) continue;
        statements.push(
          this.db
            .prepare(
              `INSERT INTO cash_drawer_currency_counts
                (tenant_id,drawer_session_id,currency_code,opening_float_minor,expected_cash_minor,
                 counted_cash_minor,variance_minor,status,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(tenant_id,drawer_session_id,currency_code) DO UPDATE SET
                 opening_float_minor=excluded.opening_float_minor,
                 expected_cash_minor=excluded.expected_cash_minor,
                 counted_cash_minor=excluded.counted_cash_minor,
                 variance_minor=excluded.variance_minor,status=excluded.status,
                 updated_at=excluded.updated_at`,
            )
            .bind(
              tenantId,
              entity.entityId,
              currency,
              numberValue(rawBalance["openingFloatMinor"]) ?? 0,
              numberValue(rawBalance["expectedCashMinor"]) ?? 0,
              numberValue(rawBalance["countedCashMinor"]),
              numberValue(rawBalance["varianceMinor"]),
              stringValue(drawer["status"]) ?? "OPEN",
              stamp,
            ),
        );
      }
    }
    return statements;
  }

  private async authoritativeConfiguredPaymentInput(input: {
    state: TransactionState;
    input: TransactionMutationCommit;
    requested: Record<string, unknown>;
    branchId: string;
  }) {
    const quoteId = stringValue(input.requested["fxQuoteId"]);
    const clientTenderCurrency = stringValue(input.requested["tenderCurrency"]);
    if (!quoteId) {
      if (clientTenderCurrency) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Foreign tender requires a server-issued FX quote",
        );
      }
      return input.requested;
    }
    const quote = await this.db
      .prepare(
        `SELECT q.*,a.change_policy,a.cash_eligible,a.digital_payment_eligible
         FROM fx_payment_quotes q JOIN tenant_accepted_currencies a
           ON a.tenant_id=q.tenant_id AND a.currency_code=q.tender_currency
         WHERE q.tenant_id=? AND q.id=? AND q.branch_id=?`,
      )
      .bind(input.input.actor.tenantId, quoteId, input.branchId)
      .first<Record<string, unknown>>();
    if (!quote) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "FX payment quote was not found");
    }
    const stamp = new Date().toISOString();
    if (stringValue(quote["status"]) !== "ACTIVE" || stringValue(quote["expires_at"])! <= stamp) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "FX payment quote expired or was already consumed; request a new quote",
      );
    }
    const invoiceId = stringValue(input.requested["invoiceId"]);
    const paymentMethodId = stringValue(input.requested["paymentMethodId"]);
    if (
      !invoiceId ||
      invoiceId !== stringValue(quote["invoice_id"]) ||
      !paymentMethodId ||
      paymentMethodId !== stringValue(quote["payment_method_id"])
    ) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "FX quote does not belong to this invoice and payment method",
      );
    }
    const invoice = input.state.bills.find(
      (candidate) =>
        candidate.id === invoiceId &&
        candidate.branchId === input.branchId &&
        !["VOID", "MERGED"].includes(candidate.status),
    );
    if (!invoice) {
      throw new ServerOperationError("VALIDATION_FAILED", 404, "Invoice was not found");
    }
    const method = getConfigurationRepository()
      .listPaymentMethods(input.input.actor.tenantId, false)
      .find((candidate) => candidate.id === paymentMethodId && candidate.enabled);
    if (!method)
      throw new ServerOperationError("VALIDATION_FAILED", 409, "Payment method is unavailable");
    const baseAmountMinor = numberValue(quote["base_amount_minor"]);
    const tenderAmountMinor = numberValue(quote["tender_amount_minor"]);
    const baseCurrency = stringValue(quote["base_currency"]);
    const tenderCurrency = stringValue(quote["tender_currency"]);
    const rateNumerator = numberValue(quote["rate_numerator"]);
    const rateDenominator = numberValue(quote["rate_denominator"]);
    if (
      baseAmountMinor === null ||
      tenderAmountMinor === null ||
      !baseCurrency ||
      !tenderCurrency ||
      rateNumerator === null ||
      rateDenominator === null
    ) {
      throw new ServerOperationError("VALIDATION_FAILED", 409, "FX quote evidence is incomplete");
    }
    const configuredCurrency = getConfigurationRepository().getTenant(
      input.input.actor.tenantId,
    ).defaultCurrency;
    if (baseCurrency !== configuredCurrency) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "FX quote base currency is no longer valid",
      );
    }
    const requestedAmount = numberValue(input.requested["amountMinor"]);
    if (requestedAmount !== null && requestedAmount !== baseAmountMinor) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Payment amount does not match the FX quote",
      );
    }
    const requestedTendered = numberValue(input.requested["tenderedAmountMinor"]);
    const cashTenderedMinor = requestedTendered ?? tenderAmountMinor;
    if (!Number.isSafeInteger(cashTenderedMinor) || cashTenderedMinor < tenderAmountMinor) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Tendered amount is below the quoted amount",
      );
    }
    const changePolicy = stringValue(quote["change_policy"]) ?? "NO_CHANGE";
    const excessTenderMinor = cashTenderedMinor - tenderAmountMinor;
    if (method.category !== "CASH" && cashTenderedMinor !== tenderAmountMinor) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Non-cash payment must match the FX quote exactly",
      );
    }
    if (method.category === "CASH" && !quote["cash_eligible"]) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Cash is not enabled for this tender currency",
      );
    }
    if (method.category !== "CASH" && !quote["digital_payment_eligible"]) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Digital payment is not enabled for this tender currency",
      );
    }
    if (changePolicy === "NO_CHANGE" && excessTenderMinor !== 0) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "This currency requires exact tender",
      );
    }
    let changeGivenMinor = excessTenderMinor;
    let changeCurrency = tenderCurrency;
    if (changePolicy === "BASE_CURRENCY" && excessTenderMinor > 0) {
      const baseDigits = numberValue(quote["base_minor_digits"]);
      const tenderDigits = numberValue(quote["tender_minor_digits"]);
      if (baseDigits === null || tenderDigits === null) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          409,
          "FX quote precision is incomplete",
        );
      }
      changeGivenMinor = convertTenderUsingQuote({
        tenderAmountMinor: excessTenderMinor,
        baseMinorDigits: baseDigits,
        tenderMinorDigits: tenderDigits,
        rateNumerator,
        rateDenominator,
      });
      changeCurrency = baseCurrency;
    }
    return {
      ...input.requested,
      amountMinor: baseAmountMinor,
      cashTenderedMinor: baseAmountMinor,
      tenderedAmountMinor: cashTenderedMinor,
      tenderCurrency,
      currencyEvidence: {
        quoteId,
        invoiceId,
        baseCurrency,
        baseAmountMinor,
        tenderCurrency,
        tenderAmountMinor,
        cashTenderedMinor,
        changeGivenMinor,
        changeCurrency,
        rateNumerator,
        rateDenominator,
        rateSourceId: stringValue(quote["rate_source_id"]) ?? "",
        rateTimestamp: stringValue(quote["rate_timestamp"]) ?? "",
        convertedBaseAmountMinor:
          numberValue(quote["converted_base_amount_minor"]) ?? baseAmountMinor,
        roundingAdjustmentMinor: numberValue(quote["rounding_adjustment_minor"]) ?? 0,
        refundRatePolicy: "ORIGINAL_RATE",
      },
    };
  }

  private async authoritativeReservationDepositInput(input: {
    state: TransactionState;
    input: TransactionMutationCommit;
    requested: Record<string, unknown>;
    branchId: string;
    businessDate: string;
  }) {
    const depositId = stringValue(input.requested["depositId"]);
    const orderId = stringValue(input.requested["orderId"]);
    if (!depositId || !orderId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "depositId and orderId are required",
      );
    }
    const deposit = await this.db
      .prepare(
        `SELECT d.id,d.branch_id,d.amount_minor,d.currency,d.liability_account_id,
                d.payment_method_id,d.payment_transaction_id,d.status,r.status AS reservation_status,
                ts.id AS table_session_id
         FROM reservation_deposits d JOIN reservations r
           ON r.tenant_id=d.tenant_id AND r.id=d.reservation_id
         LEFT JOIN guest_table_sessions ts ON ts.tenant_id=r.tenant_id
           AND ts.reservation_id=r.id AND ts.status IN ('OPEN','ORDERING','CHECK_REQUESTED','PAYMENT_PENDING')
         WHERE d.tenant_id=? AND d.id=? AND d.branch_id=?`,
      )
      .bind(input.input.actor.tenantId, depositId, input.branchId)
      .first<Record<string, unknown>>();
    if (
      !deposit ||
      deposit["status"] !== "CONFIRMED" ||
      !["SEATED", "COMPLETED"].includes(String(deposit["reservation_status"] ?? ""))
    ) {
      throw new ServerOperationError(
        "INVALID_STATE_TRANSITION",
        409,
        "A confirmed deposit for a seated reservation is required",
      );
    }
    const order = input.state.orders.find(
      (candidate) =>
        candidate.id === orderId &&
        candidate.branchId === input.branchId &&
        candidate.status !== "CANCELLED",
    );
    const invoice = input.state.bills.find(
      (candidate) =>
        candidate.orderIds.includes(orderId) &&
        candidate.branchId === input.branchId &&
        candidate.paymentStatus !== "PAID",
    );
    if (
      !order ||
      !invoice ||
      !deposit["table_session_id"] ||
      order.guestContext?.tableSessionId !== String(deposit["table_session_id"])
    ) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        404,
        "Reservation order bill was not found",
      );
    }
    const amountMinor = numberValue(deposit["amount_minor"]);
    const currency = stringValue(deposit["currency"]);
    const transactionId = stringValue(deposit["payment_transaction_id"]);
    const liabilityAccountId = stringValue(deposit["liability_account_id"]);
    const paymentMethodId = stringValue(deposit["payment_method_id"]);
    if (
      amountMinor === null ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0 ||
      !currency ||
      !transactionId ||
      !liabilityAccountId ||
      !paymentMethodId
    ) {
      throw new ServerOperationError("VALIDATION_FAILED", 400, "Confirmed deposit is incomplete");
    }
    const tenant = getConfigurationRepository().getTenant(input.input.actor.tenantId);
    const dueMinor = parseMajorAmount(invoice.total - invoice.paid, tenant.defaultCurrency);
    if (currency !== tenant.defaultCurrency || amountMinor > dueMinor) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        409,
        "Deposit currency or amount does not match the final bill",
      );
    }
    return {
      tenantId: input.input.actor.tenantId,
      branchId: input.branchId,
      invoiceId: invoice.id,
      orderId,
      paymentMethodId,
      originalTransactionId: transactionId,
      depositId,
      amountMinor,
      currency,
      liabilityAccountId,
      businessDate: input.businessDate,
      actor: input.input.actor.name,
      authoritative: true as const,
    };
  }

  private async authoritativeGuestVoucherInput(input: {
    input: TransactionMutationCommit;
    draft: Record<string, unknown>;
    requested: Record<string, unknown>;
    branchId: string;
    businessDate: string;
  }) {
    const code = stringValue(input.requested["code"]);
    if (!code) throw new ServerOperationError("VALIDATION_FAILED", 400, "Voucher code is required");
    const tenant = getConfigurationRepository().getTenant(input.input.actor.tenantId);
    const method = getConfigurationRepository()
      .listPaymentMethods(input.input.actor.tenantId, false)
      .find(
        (candidate) =>
          candidate.enabled &&
          candidate.category === "VOUCHER" &&
          candidate.metadata["valueType"] === "PROMOTION",
      );
    const debitAccountId = method ? stringValue(method.metadata["promotionAccountId"]) : undefined;
    if (!method?.receivableAccountId || !debitAccountId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Configured voucher payment and accounting mapping are unavailable",
      );
    }
    const draftLines = Array.isArray(input.draft["lines"])
      ? input.draft["lines"].filter(isRecord)
      : [];
    const lineItems = draftLines.map((line) => {
      const quantity = numberValue(line["quantity"]);
      const unitPrice = numberValue(line["unitPrice"]);
      if (
        quantity === null ||
        unitPrice === null ||
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        unitPrice < 0
      ) {
        throw new ServerOperationError("VALIDATION_FAILED", 400, "Guest order line is invalid");
      }
      const itemId = stringValue(line["productId"]);
      return {
        ...(itemId ? { itemId } : {}),
        categoryCode: stringValue(line["category"]) ?? "UNSPECIFIED",
        subtotalMinor: parseMajorAmount(unitPrice * quantity, tenant.defaultCurrency),
      };
    });
    const subtotalMinor = lineItems.reduce((sum, line) => sum + line.subtotalMinor, 0);
    const channel = stringValue(input.draft["channel"]);
    if (!channel || subtotalMinor <= 0) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Guest order cannot use this voucher",
      );
    }
    const customerId = stringValue(input.draft["customerId"]);
    const validation = await new LoyaltyValueService(this.db, input.input.actor).validateVoucher({
      code,
      ...(customerId ? { customerId } : {}),
      branchId: input.branchId,
      channel,
      subtotalMinor,
      lineItems,
      currency: tenant.defaultCurrency,
    });
    if (validation.discountMinor <= 0) {
      throw new ServerOperationError("VALIDATION_FAILED", 400, "Voucher has no financial value");
    }
    return {
      tenantId: input.input.actor.tenantId,
      branchId: input.branchId,
      paymentMethodId: method.id,
      amountMinor: validation.discountMinor,
      currency: tenant.defaultCurrency,
      valueType: "VOUCHER" as const,
      valueId: validation.voucherDefinitionId,
      publicReference: "VOUCHER APPLIED",
      debitAccountId,
      businessDate: input.businessDate,
      actor: input.input.actor.name,
      authoritative: true as const,
      metadata: {
        crmIdempotencyKey: `createGuestOrder:${input.input.idempotencyKey}`,
        voucherDefinitionId: validation.voucherDefinitionId,
        voucherIssueId: validation.voucherIssueId ?? null,
        customerId: customerId ?? null,
        channel,
        businessDate: input.businessDate,
      },
    };
  }

  private async authoritativeCustomerValueInput(input: {
    state: TransactionState;
    input: TransactionMutationCommit;
    requested: Record<string, unknown>;
    branchId: string;
    businessDate: string;
  }) {
    const invoiceId = stringValue(input.requested["invoiceId"]);
    const paymentMethodId = stringValue(input.requested["paymentMethodId"]);
    if (!invoiceId || !paymentMethodId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "invoiceId and paymentMethodId are required",
      );
    }
    const invoice = input.state.bills.find(
      (candidate) =>
        candidate.id === invoiceId &&
        (candidate.tenantId ?? input.input.actor.tenantId) === input.input.actor.tenantId,
    );
    if (!invoice) throw new ServerOperationError("VALIDATION_FAILED", 404, "Invoice was not found");
    if ((invoice.branchId ?? input.branchId) !== input.branchId) {
      throw new ServerOperationError(
        "TENANT_SCOPE_VIOLATION",
        403,
        "Invoice branch does not match",
      );
    }
    const orderId = invoice.orderIds[0];
    const order = input.state.orders.find((candidate) => candidate.id === orderId);
    if (!order || order.status === "CANCELLED") {
      throw new ServerOperationError("INVALID_STATE_TRANSITION", 409, "Order is not redeemable");
    }
    const tenant = getConfigurationRepository().getTenant(input.input.actor.tenantId);
    const method = getConfigurationRepository()
      .listPaymentMethods(input.input.actor.tenantId, false)
      .find((candidate) => candidate.id === paymentMethodId && candidate.enabled);
    if (!method?.receivableAccountId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Configured customer-value payment method is unavailable",
      );
    }
    const dueMinor = parseMajorAmount(invoice.total - invoice.paid, tenant.defaultCurrency);
    if (dueMinor <= 0) {
      throw new ServerOperationError("INVALID_STATE_TRANSITION", 409, "Invoice has no balance due");
    }
    const base = {
      tenantId: input.input.actor.tenantId,
      branchId: input.branchId,
      invoiceId,
      paymentMethodId,
      currency: tenant.defaultCurrency,
      businessDate: input.businessDate,
      actor: input.input.actor.name,
      authoritative: true as const,
    };
    const idempotencyKey = `${input.input.action}:${input.input.idempotencyKey}`;

    if (input.input.action === "applyGiftCardRedemption") {
      if (method.category !== "VOUCHER" || method.metadata["valueType"] !== "GIFT_CARD") {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Gift-card payment mapping is invalid",
        );
      }
      const token = stringValue(input.requested["token"]);
      const requestedAmount = numberValue(input.requested["amountMinor"]);
      if (
        !token ||
        requestedAmount === null ||
        !Number.isSafeInteger(requestedAmount) ||
        requestedAmount <= 0
      ) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "A valid gift-card token and amount are required",
        );
      }
      const tokenHash = await sha256(token.trim());
      const card = await this.db
        .prepare(
          `SELECT g.id,g.token_last_four,g.status,g.currency,g.expires_at,g.liability_account_id,
                  COALESCE(SUM(l.amount_minor),0) AS balance_minor
           FROM gift_cards g LEFT JOIN gift_card_ledger l
             ON l.tenant_id=g.tenant_id AND l.gift_card_id=g.id
           WHERE g.tenant_id=? AND g.token_hash=? GROUP BY g.id`,
        )
        .bind(input.input.actor.tenantId, tokenHash)
        .first<{
          id: string;
          token_last_four: string;
          status: string;
          currency: string;
          expires_at: string | null;
          liability_account_id: string;
          balance_minor: number;
        }>();
      if (
        !card ||
        card.status !== "ACTIVE" ||
        (card.expires_at && card.expires_at <= new Date().toISOString())
      ) {
        throw new ServerOperationError("INVALID_STATE_TRANSITION", 409, "Gift card is unavailable");
      }
      if (card.currency !== tenant.defaultCurrency) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Gift-card currency does not match invoice",
        );
      }
      const amountMinor = Math.min(requestedAmount, dueMinor);
      if (card.balance_minor < amountMinor) {
        throw new ServerOperationError("CONFLICT", 409, "Gift-card balance is insufficient");
      }
      return {
        ...base,
        amountMinor,
        valueType: "GIFT_CARD" as const,
        valueId: card.id,
        publicReference: `GIFT ****${card.token_last_four}`,
        debitAccountId: card.liability_account_id,
        metadata: {
          crmIdempotencyKey: idempotencyKey,
          giftCardId: card.id,
          customerId: invoice.customerId ?? null,
          orderId,
          businessDate: input.businessDate,
        },
      };
    }

    if (input.input.action === "applyVoucherRedemption") {
      if (method.category !== "VOUCHER" || method.metadata["valueType"] !== "PROMOTION") {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Voucher payment mapping is invalid",
        );
      }
      const code = stringValue(input.requested["code"]);
      if (!code)
        throw new ServerOperationError("VALIDATION_FAILED", 400, "Voucher code is required");
      const lineItems = order.lines.map((line) => ({
        ...(line.productId ? { itemId: line.productId } : {}),
        categoryCode: line.category,
        subtotalMinor: parseMajorAmount(line.unitPrice * line.quantity, tenant.defaultCurrency),
      }));
      const validation = await new LoyaltyValueService(this.db, input.input.actor).validateVoucher({
        code,
        ...(invoice.customerId ? { customerId: invoice.customerId } : {}),
        branchId: input.branchId,
        channel: order.channel,
        subtotalMinor: dueMinor,
        lineItems,
        currency: tenant.defaultCurrency,
      });
      if (validation.discountMinor <= 0) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Voucher has no financial value for this order",
        );
      }
      const debitAccountId = stringValue(method.metadata["promotionAccountId"]);
      if (!debitAccountId) {
        throw new ServerOperationError(
          "VALIDATION_FAILED",
          400,
          "Voucher accounting mapping is missing",
        );
      }
      return {
        ...base,
        amountMinor: Math.min(validation.discountMinor, dueMinor),
        valueType: "VOUCHER" as const,
        valueId: validation.voucherDefinitionId,
        publicReference: "VOUCHER APPLIED",
        debitAccountId,
        metadata: {
          crmIdempotencyKey: idempotencyKey,
          voucherDefinitionId: validation.voucherDefinitionId,
          voucherIssueId: validation.voucherIssueId ?? null,
          customerId: invoice.customerId ?? null,
          orderId,
          channel: order.channel,
          businessDate: input.businessDate,
        },
      };
    }

    if (method.category !== "LOYALTY") {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Loyalty payment mapping is invalid",
      );
    }
    if (!invoice.customerId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "A linked customer is required for loyalty redemption",
      );
    }
    const rewardId = stringValue(input.requested["rewardId"]);
    if (!rewardId) throw new ServerOperationError("VALIDATION_FAILED", 400, "Reward is required");
    const reward = await this.db
      .prepare(
        `SELECT r.id,r.program_id,r.name,r.reward_type,r.points_cost,r.value_minor,
                r.percentage_basis_points,r.item_id,r.category_code,r.minimum_tier_id,
                p.scope_type,p.brand_id,p.branch_id,p.eligible_branches_json,
                p.eligible_channels_json,p.redemption_rules_json,
                lm.tier_id,ct.rank AS current_rank,mt.rank AS minimum_rank,
                COALESCE((SELECT SUM(points) FROM loyalty_ledger l WHERE l.tenant_id=r.tenant_id
                  AND l.customer_id=? AND l.program_id=r.program_id),0) AS balance
         FROM loyalty_rewards r JOIN loyalty_programs p
           ON p.tenant_id=r.tenant_id AND p.id=r.program_id
         LEFT JOIN customer_loyalty_memberships lm ON lm.tenant_id=r.tenant_id
           AND lm.program_id=r.program_id AND lm.customer_id=? AND lm.status='ACTIVE'
         LEFT JOIN loyalty_tiers ct ON ct.tenant_id=lm.tenant_id AND ct.id=lm.tier_id
         LEFT JOIN loyalty_tiers mt ON mt.tenant_id=r.tenant_id AND mt.id=r.minimum_tier_id
         WHERE r.tenant_id=? AND r.id=? AND r.active=1 AND p.status='ACTIVE'
           AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)`,
      )
      .bind(
        invoice.customerId,
        invoice.customerId,
        input.input.actor.tenantId,
        rewardId,
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .first<Record<string, unknown>>();
    if (!reward || Number(reward["balance"] ?? 0) < Number(reward["points_cost"] ?? 0)) {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Reward is unavailable or points are insufficient",
      );
    }
    const eligibleBranches = stringArray(String(reward["eligible_branches_json"] ?? "[]"));
    const eligibleChannels = stringArray(String(reward["eligible_channels_json"] ?? "[]"));
    const rewardBranch = await this.db
      .prepare("SELECT brand_id FROM branches WHERE tenant_id=? AND id=?")
      .bind(input.input.actor.tenantId, input.branchId)
      .first<{ brand_id: string | null }>();
    if (
      (eligibleBranches.length && !eligibleBranches.includes(input.branchId)) ||
      (eligibleChannels.length && !eligibleChannels.includes(order.channel)) ||
      (reward["scope_type"] === "BRANCH" && reward["branch_id"] !== input.branchId) ||
      (reward["scope_type"] === "BRAND" && reward["brand_id"] !== rewardBranch?.brand_id) ||
      (reward["minimum_tier_id"] &&
        Number(reward["current_rank"] ?? -1) < Number(reward["minimum_rank"] ?? 0))
    ) {
      throw new ServerOperationError(
        "CONFLICT",
        409,
        "Reward eligibility requirements are not met",
      );
    }
    const rewardType = String(reward["reward_type"]);
    let rewardMinor = 0;
    if (rewardType === "FIXED_DISCOUNT") rewardMinor = Number(reward["value_minor"] ?? 0);
    if (rewardType === "PERCENTAGE_DISCOUNT") {
      rewardMinor = Math.floor(
        (dueMinor * Number(reward["percentage_basis_points"] ?? 0)) / 10_000,
      );
    }
    if (rewardType === "FREE_ITEM") {
      const matching = order.lines.filter((line) => line.productId === reward["item_id"]);
      rewardMinor = matching.length
        ? Math.min(
            ...matching.map((line) => parseMajorAmount(line.unitPrice, tenant.defaultCurrency)),
          )
        : 0;
    }
    if (rewardType === "FREE_CATEGORY_ITEM") {
      const matching = order.lines.filter((line) => line.category === reward["category_code"]);
      rewardMinor = matching.length
        ? Math.min(
            ...matching.map((line) => parseMajorAmount(line.unitPrice, tenant.defaultCurrency)),
          )
        : 0;
    }
    if (!Number.isSafeInteger(rewardMinor) || rewardMinor <= 0) {
      throw new ServerOperationError("VALIDATION_FAILED", 400, "Reward is not a checkout discount");
    }
    const redemptionRules = parseObject(String(reward["redemption_rules_json"] ?? "{}"));
    const debitAccountId =
      stringValue(redemptionRules["redemptionAccountId"]) ??
      stringValue(method.metadata["promotionAccountId"]);
    if (!debitAccountId) {
      throw new ServerOperationError(
        "VALIDATION_FAILED",
        400,
        "Loyalty accounting mapping is missing",
      );
    }
    return {
      ...base,
      amountMinor: Math.min(rewardMinor, dueMinor),
      valueType: "LOYALTY" as const,
      valueId: rewardId,
      publicReference: "LOYALTY REWARD",
      debitAccountId,
      metadata: {
        crmIdempotencyKey: idempotencyKey,
        customerId: invoice.customerId,
        programId: String(reward["program_id"]),
        rewardId,
        points: Number(reward["points_cost"]),
        orderId,
        channel: order.channel,
        businessDate: input.businessDate,
      },
    };
  }
}

function flattenState(state: TransactionState): PersistedEntity[] {
  const now = new Date().toISOString();
  const entities: PersistedEntity[] = [
    {
      entityType: ROOT_ENTITY,
      entityId: "root",
      payloadJson: JSON.stringify({
        schemaVersion: state.schemaVersion ?? 3,
        tenantId: state.tenantId,
        paymentSchemaVersion: state.paymentOperations?.schemaVersion ?? 1,
      }),
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const key of transactionCollections) {
    for (const value of state[key] as Array<Record<string, unknown>>) {
      entities.push(entityFromRecord(`state:${key}`, value, now));
    }
  }
  const paymentOperations = state.paymentOperations ?? emptyPaymentOperationsState();
  for (const key of paymentCollections) {
    for (const value of paymentOperations[key] as Array<Record<string, unknown>>) {
      entities.push(entityFromRecord(`payments:${key}`, value, now));
    }
  }
  return entities;
}

function entityFromRecord(
  entityType: string,
  value: Record<string, unknown>,
  fallbackTime: string,
) {
  const entityId = String(value["id"] ?? "");
  if (!entityId)
    throw new ServerOperationError("VALIDATION_FAILED", 400, `${entityType} has no id`);
  const branchId = stringValue(value["branchId"]);
  const businessDate = stringValue(value["businessDate"]);
  const status = stringValue(value["status"]);
  const createdAt =
    stringValue(value["createdAt"]) ??
    stringValue(value["occurredAt"]) ??
    stringValue(value["time"]) ??
    fallbackTime;
  const updatedAt = stringValue(value["updatedAt"]) ?? createdAt;
  return {
    entityType,
    entityId,
    ...(branchId ? { branchId } : {}),
    ...(businessDate ? { businessDate } : {}),
    ...(status ? { status } : {}),
    payloadJson: JSON.stringify(value),
    createdAt,
    updatedAt,
  };
}

function reconstructState(tenantId: string, rows: AuthoritativeRow[]) {
  const state = createEmptyTransactionState(tenantId);
  state.schemaVersion = 3;
  state.paymentOperations = emptyPaymentOperationsState();
  for (const row of rows) {
    if (!isStateEntity(row.entity_type) || row.entity_type === ROOT_ENTITY) continue;
    const value = JSON.parse(row.payload_json) as never;
    if (row.entity_type.startsWith("state:")) {
      const key = row.entity_type.slice("state:".length) as (typeof transactionCollections)[number];
      if (transactionCollections.includes(key)) (state[key] as never[]).push(value);
      continue;
    }
    if (row.entity_type.startsWith("payments:")) {
      const key = row.entity_type.slice("payments:".length) as (typeof paymentCollections)[number];
      if (paymentCollections.includes(key)) (state.paymentOperations[key] as never[]).push(value);
    }
  }
  return normalizeTransactionState(state);
}

function upsertEntity(
  db: D1Database,
  tenantId: string,
  entity: PersistedEntity,
  currentVersion: number,
) {
  return db
    .prepare(
      `INSERT INTO authoritative_records
        (tenant_id, entity_type, entity_id, branch_id, business_date, status, payload_json,
         version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(tenant_id, entity_type, entity_id) DO UPDATE SET
         branch_id = excluded.branch_id,
         business_date = excluded.business_date,
         status = excluded.status,
         payload_json = excluded.payload_json,
         version = authoritative_records.version + 1,
         updated_at = excluded.updated_at
       WHERE authoritative_records.version = ?`,
    )
    .bind(
      tenantId,
      entity.entityType,
      entity.entityId,
      entity.branchId ?? null,
      entity.businessDate ?? null,
      entity.status ?? null,
      entity.payloadJson,
      entity.createdAt,
      entity.updatedAt,
      currentVersion,
    );
}

function isStateEntity(entityType: string) {
  return (
    entityType === ROOT_ENTITY ||
    entityType.startsWith("state:") ||
    entityType.startsWith("payments:")
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function convertTenderUsingQuote(input: {
  tenderAmountMinor: number;
  baseMinorDigits: number;
  tenderMinorDigits: number;
  rateNumerator: number;
  rateDenominator: number;
}) {
  const numerator =
    BigInt(input.tenderAmountMinor) *
    BigInt(input.rateNumerator) *
    10n ** BigInt(input.baseMinorDigits);
  const denominator = BigInt(input.rateDenominator) * 10n ** BigInt(input.tenderMinorDigits);
  const result = Number((numerator + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new ServerOperationError(
      "VALIDATION_FAILED",
      400,
      "FX conversion exceeds safe precision",
    );
  }
  return result;
}

type CrmLoyaltyProgramRow = {
  id: string;
  earning_type: "SPEND" | "ITEM" | "CATEGORY" | "VISIT" | "BONUS";
  spend_minor_per_point: number | null;
  minimum_spend_minor: number;
  rounding_policy: "FLOOR" | "NEAREST" | "CEILING";
  expiry_type: "NONE" | "FIXED_DATE" | "DAYS_AFTER_EARN";
  expiry_days: number | null;
  expiry_date: string | null;
  eligible_branches_json: string;
  eligible_channels_json: string;
};

function isCompletedCustomerOrder(value: Record<string, unknown>) {
  const paymentStatus = stringValue(value["paymentStatus"]);
  const status = stringValue(value["status"]);
  return status === "PAID" && ["PAID", "PROVIDER_RECEIVABLE"].includes(paymentStatus ?? "");
}

function crmProgramEligible(program: CrmLoyaltyProgramRow, branchId: string, channel: string) {
  const branches = stringArray(program.eligible_branches_json);
  const channels = stringArray(program.eligible_channels_json);
  return (
    (!branches.length || branches.includes(branchId)) &&
    (!channels.length || channels.includes(channel))
  );
}

function crmEarnedPoints(
  program: CrmLoyaltyProgramRow,
  netSpendMinor: number,
  tier: { points_multiplier_numerator: number; points_multiplier_denominator: number } | null,
) {
  let base = 0;
  if (program.earning_type === "SPEND" && program.spend_minor_per_point) {
    const raw = netSpendMinor / program.spend_minor_per_point;
    base =
      program.rounding_policy === "CEILING"
        ? Math.ceil(raw)
        : program.rounding_policy === "NEAREST"
          ? Math.round(raw)
          : Math.floor(raw);
  } else if (program.earning_type === "VISIT") {
    base = 1;
  }
  const numerator = tier?.points_multiplier_numerator ?? 1;
  const denominator = tier?.points_multiplier_denominator ?? 1;
  const result = Math.floor((base * numerator) / denominator);
  return Number.isSafeInteger(result) ? result : 0;
}

function crmPointsExpiry(program: CrmLoyaltyProgramRow, occurredAt: string) {
  if (program.expiry_type === "FIXED_DATE") return program.expiry_date;
  if (program.expiry_type === "DAYS_AFTER_EARN" && program.expiry_days) {
    const expires = new Date(occurredAt);
    expires.setUTCDate(expires.getUTCDate() + program.expiry_days);
    return expires.toISOString();
  }
  return null;
}

function stringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function legacyMovementType(value: string | undefined) {
  switch (value) {
    case "RECEIPT":
      return "PURCHASE_RECEIPT";
    case "SALE_CONSUMPTION":
      return "SALE_CONSUMPTION";
    case "WASTAGE":
      return "WASTAGE";
    case "ADJUSTMENT":
      return "MANUAL_ADJUSTMENT";
    case "TRANSFER_IN":
      return "TRANSFER_IN";
    case "TRANSFER_OUT":
      return "TRANSFER_OUT";
    default:
      return null;
  }
}

function legacyMovementAccounts(
  movementType: string,
  quantityMicro: number,
  mapping: {
    inventory_account_id: string;
    cogs_account_id: string;
    wastage_account_id: string;
    variance_account_id: string;
    accounting_mode: string;
  } | null,
) {
  if (!mapping || mapping.accounting_mode !== "PERPETUAL") return null;
  if (movementType === "SALE_CONSUMPTION") {
    return { debit: mapping.cogs_account_id, credit: mapping.inventory_account_id };
  }
  if (movementType === "WASTAGE") {
    return { debit: mapping.wastage_account_id, credit: mapping.inventory_account_id };
  }
  if (movementType === "MANUAL_ADJUSTMENT") {
    return quantityMicro > 0
      ? { debit: mapping.inventory_account_id, credit: mapping.variance_account_id }
      : { debit: mapping.variance_account_id, credit: mapping.inventory_account_id };
  }
  return null;
}

function dataQualityStatement(
  db: D1Database,
  tenantId: string,
  movementId: string,
  issueCode: string,
  message: string,
  stamp: string,
  branchId?: string,
) {
  return db
    .prepare(
      `INSERT INTO inventory_data_quality_issues
        (tenant_id,id,branch_id,entity_type,entity_id,issue_code,severity,message,status,detected_at)
       VALUES (?,?,?,?,?,?,'CRITICAL',?,'OPEN',?)
       ON CONFLICT(tenant_id,issue_code,entity_type,entity_id,status)
       DO UPDATE SET message=excluded.message,detected_at=excluded.detected_at`,
    )
    .bind(
      tenantId,
      crypto.randomUUID(),
      branchId ?? null,
      "INVENTORY_MOVEMENT",
      movementId,
      issueCode,
      message,
      stamp,
    );
}

const financiallyLockedActions = new Set([
  "holdOrder",
  "createOrder",
  "updateOrderDraft",
  "upsertOrderDraft",
  "upsertAndSendKitchen",
  "prepareInvoiceForPayment",
  "applyConfiguredPayment",
  "applyVoucherRedemption",
  "applyGiftCardRedemption",
  "applyLoyaltyReward",
  "applyReservationDeposit",
  "requestRefund",
  "approveRefund",
  "recordWastage",
  "approveWastage",
  "recordBreakage",
  "approveBreakage",
  "receivePurchaseOrder",
  "replaceCostControlSnapshot",
]);

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique|mutation_commits/i.test(message);
}
