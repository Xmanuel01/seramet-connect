import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  backupObjectFiles,
  objectReference,
  recoverObjectBytes,
} from "./staging-object-recovery.mjs";

const bytes = Buffer.from("quarantined QA file,not approved for parsing\n");
const row = {
  tenant_id: "tenant-qa",
  id: "file-qa",
  object_key: "tenant-qa/private/file-qa.csv",
  object_version: "original-r2-version",
  content_type: "text/csv",
  size_bytes: bytes.length,
  checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
  status: "QUARANTINED",
};
const env = {
  SERAMET_STAGING_OBJECT_BACKUP_ACK: "true",
  CLOUDFLARE_ACCOUNT_ID: "8ee23e839ee7d7c26ae144aeac841c88",
  SERAMET_STAGING_OBJECT_BACKUP_BUCKET: "seramet-staging-objects",
  CLOUDFLARE_API_TOKEN: "isolated-test-credential",
};
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "seramet-object-recovery-"));
  try {
    await mkdir(join(root, "encrypted"));
    await mkdir(join(root, "downloaded"));
    await run(root, randomBytes(32));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("referenced file bytes are encrypted, independently retrieved and recovered without remote writes", async () => {
  await fixture(async (root, key) => {
    const files = await backupObjectFiles({
      rows: [row],
      root,
      key,
      env,
      fetchFn: async (url, init) => {
        assert.match(
          url,
          /\/buckets\/seramet-staging-objects\/objects\/tenant-qa\/private\/file-qa.csv$/,
        );
        assert.equal(init.redirect, "error");
        assert.equal(init.method, undefined);
        return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
      },
    });
    const encrypted = await readFile(join(root, "encrypted", files[0].encryptedFile));
    assert.equal(encrypted.includes(bytes), false);
    await copyFile(
      join(root, "encrypted", files[0].encryptedFile),
      join(root, "downloaded", files[0].encryptedFile),
    );
    const result = await recoverObjectBytes({ rows: [row], files, root, key });
    assert.equal(result.referencedObjectFiles, 1);
    assert.equal(result.recoveredObjectBytes, bytes.length);
    assert.equal(result.remoteObjectRestore, false);
    assert.equal(files[0].status, "QUARANTINED");
    assert.equal(files[0].originalObjectVersion, "original-r2-version");
  });
});
test("object backup requires explicit consent and exact staging account/bucket", async () => {
  await fixture(async (root, key) => {
    for (const change of [
      { SERAMET_STAGING_OBJECT_BACKUP_ACK: "false" },
      { CLOUDFLARE_ACCOUNT_ID: "another-account" },
      { SERAMET_STAGING_OBJECT_BACKUP_BUCKET: "seramet-production-objects" },
      { CLOUDFLARE_API_TOKEN: "" },
    ]) {
      await assert.rejects(
        backupObjectFiles({
          rows: [row],
          root,
          key,
          env: { ...env, ...change },
          fetchFn: () => {
            throw new Error("Must not reach network");
          },
        }),
      );
    }
  });
});
test("missing, oversized and different object contents cannot produce backup evidence", async () => {
  await fixture(async (root, key) => {
    for (const response of [
      new Response("missing", { status: 404 }),
      new Response(Buffer.alloc(bytes.length + 1)),
      new Response(Buffer.alloc(bytes.length)),
    ]) {
      await assert.rejects(
        backupObjectFiles({ rows: [row], root, key, env, fetchFn: async () => response }),
      );
    }
  });
});
test("tampered ciphertext, missing files and substituted manifest references fail recovery", async () => {
  await fixture(async (root, key) => {
    const files = await backupObjectFiles({
      rows: [row],
      root,
      key,
      env,
      fetchFn: async () => new Response(bytes),
    });
    await assert.rejects(recoverObjectBytes({ rows: [row], files, root, key }));
    const encrypted = await readFile(join(root, "encrypted", files[0].encryptedFile));
    encrypted[encrypted.length - 1] ^= 1;
    await writeFile(join(root, "downloaded", files[0].encryptedFile), encrypted);
    await assert.rejects(recoverObjectBytes({ rows: [row], files, root, key }));
    await assert.rejects(
      recoverObjectBytes({
        rows: [row],
        files: [{ ...files[0], encryptedFile: "../escape" }],
        root,
        key,
      }),
    );
    await assert.rejects(recoverObjectBytes({ rows: [], files, root, key }));
  });
});
test("unsafe cross-tenant references and excessive sizes are refused", () => {
  for (const change of [
    { object_key: "other/private/file-qa.csv" },
    { object_key: "tenant-qa/private/../file-qa.csv" },
    { id: "../escape" },
    { size_bytes: 10 * 1024 * 1024 + 1 },
    { checksum_sha256: "bad" },
    { object_version: "" },
    { status: "DELETED" },
  ])
    assert.throws(() => objectReference({ ...row, ...change }));
});
test("empty object inventories preserve existing database-only recovery without object credentials", async () => {
  await fixture(async (root, key) => {
    const files = await backupObjectFiles({ rows: [], root, key, env: {} });
    assert.deepEqual(files, []);
    assert.equal(
      (await recoverObjectBytes({ rows: [], files, root, key })).referencedObjectFiles,
      0,
    );
  });
});
