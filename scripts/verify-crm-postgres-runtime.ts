// A production-path CRM service probe against a disposable PostgreSQL CI service.
// Environment restriction prevents accidental runs against a deployed restaurant.
import assert from "node:assert/strict";
import { CampaignService } from "@/crm/campaign-service";
import { CrmLeadService } from "@/crm/crm-lead-service";
import { OnboardingService } from "@/onboarding/onboarding-service";
import type { ServerActor } from "@/lib/seramet-auth";
import { permissions } from "@/platform/permissions";
import { PostgresD1Database } from "@/server/database/postgres-database";

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
      permissions.setupView,
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
  const catalog = new OnboardingService(db, actor, { SERAMET_DB: db });
  assert.deepEqual(await catalog.listMenuCatalog(seeded.id), []);
  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO menu_catalog_items
        (tenant_id,id,code,name,category_code,selling_price_minor,currency,created_at,updated_at)
       VALUES (?,?,?,'CI Menu item','CI_TEST',25000,'KES',?,?)`,
    )
    .bind(seeded.tenant_id, itemId, "CI-" + itemId, now, now)
    .run();
  assert.deepEqual(await catalog.listMenuCatalog(seeded.id), []);
  await db
    .prepare(
      `INSERT INTO menu_item_branch_settings
        (tenant_id,branch_id,menu_item_id,available,updated_at)
       VALUES (?,?,?,1,?)`,
    )
    .bind(seeded.tenant_id, seeded.id, itemId, now)
    .run();
  const activated = await catalog.listMenuCatalog(seeded.id);
  assert.equal(activated.length, 1);
  assert.equal(activated[0].name, "CI Menu item");
  assert.equal(activated[0].branch_activated, 1);
  const master = await catalog.listMenuCatalog();
  assert.equal(master.length, 1);

  const campaignRows = await new CampaignService(db, actor).listCampaigns(seeded.id);
  assert.deepEqual(campaignRows, []);
  console.log("Authoritative CRM pipeline read/write and scoped campaign SQL on PostgreSQL: PASS");
} finally {
  await db.close();
}
