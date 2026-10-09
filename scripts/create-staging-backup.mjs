import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { collectDatabaseEvidence, requireStagingSource } from "./verify-staging-backup-restore.mjs";

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const sourceUrl = process.env.SERAMET_POSTGRES_URL?.trim();
const dumpPath = process.env.SERAMET_BACKUP_PATH?.trim();
const evidencePath = process.env.SERAMET_SOURCE_EVIDENCE_PATH?.trim();
const pgDump = process.env.SERAMET_PG_DUMP_BIN?.trim() || "pg_dump";

if (!sourceUrl || !dumpPath || !evidencePath)
  throw new Error("Staging source, backup path, and evidence path are required");
if (process.env.SERAMET_ENVIRONMENT !== "staging")
  throw new Error("Backup creation is restricted to staging");
requireStagingSource(sourceUrl);

const url = new URL(sourceUrl);
const source = new pg.Client({ connectionString: sourceUrl });
await source.connect();
try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY DEFERRABLE");
  const snapshotResult = await source.query("SELECT pg_export_snapshot() AS snapshot");
  const snapshot = snapshotResult.rows[0]?.snapshot;
  if (!snapshot) throw new Error("PostgreSQL did not export a backup snapshot");

  const dumpEnvironment = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: url.pathname.slice(1) || "postgres",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "require",
  };
  await run(
    pgDump,
    [
      "--format=custom",
      "--schema=public",
      "--no-owner",
      "--no-privileges",
      `--snapshot=${snapshot}`,
      `--file=${dumpPath}`,
    ],
    dumpEnvironment,
  );

  const evidence = await collectDatabaseEvidence(source);
  await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`, { mode: 0o600 });
  const backupStat = await stat(dumpPath);
  console.log(
    JSON.stringify({
      status: "PASS",
      backupSha256: await sha256File(dumpPath),
      backupBytes: backupStat.size,
      publicTables: evidence.tableCount,
      publicRows: evidence.totalRows,
      rowCountSha256: evidence.rowCountSha256,
      migrationCount: Number(evidence.migration.count),
      migrationVersion: Number(evidence.migration.maximum),
    }),
  );
} finally {
  await Promise.allSettled([source.query("ROLLBACK"), source.end()]);
}
