import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const STAGING_PROJECT_REF = "vnymbavsbxorwxpebkot";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function requireStagingSource(value) {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !(
      url.hostname.includes(STAGING_PROJECT_REF) ||
      decodeURIComponent(url.username).includes(STAGING_PROJECT_REF)
    )
  ) {
    throw new Error("Source DSN does not identify the approved staging project");
  }
}

async function tableNames(db) {
  const result = await db.query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname='public'
      ORDER BY tablename`,
  );
  return result.rows.map((row) => String(row.tablename));
}

async function tableCounts(db, names) {
  const counts = [];
  for (const name of names) {
    const result = await db.query(
      `SELECT COUNT(*)::bigint AS count FROM public.${quoteIdentifier(name)}`,
    );
    counts.push([name, String(result.rows[0]?.count ?? "0")]);
  }
  return counts;
}

async function migrationEvidence(db) {
  const exists = await db.query("SELECT to_regclass('public.schema_migrations')::text AS name");
  if (!exists.rows[0]?.name) return { count: 0, maximum: 0 };
  const result = await db.query(
    "SELECT COUNT(*)::integer AS count,COALESCE(MAX(version),0)::integer AS maximum FROM public.schema_migrations",
  );
  return result.rows[0];
}

async function orphanEvidence(db) {
  const checks = [
    [
      "branches_without_tenant",
      `SELECT COUNT(*)::integer AS count FROM public.branches child
       LEFT JOIN public.tenants parent ON parent.id=child.tenant_id
       WHERE parent.id IS NULL`,
    ],
    [
      "worker_jobs_without_tenant",
      `SELECT COUNT(*)::integer AS count FROM public.worker_jobs child
       LEFT JOIN public.tenants parent ON parent.id=child.tenant_id
       WHERE parent.id IS NULL`,
    ],
    [
      "worker_jobs_without_branch",
      `SELECT COUNT(*)::integer AS count FROM public.worker_jobs child
       LEFT JOIN public.branches parent
         ON parent.tenant_id=child.tenant_id AND parent.id=child.branch_id
       WHERE child.branch_id IS NOT NULL AND parent.id IS NULL`,
    ],
    [
      "setup_imports_without_tenant",
      `SELECT COUNT(*)::integer AS count FROM public.setup_imports child
       LEFT JOIN public.tenants parent ON parent.id=child.tenant_id
       WHERE parent.id IS NULL`,
    ],
    [
      "setup_imports_without_branch",
      `SELECT COUNT(*)::integer AS count FROM public.setup_imports child
       LEFT JOIN public.branches parent
         ON parent.tenant_id=child.tenant_id AND parent.id=child.branch_id
       WHERE child.branch_id IS NOT NULL AND parent.id IS NULL`,
    ],
  ];
  const evidence = {};
  for (const [name, query] of checks) {
    const result = await db.query(query);
    evidence[name] = Number(result.rows[0]?.count ?? 0);
  }
  return evidence;
}

async function schemaObjectEvidence(db) {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM pg_views WHERE schemaname='public') AS views,
       (SELECT COUNT(*)::integer FROM pg_matviews WHERE schemaname='public') AS materialized_views,
       (SELECT COUNT(*)::integer FROM pg_indexes WHERE schemaname='public') AS indexes,
       (SELECT COUNT(*)::integer FROM information_schema.routines
         WHERE routine_schema='public') AS routines,
       (SELECT COUNT(*)::integer FROM information_schema.triggers
         WHERE trigger_schema='public') AS triggers,
       (SELECT COUNT(*)::integer FROM information_schema.table_constraints
         WHERE constraint_schema='public') AS constraints,
       (SELECT COUNT(*)::integer FROM pg_sequences WHERE schemaname='public') AS sequences`,
  );
  return result.rows[0];
}

