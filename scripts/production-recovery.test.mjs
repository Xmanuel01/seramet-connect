import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  requireProductionRecoveryAuthorization,
  productionBackupConnection,
  isolatedProductionRestoreConnection,
  recoveryDigest,
  verifyProductionRecoveryManifest,
  quoteRecoveryIdentifier,
  productionTableEvidence,
} from "./production-recovery-core.mjs";
import { productionRecovery } from "./production-recovery.mjs";
import { prepareProductionRecoveryCa } from "./prepare-production-recovery-ca.mjs";
import { sealRecovery, openRecovery, recoveryKey } from "./staging-recovery-envelope.mjs";

const project = "abcdefghijklmnopqrst";
const env = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REPOSITORY_OWNER: "owner",
  GITHUB_ACTOR: "owner",
  GITHUB_TRIGGERING_ACTOR: "owner",
  GITHUB_SHA: "a".repeat(40),
  SERAMET_PRODUCTION_APPROVED_SHA: "a".repeat(40),
  SERAMET_PRODUCTION_OPERATION: "verify-recovery",
  SERAMET_PRODUCTION_PROJECT_REF: project,
};
const direct = `postgresql://seramet_production_backup:fixture@db.${project}.supabase.co:5432/postgres`;

test("only the owner, approved main revision and fixed operation are authorized", () => {
  assert.doesNotThrow(() => requireProductionRecoveryAuthorization(env));
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/other",
    GITHUB_REPOSITORY_OWNER: "invalid/login",
    GITHUB_ACTOR: "collaborator",
    GITHUB_TRIGGERING_ACTOR: "collaborator",
    GITHUB_SHA: "invalid",
    SERAMET_PRODUCTION_APPROVED_SHA: "b".repeat(40),
    SERAMET_PRODUCTION_OPERATION: "migrate",
    SERAMET_PRODUCTION_PROJECT_REF: "vnymbavsbxorwxpebkot",
  }))
    assert.throws(() => requireProductionRecoveryAuthorization({ ...env, [key]: value }));
  for (const key of Object.keys(env))
    assert.throws(() => requireProductionRecoveryAuthorization({ ...env, [key]: undefined }));
});

test("unauthorized invocations cannot read credentials, certificate data or connect", async () => {
  const denied = { ...env, GITHUB_TRIGGERING_ACTOR: "collaborator" };
  for (const key of [
    "SERAMET_PRODUCTION_BACKUP_POSTGRES_URL",
    "SERAMET_PRODUCTION_BACKUP_KEY",
    "SERAMET_PRODUCTION_POSTGRES_CA_PEM",
    "RUNNER_TEMP",
  ])
    Object.defineProperty(denied, key, {
      get() {
        assert.fail("secret or filesystem accessed before authorization");
      },
    });
  for (const mode of ["capture", "seal", "open", "verify", "migrate"])
    await assert.rejects(productionRecovery(mode, denied), /AUTHORIZATION_REQUIRED/);
  assert.throws(() => prepareProductionRecoveryCa(denied), /AUTHORIZATION_REQUIRED/);
});

