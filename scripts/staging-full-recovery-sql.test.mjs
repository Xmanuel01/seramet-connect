import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fullTableEvidence, fullSecurityEvidence } from "./staging-full-recovery-core.mjs";

test("full recovery compares contents, PUBLIC policies, ACLs and sequence state, not just counts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE auth.users(id text PRIMARY KEY, encrypted_password text);
      INSERT INTO auth.users VALUES('synthetic','synthetic-hash-only');
      CREATE TABLE storage.objects(id text);
      CREATE TABLE public.entries(id bigserial PRIMARY KEY, value integer);
      INSERT INTO public.entries(value) VALUES(10);
      ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
      CREATE POLICY never_public ON public.entries TO PUBLIC USING(false);
      GRANT SELECT ON public.entries TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO service_role;
      CREATE FUNCTION public.fixture() RETURNS integer LANGUAGE sql AS 'SELECT 1';
    `);
    const rows = await fullTableEvidence(db);
    const security = await fullSecurityEvidence(db);
    assert.deepEqual(security.policies[0].roles, ["PUBLIC"]);
    assert.ok(security.defaults.length);
    assert.ok(security.acl.some((r) => r.acl.some((a) => a.includes("service_role|SELECT"))));
    assert.ok(security.sequences.length);
    assert.ok(security.routines.length);
    await db.exec("UPDATE public.entries SET value=11");
    const changed = await fullTableEvidence(db);
    assert.equal(changed.length, rows.length);
    const before = rows.find((t) => t.table === "entries");
    const after = changed.find((t) => t.table === "entries");
    assert.equal(before.rows, after.rows);
    assert.notEqual(before.digest, after.digest);
  } finally {
    await db.close();
  }
});
