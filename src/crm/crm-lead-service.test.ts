import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION } from "@/server/database/schema-version";
import { CrmLeadService } from "@/crm/crm-lead-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import {
  createMigratedTestDatabase,
  type SqliteD1TestDatabase,
} from "@/server/database/sqlite-test-adapter";

const tenantId = "tenant-demo-mona";
const branchId = "branch-demo-westlands";
const otherBranch = "branch-demo-ngong-road";

function actor(branch = branchId, restricted = false): ServerActor {
  return {
    id: "lead-test-staff",
    name: "Lead test staff",
    tenantId,
    roleIds: ["manager"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: restricted ? [branch] : [branchId, otherBranch],
    assignedBranches: (restricted ? [branch] : [branchId, otherBranch]).map((id) => ({
      id,
      name: id,
    })),
    branchScope: restricted ? { type: "BRANCH", branchId: branch } : { type: "ALL" },
    branchId: branch,
    branch,
    role: "Manager",
  };
}

describe("CRM lead pipeline real workflow", () => {
  let db: SqliteD1TestDatabase;
  let service: CrmLeadService;

  beforeEach(() => {
    db = createMigratedTestDatabase();
    for (const file of [
      "demo.sql",
      "pass7-demo.sql",
      "pass8-demo.sql",
      "pass9-demo.sql",
      "pass10-demo.sql",
    ]) {
      db.sqlite.exec(readFileSync(resolve(process.cwd(), "migrations", "seed", file), "utf8"));
    }
    service = new CrmLeadService(db, actor());
  });

  afterEach(() => db.close());

  const input = {
    branchId,
    contactName: "Corporate catering inquiry",
    companyName: "Corporate Client",
    source: "REFERRAL",
    estimatedValueMinor: 400_000,
    nextAction: "Arrange tasting",
    requestKey: "crm-lead-test-1",
  };

  it("migrates independently with immutable tenant and branch-scoped lead events", () => {
    expect(db.sqlite.prepare("SELECT MAX(version) version FROM schema_migrations").get()).toEqual({
      version: CURRENT_SCHEMA_VERSION,
    });
    const tables = db.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('crm_leads','crm_lead_events')",
      )
      .all();
    expect(tables).toHaveLength(2);
  });

  it("follows real outreach to a recorded agreement, without inventing paid revenue", async () => {
    const created = await service.create(input);
    expect(created.duplicate).toBe(false);
    const replay = await service.create(input);
    expect(replay).toMatchObject({ duplicate: true });
    expect(replay.lead.id).toBe(created.lead.id);
    expect((await service.list({ branchId })).leads).toHaveLength(1);

    const history = await service.history(created.lead.id);
    expect(history).toHaveLength(1);

    const contacted = await service.update(created.lead.id, {
      stage: "CONTACTED",
      expectedVersion: created.lead.version,
      requestKey: "lead-contacted",
      nextAction: "Schedule tasting",
    });
    expect(contacted.lead.stage).toBe("CONTACTED");
    await expect(
      service.update(created.lead.id, {
        stage: "CONTACTED",
        expectedVersion: created.lead.version,
        requestKey: "lead-contacted",
        nextAction: "Schedule tasting",
      }),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      service.update(created.lead.id, {
        stage: "CONTACTED",
        expectedVersion: created.lead.version,
        requestKey: "lead-contacted",
        nextAction: "Different payload using the same key",
      }),
    ).rejects.toThrow(/different change/);
    const qualified = await service.update(created.lead.id, {
      stage: "QUALIFIED",
      expectedVersion: contacted.lead.version,
      requestKey: "lead-qualified",
    });
    const proposal = await service.update(created.lead.id, {
      stage: "PROPOSAL",
      expectedVersion: qualified.lead.version,
      requestKey: "lead-proposal",
    });
    await expect(
      service.update(created.lead.id, {
        stage: "WON",
        expectedVersion: proposal.lead.version,
        requestKey: "lead-no-reason",
      }),
    ).rejects.toThrow(/closure reason/);
    const won = await service.update(created.lead.id, {
      stage: "WON",
      expectedVersion: proposal.lead.version,
      requestKey: "lead-won",
      reason: "Agreement signed",
    });
    expect(won.lead.stage).toBe("WON");
    expect((await service.create(input)).duplicate).toBe(true);
    await expect(
      service.update(created.lead.id, {
        stage: "LOST",
        expectedVersion: won.lead.version,
        requestKey: "lead-reopen",
        reason: "Cannot reopen closed lead",
      }),
    ).rejects.toThrow(/closed lead/);
    const events = await service.history(created.lead.id);
    expect(events).toHaveLength(5);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) count FROM customer_transaction_links WHERE source_id=?")
        .get(created.lead.id),
    ).toMatchObject({ count: 0 });
    expect(() => db.sqlite.prepare("DELETE FROM crm_lead_events").run()).toThrow(/immutable/);
  });

  it("rejects stale edits, invalid stage transitions and request-key payload conflicts", async () => {
    const created = await service.create(input);
    await expect(service.create({ ...input, estimatedValueMinor: 2_000 })).rejects.toThrow(
      /reused with different/,
    );
    await expect(
      service.update(created.lead.id, {
        stage: "WON",
        expectedVersion: created.lead.version,
        requestKey: "invalid-won",
        reason: "No agreement stages",
      }),
    ).rejects.toThrow(/Invalid pipeline/);
    await expect(
      service.update(created.lead.id, {
        stage: "CONTACTED",
        expectedVersion: 22,
        requestKey: "stale",
      }),
    ).rejects.toThrow(/changed/);
  });

  it("enforces branch and permission boundaries on query and mutations", async () => {
    const created = await service.create(input);
    const scoped = new CrmLeadService(db, actor(otherBranch, true));
    await expect(scoped.history(created.lead.id)).rejects.toThrow(/branch/);
    await expect(
      scoped.update(created.lead.id, {
        stage: "CONTACTED",
        expectedVersion: 1,
        requestKey: "cross-branch",
      }),
    ).rejects.toThrow(/branch/);
    expect((await scoped.list({ branchId: otherBranch })).leads).toHaveLength(0);
    await expect(scoped.list({ branchId })).rejects.toThrow(/branch/);
    await expect(
      scoped.create({
        ...input,
        branchId: otherBranch,
        customerId: "customer-demo-001",
        requestKey: "cross-branch-customer-link",
      }),
    ).rejects.toThrow(/unavailable to this branch/);
    const readOnly = new CrmLeadService(db, {
      ...actor(),
      permissions: [permissions.crmView],
    });
    await expect(readOnly.create({ ...input, requestKey: "not-authorized" })).rejects.toThrow(
      /permission/,
    );
    expect((await readOnly.list({ branchId })).leads).toHaveLength(1);
  });

  it("provides genuine branch summary and keyset pagination without contact PII", async () => {
    await service.create(input);
    await service.create({
      ...input,
      contactName: "Second lead",
      estimatedValueMinor: 100_000,
      requestKey: "second-lead",
    });
    const page = await service.list({ branchId, limit: 1 });
    expect(page.leads).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = await service.list({ branchId, limit: 1, cursor: page.nextCursor! });
    expect(next.leads).toHaveLength(1);
    expect(next.leads[0]!.id).not.toBe(page.leads[0]!.id);
    const summary = await service.summary(branchId);
    expect(summary.stages).toContainEqual({
      currency: "KES",
      stage: "NEW",
      lead_count: 2,
      estimated_value_minor: 500_000,
    });
    const restricted = new CrmLeadService(db, {
      ...actor(),
      permissions: [permissions.crmView],
    });
    expect((await restricted.list({ branchId })).leads[0]).not.toHaveProperty("contactPhone");
  });
});
