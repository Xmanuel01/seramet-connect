// A production-path CRM service probe against a disposable PostgreSQL CI service.
// Environment restriction prevents accidental runs against a deployed restaurant.
import assert from "node:assert/strict";
import { CampaignService } from "@/crm/campaign-service";
import { CrmLeadService } from "@/crm/crm-lead-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { PostgresD1Database } from "@/server/database/postgres-database";
import { handleAttendanceDelays } from "@/server/attendance-delay-api";
import { staffStationAccess } from "@/server/staff-station-access";
import { LoyaltyValueService } from "@/crm/loyalty-value-service";
import { handleWorkerQueue } from "@/server/workers";

const url = process.env.SERAMET_POSTGRES_URL;
const target = url ? new URL(url) : null;
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  target.username !== "seramet_test" ||
  target.pathname !== "/seramet_test"
) {
  throw new Error("Authoritative CRM probe requires disposable isolated CI PostgreSQL");
}
const db = PostgresD1Database.fromHyperdrive({ connectionString: url! });
try {
  const seeded = await db
    .prepare("SELECT tenant_id,id FROM branches WHERE code='CI' ORDER BY id LIMIT 1")
    .first<{ tenant_id: string; id: string }>();
  assert.ok(seeded, "Raw CRM schema verification must seed the isolated tenant first");
  const actor: ServerActor = {
    id: "ci-test-actor",
    name: "Isolated CI Operator",
    tenantId: seeded.tenant_id,
    roleIds: ["test-role"],
    permissions: [
      permissions.crmView,
      permissions.crmCustomerManage,
      permissions.crmCustomerContactView,
      permissions.campaignView,
    ],
    assignedBranchIds: [seeded.id],
    assignedBranches: [{ id: seeded.id, name: "CI Branch" }],
    branchScope: { type: "BRANCH", branchId: seeded.id },
    branchId: seeded.id,
    role: "Manager",
    branch: "CI Branch",
  };
  const service = new CrmLeadService(db, actor);
  const payload = {
    branchId: seeded.id,
    contactName: "Postgres CI opportunity",
    source: "CI_PROBE",
    estimatedValueMinor: 450000,
    requestKey: "ci-probe:" + crypto.randomUUID(),
  };
  const created = await service.create(payload);
  assert.equal(created.lead.stage, "NEW");
  assert.equal((await service.create(payload)).duplicate, true);
  assert.equal((await service.list({ branchId: seeded.id })).leads.length, 2);
  assert.equal((await service.summary(seeded.id)).overdueCount, 0);
  const contacted = await service.update(created.lead.id, {
    stage: "CONTACTED",
    expectedVersion: created.lead.version,
    requestKey: "ci-contacted:" + crypto.randomUUID(),
    nextAction: "Telephone follow-up",
  });
  assert.equal(contacted.lead.stage, "CONTACTED");
  assert.equal((await service.history(created.lead.id)).length, 2);
  const campaignRows = await new CampaignService(db, actor).listCampaigns(seeded.id);
  assert.deepEqual(campaignRows, []);
  console.log("Authoritative CRM pipeline read/write and scoped campaign SQL on PostgreSQL: PASS");
  await verifyAttendanceTransactions(seeded.tenant_id, seeded.id);
  await verifyStaffPilotTransactions(seeded.tenant_id, seeded.id);
  const expiryService = new LoyaltyValueService(db, {
    ...actor,
    permissions: [permissions.loyaltyManage, permissions.giftCardManage, permissions.voucherManage],
  });
  assert.deepEqual(await expiryService.expirePoints(), { expiredEntries: 0 });
  assert.deepEqual(await expiryService.expireStoredValue(), {
    expiredGiftCards: 0,
    expiredDefinitions: 0,
    expiredIssues: 0,
  });
  const jobId = crypto.randomUUID();
  const stamp = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO worker_jobs
     (tenant_id,id,job_type,payload_json,idempotency_key,correlation_id,status,scheduled_at,created_at,updated_at)
     VALUES (?,?,'INVENTORY_EXPIRY_ALERTS','{}',?,?,'PENDING',?,?,?)`,
    )
    .bind(seeded.tenant_id, jobId, jobId, jobId, stamp, stamp, stamp)
    .run();
  let acknowledged = 0;
  const message = {
    id: jobId,
    timestamp: new Date(stamp),
    body: { kind: "worker-job" as const, tenantId: seeded.tenant_id, jobId, correlationId: jobId },
    attempts: 1,
    ack: () => {
      acknowledged += 1;
    },
    retry: () => {
      assert.fail("Inventory expiry SQL must not fail on PostgreSQL");
    },
  };
  for (let delivery = 0; delivery < 2; delivery += 1) {
    await handleWorkerQueue(
      { queue: "disposable-expiry-query", messages: [message] },
      { SERAMET_DB: db, SERAMET_ENVIRONMENT: "test" },
    );
  }
  assert.equal(acknowledged, 2);
  assert.equal(
    await db
      .prepare("SELECT status FROM worker_jobs WHERE tenant_id=? AND id=?")
      .bind(seeded.tenant_id, jobId)
      .first("status"),
    "SUCCEEDED",
  );
  console.log("PostgreSQL expiry queries and terminal worker redelivery: PASS (empty ledgers)");
} finally {
  await db.close();
}

async function verifyStaffPilotTransactions(tenantId: string, branchId: string) {
  const second = PostgresD1Database.fromHyperdrive({ connectionString: url! });
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const stamp = new Date().toISOString();
  try {
    for (const id of ids) {
      await db
        .prepare("INSERT INTO users(tenant_id,id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
        .bind(tenantId, id, "Disposable staff certification", stamp, stamp)
        .run();
      await db
        .prepare("INSERT INTO user_branches(tenant_id,user_id,branch_id) VALUES(?,?,?)")
        .bind(tenantId, id, branchId)
        .run();
    }
    const actor = (id: string): ServerActor => ({
      id,
      name: "Disposable",
      tenantId,
      branchId,
      branch: "CI",
      authLevel: "FULL",
      role: "CI staff",
      roleIds: [],
      permissions: [
        permissions.attendanceUse,
        permissions.staffManage,
        permissions.usersManage,
        permissions.employeeCredentialsManage,
      ],
      assignedBranches: [{ id: branchId, name: "CI" }],
      assignedBranchIds: [branchId],
      branchScope: { type: "BRANCH", branchId },
    });
    const invoke = (
      database: PostgresD1Database,
      who: string,
      path: string,
      body: unknown,
      manage = false,
    ) =>
      handleAttendanceDelays(
        new Request("http://127.0.0.1/api/seramet/attendance/delays" + path, {
          method: "POST",
          body: JSON.stringify(body),
        }),
        actor(who),
        database,
        async (selected) => {
          assert.equal(selected, branchId);
          return {
            actor: actor(who),
            db: database,
            branch: { id: branchId, timezone: "Africa/Nairobi", business_day_cutoff_minutes: 240 },
          };
        },
        manage,
      );
    const request = {
      branchId,
      idempotencyKey: crypto.randomUUID(),
      expectedArrivalAt: new Date(Date.now() + 1800000).toISOString(),
      reason: "Disposable transport delay",
    };
    const submissions = await Promise.all([
      invoke(db, ids[0]!, "", request),
      invoke(second, ids[0]!, "", request),
    ]);
    const body = (await submissions[0]!.json()) as { id: string };
    const count = await db
      .prepare(
        "SELECT COUNT(*) count FROM attendance_delay_requests WHERE tenant_id=? AND user_id=?",
      )
      .bind(tenantId, ids[0])
      .first<{ count: string }>();
    assert.equal(Number(count?.count), 1);
    const decision = (status: string) => ({
      branchId,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      status,
      note: "Disposable supervisor decision",
    });
    const results = await Promise.allSettled([
      invoke(db, ids[1]!, `/${body.id}/decision`, decision("APPROVED"), true),
      invoke(second, ids[2]!, `/${body.id}/decision`, decision("REJECTED"), true),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const history = await db
      .prepare(
        "SELECT COUNT(*) count FROM attendance_delay_events WHERE tenant_id=? AND request_id=?",
      )
      .bind(tenantId, body.id)
      .first<{ count: string }>();
    assert.equal(Number(history?.count), 2);
    const station = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO stations(tenant_id,id,branch_id,code,name,station_type,active,payload_json) VALUES(?,?,?,?,?,'KITCHEN',1,'{}')",
      )
      .bind(tenantId, station, branchId, station, "Disposable station")
      .run();
    const stationRequest = () =>
      new Request("http://127.0.0.1/api", {
        method: "PUT",
        body: JSON.stringify({ branchId, stationIds: [station], expectedVersion: 0 }),
      });
    const assignments = await Promise.allSettled([
      staffStationAccess(stationRequest(), { SERAMET_DB: db }, actor(ids[1]!), ids[0]!),
      staffStationAccess(stationRequest(), { SERAMET_DB: second }, actor(ids[2]!), ids[0]!),
    ]);
    assert.equal(assignments.filter((r) => r.status === "fulfilled").length, 1);
    const audit = await db
      .prepare(
        "SELECT COUNT(*) count FROM staff_access_events WHERE tenant_id=? AND entity_type='STATION_ACCESS'",
      )
      .bind(tenantId)
      .first<{ count: string }>();
    assert.equal(Number(audit?.count), 1);
    const rls = await db
      .prepare(
        "SELECT COUNT(*) count FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('attendance_delay_requests','attendance_delay_events','attendance_delay_reads','employee_account_invitations','employee_station_access','staff_access_events') AND relrowsecurity=true",
      )
      .first<{ count: string }>();
    assert.equal(Number(rls?.count), 6);
    console.log(
      "PostgreSQL staff pilot: duplicate delay submission, one decision winner, station CAS/audit and six-table RLS: PASS",
    );
  } finally {
    await second.close();
  }
}

async function verifyAttendanceTransactions(tenantId: string, branchId: string) {
  const second = PostgresD1Database.fromHyperdrive({ connectionString: url! });
  const userId = crypto.randomUUID();
  const stamp = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO users(tenant_id,id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
      .bind(tenantId, userId, "Disposable attendance operator", stamp, stamp)
      .run();
    const create = (database: PostgresD1Database, date: string) => {
      const sessionId = crypto.randomUUID();
      const requestKey = crypto.randomUUID();
      return database.batch([
        database
          .prepare(
            "INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_in_key,clock_in_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'SUPERVISOR',?,?)",
          )
          .bind(tenantId, sessionId, userId, branchId, date, stamp, requestKey, stamp, stamp),
        database
          .prepare(
            "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at) VALUES(?,?,?,?,'SUPERVISOR_CLOCK_IN',?,'disposable-request',1,'Disposable concurrency verification',?)",
          )
          .bind(tenantId, crypto.randomUUID(), sessionId, userId, requestKey, stamp),
      ]);
    };
    // Different business dates must not permit two simultaneous open sessions.
    const created = await Promise.allSettled([
      create(db, "2026-10-16"),
      create(second, "2026-10-17"),
    ]);
    assert.equal(created.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const createFailure = created.find((outcome) => outcome.status === "rejected");
    assert.ok(createFailure?.status === "rejected" && createFailure.reason.code === "23505");
    const session = await db
      .prepare(
        "SELECT id,version FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=?",
      )
      .bind(tenantId, userId)
      .first<{ id: string; version: number }>();
    assert.ok(session);
    const correct = (database: PostgresD1Database) =>
      database.batch([
        database
          .prepare(
            "UPDATE employee_attendance_sessions SET version=version+1 WHERE tenant_id=? AND id=? AND version=?",
          )
          .bind(tenantId, session.id, session.version),
        database
          .prepare(
            "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at) SELECT ?,?,?,?,'CORRECT_IN',?,'disposable-correction',version,?,? FROM employee_attendance_sessions WHERE tenant_id=? AND id=? AND version=?",
          )
          .bind(
            tenantId,
            crypto.randomUUID(),
            session.id,
            userId,
            crypto.randomUUID(),
            "Disposable correction race",
            stamp,
            tenantId,
            session.id,
            session.version + 1,
          ),
      ]);
    const corrected = await Promise.allSettled([correct(db), correct(second)]);
    assert.equal(corrected.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const correctionFailure = corrected.find((outcome) => outcome.status === "rejected");
    assert.ok(
      correctionFailure?.status === "rejected" && correctionFailure.reason.code === "23505",
    );
    const counts = await db
      .prepare(
        "SELECT COUNT(*) count FROM employee_attendance_events WHERE tenant_id=? AND actor_id=?",
      )
      .bind(tenantId, userId)
      .first<{ count: number }>();
    assert.equal(
      Number(counts?.count),
      2,
      "Losing transactions must leave no orphan audit entries",
    );
    const final = await db
      .prepare(
        "SELECT COUNT(*) count,MAX(version) version FROM employee_attendance_sessions WHERE tenant_id=? AND user_id=?",
      )
      .bind(tenantId, userId)
      .first<{ count: number; version: number }>();
    assert.equal(Number(final?.count), 1);
    assert.equal(final?.version, 2);
    const otherSession = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO employee_attendance_sessions(tenant_id,id,user_id,branch_id,business_date,clock_in_at,clock_out_at,clock_in_key,clock_in_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'SUPERVISOR',?,?)",
      )
      .bind(
        tenantId,
        otherSession,
        userId,
        branchId,
        "2026-10-16",
        "2026-10-16T05:00:00Z",
        "2026-10-16T08:00:00Z",
        crypto.randomUUID(),
        stamp,
        stamp,
      )
      .run();
    await db
      .prepare("INSERT INTO attendance_employee_versions(tenant_id,user_id,version) VALUES(?,?,0)")
      .bind(tenantId, userId)
      .run();
    const guarded = (
      database: PostgresD1Database,
      id: string,
      version: number,
      includeEvent = true,
    ) => {
      const eventId = crypto.randomUUID();
      return database.batch([
        database
          .prepare(
            "UPDATE attendance_employee_versions SET version=version+1 WHERE tenant_id=? AND user_id=? AND version=0",
          )
          .bind(tenantId, userId),
        database
          .prepare(
            "INSERT INTO attendance_mutation_claims(tenant_id,user_id,version,event_id) VALUES(?,?,1,?)",
          )
          .bind(tenantId, userId, eventId),
        database
          .prepare(
            "UPDATE employee_attendance_sessions SET version=version+1 WHERE tenant_id=? AND id=? AND version=?",
          )
          .bind(tenantId, id, version),
        ...(includeEvent
          ? [
              database
                .prepare(
                  "INSERT INTO employee_attendance_events(tenant_id,id,session_id,actor_id,event_type,request_key,request_hash,session_version,reason,at) VALUES(?,?,?,?,'EXPLAIN',?,'guarded-probe',?,'Disposable split-shift serialization',?)",
                )
                .bind(tenantId, eventId, id, userId, crypto.randomUUID(), version + 1, stamp),
            ]
          : []),
      ]);
    };
    // An obligation without its immutable event cannot commit, including after a crash.
    await assert.rejects(
      guarded(db, otherSession, 1, false),
      (error: { code?: string }) => error.code === "23503",
    );
    const employeeRevision = await db
      .prepare("SELECT version FROM attendance_employee_versions WHERE tenant_id=? AND user_id=?")
      .bind(tenantId, userId)
      .first<{ version: number }>();
    assert.equal(employeeRevision?.version, 0);
    const guardedResults = await Promise.allSettled([
      guarded(db, session.id, 2),
      guarded(second, otherSession, 1),
    ]);
    assert.equal(guardedResults.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const claims = await db
      .prepare(
        "SELECT COUNT(*) count FROM attendance_mutation_claims WHERE tenant_id=? AND user_id=?",
      )
      .bind(tenantId, userId)
      .first<{ count: number }>();
    assert.equal(
      Number(claims?.count),
      1,
      "Split-session mutations serialize per employee without orphan claims",
    );
    const rls = await db
      .prepare(
        "SELECT COUNT(*) count FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('attendance_geofences','attendance_shift_assignments','employee_attendance_sessions','employee_attendance_events','attendance_management_events','attendance_employee_versions','attendance_mutation_claims','attendance_access_events') AND relrowsecurity=true",
      )
      .first<{ count: number }>();
    assert.equal(Number(rls?.count), 8, "Every attendance table must enable PostgreSQL RLS");
    console.log(
      "PostgreSQL attendance: two-connection open-session/correction/split-session races, deferred audit rollback and eight-table RLS: PASS",
    );
  } finally {
    await second.close();
  }
}
