import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  db.close();
  setConfigurationRepositoryForTests();
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
