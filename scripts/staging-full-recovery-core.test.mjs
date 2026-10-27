import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeFullRecovery,
  fullRecoverySource,
  fullRecoveryRestore,
  validateFullManifest,
  digest,
  ident,
  fullRecoverySchemas,
} from "./staging-full-recovery-core.mjs";

const sha = "a".repeat(40);
const approved = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "Xmanuel01/seramet-connect",
  GITHUB_ACTOR: "Xmanuel01",
  GITHUB_TRIGGERING_ACTOR: "Xmanuel01",
  GITHUB_REF: "refs/heads/codex/phase3-completion",
  GITHUB_SHA: sha,
  SERAMET_PHASE3_RECOVERY_APPROVED_SHA: sha,
  SERAMET_PHASE3_FULL_RECOVERY_ACK: "true",
  SERAMET_STAGING_BACKUP_KEY_ESCROW_VERIFIED: "true",
};
test("full staging recovery needs exact owner, branch, consent, commit and key escrow", () => {
  assert.doesNotThrow(() => authorizeFullRecovery(approved));
  for (const [key, value] of Object.entries(approved)) {
    assert.throws(() =>
      authorizeFullRecovery({ ...approved, [key]: value === "true" ? "false" : "other" }),
    );
  }
});
test("source fences refuse production, transaction poolers, weak TLS and disguised hostnames", () => {
  const good =
    "postgresql://postgres.vnymbavsbxorwxpebkot:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";
  assert.equal(fullRecoverySource(good).ssl.rejectUnauthorized, true);
  for (const raw of [
    good.replace("vnymbavsbxorwxpebkot", "qnhqylslyhxjcksuhgyq"),
    good.replace(":5432", ":6543"),
    good.replace("verify-full", "require"),
    good.replace(".supabase.com", ".supabase.com.invalid"),
    good + "&sslrootcert=bad",
    good.replace("/postgres?", "/wrong?"),
  ])
    assert.throws(() => fullRecoverySource(raw));
});
test("restoration accepts only the fixed disposable loopback database", () => {
  const good = "postgresql://postgres:temporary@127.0.0.1:54329/seramet_full_restore";
  assert.ok(fullRecoveryRestore(good));
  for (const raw of [
    good.replace("127.0.0.1", "example.test"),
    good.replace("seramet_full_restore", "postgres"),
    good.replace("54329", "5432"),
    good + "?host=example.test",
  ])
    assert.throws(() => fullRecoveryRestore(raw));
});
test("full manifest requires Auth and Storage coverage, fresh identity and actual object evidence", () => {
  const bytes = Buffer.from("synthetic encrypted input");
  const manifest = {
    version: 1,
    project: "vnymbavsbxorwxpebkot",
    commit: sha,
    createdAt: new Date().toISOString(),
    schemas: fullRecoverySchemas,
    dumpSha256: digest(bytes),
    tables: fullRecoverySchemas.map((schema) => ({
      schema,
      table: "test",
      rows: "0",
      digest: digest(bytes),
    })),
    roles: [],
    applicationObjectReferences: 0,
    supabaseStorageObjects: 0,
  };
  assert.doesNotThrow(() => validateFullManifest(manifest, sha, bytes));
  for (const change of [
    { commit: "b".repeat(40) },
    { schemas: ["public"] },
    { tables: [{ schema: "public" }] },
    { applicationObjectReferences: 1 },
    { supabaseStorageObjects: 1 },
    { createdAt: "2020-01-01T00:00:00Z" },
    { dumpSha256: "bad" },
  ])
    assert.throws(() => validateFullManifest({ ...manifest, ...change }, sha, bytes));
});
test("recovery identifiers are quoted and bounded", () => {
  assert.equal(ident('a"b'), '"a""b"');
  for (const name of ["", "a\0b", "a".repeat(64)]) assert.throws(() => ident(name));
});
