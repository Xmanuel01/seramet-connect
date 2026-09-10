import type { D1Database } from "@/server/database/d1";

export type RealtimeEvent = {
  id: string;
  branchId: string | null;
  topic: string;
  entityType: string;
  entityId: string;
  eventType: string;
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export async function publishRealtimeEvent(
  db: D1Database,
  input: {
    tenantId: string;
    branchId?: string;
    topic: string;
    entityType: string;
    entityId: string;
    eventType: string;
    correlationId: string;
    payload?: Record<string, unknown>;
  },
) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  await db
    .prepare(
      `INSERT INTO realtime_events
        (tenant_id,id,branch_id,topic,entity_type,entity_id,event_type,correlation_id,
         payload_json,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      input.tenantId,
      id,
      input.branchId ?? null,
      input.topic,
      input.entityType,
      input.entityId,
      input.eventType,
      input.correlationId,
      JSON.stringify(input.payload ?? {}),
      createdAt,
      expiresAt,
    )
    .run();
  return id;
}

export async function listRealtimeEvents(
  db: D1Database,
  input: { tenantId: string; branchId?: string; after: string; afterId?: string; limit?: number },
) {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const result = await db
    .prepare(
      `SELECT id,branch_id,topic,entity_type,entity_id,event_type,correlation_id,payload_json,created_at
       FROM realtime_events
       WHERE tenant_id=?
         AND (? IS NULL OR branch_id IS NULL OR branch_id=?)
         AND (created_at>? OR (created_at=? AND id>?))
         AND (expires_at IS NULL OR expires_at>?)
       ORDER BY created_at,id LIMIT ?`,
    )
    .bind(
      input.tenantId,
      input.branchId ?? null,
      input.branchId ?? null,
      input.after,
      input.after,
      input.afterId ?? "",
      new Date().toISOString(),
      limit,
    )
    .all<{
      id: string;
      branch_id: string | null;
      topic: string;
      entity_type: string;
      entity_id: string;
      event_type: string;
      correlation_id: string;
      payload_json: string;
      created_at: string;
    }>();
  return (result.results ?? []).map((row): RealtimeEvent => ({
    id: row.id,
    branchId: row.branch_id,
    topic: row.topic,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    payload: safeJson(row.payload_json),
    createdAt: row.created_at,
  }));
}

function safeJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
