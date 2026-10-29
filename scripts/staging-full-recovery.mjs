import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import pg from "pg";
import {
  authorizeFullRecovery,
  fullRecoverySource,
  fullRecoveryRestore,
  fullRecoveryProject,
  fullRecoverySchemas,
  fullTableEvidence,
  fullSecurityEvidence,
  digest,
  ident,
  validateFullManifest,
} from "./staging-full-recovery-core.mjs";
import { recoveryKey, sealRecovery, openRecovery } from "./staging-recovery-envelope.mjs";
import { backupObjectFiles, recoverObjectBytes } from "./staging-object-recovery.mjs";

let phase = "authorization";
function command(binary, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    let diagnostic = "";
    child.stderr.on("data", (b) => {
      if (diagnostic.length < 100_000) diagnostic += b;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error("RECOVERY_COMMAND_FAILED");
        error.diagnostic = diagnostic;
        reject(error);
      }
    });
  });
}
async function extensionDependencies(db) {
  return (await db.query("SELECT extname FROM pg_extension ORDER BY extname")).rows;
}
async function backup(root) {
  const sourceRaw = process.env.SERAMET_POSTGRES_URL;
  const config = fullRecoverySource(sourceRaw);
  const source = new pg.Client(config);
  const dump = join(root, "full.dump");
  await source.connect();
  try {
    phase = "read-only-snapshot";
    await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(
      (await source.query("SHOW transaction_read_only")).rows[0].transaction_read_only,
      "on",
    );
    const snapshot = (await source.query("SELECT pg_export_snapshot() AS id")).rows[0].id;
    const objectReferences = (
      await source.query(
        `SELECT tenant_id,id,object_key,object_version,content_type,size_bytes,checksum_sha256,status
         FROM public.stored_objects WHERE status<>'DELETED' ORDER BY tenant_id,id`,
      )
    ).rows;
    const objects = Number(
      (await source.query("SELECT count(*) FROM storage.objects")).rows[0].count,
    );
    assert.equal(objects, 0, "Supabase Storage files require a separate encrypted object backup");
    const key = recoveryKey(process.env.SERAMET_STAGING_BACKUP_KEY);
    await mkdir(join(root, "encrypted"), { recursive: true, mode: 0o700 });
    phase = "read-only-referenced-object-backup";
    const objectFiles = await backupObjectFiles({
      rows: objectReferences,
      root,
      key,
      env: process.env,
    });
    const roles = (
      await source.query(
        "SELECT rolname,rolinherit,rolbypassrls,rolconfig FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname",
      )
    ).rows;
    const memberships = (
      await source.query(
        "SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,admin_option FROM pg_auth_members WHERE pg_get_userbyid(roleid) NOT LIKE 'pg_%' AND pg_get_userbyid(member) NOT LIKE 'pg_%' ORDER BY 1,2",
      )
    ).rows;
    const extensions = await extensionDependencies(source);
    const url = new URL(sourceRaw);
    phase = "read-only-dump";
    await command(
      "/usr/lib/postgresql/17/bin/pg_dump",
      [
        "--format=custom",
        ...fullRecoverySchemas.map((s) => `--schema=${s}`),
        `--snapshot=${snapshot}`,
        `--file=${dump}`,
      ],
      {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: "5432",
        PGDATABASE: "postgres",
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: "verify-full",
        PGOPTIONS: "-c default_transaction_read_only=on",
      },
    );
    phase = "snapshot-content-and-security";
    const bytes = await readFile(dump);
    assert.ok(bytes.length <= 512 * 1024 * 1024);
    const manifest = {
      version: 2,
      project: fullRecoveryProject,
      commit: process.env.GITHUB_SHA,
      createdAt: new Date().toISOString(),
      schemas: fullRecoverySchemas,
      dumpSha256: digest(bytes),
      tables: await fullTableEvidence(source),
      security: await fullSecurityEvidence(source),
      roles,
      memberships,
      extensions,
      applicationObjectReferences: objectReferences.length,
      supabaseStorageObjects: objects,
      objectReferences,
      objectFiles,
    };
    validateFullManifest(manifest, process.env.GITHUB_SHA, bytes);
    await writeFile(join(root, "encrypted", "full.dump.enc"), sealRecovery(bytes, key), {
      mode: 0o600,
    });
    await writeFile(
      join(root, "encrypted", "manifest.json.enc"),
      sealRecovery(Buffer.from(JSON.stringify(manifest)), key),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: "ENCRYPTED_BACKUP_CREATED",
        schemas: fullRecoverySchemas,
        tables: manifest.tables.length,
        dumpSha256: manifest.dumpSha256,
        bytes: bytes.length,
        referencedObjectFiles: objectFiles.length,
      }),
    );
  } finally {
    await source.query("ROLLBACK").catch(() => {});
    await source.end();
    await rm(dump, { force: true });
  }
}
async function restore(root) {
  const started = Date.now();
  const key = recoveryKey(process.env.SERAMET_STAGING_BACKUP_KEY);
  const bytes = openRecovery(await readFile(join(root, "downloaded", "full.dump.enc")), key);
  const manifest = JSON.parse(
    openRecovery(await readFile(join(root, "downloaded", "manifest.json.enc")), key),
  );
  validateFullManifest(manifest, process.env.GITHUB_SHA, bytes);
  const targetRaw = process.env.SERAMET_RESTORE_POSTGRES_URL;
  const target = new pg.Client(fullRecoveryRestore(targetRaw));
  const dump = join(root, "restoring.dump");
  await writeFile(dump, bytes, { mode: 0o600 });
  await target.connect();
  try {
    phase = "isolated-role-reconstruction";
    assert.equal(
      (await target.query("SELECT current_database() AS db")).rows[0].db,
      "seramet_full_restore",
    );
    // Global passwords and live login capability are deliberately not cloned.
    for (const role of manifest.roles) {
      if (role.rolname === "postgres") continue;
      if (!(await target.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role.rolname])).rowCount)
        await target.query(
          `CREATE ROLE ${ident(role.rolname)} NOLOGIN ${role.rolinherit ? "INHERIT" : "NOINHERIT"} ${role.rolbypassrls ? "BYPASSRLS" : "NOBYPASSRLS"}`,
        );
    }
    for (const membership of manifest.memberships) {
      await target.query(
        `GRANT ${ident(membership.role)} TO ${ident(membership.member)}${membership.admin_option ? " WITH ADMIN OPTION" : ""}`,
      );
    }
    for (const role of manifest.roles) {
      for (const setting of role.rolconfig ?? []) {
        const split = setting.indexOf("=");
        assert.ok(split > 0);
        await target.query(
          `ALTER ROLE ${ident(role.rolname)} SET ${ident(setting.slice(0, split))} TO '${setting.slice(split + 1).replaceAll("'", "''")}'`,
        );
      }
    }
    phase = "isolated-extension-dependencies";
    await target.query("CREATE SCHEMA IF NOT EXISTS extensions");
    for (const { extname } of manifest.extensions) {
      if (["pgcrypto", "uuid-ossp"].includes(extname))
        await target.query(
          `CREATE EXTENSION IF NOT EXISTS ${ident(extname)} WITH SCHEMA extensions`,
        );
    }
    phase = "isolated-restore";
    for (const schema of fullRecoverySchemas)
      await target.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    const url = new URL(targetRaw);
    await command(
      "/usr/lib/postgresql/17/bin/pg_restore",
      ["--exit-on-error", "--single-transaction", `--dbname=${url.pathname.slice(1)}`, dump],
      {
        ...process.env,
        PGHOST: "127.0.0.1",
        PGPORT: "54329",
        PGUSER: "postgres",
        PGPASSWORD: decodeURIComponent(url.password),
        PGSSLMODE: "disable",
        PGOPTIONS: "",
      },
    );
    phase = "restored-rows-and-access-comparison";
    const actualTables = await fullTableEvidence(target);
    assert.deepEqual(
      actualTables,
      manifest.tables,
      "Restored rows differ from the consistent source snapshot",
    );
    const actualSecurity = await fullSecurityEvidence(target);
    for (const category of Object.keys(manifest.security)) {
      phase = `security-comparison-${category}`;
      assert.deepEqual(
        actualSecurity[category],
        manifest.security[category],
        "Restored access settings or counters differ",
      );
    }
    phase = "isolated-referenced-object-byte-recovery";
    const objectReferences = (
      await target.query(
        `SELECT tenant_id,id,object_key,object_version,content_type,size_bytes,checksum_sha256,status
         FROM public.stored_objects WHERE status<>'DELETED' ORDER BY tenant_id,id`,
      )
    ).rows;
    const objectRecovery = await recoverObjectBytes({
      rows: objectReferences,
      files: manifest.objectFiles ?? [],
      root,
      key,
    });
    phase = "client-and-cookbook-access";
    for (const role of ["anon", "authenticated"]) {
      const exposed = await target.query(
        "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND (has_table_privilege($1,quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE') OR has_schema_privilege($1,'public','USAGE'))",
        [role],
      );
      assert.equal(Number(exposed.rows[0].count), 0);
    }
    const authUsers = manifest.tables.find((t) => t.schema === "auth" && t.table === "users");
    const identities = manifest.tables.find((t) => t.schema === "auth" && t.table === "identities");
    const evidence = {
      status: "PASS",
      project: manifest.project,
      commit: manifest.commit,
      scope:
        "Auth/public/Storage database rows, ownership, ACL, RLS policies, sequences and referenced R2 file bytes recovered into isolated memory; no global passwords, remote object restore/version remapping, external service configuration or unreferenced blobs",
      tables: manifest.tables.length,
      rows: manifest.tables.reduce((sum, t) => sum + Number(t.rows), 0),
      authAccounts: Number(authUsers.rows),
      identities: Number(identities.rows),
      dumpSha256: manifest.dumpSha256,
      contentDigest: digest(JSON.stringify(actualTables)),
      securityDigest: digest(JSON.stringify(actualSecurity)),
      restoreSeconds: Math.round((Date.now() - started) / 1000),
      snapshotCreatedAt: manifest.createdAt,
      sourceReadOnly: true,
      remoteRestore: false,
      ...objectRecovery,
      globalPasswordsCloned: false,
    };
    await writeFile(join(root, "result.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    await target.end();
    await rm(dump, { force: true });
  }
}
try {
  authorizeFullRecovery(process.env);
  const root = process.env.SERAMET_FULL_RECOVERY_DIRECTORY;
  assert.ok(
    isAbsolute(root ?? "") &&
      root.startsWith(process.env.RUNNER_TEMP + "/") &&
      !root.includes(".."),
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  const mode = process.argv[2];
  if (mode === "authorize") console.log("STAGING_FULL_RECOVERY_AUTHORIZED");
  else if (mode === "backup") await backup(root);
  else if (mode === "restore") await restore(root);
  else throw new Error("RECOVERY_MODE_INVALID");
} catch (error) {
  // COPY diagnostics can contain password hashes or personal records. Never log them.
  const root = process.env.SERAMET_FULL_RECOVERY_DIRECTORY;
  if (root && isAbsolute(root) && root.startsWith(process.env.RUNNER_TEMP + "/")) {
    try {
      const key = recoveryKey(process.env.SERAMET_STAGING_BACKUP_KEY);
      await mkdir(join(root, "diagnostics"), { recursive: true, mode: 0o700 });
      await writeFile(
        join(root, "diagnostics", "failure.json.enc"),
        sealRecovery(
          Buffer.from(
            JSON.stringify({ phase, message: error.message, diagnostic: error.diagnostic }),
          ),
          key,
        ),
        { mode: 0o600 },
      );
    } catch {
      /* No unencrypted diagnostics are retained. */
    }
  }
  console.error(
    JSON.stringify({
      status: "FAIL",
      phase,
      code: /^[0-9A-Z]{5}$/.test(error.code ?? "") ? error.code : "FULL_RECOVERY_FAILED",
    }),
  );
  process.exitCode = 1;
}
