import { createHash } from "node:crypto";
import { stagingTlsConfig } from "./staging-postgres-tls.mjs";

export function requireProductionRecoveryAuthorization(env) {
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !login.test(env.GITHUB_REPOSITORY_OWNER ?? "") ||
    env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
    env.GITHUB_TRIGGERING_ACTOR !== env.GITHUB_REPOSITORY_OWNER ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    env.SERAMET_PRODUCTION_APPROVED_SHA !== env.GITHUB_SHA ||
    env.SERAMET_PRODUCTION_OPERATION !== "verify-recovery" ||
    !/^[a-z]{20}$/.test(env.SERAMET_PRODUCTION_PROJECT_REF ?? "") ||
    env.SERAMET_PRODUCTION_PROJECT_REF === "vnymbavsbxorwxpebkot"
  ) {
    throw new Error("PRODUCTION_RECOVERY_AUTHORIZATION_REQUIRED");
  }
}

export function productionBackupConnection(raw, projectRef) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PRODUCTION_BACKUP_CONNECTION_INVALID");
  }
  const role = "seramet_production_backup";
  const direct =
    url.hostname === `db.${projectRef}.supabase.co` && decodeURIComponent(url.username) === role;
  const pooler =
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    decodeURIComponent(url.username) === `${role}.${projectRef}`;
  if (
    !/^[a-z]{20}$/.test(projectRef ?? "") ||
    projectRef === "vnymbavsbxorwxpebkot" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    (!direct && !pooler) ||
    url.pathname !== "/postgres" ||
    (url.port && url.port !== "5432") ||
    !url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => !["sslmode", "ssl"].includes(key))
  ) {
    throw new Error("PRODUCTION_BACKUP_IDENTITY_MISMATCH");
  }
  return {
    ...stagingTlsConfig(url.toString()),
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 10_000,
  };
}

export function isolatedProductionRestoreConnection(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ISOLATED_PRODUCTION_RESTORE_REQUIRED");
  }
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== "54329" ||
    url.username !== "postgres" ||
    url.pathname !== "/seramet_production_restore" ||
    url.search ||
    url.hash
  ) {
    throw new Error("ISOLATED_PRODUCTION_RESTORE_REQUIRED");
  }
  return { connectionString: raw, connectionTimeoutMillis: 10_000 };
}

export function recoveryDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyProductionRecoveryManifest(manifest, env, dump, now = Date.now()) {
  requireProductionRecoveryAuthorization(env);
  const age = now - Date.parse(manifest?.createdAt);
  if (
    manifest?.version !== 1 ||
    manifest.environment !== "production" ||
    manifest.projectRef !== env.SERAMET_PRODUCTION_PROJECT_REF ||
    manifest.commit !== env.GITHUB_SHA ||
    manifest.coverage !== "PUBLIC_APPLICATION_SCHEMA_ONLY" ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 2 * 60 * 60 * 1000 ||
    manifest.dumpSha256 !== recoveryDigest(dump) ||
    !Array.isArray(manifest.tables) ||
    !Array.isArray(manifest.policyRoles)
  ) {
    throw new Error("PRODUCTION_RECOVERY_EVIDENCE_INVALID");
  }
}

export function quoteRecoveryIdentifier(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > 63 ||
    value.includes("\0")
  )
    throw new Error("RECOVERY_IDENTIFIER_INVALID");
  return '"' + value.replaceAll('"', '""') + '"';
}

export async function productionTableEvidence(client) {
  const inventory = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const tables = [];
  let totalRows = 0n;
  for (const { tablename } of inventory.rows) {
    const table = `public.${quoteRecoveryIdentifier(tablename)}`;
    const size = await client.query(
      `SELECT COUNT(*)::text AS count,COALESCE(SUM(octet_length(row_to_json(t)::text)),0)::text AS bytes FROM ${table} AS t`,
    );
    totalRows += BigInt(size.rows[0].count);
    if (totalRows > 100000n || BigInt(size.rows[0].bytes) > 64n * 1024n * 1024n)
      throw new Error("PRODUCTION_RECOVERY_CAPACITY_EXCEEDED");
    const result = await client.query(
      `SELECT row_to_json(t)::text AS record FROM ${table} AS t ORDER BY row_to_json(t)::text COLLATE "C"`,
    );
    const hash = createHash("sha256");
    for (const row of result.rows) hash.update(row.record).update("\n");
    tables.push({ name: tablename, count: size.rows[0].count, dataSha256: hash.digest("hex") });
  }
  return tables;
}

export async function productionSchemaEvidence(client) {
  // Catalog evidence is role-independent, unlike information_schema trigger counts.
  // OIDs, owners and grants deliberately do not form part of logical recovery identity.
  const result = await client.query(`
    SELECT evidence FROM (
      SELECT 'relation:' || c.relname || ':' || c.relkind || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity AS evidence
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
      UNION ALL
      SELECT 'column:' || c.relname || ':' || a.attnum || ':' || a.attname || ':' ||
        pg_catalog.format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull || ':' || a.attidentity || ':' || a.attgenerated || ':' ||
        COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')
        FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m')
      UNION ALL
      SELECT 'constraint:' || c.relname || ':' || k.conname || ':' || pg_catalog.pg_get_constraintdef(k.oid,true)
        FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'index:' || c.relname || ':' || pg_catalog.pg_get_indexdef(i.indexrelid)
        FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'trigger:' || c.relname || ':' || pg_catalog.pg_get_triggerdef(t.oid,true)
        FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
      UNION ALL
      SELECT 'routine:' || p.proname || ':' || pg_catalog.pg_get_functiondef(p.oid)
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind IN ('f','p')
      UNION ALL
      SELECT 'view:' || c.relname || ':' || pg_catalog.pg_get_viewdef(c.oid,true)
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('v','m')
      UNION ALL
      SELECT 'policy:' || tablename || ':' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' ||
        COALESCE(qual,'') || ':' || COALESCE(with_check,'') FROM pg_catalog.pg_policies WHERE schemaname='public'
    ) AS definitions ORDER BY evidence COLLATE "C"`);
  const hash = createHash("sha256");
  for (const { evidence } of result.rows) hash.update(evidence).update("\n");
  return { objectCount: result.rows.length, definitionSha256: hash.digest("hex") };
}