test("production trust preparation verifies the pin and writes only fixed runner paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "seramet-production-ca-"));
  try {
    const root = rootCertificates
      .map((pem) => new X509Certificate(pem))
      .find(
        (cert) =>
          cert.ca &&
          cert.subject === cert.issuer &&
          cert.verify(cert.publicKey) &&
          Date.parse(cert.validFrom) <= Date.now() &&
          Date.parse(cert.validTo) > Date.now(),
      );
    assert.ok(root);
    const runner = {
      ...env,
      GITHUB_ACTIONS: "true",
      RUNNER_TEMP: directory,
      GITHUB_ENV: join(directory, "github-env"),
      SERAMET_PRODUCTION_POSTGRES_CA_PEM: root.toString(),
      SERAMET_PRODUCTION_POSTGRES_CA_SHA256: root.fingerprint256.replaceAll(":", ""),
    };
    const path = join(directory, "seramet-production-postgres-root.crt");
    assert.throws(() =>
      prepareProductionRecoveryCa({
        ...runner,
        SERAMET_PRODUCTION_POSTGRES_CA_SHA256: "0".repeat(64),
      }),
    );
    assert.throws(() => prepareProductionRecoveryCa({ ...runner, RUNNER_TEMP: "relative" }));
    assert.throws(() =>
      prepareProductionRecoveryCa({ ...runner, GITHUB_ENV: directory + "\nINJECTED=1" }),
    );
    assert.equal(existsSync(path), false);
    prepareProductionRecoveryCa(runner);
    assert.equal(readFileSync(path, "utf8"), root.toString());
    assert.equal(
      readFileSync(runner.GITHUB_ENV, "utf8"),
      `NODE_EXTRA_CA_CERTS=${path}\nPGSSLROOTCERT=${path}\n`,
    );
    assert.throws(() => prepareProductionRecoveryCa(runner), /EEXIST/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("dedicated direct and session-pooler backup connections require verified TLS and read-only defaults", () => {
  for (const url of [
    direct,
    `postgresql://seramet_production_backup.${project}:fixture@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`,
  ]) {
    const config = productionBackupConnection(url, project);
    assert.equal(config.ssl.rejectUnauthorized, true);
    assert.equal(config.options, "-c default_transaction_read_only=on");
    assert.equal(new URL(config.connectionString).search, "");
  }
});

test("wrong projects, owner credentials, transaction pooling and URI overrides fail closed", () => {
  for (const raw of [
    direct.replace("seramet_production_backup", "postgres"),
    direct.replace(project, "z".repeat(20)),
    direct.replace(":5432", ":6543"),
    direct.replace("db.", "evil."),
    direct.replace(":fixture", ""),
    direct + "?sslmode=require",
    direct + "?ssl=false",
    direct + "?options=-c%20read_only=off",
    direct + "?host=localhost",
    direct + "?sslrootcert=attacker",
    direct + "#fragment",
    direct.replace("/postgres", "/other"),
  ])
    assert.throws(() => productionBackupConnection(raw, project));
});

test("destructive restore preparation is confined to the exact disposable loopback database", () => {
  const raw = "postgresql://postgres:fixture@127.0.0.1:54329/seramet_production_restore";
  assert.equal(isolatedProductionRestoreConnection(raw).connectionString, raw);
  for (const bad of [
    direct,
    raw.replace("127.0.0.1", "localhost"),
    raw.replace("54329", "5432"),
    raw.replace("seramet_production_restore", "postgres"),
    raw + "?host=production",
    raw + "#fragment",
  ])
    assert.throws(() => isolatedProductionRestoreConnection(bad));
});

test("recovery evidence binds project, revision, coverage, fresh time and every dump byte", () => {
  const dump = Buffer.from("disposable fixture");
  const now = Date.now();
  const manifest = {
    version: 1,
    environment: "production",
    projectRef: project,
    commit: env.GITHUB_SHA,
    coverage: "PUBLIC_APPLICATION_SCHEMA_ONLY",
    createdAt: new Date(now).toISOString(),
    tables: [],
    policyRoles: [],
    dumpSha256: recoveryDigest(dump),
  };
  assert.doesNotThrow(() => verifyProductionRecoveryManifest(manifest, env, dump, now));
  for (const change of [
    { environment: "staging" },
    { projectRef: "z".repeat(20) },
    { commit: "b".repeat(40) },
    { coverage: "everything" },
    { createdAt: new Date(now - 7200001).toISOString() },
    { createdAt: new Date(now + 1).toISOString() },
    { createdAt: "invalid" },
    { tables: null },
    { policyRoles: null },
    { dumpSha256: "bad" },
  ])
    assert.throws(() =>
      verifyProductionRecoveryManifest({ ...manifest, ...change }, env, dump, now),
    );
  assert.throws(() => verifyProductionRecoveryManifest(manifest, env, Buffer.from("changed"), now));
});

test("both backup envelopes are authenticated, randomized and reject tampering or wrong keys", () => {
  const key = recoveryKey(Buffer.alloc(32, 9).toString("base64"));
  const content = Buffer.from("fixture only");
  const first = sealRecovery(content, key);
  assert.notDeepEqual(first, sealRecovery(content, key));
  assert.deepEqual(openRecovery(first, key), content);
  for (const position of [0, 25, first.length - 1]) {
    const corrupt = Buffer.from(first);
    corrupt[position] ^= 1;
    assert.throws(() => openRecovery(corrupt, key));
  }
  assert.throws(() => openRecovery(first, Buffer.alloc(32, 10)));
});

test("record evidence hashes persisted values, preserving row count does not conceal modification", async () => {
  const client = (record) => ({
    query: async (sql) => {
      if (sql.includes("pg_catalog.pg_tables")) return { rows: [{ tablename: 'fixture"table' }] };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "1", bytes: "30" }] };
      assert.match(sql, /public\."fixture""table"/);
      return { rows: [{ record }] };
    },
  });
  const before = await productionTableEvidence(client('{"amount":100}'));
  const after = await productionTableEvidence(client('{"amount":200}'));
  assert.equal(before[0].count, after[0].count);
  assert.notEqual(before[0].dataSha256, after[0].dataSha256);
  assert.equal(quoteRecoveryIdentifier('a"b'), '"a""b"');
  assert.throws(() => quoteRecoveryIdentifier("a\0b"));
});

test("capacity limits reject incomplete recovery rather than silently omitting rows", async () => {
  await assert.rejects(
    productionTableEvidence({
      query: async (sql) => ({
        rows: sql.includes("pg_catalog.pg_tables")
          ? [{ tablename: "fixture" }]
          : [{ count: "100001", bytes: "1" }],
      }),
    }),
    /CAPACITY_EXCEEDED/,
  );
});

test("CLI failures expose no supplied connection, SQL or secret", () => {
  const result = spawnSync(process.execPath, ["scripts/production-recovery.mjs", "capture"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      GITHUB_TRIGGERING_ACTOR: "other",
      SERAMET_PRODUCTION_BACKUP_POSTGRES_URL: "fixture-private-host-password",
      SERAMET_PRODUCTION_BACKUP_KEY: "fixture-secret",
    },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.trim(), "PRODUCTION_RECOVERY_FAILED");
});

test("manual recovery workflow isolates secrets, verifies owner reruns and never migrates production", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/production-recovery-verification.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.match(workflow, /github\.triggering_actor == github\.repository_owner/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /production-recovery\/encrypted\/\*\.enc/);
  assert.doesNotMatch(workflow, /migrate:postgres|wrangler deploy|supabase db push|lockdown/i);
  const verifyStep = workflow.split("- name: Verify isolated restoration")[1].split("- name:")[0];
  assert.doesNotMatch(verifyStep, /secrets\.|BACKUP_POSTGRES_URL|BACKUP_KEY/);
});
