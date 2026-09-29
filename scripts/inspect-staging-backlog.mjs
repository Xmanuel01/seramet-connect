import pg from "pg";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { Client } = pg;

/**
 * Run using the staging connection only. A read-only transaction checks aggregates
 * and blocks overlapping committing menu files without outputting tenant IDs,
 * restaurant data, file contents or provider secrets.
 */
export async function inspectStagingBacklog(db) {
  await db.query("BEGIN READ ONLY");
  try {
    const [imports, pendingJobs, duplicateGroups] = await Promise.all([
      db.query(
        `SELECT import_kind, status, COUNT(*)::integer AS count
         FROM setup_imports
         GROUP BY import_kind, status
         ORDER BY import_kind, status`,
      ),
      db.query(
        `SELECT job_type, status, COUNT(*)::integer AS count
         FROM worker_jobs
         WHERE status IN ('PENDING','CLAIMED','RUNNING','RETRY_PENDING')
         GROUP BY job_type, status
         ORDER BY job_type, status`,
      ),
      db.query(
        `SELECT COUNT(*)::integer AS count
         FROM (
           SELECT tenant_id, file_checksum
           FROM setup_imports
           WHERE import_kind='MENU' AND status='COMMITTING'
           GROUP BY tenant_id,file_checksum
           HAVING COUNT(*) > 1
         ) duplicate_file_groups`,
      ),
    ]);
    return {
      importStatusCounts: imports.rows,
      pendingJobStatusCounts: pendingJobs.rows,
      overlappingCommittingMenuFiles: Number(duplicateGroups.rows[0]?.count ?? 0),
    };
  } finally {
    // Even this inspection runs in an explicitly read-only transaction.
    await db.query("ROLLBACK");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (!process.env.SERAMET_POSTGRES_URL?.trim()) {
    throw new Error("Staging PostgreSQL connection is required for read-only preflight");
  }
  if (process.env.SERAMET_ENVIRONMENT !== "staging") {
    throw new Error("Refusing backlog inspection without SERAMET_ENVIRONMENT=staging");
  }
  const db = new Client({ connectionString: process.env.SERAMET_POSTGRES_URL });
  await db.connect();
  try {
    const summary = await inspectStagingBacklog(db);
    console.log("Non-sensitive staging backlog counts:", JSON.stringify(summary));
    if (summary.overlappingCommittingMenuFiles > 0) {
      throw new Error(
        "Overlapping COMMITTING menu files remain. Backup, inspect and approve an audited duplicate-job quarantine before deployment.",
      );
    }
  } finally {
    await db.end();
  }
}
