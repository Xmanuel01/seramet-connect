// CI-only integration probe: uses an isolated disposable PostgreSQL service.
// Never point this script at a real tenant or deployed database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = process.env.SERAMET_POSTGRES_URL;
if (!url || !url.includes("seramet_test@127.0.0.1:5432/seramet_test")) {
  throw new Error("CRM PostgreSQL smoke test requires the isolated CI database");
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const migrations = await client.query("SELECT MAX(version) AS version FROM schema_migrations");
  assert.equal(Number(migrations.rows[0].version), 26, "All 26 migrations must apply");
  const json = await client.query(
    "SELECT value FROM json_each($1::text) WHERE value=$2::text",
    [JSON.stringify(["westlands", "ngong"]), "ngong"],
  );
  assert.deepEqual(json.rows, [{ value: "ngong" }], "CRM JSON scope iterator must work");

  const schema = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('crm_leads','crm_lead_events')",
  );
  assert.equal(schema.rows.length, 2, "Both CRM pipeline tables must exist");

  const tenantId = "ci-tenant-" + randomUUID();
  const branchId = "ci-branch-" + randomUUID();
  const leadId = randomUUID();
  const eventId = randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO tenants
      (id,slug,legal_name,trading_name,default_currency,timezone,locale,active,payload_json,created_at,updated_at)
     VALUES ($1,$2,'CI Restaurant','CI Restaurant','KES','Africa/Nairobi','en-KE',1,'{}',$3,$3)`,
    [tenantId, tenantId, now],
  );
  await client.query(
    `INSERT INTO branches
      (tenant_id,id,code,name,timezone,business_day_cutoff_minutes,active,payload_json)
     VALUES ($1,$2,'CI','CI Branch','Africa/Nairobi',240,1,'{}')`,
    [tenantId, branchId],
  );
  await client.query(
    `INSERT INTO crm_leads
      (tenant_id,id,branch_id,contact_name,source,owner_actor_id,owner_display_name,
       estimated_value_minor,currency,stage,version,request_key,create_payload_json,
       last_mutation_key,created_at,updated_at)
     VALUES ($1,$2,$3,'Isolated CI test','CI','test-actor','CI Actor',
       125000,'KES','NEW',1,$4,'{}',$4,$5,$5)`,
    [tenantId, leadId, branchId, randomUUID(), now],
  );
  await client.query(
    `INSERT INTO crm_lead_events
      (tenant_id,id,lead_id,request_key,request_payload_json,from_stage,to_stage,
       action_by,created_at)
     VALUES ($1,$2,$3,'initial','{}',NULL,'NEW','test-actor',$4)`,
    [tenantId, eventId, leadId, now],
  );
  await assert.rejects(
    client.query("DELETE FROM crm_lead_events WHERE tenant_id=$1 AND id=$2", [tenantId, eventId]),
    /immutable/i,
  );
  const remaining = await client.query(
    "SELECT COUNT(*)::int AS count FROM crm_lead_events WHERE tenant_id=$1 AND id=$2",
    [tenantId, eventId],
  );
  assert.equal(remaining.rows[0].count, 1);
  console.log("PostgreSQL CRM schema, JSON scopes and immutable pipeline events: PASS");
} finally {
  await client.end();
}
