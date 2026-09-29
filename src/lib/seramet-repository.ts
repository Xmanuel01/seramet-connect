import {
  TransactionEngine,
  createInitialTransactionState,
  type TransactionState,
} from "@/lib/transaction-engine";
import type { D1Database, ServerActor } from "@/lib/seramet-auth";

export type IdempotencyRecord = {
  key: string;
  actorId: string;
  action: string;
  requestHash: string;
  responseJson: string;
  createdAt: string;
};

export type TransactionRepository = {
  loadState: () => Promise<TransactionState>;
  saveState: (state: TransactionState, actor: ServerActor, reason: string) => Promise<void>;
  getIdempotency: (key: string) => Promise<IdempotencyRecord | null>;
  saveIdempotency: (record: IdempotencyRecord) => Promise<void>;
  appendProviderEvent: (event: ProviderWebhookEvent) => Promise<void>;
  migrate: () => Promise<void>;
};

export type ProviderWebhookEvent = {
  id: string;
  provider: string;
  eventType: string;
  externalReference: string;
  payloadJson: string;
  receivedAt: string;
  processed: boolean;
};

type SnapshotRow = { id: string; payload_json: string };
type IdempotencyRow = {
  key: string;
  actor_id: string;
  action: string;
  request_hash: string;
  response_json: string;
  created_at: string;
};

const snapshotId = "current";
const memory = {
  state: createInitialTransactionState(),
  idempotency: new Map<string, IdempotencyRecord>(),
  events: [] as ProviderWebhookEvent[],
};

export function createTransactionRepository(db?: D1Database): TransactionRepository {
  return db ? new D1TransactionRepository(db) : new MemoryTransactionRepository();
}

class MemoryTransactionRepository implements TransactionRepository {
  async migrate() {
    return undefined;
  }

  async loadState() {
    return structuredCloneSafe(memory.state);
  }

  async saveState(state: TransactionState) {
    memory.state = structuredCloneSafe(state);
  }

  async getIdempotency(key: string) {
    return memory.idempotency.get(key) ?? null;
  }

  async saveIdempotency(record: IdempotencyRecord) {
    memory.idempotency.set(record.key, record);
  }

  async appendProviderEvent(event: ProviderWebhookEvent) {
    memory.events.unshift(event);
  }
}

class D1TransactionRepository implements TransactionRepository {
  constructor(private db: D1Database) {}

