import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";
import { sealRecovery, openRecovery, recoveryKey } from "./staging-recovery-envelope.mjs";
import {
  requireProductionRecoveryAuthorization,
  productionBackupConnection,
  isolatedProductionRestoreConnection,
  productionTableEvidence,
  productionSchemaEvidence,
  recoveryDigest,
  verifyProductionRecoveryManifest,
  quoteRecoveryIdentifier,
} from "./production-recovery-core.mjs";

const dumpName = "production-public.dump";
const manifestName = "production-manifest.json";

function run(binary, args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { env, stdio: "ignore", shell: false });
    child.once("error", () => reject(new Error("RECOVERY_DATABASE_TOOL_FAILED")));
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error("RECOVERY_DATABASE_TOOL_FAILED")),
    );
  });
}

function paths(env) {
  if (!env.RUNNER_TEMP || !isAbsolute(env.RUNNER_TEMP))
    throw new Error("RECOVERY_RUNNER_TEMP_REQUIRED");
  const root = join(resolve(env.RUNNER_TEMP), "seramet-production-recovery");
  return {
    root,
    encrypted: join(root, "encrypted"),
    downloaded: join(root, "downloaded"),
    restored: join(root, "restored"),
  };
}

async function readBounded(path) {
  if ((await stat(path)).size > 512 * 1024 * 1024)
    throw new Error("RECOVERY_FILE_CAPACITY_EXCEEDED");
  return readFile(path);
}

async function capture(env, directory) {
  const config = productionBackupConnection(
    env.SERAMET_PRODUCTION_BACKUP_POSTGRES_URL,
    env.SERAMET_PRODUCTION_PROJECT_REF,
  );
  const source = new pg.Client(config);
  await source.connect();
  try {
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await source.query("SET LOCAL timezone='UTC'");
    await source.query("SET LOCAL search_path=pg_catalog,public");
    await source.query("SET LOCAL statement_timeout='60000'");
    await source.query("SET LOCAL row_security=off");
    const identity = await source.query(
      `SELECT current_user AS role,current_database() AS database,
              (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
              r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
              has_schema_privilege(current_user,'public','CREATE') AS schema_write
       FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`,
    );
    const role = identity.rows[0];
    if (
      role?.role !== "seramet_production_backup" ||
      role.database !== "postgres" ||
      role.tls !== true ||
      role.rolsuper ||
      role.rolcreaterole ||
      role.rolcreatedb ||
      role.rolreplication ||
      role.schema_write
    )
      throw new Error("PRODUCTION_BACKUP_READONLY_ROLE_REQUIRED");
    const writable = await source.query(
      `SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_tables t
       WHERE schemaname='public' AND has_table_privilege(current_user,
         format('%I.%I',t.schemaname,t.tablename),'INSERT,UPDATE,DELETE,TRUNCATE')`,
    );
    if (writable.rows[0]?.count !== 0) throw new Error("PRODUCTION_BACKUP_READONLY_ROLE_REQUIRED");
    const exported = await source.query("SELECT pg_export_snapshot() AS snapshot");
    const snapshot = exported.rows[0]?.snapshot;
    if (!/^[A-Fa-f0-9-]+$/.test(snapshot ?? "")) throw new Error("BACKUP_SNAPSHOT_REQUIRED");
    const url = new URL(config.connectionString);
    await run(
      env.SERAMET_PG_DUMP_BIN || "pg_dump",
      [
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        `--snapshot=${snapshot}`,
        `--file=${join(directory.root, dumpName)}`,
      ],
      {
        PATH: env.PATH,
        PGHOST: url.hostname,
        PGPORT: url.port || "5432",
        PGDATABASE: "postgres",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: env.PGSSLROOTCERT,
        PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=60000",
      },
    );
    const tables = await productionTableEvidence(source);
    const roles = await source.query(
      `SELECT DISTINCT r.rolname FROM pg_catalog.pg_policy p
       JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_catalog.pg_roles r ON r.oid=ANY(p.polroles) WHERE n.nspname='public' ORDER BY r.rolname`,
    );
    const manifest = {
      version: 1,
      environment: "production",
      projectRef: env.SERAMET_PRODUCTION_PROJECT_REF,
      commit: env.GITHUB_SHA,
      createdAt: new Date().toISOString(),
      coverage: "PUBLIC_APPLICATION_SCHEMA_ONLY",
      tables,
      metadata: await productionSchemaEvidence(source),
      policyRoles: roles.rows.map((row) => row.rolname),
      dumpSha256: recoveryDigest(await readBounded(join(directory.root, dumpName))),
    };
    await writeFile(join(directory.root, manifestName), JSON.stringify(manifest), {
      mode: 0o600,
      flag: "wx",
    });
  } finally {
    await Promise.allSettled([source.query("ROLLBACK")]);
    await source.end();
  }
}

