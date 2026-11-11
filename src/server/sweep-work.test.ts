import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerametEnv } from "@/lib/seramet-auth";
import type { D1Database } from "@/server/database/d1";
import { PostgresD1Database } from "@/server/database/postgres-database";
import {
  compileSqliteMigrationForPostgres,
  postgresCompatibilityPrelude,
} from "@/server/database/postgres-migration-compiler";
import {
  createMigratedTestDatabase,
  migrationFiles,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import {
  findTenantsWithSweepWork,
  probedSweepJobTypes,
  scheduleDurableWork,
  type SerametWorkerMessage,
} from "@/server/workers";

// Two restaurants: one with nothing going on, one with some of everything.
const idle = "sweep-idle";
const busy = "sweep-busy";
const branch = "sweep-branch";
// 08:03 UTC: no hourly or daily job is due, and it isn't a five-minute summary check.
const at = new Date("2026-11-11T08:03:00.000Z");
const minutesFrom = (minutes: number) => new Date(at.getTime() + minutes * 60_000).toISOString();

async function seedTenants(db: D1Database) {
  for (const id of [idle, busy]) {
    await db
      .prepare(
        `INSERT INTO tenants
          (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
         VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)`,
      )
      .bind(id, id, id, id, minutesFrom(-600), minutesFrom(-600))
      .run();
  }
}

function record(db: D1Database, entityType: string, id: string, status: string, payload: object) {
  return db
    .prepare(
      `INSERT INTO authoritative_records
        (tenant_id,entity_type,entity_id,status,payload_json,version,created_at,updated_at)
       VALUES (?,?,?,?,?,1,?,?)`,
    )
    .bind(busy, entityType, id, status, JSON.stringify(payload), minutesFrom(-60), minutesFrom(-60))
    .run();
}

function reservation(db: D1Database, id: string, startsAt: string, updatedAt: string) {
  return db
    .prepare(
      `INSERT INTO reservations
        (tenant_id,id,branch_id,guest_name,contact_email,party_size,starts_at,ends_at,business_date,
         status,source,confirmation_state,manage_token_hash,idempotency_key,created_by,created_at,updated_at)
       VALUES (?,?,?,'Guest','guest@example.test',2,?,?,'2026-11-12','CONFIRMED','WEB','NOT_REQUIRED',?,?,
               'guest',?,?)`,
    )
    .bind(
      busy,
      id,
      branch,
      startsAt,
      new Date(Date.parse(startsAt) + 7_200_000).toISOString(),
      `manage-${id}`,
      `reservation-${id}`,
      updatedAt,
      updatedAt,
    )
    .run();
}

function notificationEvent(db: D1Database, id: string, key: string, status: string) {
  return db
    .prepare(
      `INSERT INTO guest_notification_events
        (tenant_id,id,branch_id,purpose,channel,template_key,destination_hash,source_type,source_id,
         status,attempts,idempotency_key,scheduled_at,created_at,updated_at)
       VALUES (?,?,?,'RESERVATION_CONFIRMATION','EMAIL','reservation-confirmation','hash',
               'RESERVATION',?,?,0,?,?,?,?)`,
    )
    .bind(busy, id, branch, id, status, key, minutesFrom(-1), minutesFrom(-1), minutesFrom(-1))
    .run();
}

/** Work for each probed sweep at the busy restaurant only. */
async function seedBusyWork(db: D1Database) {
  await record(db, "state:orders", "held-order", "HELD", {
    id: "held-order",
    status: "HELD",
    externalSource: { scheduledReleaseAt: minutesFrom(30) },
  });
  await record(db, "payments:intents", "waiting-prompt", "AWAITING_CUSTOMER", {
    id: "waiting-prompt",
  });
  await db
    .prepare(
      `INSERT INTO integration_outbox
        (tenant_id,id,connection_id,event_type,resource_type,resource_id,payload_json,idempotency_key,
         correlation_id,status,attempt_count,next_attempt_at,created_at,updated_at)
       VALUES (?,'due-outbox','connection','ORDER_UPDATED','ORDER','order','{}','due-outbox','c',
               'RETRY_PENDING',1,?,?,?)`,
    )
    .bind(busy, minutesFrom(-1), minutesFrom(-10), minutesFrom(-10))
    .run();
  await db
    .prepare(
      `INSERT INTO campaigns
        (tenant_id,id,name,status,objective,segment_id,channels_json,schedule_at,template_body,
         created_by,created_at,updated_at)
       VALUES (?,'due-campaign','Weekend','SCHEDULED','RETENTION','segment','["EMAIL"]',?,'Hi',
               'owner',?,?)`,
    )
    .bind(busy, minutesFrom(-1), minutesFrom(-60), minutesFrom(-60))
    .run();
  await db
    .prepare(
      `INSERT INTO guest_sessions
        (tenant_id,id,branch_id,session_type,token_hash,status,channel_code,expires_at,last_seen_at,created_at)
       VALUES (?,'expired-session',?,'WEB','token-hash','ACTIVE','WEB',?,?,?)`,
    )
    .bind(busy, branch, minutesFrom(-1), minutesFrom(-30), minutesFrom(-60))
    .run();
  // Confirmed a minute ago and not yet sent a confirmation.
  await reservation(db, "new-booking", minutesFrom(3 * 24 * 60), minutesFrom(-1));
}

async function sweepTenants(db: D1Database, options?: { dailySummary?: boolean }) {
  const work = await findTenantsWithSweepWork(db, at, options);
  return Object.fromEntries(
    probedSweepJobTypes.map((type) => [type, [idle, busy].filter((id) => work[type].has(id))]),
  );
}

describe("frequent sweeps write a job only when there is work", () => {
  let db: SqliteD1TestDatabase;
  let sent: SerametWorkerMessage[];
  let env: SerametEnv;
  const jobs = async (tenantId: string) =>
    (
      await db
        .prepare("SELECT job_type FROM worker_jobs WHERE tenant_id=? ORDER BY job_type")
        .bind(tenantId)
        .all<{ job_type: string }>()
    ).results?.map((row) => row.job_type) ?? [];

  beforeEach(async () => {
    db = createMigratedTestDatabase();
    // The rows reference catalogue and provider data these checks never read.
    db.sqlite.exec("PRAGMA foreign_keys = OFF");
    await seedTenants(db);
    sent = [];
    env = {
      SERAMET_DB: db,
      SERAMET_ENVIRONMENT: "test",
      SERAMET_WORK_QUEUE: {
        async send(body) {
          sent.push(body as SerametWorkerMessage);
        },
      },
    };
  });
  afterEach(() => db.close());

  it("writes no job row for a restaurant with nothing to do", async () => {
    expect(await scheduleDurableWork(env, at)).toEqual({ queued: 0 });
    expect(await jobs(idle)).toEqual([]);
    expect(await jobs(busy)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("schedules each sweep only for the restaurant that has its work, once per minute", async () => {
    await seedBusyWork(db);
    await scheduleDurableWork(env, at);
    expect(await jobs(idle)).toEqual([]);
    expect(await jobs(busy)).toEqual([
      "CRM_CAMPAIGN_DISPATCH",
      "GUEST_LIFECYCLE_MAINTENANCE",
      "GUEST_NOTIFICATION_DISPATCH",
      "INTEGRATION_OUTBOX_RECOVERY",
      "PAYMENT_PROMPT_STATUS_CHECK",
      "SCHEDULED_ORDER_RELEASE",
    ]);
    expect(sent.filter((message) => message.tenantId === busy)).toHaveLength(6);
    // The per-minute idempotency key still stops a repeated run from duplicating work.
    await scheduleDurableWork(env, at);
    expect(await jobs(busy)).toHaveLength(6);
  });

  it("still re-sends a sweep job waiting to retry after its work is gone", async () => {
    await db
      .prepare(
        `INSERT INTO worker_jobs
          (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,attempt_count,
           max_attempts,scheduled_at,created_at,updated_at)
         VALUES (?,'retrying','INTEGRATION_OUTBOX_RECOVERY','{}','retrying','c','RETRY_PENDING',1,8,?,?,?)`,
      )
      .bind(busy, minutesFrom(-1), minutesFrom(-5), minutesFrom(-1))
      .run();
    await scheduleDurableWork(env, at);
    expect(sent).toEqual([expect.objectContaining({ tenantId: busy, jobId: "retrying" })]);
  });

  it("checks each sweep's own condition", async () => {
    await seedBusyWork(db);
    expect(await sweepTenants(db)).toMatchObject({
      SCHEDULED_ORDER_RELEASE: [busy],
      PAYMENT_PROMPT_STATUS_CHECK: [busy],
      DAILY_SUMMARY_DISPATCH: [],
    });
    // A held order nobody scheduled, a settled prompt, a paused campaign: nothing to do.
    await db.exec(`UPDATE authoritative_records SET payload_json='{"id":"held-order","status":"HELD"}'
      WHERE entity_type='state:orders';
      UPDATE authoritative_records SET status='SUCCEEDED' WHERE entity_type='payments:intents';
      UPDATE campaigns SET status='PAUSED';
      UPDATE integration_outbox SET next_attempt_at='${minutesFrom(5)}';
      UPDATE guest_sessions SET expires_at='${minutesFrom(5)}'`);
    // The new booking's confirmation and (early, as the job creates it) reminder exist.
    await notificationEvent(db, "confirmation", "reservation-confirmation:new-booking", "SENT");
    await notificationEvent(
      db,
      "early-reminder",
      `reservation-reminder:new-booking:${minutesFrom(3 * 24 * 60)}`,
      "SENT",
    );
    // Stays in the reminder window for two hours, but its reminder was already created.
    const tomorrow = minutesFrom(24 * 60);
    await reservation(db, "tomorrow", tomorrow, minutesFrom(-600));
    await notificationEvent(db, "confirm-2", "reservation-confirmation:tomorrow", "SENT");
    await notificationEvent(db, "remind-2", `reservation-reminder:tomorrow:${tomorrow}`, "SENT");
    expect(await sweepTenants(db)).toEqual(
      Object.fromEntries(probedSweepJobTypes.map((type) => [type, []])),
    );
    // A due notification only counts when a provider can send it.
    await notificationEvent(db, "queued", "queued-key", "QUEUED");
    expect((await sweepTenants(db)).GUEST_NOTIFICATION_DISPATCH).toEqual([]);
    await db
      .prepare(
        `INSERT INTO communication_provider_configs
          (tenant_id,id,provider_key,display_name,status,created_by,created_at,updated_at)
         VALUES (?,'provider','email','Email','CONFIGURED','owner',?,?)`,
      )
      .bind(busy, minutesFrom(-60), minutesFrom(-60))
      .run();
    expect((await sweepTenants(db)).GUEST_NOTIFICATION_DISPATCH).toEqual([busy]);
  });

  it("checks the end-of-day summary only for restaurants with recipients", async () => {
    await record(db, "payments:closingPolicies", "empty", "", { recipientUserIds: [] });
    expect((await sweepTenants(db, { dailySummary: true })).DAILY_SUMMARY_DISPATCH).toEqual([]);
    await record(db, "payments:closingPolicies", "chosen", "", { recipientUserIds: ["manager"] });
    expect((await sweepTenants(db, { dailySummary: true })).DAILY_SUMMARY_DISPATCH).toEqual([busy]);
    // 08:02 is a summary minute.
    await scheduleDurableWork(env, new Date("2026-11-11T08:02:00.000Z"));
    expect(await jobs(busy)).toEqual(["DAILY_SUMMARY_DISPATCH"]);
    expect(await jobs(idle)).toEqual([]);
  });

  it("falls back to every restaurant when a check fails", async () => {
    const failing: D1Database = {
      ...db,
      prepare: (sql: string) => {
        if (sql.includes("FROM integration_outbox")) throw new Error("check unavailable");
        return db.prepare(sql);
      },
      batch: (statements) => db.batch(statements),
      exec: (sql) => db.exec(sql),
    } as D1Database;
    const work = await sweepTenants(failing);
    expect(work.INTEGRATION_OUTBOX_RECOVERY).toEqual([idle, busy]);
    expect(work.SCHEDULED_ORDER_RELEASE).toEqual([]);
  });
});

it("runs the sweep checks on PostgreSQL", async () => {
  const postgres = new PGlite();
  try {
    await postgres.exec(postgresCompatibilityPrelude);
    for (const file of migrationFiles) {
      await postgres.exec(
        compileSqliteMigrationForPostgres(
          readFileSync(resolve(process.cwd(), "migrations", file), "utf8"),
        ).sql,
      );
    }
    // The rows reference catalogue and provider data these checks never read.
    await postgres.exec("SET session_replication_role = replica");
    const query = async (sql: string, values?: unknown[]) => {
      const result = await postgres.query(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    };
    const db = new PostgresD1Database({
      query,
      connect: async () => ({ query, release() {} }),
    } as unknown as Pool);
    await seedTenants(db);
    expect(await sweepTenants(db, { dailySummary: true })).toEqual(
      Object.fromEntries(probedSweepJobTypes.map((type) => [type, []])),
    );
    await seedBusyWork(db);
    await record(db, "payments:closingPolicies", "chosen", "", { recipientUserIds: ["manager"] });
    expect(await sweepTenants(db, { dailySummary: true })).toEqual(
      Object.fromEntries(probedSweepJobTypes.map((type) => [type, [busy]])),
    );
  } finally {
    await postgres.close();
  }
}, 120_000);
