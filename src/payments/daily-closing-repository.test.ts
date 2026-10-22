import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { setConfigurationRepositoryForTests } from "@/platform/repositories/configuration-repository";
import { allPermissionCodes } from "@/platform/permissions";
import type { ServerActor } from "@/lib/seramet-auth";
import { businessDateForTimestamp } from "@/lib/business-date";
import { deliverDailyClosingEmail } from "@/server/daily-closing-email";
import { handleWorkerQueue, scheduleDurableWork } from "@/server/workers";
import type { SerametEnv } from "@/lib/seramet-auth";

let db: SqliteD1TestDatabase;
let repo: D1AuthoritativeTransactionRepository;
let actor: ServerActor;
let businessDate: string;
beforeEach(async () => {
  db = createMigratedTestDatabase();
  const tenantId = randomUUID(),
    branchId = randomUUID(),
    id = randomUUID(),
    stamp = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO tenants (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at) VALUES (?,?,?,?,'KES','Africa/Nairobi','en-KE',1,'{}',?,?)",
    )
    .bind(tenantId, tenantId, "Disposable", "Disposable", stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO branches (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json) VALUES (?,?,?,?,'Africa/Nairobi',240,1,'{}')",
    )
    .bind(tenantId, branchId, branchId, "Disposable branch")
    .run();
  await db
    .prepare(
      "INSERT INTO users (tenant_id,id,email,name,password_version,active,payload_json,created_at,updated_at) VALUES (?,?,?,'Manager',1,1,'{}',?,?)",
    )
    .bind(tenantId, id, `${id}@example.invalid`, stamp, stamp)
    .run();
  await db
    .prepare(
      "INSERT INTO permissions (code,description) VALUES ('reconciliation.view','Disposable report recipient') ON CONFLICT DO NOTHING",
    )
    .run();
  const roleId = randomUUID();
  await db
    .prepare(
      "INSERT INTO roles (tenant_id,id,code,name,active,payload_json) VALUES (?,?,?,'Disposable report recipient',1,'{}')",
    )
    .bind(tenantId, roleId, roleId)
    .run();
  await db
    .prepare("INSERT INTO role_permissions VALUES (?,?,'reconciliation.view')")
    .bind(tenantId, roleId)
    .run();
  await db.prepare("INSERT INTO user_roles VALUES (?,?,?)").bind(tenantId, id, roleId).run();
  await db.prepare("INSERT INTO user_branches VALUES (?,?,?)").bind(tenantId, id, branchId).run();
  await hydrateAuthoritativeConfiguration(db, {}, true);
  actor = {
    id,
    tenantId,
    branchId,
    name: "Manager",
    branch: "Disposable branch",
    permissions: [...allPermissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Disposable branch" }],
    roleIds: [],
    role: "Manager",
    branchScope: { type: "BRANCH", branchId },
  };
  businessDate = businessDateForTimestamp(new Date(), "Africa/Nairobi", 240);
  repo = new D1AuthoritativeTransactionRepository(db);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  setConfigurationRepositoryForTests();
});