export async function collectDatabaseEvidence(db) {
  const names = await tableNames(db);
  const counts = await tableCounts(db, names);
  const totalRows = counts.reduce((total, [, count]) => total + BigInt(count), 0n);
  const rowCountSha256 = createHash("sha256").update(JSON.stringify(counts)).digest("hex");
  return {
    tableCount: names.length,
    tableNames: names,
    totalRows: totalRows.toString(),
    rowCountSha256,
    migration: await migrationEvidence(db),
    orphans: await orphanEvidence(db),
    schemaObjects: await schemaObjectEvidence(db),
  };
}

export function compareDatabaseEvidence(source, restored) {
  const issues = [];
  if (source.tableCount !== restored.tableCount) issues.push("PUBLIC_TABLE_COUNT_MISMATCH");
  if (JSON.stringify(source.tableNames) !== JSON.stringify(restored.tableNames))
    issues.push("PUBLIC_TABLE_INVENTORY_MISMATCH");
  if (source.totalRows !== restored.totalRows) issues.push("PUBLIC_ROW_TOTAL_MISMATCH");
  if (source.rowCountSha256 !== restored.rowCountSha256) issues.push("PUBLIC_ROW_COUNTS_MISMATCH");
  if (Number(source.migration.count) !== Number(restored.migration.count))
    issues.push("MIGRATION_COUNT_MISMATCH");
  if (Number(source.migration.maximum) !== Number(restored.migration.maximum))
    issues.push("MIGRATION_VERSION_MISMATCH");
  if (JSON.stringify(source.orphans) !== JSON.stringify(restored.orphans))
    issues.push("RELATIONSHIP_EVIDENCE_MISMATCH");
  if (JSON.stringify(source.schemaObjects) !== JSON.stringify(restored.schemaObjects))
    issues.push("PUBLIC_SCHEMA_OBJECT_MISMATCH");
  const sourceOrphans = Object.values(source.orphans).reduce(
    (total, value) => total + Number(value),
    0,
  );
  const restoredOrphans = Object.values(restored.orphans).reduce(
    (total, value) => total + Number(value),
    0,
  );
  if (sourceOrphans !== 0 || restoredOrphans !== 0) issues.push("CRITICAL_ORPHANS_PRESENT");
  return issues;
}

async function main() {
  const sourceUrl = process.env.SERAMET_POSTGRES_URL?.trim();
  const restoredUrl = process.env.SERAMET_RESTORE_POSTGRES_URL?.trim();
  const sourceEvidencePath = process.env.SERAMET_SOURCE_EVIDENCE_PATH?.trim();
  if (!sourceUrl || !restoredUrl) throw new Error("Source and isolated restore DSNs are required");
  if (process.env.SERAMET_ENVIRONMENT !== "staging")
    throw new Error("Backup verification is restricted to staging");
  requireStagingSource(sourceUrl);

  const restored = new pg.Client({ connectionString: restoredUrl });
  await restored.connect();
  let source;
  try {
    await restored.query("BEGIN READ ONLY");
    let sourceEvidence;
    if (sourceEvidencePath) {
      const { readFile } = await import("node:fs/promises");
      sourceEvidence = JSON.parse(await readFile(sourceEvidencePath, "utf8"));
    } else {
      source = new pg.Client({ connectionString: sourceUrl });
      await source.connect();
      await source.query("BEGIN READ ONLY");
      sourceEvidence = await collectDatabaseEvidence(source);
    }
    const restoredEvidence = await collectDatabaseEvidence(restored);
    const issues = compareDatabaseEvidence(sourceEvidence, restoredEvidence);
    if (issues.length)
      throw new Error(`Isolated restore verification failed: ${issues.join(", ")}`);
    console.log(
      JSON.stringify({
        status: "PASS",
        stagingProject: STAGING_PROJECT_REF,
        publicTables: sourceEvidence.tableCount,
        publicRows: sourceEvidence.totalRows,
        rowCountSha256: sourceEvidence.rowCountSha256,
        migrationCount: Number(sourceEvidence.migration.count),
        migrationVersion: Number(sourceEvidence.migration.maximum),
        criticalRelationshipOrphans: 0,
      }),
    );
  } finally {
    await Promise.allSettled([
      source?.query("ROLLBACK"),
      restored.query("ROLLBACK"),
    ]);
    await Promise.allSettled([source?.end(), restored.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