  async migrate() {
    await this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS seramet_transaction_snapshots (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        reason TEXT NOT NULL
      )
    `,
      )
      .run();
    await this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS seramet_idempotency (
        key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
      )
      .run();
    await this.db
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS seramet_provider_events (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        event_type TEXT NOT NULL,
        external_reference TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        processed INTEGER NOT NULL
      )
    `,
      )
      .run();
  }

  async loadState() {
    await this.migrate();
    const row = await this.db
      .prepare("SELECT id, payload_json FROM seramet_transaction_snapshots WHERE id = ?")
      .bind(snapshotId)
      .first<SnapshotRow>();
    if (!row) {
      const initial = createInitialTransactionState();
      await this.saveState(
        initial,
        { id: "system", name: "System", role: "General Manager", branch: "All Branches" },
        "Initial database seed",
      );
      return initial;
    }
    return JSON.parse(row.payload_json) as TransactionState;
  }

  async saveState(state: TransactionState, actor: ServerActor, reason: string) {
    await this.migrate();
    await this.db
      .prepare(
        `
      INSERT INTO seramet_transaction_snapshots (id, payload_json, updated_by, updated_at, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at,
        reason = excluded.reason
    `,
      )
      .bind(snapshotId, JSON.stringify(state), actor.id, new Date().toISOString(), reason)
      .run();
  }

  async getIdempotency(key: string) {
    await this.migrate();
    const row = await this.db
      .prepare(
        "SELECT key, actor_id, action, request_hash, response_json, created_at FROM seramet_idempotency WHERE key = ?",
      )
      .bind(key)
      .first<IdempotencyRow>();
    if (!row) return null;
    return {
      key: row.key,
      actorId: row.actor_id,
      action: row.action,
      requestHash: row.request_hash,
      responseJson: row.response_json,
      createdAt: row.created_at,
    };
  }

  async saveIdempotency(record: IdempotencyRecord) {
    await this.migrate();
    await this.db
      .prepare(
        `
      INSERT INTO seramet_idempotency (key, actor_id, action, request_hash, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        record.key,
        record.actorId,
        record.action,
        record.requestHash,
        record.responseJson,
        record.createdAt,
      )
      .run();
  }

  async appendProviderEvent(event: ProviderWebhookEvent) {
    await this.migrate();
    await this.db
      .prepare(
        `
      INSERT INTO seramet_provider_events (id, provider, event_type, external_reference, payload_json, received_at, processed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .bind(
        event.id,
        event.provider,
        event.eventType,
        event.externalReference,
        event.payloadJson,
        event.receivedAt,
        event.processed ? 1 : 0,
      )
      .run();
  }
}

export function applyServerMutation(
  state: TransactionState,
  action: string,
  payload: unknown,
  actor: ServerActor,
) {
  const input = payload as Record<string, unknown>;
  switch (action) {
    case "replaceState":
      return input.state as TransactionState;
    case "holdOrder":
      return TransactionEngine.holdOrder(
        state,
        input.draft as Parameters<typeof TransactionEngine.holdOrder>[1],
      );
    case "createOrder":
      return TransactionEngine.createOrder(
        state,
        input.draft as Parameters<typeof TransactionEngine.createOrder>[1],
        input.status as Parameters<typeof TransactionEngine.createOrder>[2],
      );
    case "sendToKitchen":
      return TransactionEngine.sendToKitchen(state, String(input.orderId), actor.name);
    case "releaseHeldOrder":
      return TransactionEngine.releaseHeldOrder(state, String(input.orderId), actor.name);
    case "createOpenBill":
      return TransactionEngine.createOpenBill(state, String(input.orderId));
    case "confirmPaymentIntent":
      return TransactionEngine.confirmPaymentIntent(
        state,
        String(input.intentId),
        String(input.externalReference),
        actor.name,
      );
    case "recordManualTillPayment":
      return TransactionEngine.recordManualTillPayment(
        state,
        String(input.invoiceId),
        input.input as Parameters<typeof TransactionEngine.recordManualTillPayment>[2],
      );
    case "recordCashPayment":
      return TransactionEngine.recordCashPayment(
        state,
        String(input.invoiceId),
        input.input as Parameters<typeof TransactionEngine.recordCashPayment>[2],
      );
    case "recordCardPayment":
      return TransactionEngine.recordCardPayment(
        state,
        String(input.invoiceId),
        input.input as Parameters<typeof TransactionEngine.recordCardPayment>[2],
      );
    case "recordBankPayment":
      return TransactionEngine.recordBankPayment(
        state,
        String(input.invoiceId),
        input.input as Parameters<typeof TransactionEngine.recordBankPayment>[2],
      );
    case "mergeBills":
      return TransactionEngine.mergeBills(
        state,
        input.billIds as string[],
        actor.name,
        String(input.reason ?? "Authorized merge"),
      );
    case "splitBill":
      return TransactionEngine.splitBill(
        state,
        String(input.billId),
        input.splits as Parameters<typeof TransactionEngine.splitBill>[2],
        actor.name,
      );
    case "cancelOrder":
      return TransactionEngine.cancelOrder(
        state,
        String(input.orderId),
        input.input as Parameters<typeof TransactionEngine.cancelOrder>[2],
      );
    case "requestRefund":
      return TransactionEngine.requestRefund(
        state,
        input.input as Parameters<typeof TransactionEngine.requestRefund>[1],
      );
    case "approveRefund":
      return TransactionEngine.approveRefund(state, String(input.refundId), actor.name);
    case "importExternalTransaction":
      return TransactionEngine.importExternalTransaction(
        state,
        input.input as Parameters<typeof TransactionEngine.importExternalTransaction>[1],
      );
    case "suggestReconciliation":
      return TransactionEngine.suggestReconciliation(state, String(input.externalTransactionId));
    case "manuallyReconcile":
      return TransactionEngine.manuallyReconcile(
        state,
        String(input.externalTransactionId),
        String(input.paymentId),
        actor.name,
        String(input.notes ?? "Manual reconciliation"),
      );
    case "closeCashDrawer":
      return TransactionEngine.closeCashDrawer(
        state,
        String(input.drawerId),
        Number(input.physicalCount),
        actor.name,
      );
    default:
      throw new Error(`Unsupported mutation ${action}`);
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