async function envelope(env, directory, opening) {
  const key = recoveryKey(env.SERAMET_PRODUCTION_BACKUP_KEY);
  const destination = opening ? directory.restored : directory.encrypted;
  await mkdir(destination, { recursive: true, mode: 0o700 });
  try {
    for (const name of [dumpName, manifestName]) {
      const input = await readBounded(
        join(opening ? directory.downloaded : directory.root, name + (opening ? ".enc" : "")),
      );
      const result = opening ? openRecovery(input, key) : sealRecovery(input, key);
      await writeFile(join(destination, name + (opening ? "" : ".enc")), result, {
        mode: 0o600,
        flag: "wx",
      });
    }
  } finally {
    key.fill(0);
  }
}

async function verify(env, directory) {
  const dump = await readBounded(join(directory.restored, dumpName));
  const manifest = JSON.parse(await readFile(join(directory.restored, manifestName), "utf8"));
  verifyProductionRecoveryManifest(manifest, env, dump);
  const config = isolatedProductionRestoreConnection(env.SERAMET_PRODUCTION_RESTORE_POSTGRES_URL);
  const restored = new pg.Client(config);
  await restored.connect();
  try {
    // Only the fixed disposable loopback database can reach this destructive preparation.
    await restored.query("DROP SCHEMA public CASCADE");
    for (const name of new Set([
      "anon",
      "authenticated",
      "service_role",
      ...manifest.policyRoles,
    ])) {
      const exists = await restored.query("SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1", [
        name,
      ]);
      if (!exists.rows.length)
        await restored.query(
          `CREATE ROLE ${quoteRecoveryIdentifier(name)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
    }
    const url = new URL(config.connectionString);
    await run(
      env.SERAMET_PG_RESTORE_BIN || "pg_restore",
      [
        "--host",
        "127.0.0.1",
        "--port",
        "54329",
        "--username",
        "postgres",
        "--dbname",
        "seramet_production_restore",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        join(directory.restored, dumpName),
      ],
      { PATH: env.PATH, PGPASSWORD: decodeURIComponent(url.password) },
    );
    await restored.query("BEGIN READ ONLY");
    await restored.query("SET LOCAL timezone='UTC'");
    await restored.query("SET LOCAL search_path=pg_catalog,public");
    await restored.query("SET LOCAL statement_timeout='60000'");
    const tables = await productionTableEvidence(restored);
    if (JSON.stringify(tables) !== JSON.stringify(manifest.tables))
      throw new Error("PRODUCTION_RESTORE_RECORD_MISMATCH");
    const metadata = await productionSchemaEvidence(restored);
    if (JSON.stringify(manifest.metadata) !== JSON.stringify(metadata))
      throw new Error("PRODUCTION_RESTORE_SCHEMA_MISMATCH");
    await writeFile(
      join(directory.root, "verification.json"),
      JSON.stringify({
        status: "RESTORE_VERIFIED",
        environment: "production",
        projectRef: manifest.projectRef,
        commit: manifest.commit,
        recoveryPointCreatedAt: manifest.createdAt,
        dumpSha256: manifest.dumpSha256,
        coverage: manifest.coverage,
        tableCount: tables.length,
        restorationTarget: "ISOLATED_LOCAL_POSTGRESQL_17",
        privilegeReconstruction: "SEPARATE_REQUIRED_STEP",
      }),
      { mode: 0o600, flag: "wx" },
    );
  } finally {
    await Promise.allSettled([restored.query("ROLLBACK")]);
    await restored.end();
  }
}

export async function productionRecovery(mode, env = process.env) {
  requireProductionRecoveryAuthorization(env);
  if (!["capture", "seal", "open", "verify"].includes(mode))
    throw new Error("PRODUCTION_RECOVERY_MODE_INVALID");
  const directory = paths(env);
  await mkdir(directory.root, { recursive: true, mode: 0o700 });
  if (mode === "capture") await capture(env, directory);
  if (mode === "seal") await envelope(env, directory, false);
  if (mode === "open") await envelope(env, directory, true);
  if (mode === "verify") await verify(env, directory);
  console.log(JSON.stringify({ operation: "production-recovery", stage: mode, result: "PASS" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await productionRecovery(process.argv[2]);
  } catch {
    console.error("PRODUCTION_RECOVERY_FAILED");
    process.exitCode = 1;
  }
}
