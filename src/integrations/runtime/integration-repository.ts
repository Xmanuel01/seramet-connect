import type { D1Database } from "@/server/database/d1";
import type {
  ExternalResourceMapping,
  IntegrationDeadLetter,
  IntegrationEvent,
  IntegrationHealthRecord,
  IntegrationIdempotencyRecord,
  IntegrationOutbox,
  IntegrationReplay,
} from "@/integrations/runtime/models";

type RecordKind =
  "EVENT" | "IDEMPOTENCY" | "MAPPING" | "OUTBOX" | "DEAD_LETTER" | "HEALTH" | "REPLAY";
type RecordByKind = {
  EVENT: IntegrationEvent;
  IDEMPOTENCY: IntegrationIdempotencyRecord;
  MAPPING: ExternalResourceMapping;
  OUTBOX: IntegrationOutbox;
  DEAD_LETTER: IntegrationDeadLetter;
  HEALTH: IntegrationHealthRecord;
  REPLAY: IntegrationReplay;
};

export type IntegrationRepository = {
  migrate(): Promise<void>;
  appendEvent(event: IntegrationEvent): Promise<void>;
  getEvent(tenantId: string, id: string): Promise<IntegrationEvent | null>;
  listEvents(
    tenantId: string,
    filters?: Partial<
      Pick<
        IntegrationEvent,
        "connectionId" | "branchId" | "providerId" | "direction" | "eventType" | "status"
      >
    >,
  ): Promise<IntegrationEvent[]>;
  updateEvent(
    tenantId: string,
    id: string,
    update: Partial<Omit<IntegrationEvent, "id" | "tenantId" | "payload" | "createdAt">>,
  ): Promise<IntegrationEvent>;
  getIdempotency(
    tenantId: string,
    connectionId: string,
    key: string,
  ): Promise<IntegrationIdempotencyRecord | null>;
  claimIdempotency(
    record: IntegrationIdempotencyRecord,
  ): Promise<{ claimed: boolean; record: IntegrationIdempotencyRecord }>;
  completeIdempotency(
    tenantId: string,
    connectionId: string,
    key: string,
    result: unknown,
  ): Promise<void>;
  upsertMapping(mapping: ExternalResourceMapping): Promise<void>;
  getMapping(
    tenantId: string,
    connectionId: string,
    resourceType: string,
    externalId: string,
  ): Promise<ExternalResourceMapping | null>;
  listMappings(tenantId: string, connectionId?: string): Promise<ExternalResourceMapping[]>;
  deleteMapping(tenantId: string, id: string): Promise<void>;
  enqueueOutbox(
    record: IntegrationOutbox,
  ): Promise<{ created: boolean; record: IntegrationOutbox }>;
  coalesceOutbox(
    record: IntegrationOutbox,
  ): Promise<{ created: boolean; replaced: boolean; record: IntegrationOutbox }>;
  getOutbox(tenantId: string, id: string): Promise<IntegrationOutbox | null>;
  listOutbox(tenantId: string, connectionId?: string): Promise<IntegrationOutbox[]>;
  updateOutbox(
    tenantId: string,
    id: string,
    update: Partial<Omit<IntegrationOutbox, "id" | "tenantId" | "payload" | "createdAt">>,
  ): Promise<IntegrationOutbox>;
  appendDeadLetter(record: IntegrationDeadLetter): Promise<void>;
  listDeadLetters(tenantId: string, connectionId?: string): Promise<IntegrationDeadLetter[]>;
  updateDeadLetter(
    tenantId: string,
    id: string,
    update: Partial<
      Omit<IntegrationDeadLetter, "id" | "tenantId" | "originalPayload" | "createdAt">
    >,
  ): Promise<IntegrationDeadLetter>;
  upsertHealth(record: IntegrationHealthRecord): Promise<void>;
  getHealth(tenantId: string, connectionId: string): Promise<IntegrationHealthRecord | null>;
  listHealth(tenantId: string): Promise<IntegrationHealthRecord[]>;
  appendReplay(record: IntegrationReplay): Promise<void>;
  listReplays(tenantId: string, originalEventId?: string): Promise<IntegrationReplay[]>;
};

