// Executed ONLY against disposable PostgreSQL CI service after migrations.
// Never connects to a staging or production database.
import assert from "node:assert/strict";
import type { ServerActor } from "@/lib/seramet-auth";
import { PostgresD1Database } from "@/server/database/postgres-database";
import { D1AuthoritativeTransactionRepository } from "@/server/database/authoritative-transaction-repository";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import { KITCHEN_OUTBOX_ENTITY } from "@/server/kitchen-print-outbox";
import { permissions } from "@/platform/permissions";

const connection = process.env.SERAMET_POSTGRES_URL;
const target = connection ? new URL(connection) : null;
if (
  process.env.CI !== "true" ||
  !target ||
  target.hostname !== "127.0.0.1" ||
  target.port !== "5432" ||
  target.username !== "seramet_test" ||
  target.pathname !== "/seramet_test"
) {
  throw new Error("Kitchen print outbox probe requires isolated CI PostgreSQL");
}
const db = PostgresD1Database.fromHyperdrive({ connectionString: connection! });
try {
  const branch = await db
    .prepare("SELECT tenant_id,id,name FROM branches WHERE code='CI' ORDER BY id LIMIT 1")
    .first<{ tenant_id: string; id: string; name: string }>();
  assert.ok(branch, "The isolated PostgreSQL fixture must seed the CI tenant");
  await hydrateAuthoritativeConfiguration(db, { SERAMET_DB: db }, true);
  const actor: ServerActor = {
    id: "ci-kot-actor",
    name: "Isolated CI Printer",
    tenantId: branch.tenant_id,
    roleIds: ["ci-role"],
    permissions: [permissions.ordersUpdate, permissions.kitchenOperate],
    assignedBranchIds: [branch.id],
    assignedBranches: [{ id: branch.id, name: branch.name }],
    branchScope: { type: "BRANCH", branchId: branch.id },
    branchId: branch.id,
    role: "Manager",
    branch: branch.name,
  };
  const repository = new D1AuthoritativeTransactionRepository(db);
  const key = "ci-kot-" + crypto.randomUUID();
  const command = {
    actor,
    action: "upsertAndSendKitchen",
    payload: {
      draft: {
        tenantId: branch.tenant_id,
        branchId: branch.id,
        branch: branch.name,
        customer: "Isolated PostgreSQL KOT",
        channel: "DINE_IN",
        cashier: actor.name,
        lines: [{
          id: "ci-line-" + key,
          name: "CI Test Dish",
          category: "Main",
          quantity: 1,
          unitPrice: 1200,
          productionStation: "MAIN KITCHEN",
        }],
      },
    },
    idempotencyKey: key,
    requestHash: key,
    correlationId: key,
    deviceId: "ci-device",
  };
  const accepted = await repository.commitMutation(command);
  const ticket = await db
    .prepare(
      "SELECT entity_id,status,payload_json,version FROM authoritative_records WHERE tenant_id=? AND entity_type=?",
    )
    .bind(branch.tenant_id, KITCHEN_OUTBOX_ENTITY)
    .first<{ entity_id: string; status: string; payload_json: string; version: number }>();
  assert.ok(ticket, "Kitchen accepted but transactional KOT obligation was missing");
  assert.equal(ticket.status, "QUEUED");
  const payload = JSON.parse(ticket.payload_json) as {
    orderId: string;
    amendmentType: string;
    snapshot: { lines: unknown[] };
  };
  assert.equal(payload.orderId, accepted.state.orders[0]!.id);
  assert.equal(payload.amendmentType, "NEW");
  assert.equal(payload.snapshot.lines.length, 1);
  assert.equal((await repository.commitMutation(command)).duplicate, true);

  const claim = () =>
    db
      .prepare(
        `UPDATE authoritative_records SET status='CLAIMED',version=version+1
         WHERE tenant_id=? AND entity_type=? AND entity_id=? AND status='QUEUED' AND version=?`,
      )
      .bind(branch.tenant_id, KITCHEN_OUTBOX_ENTITY, ticket.entity_id, ticket.version)
      .run();
  const [first, second] = await Promise.all([claim(), claim()]);
  assert.equal(
    (first.meta?.changes ?? 0) + (second.meta?.changes ?? 0),
    1,
    "Exactly one PostgreSQL device claim must win",
  );
  console.log("PostgreSQL atomic original KOT, repeat submission and exclusive CAS: PASS");
} finally {
  await db.close();
}
