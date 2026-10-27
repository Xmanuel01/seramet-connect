import { createHash } from "node:crypto";
import { stagingTlsConfig } from "./staging-postgres-tls.mjs";

export const fullRecoveryProject = "vnymbavsbxorwxpebkot";
export const fullRecoverySchemas = ["auth", "public", "storage"];
export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const ident = (value) => {
  if (typeof value !== "string" || !value || value.includes("\0") || Buffer.byteLength(value) > 63)
    throw new Error("RECOVERY_IDENTIFIER_INVALID");
  return '"' + value.replaceAll('"', '""') + '"';
};
export function authorizeFullRecovery(env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REPOSITORY !== "Xmanuel01/seramet-connect" ||
    env.GITHUB_ACTOR !== "Xmanuel01" ||
    env.GITHUB_TRIGGERING_ACTOR !== "Xmanuel01" ||
    env.GITHUB_REF !== "refs/heads/codex/phase3-completion" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    env.SERAMET_PHASE3_RECOVERY_APPROVED_SHA !== env.GITHUB_SHA ||
    env.SERAMET_PHASE3_FULL_RECOVERY_ACK !== "true" ||
    env.SERAMET_STAGING_BACKUP_KEY_ESCROW_VERIFIED !== "true"
  ) {
    throw new Error("STAGING_FULL_RECOVERY_OWNER_APPROVAL_REQUIRED");
  }
}
export function fullRecoverySource(raw) {
  const url = new URL(raw);
  const direct =
    url.hostname === `db.${fullRecoveryProject}.supabase.co` && url.username === "postgres";
  const pooled =
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.username === `postgres.${fullRecoveryProject}`;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!direct && !pooled) ||
    url.pathname !== "/postgres" ||
    (url.port && url.port !== "5432") ||
    !url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((k) => !["sslmode", "ssl"].includes(k))
  )
    throw new Error("STAGING_FULL_RECOVERY_SOURCE_REFUSED");
  return {
    ...stagingTlsConfig(raw),
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 10000,
  };
}
export function fullRecoveryRestore(raw) {
  const url = new URL(raw);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "54329" ||
    url.username !== "postgres" ||
    url.pathname !== "/seramet_full_restore" ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error("ISOLATED_FULL_RESTORE_REQUIRED");
  return { connectionString: raw, connectionTimeoutMillis: 10000 };
}
export async function fullTableEvidence(db) {
  await db.query("SET timezone='UTC'");
  const inventory = await db.query(
    "SELECT schemaname,tablename FROM pg_tables WHERE schemaname=ANY($1::text[]) ORDER BY schemaname,tablename",
    [fullRecoverySchemas],
  );
  const tables = [];
  for (const { schemaname, tablename } of inventory.rows) {
    const result = await db.query(
      `SELECT count(*)::text AS rows,encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') AS digest FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM ${ident(schemaname)}.${ident(tablename)} t) hashes`,
    );
    tables.push({ schema: schemaname, table: tablename, ...result.rows[0] });
  }
  return tables;
}
export async function fullSecurityEvidence(db) {
  const acl = (value, kind, owner) =>
    `ARRAY(SELECT pg_get_userbyid(a.grantor)||'|'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||'|'||a.privilege_type||'|'||a.is_grantable::text FROM aclexplode(COALESCE(${value},acldefault(${kind},${owner}))) a ORDER BY 1)`;
  const policies = await db.query(
    "SELECT n.nspname AS schema,c.relname AS table,p.polname,p.polpermissive,p.polcmd,ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r ORDER BY 1) AS roles,pg_get_expr(p.polqual,p.polrelid) AS using_expr,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expr FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY 1,2,3",
    [fullRecoverySchemas],
  );
  const relations = await db.query(
    `SELECT n.nspname AS schema,c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,${acl("c.relacl", "CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END", "c.relowner")} AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN('r','S','v','m') ORDER BY 1,2`,
    [fullRecoverySchemas],
  );
  const schemas = await db.query(
    `SELECT nspname,pg_get_userbyid(nspowner) AS owner,${acl("nspacl", "'n'::\"char\"", "nspowner")} AS acl FROM pg_namespace WHERE nspname=ANY($1::text[]) ORDER BY nspname`,
    [fullRecoverySchemas],
  );
  const defaults = await db.query(
    `SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,d.defaclobjtype,${acl("d.defaclacl", "CASE WHEN d.defaclobjtype='S' THEN 's'::\"char\" ELSE d.defaclobjtype END", "d.defaclrole")} AS acl FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname=ANY($1::text[]) ORDER BY 1,2,3`,
    [fullRecoverySchemas],
  );
  const routines = await db.query(
    `SELECT n.nspname AS schema,p.proname,pg_get_function_identity_arguments(p.oid) AS signature,pg_get_userbyid(p.proowner) AS owner,${acl("p.proacl", "'f'::\"char\"", "p.proowner")} AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) ORDER BY 1,2,3`,
    [fullRecoverySchemas],
  );
  const sequences = await db.query(
    "SELECT schemaname,sequencename,last_value::text,start_value::text,min_value::text,max_value::text,increment_by::text,cycle FROM pg_sequences WHERE schemaname=ANY($1::text[]) ORDER BY 1,2",
    [fullRecoverySchemas],
  );
  return {
    policies: policies.rows,
    acl: relations.rows,
    schemas: schemas.rows,
    defaults: defaults.rows,
    routines: routines.rows,
    sequences: sequences.rows,
  };
}
export function validateFullManifest(manifest, sha, bytes, now = Date.now()) {
  const age = now - Date.parse(manifest?.createdAt);
  if (
    manifest?.version !== 1 ||
    manifest.project !== fullRecoveryProject ||
    manifest.commit !== sha ||
    JSON.stringify(manifest.schemas) !== JSON.stringify(fullRecoverySchemas) ||
    manifest.dumpSha256 !== digest(bytes) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 7200000 ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.roles) ||
    !fullRecoverySchemas.every((s) => manifest.tables.some((t) => t.schema === s)) ||
    manifest.applicationObjectReferences !== 0 ||
    manifest.supabaseStorageObjects !== 0
  )
    throw new Error("FULL_RECOVERY_MANIFEST_INVALID_OR_OBJECT_BACKUP_REQUIRED");
}