type MemoryRecords = { [K in RecordKind]: Map<string, RecordByKind[K]> };

function createMemoryRecords(): MemoryRecords {
  return {
    EVENT: new Map(),
    IDEMPOTENCY: new Map(),
    MAPPING: new Map(),
    OUTBOX: new Map(),
    DEAD_LETTER: new Map(),
    HEALTH: new Map(),
    REPLAY: new Map(),
  };
}

let sharedMemory = createMemoryRecords();
const clone = <T>(value: T): T => structuredClone(value);
const key = (tenantId: string, id: string) => `${tenantId}:${id}`;

export function resetIntegrationMemoryForTests() {
  sharedMemory = createMemoryRecords();
}

export function createIntegrationRepository(db?: D1Database): IntegrationRepository {
  return db ? new D1IntegrationRepository(db) : new MemoryIntegrationRepository(sharedMemory);
}

class MemoryIntegrationRepository implements IntegrationRepository {
  constructor(private records: MemoryRecords) {}
  async migrate() {}

  async appendEvent(event: IntegrationEvent) {
    const recordKey = key(event.tenantId, event.id);
    if (this.records.EVENT.has(recordKey)) throw new Error("Integration event already exists");
    this.records.EVENT.set(recordKey, clone(event));
  }
  async getEvent(tenantId: string, id: string) {
    return clone(this.records.EVENT.get(key(tenantId, id)) ?? null);
  }
  async listEvents(tenantId: string, filters = {}) {
    return this.list("EVENT", tenantId)
      .filter((row) => matches(row, filters))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateEvent(tenantId: string, id: string, update: Partial<IntegrationEvent>) {
    const current = await this.getEvent(tenantId, id);
    if (!current) throw new Error("EVENT record not found");
    const next = {
      ...current,
      ...clone(update),
      id: current.id,
      tenantId,
      payload: current.payload,
      createdAt: current.createdAt,
    };
    this.records.EVENT.set(key(tenantId, id), next);
    return clone(next);
  }
  async getIdempotency(tenantId: string, connectionId: string, idempotencyKey: string) {
    const id = `${connectionId}:${idempotencyKey}`;
    return clone(this.records.IDEMPOTENCY.get(key(tenantId, id)) ?? null);
  }
  async claimIdempotency(record: IntegrationIdempotencyRecord) {
    const id = `${record.connectionId}:${record.key}`;
    const recordKey = key(record.tenantId, id);
    const existing = this.records.IDEMPOTENCY.get(recordKey);
    if (existing) return { claimed: false, record: clone(existing) };
    const stored = { ...clone(record), id };
    this.records.IDEMPOTENCY.set(recordKey, stored);
    return { claimed: true, record: clone(stored) };
  }
  async completeIdempotency(
    tenantId: string,
    connectionId: string,
    idempotencyKey: string,
    result: unknown,
  ) {
    const current = await this.getIdempotency(tenantId, connectionId, idempotencyKey);
    if (!current) throw new Error("Idempotency record not found");
    this.records.IDEMPOTENCY.set(key(tenantId, current.id), {
      ...current,
      status: "COMPLETED",
      result: clone(result),
      updatedAt: new Date().toISOString(),
    });
  }
  async upsertMapping(mapping: ExternalResourceMapping) {
    this.records.MAPPING.set(key(mapping.tenantId, mapping.id), clone(mapping));
  }
  async getMapping(
    tenantId: string,
    connectionId: string,
    resourceType: string,
    externalId: string,
  ) {
    return (
      this.list("MAPPING", tenantId).find(
        (row) =>
          row.connectionId === connectionId &&
          row.resourceType === resourceType &&
          row.externalId === externalId &&
          row.status !== "DISABLED",
      ) ?? null
    );
  }
  async listMappings(tenantId: string, connectionId?: string) {
    return this.list("MAPPING", tenantId).filter(
      (row) => !connectionId || row.connectionId === connectionId,
    );
  }
  async deleteMapping(tenantId: string, id: string) {
    this.records.MAPPING.delete(key(tenantId, id));
  }
  async enqueueOutbox(record: IntegrationOutbox) {
    const existing = this.list("OUTBOX", record.tenantId).find(
      (row) =>
        row.connectionId === record.connectionId && row.idempotencyKey === record.idempotencyKey,
    );
    if (existing) return { created: false, record: existing };
    this.records.OUTBOX.set(key(record.tenantId, record.id), clone(record));
    return { created: true, record: clone(record) };
  }
  async coalesceOutbox(record: IntegrationOutbox) {
    const existing = this.list("OUTBOX", record.tenantId).find(
      (row) =>
        row.connectionId === record.connectionId &&
        row.coalescingKey === record.coalescingKey &&
        ["PENDING", "RETRY_PENDING"].includes(row.status),
    );
    if (!existing) {
      const created = await this.enqueueOutbox(record);
      return { ...created, replaced: false };
    }
    const replacement = {
      ...record,
      id: existing.id,
      createdAt: existing.createdAt,
      attemptCount: 0,
      status: "PENDING" as const,
    };
    this.records.OUTBOX.set(key(record.tenantId, existing.id), clone(replacement));
    return { created: false, replaced: true, record: clone(replacement) };
  }
  async getOutbox(tenantId: string, id: string) {
    return clone(this.records.OUTBOX.get(key(tenantId, id)) ?? null);
  }
  async listOutbox(tenantId: string, connectionId?: string) {
    return this.list("OUTBOX", tenantId).filter(
      (row) => !connectionId || row.connectionId === connectionId,
    );
  }
  async updateOutbox(tenantId: string, id: string, update: Partial<IntegrationOutbox>) {
    const current = await this.getOutbox(tenantId, id);
    if (!current) throw new Error("OUTBOX record not found");
    const next = {
      ...current,
      ...clone(update),
      id,
      tenantId,
      payload: current.payload,
      createdAt: current.createdAt,
    };
    this.records.OUTBOX.set(key(tenantId, id), next);
    return clone(next);
  }
  async appendDeadLetter(record: IntegrationDeadLetter) {
    this.records.DEAD_LETTER.set(key(record.tenantId, record.id), clone(record));
  }
  async listDeadLetters(tenantId: string, connectionId?: string) {
    return this.list("DEAD_LETTER", tenantId).filter(
      (row) => !connectionId || row.connectionId === connectionId,
    );
  }
  async updateDeadLetter(tenantId: string, id: string, update: Partial<IntegrationDeadLetter>) {
    const current = await this.require("DEAD_LETTER", tenantId, id);
    const next = {
      ...current,
      ...clone(update),
      id,
      tenantId,
      originalPayload: current.originalPayload,
      createdAt: current.createdAt,
    };
    this.records.DEAD_LETTER.set(key(tenantId, id), next);
    return clone(next);
  }
  async upsertHealth(record: IntegrationHealthRecord) {
    this.records.HEALTH.set(
      key(record.tenantId, record.connectionId),
      clone({ ...record, id: record.connectionId }),
    );
  }
  async getHealth(tenantId: string, connectionId: string) {
    return clone(this.records.HEALTH.get(key(tenantId, connectionId)) ?? null);
  }
  async listHealth(tenantId: string) {
    return this.list("HEALTH", tenantId);
  }
  async appendReplay(record: IntegrationReplay) {
    this.records.REPLAY.set(key(record.tenantId, record.id), clone(record));
  }
  async listReplays(tenantId: string, originalEventId?: string) {
    return this.list("REPLAY", tenantId).filter(
      (row) => !originalEventId || row.originalEventId === originalEventId,
    );
  }

  private list<K extends RecordKind>(kind: K, tenantId: string) {
    return Array.from(this.records[kind].values())
      .filter((row) => row.tenantId === tenantId)
      .map(clone);
  }
  private async require<K extends RecordKind>(kind: K, tenantId: string, id: string) {
    const row = this.records[kind].get(key(tenantId, id));
    if (!row) throw new Error(`${kind} record not found`);
    return clone(row);
  }
}

class D1IntegrationRepository implements IntegrationRepository {
  constructor(private db: D1Database) {}
  async migrate() {
    const schema = await this.db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .first<{ version: number | null }>();
    if ((schema?.version ?? 0) < 4) {
      throw new Error("Integration database schema is behind required version 4");
    }
  }
  async appendEvent(event: IntegrationEvent) {
    await this.migrate();
    await this.db
      .prepare(
        `INSERT INTO provider_events
          (tenant_id, id, branch_id, connection_id, provider_id, direction, event_type,
           provider_event_id, external_resource_id, correlation_id, idempotency_key,
           payload_json, payload_hash, received_at, processed_at, status, attempt_count,
           last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.tenantId,
        event.id,
        event.branchId ?? null,
        event.connectionId,
        event.providerId,
        event.direction,
        event.eventType,
        event.providerEventId,
        event.externalResourceId ?? null,
        event.correlationId,
        event.idempotencyKey,
        JSON.stringify(event),
        event.payloadHash,
        event.receivedAt,
        event.processedAt ?? null,
        event.status,
        event.attemptCount,
        event.lastError ?? null,
        event.createdAt,
      )
      .run();
  }

  private async writeOutbox(record: IntegrationOutbox, upsert: boolean) {
    await this.migrate();
    const updatedAt = new Date().toISOString();
    const query = `INSERT INTO integration_outbox
      (tenant_id, id, branch_id, connection_id, event_type, resource_type, resource_id,
       payload_json, idempotency_key, correlation_id, status, attempt_count,
       next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${
       upsert
         ? `ON CONFLICT(tenant_id, id) DO UPDATE SET
              branch_id = excluded.branch_id, payload_json = excluded.payload_json,
              status = excluded.status, attempt_count = excluded.attempt_count,
              next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at,
              lease_owner = NULL, lease_expires_at = NULL,
              last_error = json_extract(excluded.payload_json, '$.lastError')`
         : ""
     }`;
    await this.db
      .prepare(query)
      .bind(
        record.tenantId,
        record.id,
        record.branchId ?? null,
        record.connectionId,
        record.eventType,
        record.resourceType,
        record.resourceId,
        JSON.stringify(record),
        record.idempotencyKey,
        record.correlationId,
        databaseOutboxStatus(record.status),
        record.attemptCount,
        record.nextAttemptAt ?? record.createdAt,
        record.createdAt,
        updatedAt,
      )
      .run();
  }

  private async getJsonRecord<T>(
    table: string,
    tenantId: string,
    id: string,
    jsonColumn: string,
  ): Promise<T | null> {
    await this.migrate();
    assertRuntimeIdentifier(table);
    assertRuntimeIdentifier(jsonColumn);
    const row = await this.db
      .prepare(`SELECT ${jsonColumn} AS payload_json FROM ${table} WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .first<{ payload_json: string }>();
    return row ? (JSON.parse(row.payload_json) as T) : null;
  }

  private async listJsonRecords<T>(
    table: string,
    tenantId: string,
    orderColumn: string,
    jsonColumn = "payload_json",
  ): Promise<T[]> {
    await this.migrate();
    assertRuntimeIdentifier(table);
    assertRuntimeIdentifier(orderColumn);
    assertRuntimeIdentifier(jsonColumn);
    const result = await this.db
      .prepare(
        `SELECT ${jsonColumn} AS payload_json FROM ${table} WHERE tenant_id = ? ORDER BY ${orderColumn} DESC LIMIT 500`,
      )
      .bind(tenantId)
      .all<{ payload_json: string }>();
    return (result.results ?? []).map((row) => JSON.parse(row.payload_json) as T);
  }
  async getEvent(tenantId: string, id: string) {
    return this.getJsonRecord<IntegrationEvent>("provider_events", tenantId, id, "payload_json");
  }
  async listEvents(tenantId: string, filters = {}) {
    return (
      await this.listJsonRecords<IntegrationEvent>("provider_events", tenantId, "received_at")
    )
      .filter((row) => matches(row, filters))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateEvent(tenantId: string, id: string, update: Partial<IntegrationEvent>) {
    const current = await this.getEvent(tenantId, id);
    if (!current) throw new Error("EVENT record not found");
    const next = {
      ...current,
      ...clone(update),
      id,
      tenantId,
      payload: current.payload,
      createdAt: current.createdAt,
    };
    await this.db
      .prepare(
        `UPDATE provider_events SET payload_json = ?, processed_at = ?, status = ?,
         attempt_count = ?, last_error = ? WHERE tenant_id = ? AND id = ?`,
      )
      .bind(
        JSON.stringify(next),
        next.processedAt ?? null,
        next.status,
        next.attemptCount,
        next.lastError ?? null,
        tenantId,
        id,
      )
      .run();
    return next;
  }
  async getIdempotency(tenantId: string, connectionId: string, idempotencyKey: string) {
    return this.get("IDEMPOTENCY", tenantId, `${connectionId}:${idempotencyKey}`);
  }
  async claimIdempotency(record: IntegrationIdempotencyRecord) {
    const stored = { ...record, id: `${record.connectionId}:${record.key}` };
    const existing = await this.getIdempotency(record.tenantId, record.connectionId, record.key);
    if (existing) return { claimed: false, record: existing };
    try {
      await this.insert("IDEMPOTENCY", stored);
      return { claimed: true, record: stored };
    } catch {
      return {
        claimed: false,
        record: (await this.getIdempotency(record.tenantId, record.connectionId, record.key))!,
      };
    }
  }
  async completeIdempotency(
    tenantId: string,
    connectionId: string,
    idempotencyKey: string,
    result: unknown,
  ) {
    const current = await this.getIdempotency(tenantId, connectionId, idempotencyKey);
    if (!current) throw new Error("Idempotency record not found");
    await this.put("IDEMPOTENCY", {
      ...current,
      status: "COMPLETED",
      result,
      updatedAt: new Date().toISOString(),
    });
  }
  async upsertMapping(mapping: ExternalResourceMapping) {
    await this.migrate();
    await this.db
      .prepare(
        `INSERT INTO provider_mappings
          (tenant_id, id, branch_id, connection_id, provider_id, resource_type, internal_id,
           external_id, status, sync_status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, id) DO UPDATE SET
           branch_id = excluded.branch_id, internal_id = excluded.internal_id,
           external_id = excluded.external_id, status = excluded.status,
           sync_status = excluded.sync_status, metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        mapping.tenantId,
        mapping.id,
        mapping.branchId ?? null,
        mapping.connectionId,
        mapping.providerId,
        mapping.resourceType,
        mapping.internalId,
        mapping.externalId,
        mapping.status,
        mapping.syncStatus ?? null,
        JSON.stringify(mapping),
        mapping.createdAt,
        mapping.updatedAt,
      )
      .run();
  }
  async getMapping(
    tenantId: string,
    connectionId: string,
    resourceType: string,
    externalId: string,
  ) {
    return (
      (
        await this.listJsonRecords<ExternalResourceMapping>(
          "provider_mappings",
          tenantId,
          "updated_at",
          "metadata_json",
        )
      ).find(
        (row) =>
          row.connectionId === connectionId &&
          row.resourceType === resourceType &&
          row.externalId === externalId &&
          row.status !== "DISABLED",
      ) ?? null
    );
  }
  async listMappings(tenantId: string, connectionId?: string) {
    return (
      await this.listJsonRecords<ExternalResourceMapping>(
        "provider_mappings",
        tenantId,
        "updated_at",
        "metadata_json",
      )
    ).filter((row) => !connectionId || row.connectionId === connectionId);
  }
  async deleteMapping(tenantId: string, id: string) {
    await this.db
      .prepare("DELETE FROM provider_mappings WHERE tenant_id = ? AND id = ?")
      .bind(tenantId, id)
      .run();
  }
  async enqueueOutbox(record: IntegrationOutbox) {
    const existing = (await this.listOutbox(record.tenantId)).find(
      (row) =>
        row.connectionId === record.connectionId && row.idempotencyKey === record.idempotencyKey,
    );
    if (existing) return { created: false, record: existing };
    await this.writeOutbox(record, false);
    return { created: true, record };
  }
  async coalesceOutbox(record: IntegrationOutbox) {
    const existing = (await this.listOutbox(record.tenantId)).find(
      (row) =>
        row.connectionId === record.connectionId &&
        row.coalescingKey === record.coalescingKey &&
        ["PENDING", "RETRY_PENDING"].includes(row.status),
    );
    if (!existing) {
      const created = await this.enqueueOutbox(record);
      return { ...created, replaced: false };
    }
    const replacement = {
      ...record,
      id: existing.id,
      createdAt: existing.createdAt,
      attemptCount: 0,
      status: "PENDING" as const,
    };
    await this.writeOutbox(replacement, true);
    return { created: false, replaced: true, record: replacement };
  }
  async getOutbox(tenantId: string, id: string) {
    return this.getJsonRecord<IntegrationOutbox>(
      "integration_outbox",
      tenantId,
      id,
      "payload_json",
    );
  }
  async listOutbox(tenantId: string, connectionId?: string) {
    return (
      await this.listJsonRecords<IntegrationOutbox>("integration_outbox", tenantId, "updated_at")
    ).filter((row) => !connectionId || row.connectionId === connectionId);
  }
  async updateOutbox(tenantId: string, id: string, update: Partial<IntegrationOutbox>) {
    const current = await this.getOutbox(tenantId, id);
    if (!current) throw new Error("OUTBOX record not found");
    const next = {
      ...current,
      ...update,
      id,
      tenantId,
      payload: current.payload,
      createdAt: current.createdAt,
    };
    await this.writeOutbox(next, true);
    return next;
  }
  async appendDeadLetter(record: IntegrationDeadLetter) {
    await this.migrate();
    await this.db
      .prepare(
        `INSERT INTO integration_dead_letters
          (tenant_id, id, branch_id, connection_id, provider_id, source_type, source_id,
           original_payload_json, error, attempt_count, correlation_id, status, created_at,
           resolved_at, resolved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.tenantId,
        record.id,
        record.branchId ?? null,
        record.connectionId,
        record.providerId,
        record.sourceType,
        record.sourceId,
        JSON.stringify(record),
        record.error,
        record.attemptCount,
        record.correlationId,
        deadLetterStatus(record.status),
        record.createdAt,
        record.resolvedAt ?? null,
        record.resolvedBy ?? null,
      )
      .run();
  }
  async listDeadLetters(tenantId: string, connectionId?: string) {
    return (
      await this.listJsonRecords<IntegrationDeadLetter>(
        "integration_dead_letters",
        tenantId,
        "created_at",
        "original_payload_json",
      )
    ).filter((row) => !connectionId || row.connectionId === connectionId);
  }
  async updateDeadLetter(tenantId: string, id: string, update: Partial<IntegrationDeadLetter>) {
    const current = await this.getJsonRecord<IntegrationDeadLetter>(
      "integration_dead_letters",
      tenantId,
      id,
      "original_payload_json",
    );
    if (!current) throw new Error("DEAD_LETTER record not found");
    const next = {
      ...current,
      ...update,
      id,
      tenantId,
      originalPayload: current.originalPayload,
      createdAt: current.createdAt,
    };
    await this.db
      .prepare(
        `UPDATE integration_dead_letters SET original_payload_json = ?, status = ?,
         resolved_at = ?, resolved_by = ? WHERE tenant_id = ? AND id = ?`,
      )
      .bind(
        JSON.stringify(next),
        deadLetterStatus(next.status),
        next.resolvedAt ?? null,
        next.resolvedBy ?? null,
        tenantId,
        id,
      )
      .run();
    return next;
  }
  async upsertHealth(record: IntegrationHealthRecord) {
    await this.put("HEALTH", { ...record, id: record.connectionId });
  }
  async getHealth(tenantId: string, connectionId: string) {
    return this.get("HEALTH", tenantId, connectionId);
  }
  async listHealth(tenantId: string) {
    return this.list("HEALTH", tenantId);
  }
  async appendReplay(record: IntegrationReplay) {
    await this.insert("REPLAY", record);
  }
  async listReplays(tenantId: string, originalEventId?: string) {
    return (await this.list("REPLAY", tenantId)).filter(
      (row) => !originalEventId || row.originalEventId === originalEventId,
    );
  }

  private async insert<K extends RecordKind>(kind: K, record: RecordByKind[K]) {
    await this.migrate();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO integration_runtime_records (tenant_id, kind, id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(record.tenantId, kind, record.id, JSON.stringify(record), now, now)
      .run();
  }
  private async put<K extends RecordKind>(kind: K, record: RecordByKind[K]) {
    await this.migrate();
    const now = new Date().toISOString();
    await this.db
      .prepare(
        "INSERT INTO integration_runtime_records (tenant_id, kind, id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, kind, id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at",
      )
      .bind(record.tenantId, kind, record.id, JSON.stringify(record), now, now)
      .run();
  }
  private async get<K extends RecordKind>(
    kind: K,
    tenantId: string,
    id: string,
  ): Promise<RecordByKind[K] | null> {
    await this.migrate();
    const row = await this.db
      .prepare(
        "SELECT payload_json FROM integration_runtime_records WHERE tenant_id = ? AND kind = ? AND id = ?",
      )
      .bind(tenantId, kind, id)
      .first<{ payload_json: string }>();
    return row ? (JSON.parse(row.payload_json) as RecordByKind[K]) : null;
  }
  private async list<K extends RecordKind>(kind: K, tenantId: string): Promise<RecordByKind[K][]> {
    await this.migrate();
    const result = await this.db
      .prepare(
        "SELECT payload_json FROM integration_runtime_records WHERE tenant_id = ? AND kind = ? ORDER BY updated_at DESC",
      )
      .bind(tenantId, kind)
      .all<{ payload_json: string }>();
    return (result.results ?? []).map((row) => JSON.parse(row.payload_json) as RecordByKind[K]);
  }
  private async require<K extends RecordKind>(kind: K, tenantId: string, id: string) {
    const row = await this.get(kind, tenantId, id);
    if (!row) throw new Error(`${kind} record not found`);
    return row;
  }
  private async delete(kind: RecordKind, tenantId: string, id: string) {
    await this.migrate();
    await this.db
      .prepare(
        "DELETE FROM integration_runtime_records WHERE tenant_id = ? AND kind = ? AND id = ?",
      )
      .bind(tenantId, kind, id)
      .run();
  }
}

function matches<T extends object>(row: T, filters: Partial<T>) {
  return Object.entries(filters).every(
    ([field, value]) => value === undefined || row[field as keyof T] === value,
  );
}

function databaseOutboxStatus(status: IntegrationOutbox["status"]) {
  const mapping: Record<IntegrationOutbox["status"], string> = {
    PENDING: "PENDING",
    PROCESSING: "CLAIMED",
    RETRY_PENDING: "RETRY_PENDING",
    PROCESSED: "SUCCEEDED",
    DEAD_LETTER: "DEAD_LETTER",
  };
  return mapping[status];
}

function deadLetterStatus(status: IntegrationDeadLetter["status"]) {
  return status === "OPEN" ? "OPEN" : "RESOLVED";
}

function assertRuntimeIdentifier(value: string) {
  const allowed = new Set([
    "provider_events",
    "provider_mappings",
    "integration_outbox",
    "integration_dead_letters",
    "payload_json",
    "metadata_json",
    "original_payload_json",
    "received_at",
    "updated_at",
    "created_at",
  ]);
  if (!allowed.has(value)) throw new Error("Unsafe runtime database identifier");
}