async function queuedEmail() {
  await command("configureDailyClosing", {
    branchId: actor.branchId,
    mode: "SUPERVISOR_DAILY_CLOSE",
    materialVarianceMinor: 50000,
    recipientUserIds: [actor.id],
  });
  const openedDrawer = await opened();
  const request = payload(openedDrawer.state.paymentOperations!.drawerSessions[0]!.id);
  await command("closeBusinessDay", request, "email-close");
  const job = await db
    .prepare("SELECT id FROM worker_jobs WHERE tenant_id=? AND job_type='DAILY_CLOSING_EMAIL'")
    .bind(actor.tenantId)
    .first<{ id: string }>();
  return { jobId: job!.id, request };
}
const emailConfiguration = {
  get SERAMET_TRANSACTIONAL_EMAIL_CONFIG() {
    return JSON.stringify({
      [actor.tenantId]: {
        apiKey: "disposable-test-only",
        from: "Closing <closing@example.invalid>",
      },
    });
  },
};
describe("durable daily closing email boundary", () => {
  it("recovers an expired email lease through the existing scheduler", async () => {
    const { jobId } = await queuedEmail();
    await db
      .prepare(
        "UPDATE worker_jobs SET status='RUNNING',lease_owner='crashed-consumer',lease_expires_at=?,attempt_count=1 WHERE id=?",
      )
      .bind(new Date(Date.now() - 1000).toISOString(), jobId)
      .run();
    const send = vi.fn().mockResolvedValue(undefined);
    const env: SerametEnv = {
      SERAMET_DB: db,
      SERAMET_ENVIRONMENT: "test",
      SERAMET_WORK_QUEUE: { send },
      ...emailConfiguration,
    };
    await scheduleDurableWork(env);
    expect(send.mock.calls.some(([body]) => body.jobId === jobId)).toBe(true);
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ messageId: `<${randomUUID()}@brevo.test>` })),
      );
    await handleWorkerQueue(
      {
        queue: "disposable",
        messages: [
          {
            id: randomUUID(),
            timestamp: new Date(),
            body: {
              kind: "worker-job",
              tenantId: actor.tenantId,
              jobId,
              correlationId: randomUUID(),
            },
            attempts: 2,
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      },
      env,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    const brevoRequest = JSON.parse(transport.mock.calls[0]![1]!.body as string);
    expect(transport.mock.calls[0]![0]).toBe("https://api.brevo.com/v3/smtp/email");
    expect(brevoRequest.attachment[0].name).toMatch(/^daily-closing-.*-r1\.pdf$/);
    expect(atob(brevoRequest.attachment[0].content)).toMatch(/^%PDF-/);
    expect(brevoRequest.to).toHaveLength(1);
    expect(
      await db.prepare("SELECT status FROM worker_jobs WHERE id=?").bind(jobId).first("status"),
    ).toBe("SUCCEEDED");
  });
  it.each([401, 429, 503])(
    "sanitizes provider HTTP %s without exposing its body",
    async (status) => {
      const { jobId } = await queuedEmail();
      await db.prepare("UPDATE worker_jobs SET status='RUNNING' WHERE id=?").bind(jobId).run();
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private provider diagnostic content", { status }));
      await expect(
        deliverDailyClosingEmail(
          { SERAMET_DB: db, ...emailConfiguration },
          actor.tenantId,
          jobId,
          transport,
        ),
      ).rejects.toThrow(
        status >= 500
          ? "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED"
          : status === 429
            ? "TRANSACTIONAL_EMAIL_RATE_LIMITED"
            : "TRANSACTIONAL_EMAIL_PROVIDER_REJECTED",
      );
    },
  );
  it("rejects an unverified provider response and cannot exceed eight send attempts", async () => {
    const { jobId } = await queuedEmail();
    await db.prepare("UPDATE worker_jobs SET status='RUNNING' WHERE id=?").bind(jobId).run();
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ success: true })));
    await expect(
      deliverDailyClosingEmail(
        { SERAMET_DB: db, ...emailConfiguration },
        actor.tenantId,
        jobId,
        transport,
      ),
    ).rejects.toThrow("TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED");
    await db.prepare("UPDATE worker_jobs SET attempt_count=9 WHERE id=?").bind(jobId).run();
    await expect(
      deliverDailyClosingEmail(
        { SERAMET_DB: db, ...emailConfiguration },
        actor.tenantId,
        jobId,
        transport,
      ),
    ).rejects.toThrow("TRANSACTIONAL_EMAIL_AUTHORIZED_JOB_REQUIRED");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("permits only one queued worker claim and provider send under concurrent consumers", async () => {
    const { jobId } = await queuedEmail();
    const send = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ messageId: `<${randomUUID()}@brevo.test>` })),
      );
    const env: SerametEnv = { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test", ...emailConfiguration };
    const message = () => ({
      id: randomUUID(),
      timestamp: new Date(),
      body: {
        kind: "worker-job" as const,
        tenantId: actor.tenantId,
        jobId,
        correlationId: randomUUID(),
      },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn(),
    });
    await Promise.all([
      handleWorkerQueue({ queue: "disposable", messages: [message()] }, env),
      handleWorkerQueue({ queue: "disposable", messages: [message()] }, env),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      await db.prepare("SELECT status FROM worker_jobs WHERE id=?").bind(jobId).first("status"),
    ).toBe("SUCCEEDED");
    expect(
      await db
        .prepare(
          "SELECT COUNT(*) AS count FROM audit_events WHERE action='CLOSING_EMAIL_PROVIDER_ACCEPTED'",
        )
        .first("count"),
    ).toBe(1);
  });
  it("records one durable job in the close transaction and never duplicates it on confirmation replay", async () => {
    const { request } = await queuedEmail();
    await command("closeBusinessDay", request, "email-close");
    await command("closeBusinessDay", request, "another-confirmation");
    expect(
      await db
        .prepare("SELECT COUNT(*) AS count FROM worker_jobs WHERE job_type='DAILY_CLOSING_EMAIL'")
        .first("count"),
    ).toBe(1);
    expect((await repo.loadState(actor.tenantId)).paymentOperations!.dayCloses[0]!.status).toBe(
      "CLOSED",
    );
  });
  it("does not leave a notification behind when financial closing rolls back", async () => {
    await command("configureDailyClosing", {
      branchId: actor.branchId,
      mode: "SUPERVISOR_DAILY_CLOSE",
      materialVarianceMinor: 50000,
      recipientUserIds: [actor.id],
    });
    const initial = await opened();
    await db.exec(
      "CREATE TRIGGER reject_test_email BEFORE INSERT ON worker_jobs WHEN NEW.job_type='DAILY_CLOSING_EMAIL' BEGIN SELECT RAISE(ABORT, 'Injected durable enqueue failure'); END;",
    );
    await expect(
      command("closeBusinessDay", payload(initial.state.paymentOperations!.drawerSessions[0]!.id)),
    ).rejects.toThrow();
    expect(await repo.loadState(actor.tenantId)).toEqual(initial.state);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM worker_jobs").first("count")).toBe(0);
  });
  it("retains uncertain Brevo evidence without automatically replaying the report", async () => {
    const { jobId } = await queuedEmail();
    await db.prepare("UPDATE worker_jobs SET status='RUNNING' WHERE id=?").bind(jobId).run();
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("Private provider details must not be logged"))
      .mockResolvedValue(
        new Response(JSON.stringify({ messageId: `<${randomUUID()}@brevo.test>` })),
      );
    const env = { SERAMET_DB: db, ...emailConfiguration };
    await expect(deliverDailyClosingEmail(env, actor.tenantId, jobId, transport)).rejects.toThrow(
      "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED",
    );
    await expect(deliverDailyClosingEmail(env, actor.tenantId, jobId, transport)).rejects.toThrow(
      "TRANSACTIONAL_EMAIL_DELIVERY_RECONCILIATION_REQUIRED",
    );
    expect(transport).toHaveBeenCalledTimes(1);
    const evidence = await db
      .prepare("SELECT result_json FROM worker_jobs WHERE id=?")
      .bind(jobId)
      .first<{ result_json: string }>();
    expect(JSON.parse(evidence!.result_json)).toMatchObject({
      email: { provider: "BREVO", outcome: "UNKNOWN" },
    });
  });
  it("rejects revoked recipient authorization without contacting the provider", async () => {
    const { jobId } = await queuedEmail();
    await db.prepare("UPDATE worker_jobs SET status='RUNNING' WHERE id=?").bind(jobId).run();
    await db
      .prepare("DELETE FROM user_branches WHERE tenant_id=? AND user_id=?")
      .bind(actor.tenantId, actor.id)
      .run();
    const transport = vi.fn<typeof fetch>();
    await expect(
      deliverDailyClosingEmail(
        { SERAMET_DB: db, ...emailConfiguration },
        actor.tenantId,
        jobId,
        transport,
      ),
    ).rejects.toThrow("CLOSING_EMAIL_RECIPIENT_NOT_AUTHORIZED");
    expect(transport).not.toHaveBeenCalled();
  });
  it("requires reconciliation for legacy prepared Resend evidence instead of switching providers", async () => {
    const { jobId } = await queuedEmail();
    await db.prepare("UPDATE worker_jobs SET status='RUNNING' WHERE id=?").bind(jobId).run();
    const transport = vi.fn<typeof fetch>();
    const env = { SERAMET_DB: db, ...emailConfiguration };
    const row = await db
      .prepare("SELECT result_json FROM worker_jobs WHERE id=?")
      .bind(jobId)
      .first<{ result_json: string }>();
    const result = JSON.parse(row!.result_json);
    result.prepared = { preparedAt: new Date(Date.now() - 24 * 3600000).toISOString() };
    await db
      .prepare("UPDATE worker_jobs SET result_json=? WHERE id=?")
      .bind(JSON.stringify(result), jobId)
      .run();
    await expect(deliverDailyClosingEmail(env, actor.tenantId, jobId, transport)).rejects.toThrow(
      "TRANSACTIONAL_EMAIL_LEGACY_SEND_RECONCILIATION_REQUIRED",
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses existing queue backoff and attempt limits without reopening a closed day", async () => {
    const { jobId } = await queuedEmail();
    const env: SerametEnv = { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test" };
    const ack = vi.fn(),
      retry = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const message = {
      id: randomUUID(),
      timestamp: new Date(),
      body: {
        kind: "worker-job" as const,
        tenantId: actor.tenantId,
        jobId,
        correlationId: randomUUID(),
      },
      attempts: 1,
      ack,
      retry,
    };
    await handleWorkerQueue({ queue: "disposable", messages: [message] }, env);
    expect(retry).toHaveBeenCalled();
    expect(
      await db.prepare("SELECT status FROM worker_jobs WHERE id=?").bind(jobId).first("status"),
    ).toBe("RETRY_PENDING");
    await db
      .prepare("UPDATE worker_jobs SET attempt_count=7,scheduled_at=? WHERE id=?")
      .bind(new Date(Date.now() - 1000).toISOString(), jobId)
      .run();
    await handleWorkerQueue({ queue: "disposable", messages: [message] }, env);
    expect(
      await db.prepare("SELECT status FROM worker_jobs WHERE id=?").bind(jobId).first("status"),
    ).toBe("DEAD_LETTER");
    expect(ack).toHaveBeenCalled();
    expect((await repo.loadState(actor.tenantId)).paymentOperations!.dayCloses[0]!.status).toBe(
      "CLOSED",
    );
  });
});
async function command(
  action: string,
  payload: unknown,
  key: string = randomUUID(),
  expectedRevision?: number,
) {
  return repo.commitMutation({
    actor,
    action,
    payload,
    idempotencyKey: key,
    requestHash: JSON.stringify(payload),
    correlationId: key,
    expectedRevision,
  });
}
async function opened() {
  return command("openPaymentDrawer", {
    input: {
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      employeeId: actor.id,
      currency: "KES",
      openingFloatMinor: 10000,
      actor: actor.id,
    },
  });
}
function payload(drawerSessionId: string) {
  return {
    businessDate,
    confirmed: true,
    drawerCounts: [{ drawerSessionId, countedByCurrency: { KES: 10000 } }],
  };
}
describe("authoritative combined closing persistence", () => {
  it("commits drawer and day together, with one winner and no loser audit or event", async () => {
    const initial = await opened();
    const request = payload(initial.state.paymentOperations!.drawerSessions[0]!.id);
    const race = await Promise.allSettled([
      command("closeBusinessDay", request, "close-a", initial.revision),
      command("closeBusinessDay", request, "close-b", initial.revision),
    ]);
    expect(race.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((r) => r.status === "rejected")).toHaveLength(1);
    const stored = await repo.loadState(actor.tenantId);
    expect(stored.paymentOperations!.drawerSessions[0]!.status).toBe("CLOSED");
    expect(stored.paymentOperations!.dayCloses[0]!.snapshots).toHaveLength(1);
    for (const table of ["mutation_commits", "realtime_events", "audit_events"]) {
      expect(
        await db
          .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id=?`)
          .bind(actor.tenantId)
          .first("count"),
      ).toBe(2);
    }
    const winner = race[0]!.status === "fulfilled" ? "close-a" : "close-b";
    expect((await command("closeBusinessDay", request, winner)).duplicate).toBe(true);
    await expect(
      command("closeBusinessDay", { ...request, confirmed: false }, winner),
    ).rejects.toThrow(/different request/);
    await expect(opened()).rejects.toThrow(/closed/);
  });
  it("rolls back all drawer, day, snapshot, audit and event writes on database failure", async () => {
    const initial = await opened();
    await db.exec(
      "CREATE TRIGGER reject_test_close BEFORE INSERT ON day_closes BEGIN SELECT RAISE(ABORT, 'Injected close failure'); END;",
    );
    await expect(
      command("closeBusinessDay", payload(initial.state.paymentOperations!.drawerSessions[0]!.id)),
    ).rejects.toThrow();
    expect(await repo.loadState(actor.tenantId)).toEqual(initial.state);
    expect(await repo.revision(actor.tenantId)).toBe(initial.revision);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM day_closes").first("count")).toBe(0);
  });
  it("persists and reconstructs branch policy without changing existing schema", async () => {
    await command("configureDailyClosing", {
      branchId: actor.branchId,
      mode: "MULTI_CASHIER_SHIFTS",
      materialVarianceMinor: 1000,
      recipientUserIds: [],
    });
    expect((await repo.loadState(actor.tenantId)).paymentOperations!.closingPolicies).toMatchObject(
      [{ branchId: actor.branchId, mode: "MULTI_CASHIER_SHIFTS" }],
    );
  });
});
