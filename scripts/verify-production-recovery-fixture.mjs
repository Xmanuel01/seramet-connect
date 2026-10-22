import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, copyFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  isolatedProductionRestoreConnection,
  productionTableEvidence,
  productionSchemaEvidence,
  recoveryDigest,
} from "./production-recovery-core.mjs";
import { productionRecovery } from "./production-recovery.mjs";

// This certification has no remote source path. Every SQL write is confined to
// the same fixed disposable database accepted by the production restore guard.
if (process.env.CI !== "true") throw new Error("DISPOSABLE_CI_REQUIRED");
const raw = process.env.SERAMET_PRODUCTION_RESTORE_POSTGRES_URL;
const config = isolatedProductionRestoreConnection(raw);
const directory = await mkdtemp(join(process.env.RUNNER_TEMP, "recovery-fixture-"));
const root = join(directory, "seramet-production-recovery");
const fixtureEnv = {
  PATH: process.env.PATH,
  RUNNER_TEMP: directory,
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY_OWNER: "disposable-fixture",
  GITHUB_ACTOR: "disposable-fixture",
  GITHUB_TRIGGERING_ACTOR: "disposable-fixture",
  GITHUB_SHA: process.env.GITHUB_SHA,
  SERAMET_PRODUCTION_APPROVED_SHA: process.env.GITHUB_SHA,
  SERAMET_PRODUCTION_PROJECT_REF: "abcdefghijklmnopqrst",
  SERAMET_PRODUCTION_OPERATION: "verify-recovery",
  SERAMET_PRODUCTION_RESTORE_POSTGRES_URL: raw,
  SERAMET_PRODUCTION_BACKUP_KEY: randomBytes(32).toString("base64"),
  SERAMET_PG_RESTORE_BIN: process.env.SERAMET_PG_RESTORE_BIN,
};
const db = new pg.Client(config);
try {
  await mkdir(root);
  await db.connect();
  await db.query("SET timezone='UTC'");
  await db.query("SET search_path=pg_catalog,public");
  await db.query(
    "CREATE TABLE public.recovery_fixture (id integer PRIMARY KEY, amount_minor bigint NOT NULL, note text NOT NULL)",
  );
  await db.query(
    "INSERT INTO public.recovery_fixture VALUES (1,12400,'Disposable synthetic record'),(2,0,'Long note with punctuation; no customer data')",
  );
  const dumpPath = join(root, "production-public.dump");
  const dump = spawnSync(
    process.env.SERAMET_PG_DUMP_BIN || "pg_dump",
    ["--format=custom", "--schema=public", "--no-owner", "--no-privileges", `--file=${dumpPath}`],
    {
      env: {
        PATH: process.env.PATH,
        PGHOST: "127.0.0.1",
        PGPORT: "54329",
        PGUSER: "postgres",
        PGDATABASE: "seramet_production_restore",
        PGPASSWORD: decodeURIComponent(new URL(raw).password),
      },
      stdio: "ignore",
    },
  );
  assert.equal(dump.status, 0, "Disposable PostgreSQL dump must succeed");
  const tables = await productionTableEvidence(db);
  const metadata = await productionSchemaEvidence(db);
  await writeFile(
    join(root, "production-manifest.json"),
    JSON.stringify({
      version: 1,
      environment: "production",
      projectRef: fixtureEnv.SERAMET_PRODUCTION_PROJECT_REF,
      commit: fixtureEnv.GITHUB_SHA,
      createdAt: new Date().toISOString(),
      coverage: "PUBLIC_APPLICATION_SCHEMA_ONLY",
      tables,
      metadata,
      policyRoles: [],
      dumpSha256: recoveryDigest(await readFile(dumpPath)),
    }),
    { mode: 0o600 },
  );
  await productionRecovery("seal", fixtureEnv);
  await mkdir(join(root, "downloaded"));
  for (const name of ["production-public.dump.enc", "production-manifest.json.enc"])
    await copyFile(join(root, "encrypted", name), join(root, "downloaded", name));
  await productionRecovery("open", fixtureEnv);
  // Deliberately alter persisted values; restore must recover the original data.
  await db.query("UPDATE public.recovery_fixture SET amount_minor=1");
  await productionRecovery("verify", fixtureEnv);
  assert.deepEqual(await productionTableEvidence(db), tables);
  const evidence = JSON.parse(await readFile(join(root, "verification.json"), "utf8"));
  assert.equal(evidence.status, "RESTORE_VERIFIED");
  assert.equal(evidence.commit, process.env.GITHUB_SHA);
  console.log("DISPOSABLE_PRODUCTION_RECOVERY_FIXTURE_PASS");
} finally {
  await db.end();
  fixtureEnv.SERAMET_PRODUCTION_BACKUP_KEY = "";
  await rm(directory, { recursive: true, force: true });
}
