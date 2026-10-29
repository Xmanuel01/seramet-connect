import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openRecovery, sealRecovery } from "./staging-recovery-envelope.mjs";

const account = "8ee23e839ee7d7c26ae144aeac841c88";
export const objectBackupBucket = "seramet-staging-objects";
const maxFileBytes = 10 * 1024 * 1024;
const maxBackupBytes = 512 * 1024 * 1024;
const checksum = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function objectReference(row) {
  assert.ok(/^[a-zA-Z0-9_-]{1,128}$/.test(row.tenant_id));
  assert.ok(/^[a-zA-Z0-9_-]{1,128}$/.test(row.id));
  const key = String(row.object_key);
  const parts = key.split("/");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], row.tenant_id);
  assert.ok(["private", "public"].includes(parts[1]));
  assert.ok(
    ["csv", "xlsx", "pdf", "png", "jpg", "jpeg", "webp"].some(
      (extension) => parts[2] === `${row.id}.${extension}`,
    ),
  );
  assert.ok(/^[a-f0-9]{64}$/.test(row.checksum_sha256));
  assert.ok(
    typeof row.object_version === "string" &&
      row.object_version.length > 0 &&
      row.object_version.length <= 256 &&
      !/[\r\n\0]/.test(row.object_version),
  );
  assert.ok(
    typeof row.content_type === "string" &&
      row.content_type.length > 0 &&
      row.content_type.length <= 200,
  );
  const size = Number(row.size_bytes);
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= maxFileBytes);
  assert.ok(["PENDING_SCAN", "QUARANTINED", "ACTIVE"].includes(row.status));
  return {
    tenantId: row.tenant_id,
    objectId: row.id,
    objectKey: key,
    originalObjectVersion: row.object_version,
    contentType: row.content_type,
    sizeBytes: size,
    sha256: row.checksum_sha256,
    status: row.status,
    encryptedFile: `object-${checksum(key)}.bin.enc`,
  };
}

export function validateObjectFiles(rows, files) {
  assert.ok(Array.isArray(rows) && rows.length <= 512);
  assert.ok(Array.isArray(files));
  const expected = rows.map(objectReference);
  assert.equal(new Set(expected.map((file) => file.objectKey)).size, expected.length);
  assert.ok(expected.reduce((sum, file) => sum + file.sizeBytes, 0) <= maxBackupBytes);
  assert.deepEqual(files, expected);
  return expected;
}

export async function backupObjectFiles({ rows, root, key, env, fetchFn = fetch }) {
  const files = rows.map(objectReference);
  validateObjectFiles(rows, files);
  if (files.length) {
    assert.equal(env.SERAMET_STAGING_OBJECT_BACKUP_ACK, "true");
    assert.equal(env.CLOUDFLARE_ACCOUNT_ID, account);
    assert.equal(env.SERAMET_STAGING_OBJECT_BACKUP_BUCKET, objectBackupBucket);
    assert.ok(env.CLOUDFLARE_API_TOKEN);
  }
  for (const file of files) {
    const encodedKey = file.objectKey.split("/").map(encodeURIComponent).join("/");
    const response = await fetchFn(
      `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${objectBackupBucket}/objects/${encodedKey}`,
      {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert.ok(response.ok, "STAGING_OBJECT_BACKUP_READ_FAILED");
    if (response.headers.has("content-length")) {
      assert.equal(Number(response.headers.get("content-length")), file.sizeBytes);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    let bytes;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        assert.ok(length <= file.sizeBytes, "STAGING_OBJECT_BACKUP_SIZE_MISMATCH");
        chunks.push(Buffer.from(part.value));
      }
      bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, file.sizeBytes);
      assert.equal(checksum(bytes), file.sha256, "STAGING_OBJECT_BACKUP_HASH_MISMATCH");
      await writeFile(join(root, "encrypted", file.encryptedFile), sealRecovery(bytes, key), {
        mode: 0o600,
      });
    } finally {
      await reader.cancel().catch(() => {});
      for (const chunk of chunks) chunk.fill(0);
      bytes?.fill(0);
    }
  }
  return files;
}

export async function recoverObjectBytes({ rows, files, root, key }) {
  validateObjectFiles(rows, files);
  // Restore untrusted bytes only into this isolated in-memory fixture. Never
  // upload, execute, parse, mark clean or rewrite original R2 version evidence.
  for (const file of files) {
    const bytes = openRecovery(await readFile(join(root, "downloaded", file.encryptedFile)), key);
    try {
      assert.equal(bytes.length, file.sizeBytes);
      assert.equal(checksum(bytes), file.sha256);
    } finally {
      bytes.fill(0);
    }
  }
  return {
    referencedObjectFiles: files.length,
    recoveredObjectBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    objectManifestDigest: checksum(JSON.stringify(files)),
    objectRecoveryTarget: "ISOLATED_MEMORY_ONLY",
    remoteObjectRestore: false,
    remoteObjectVersionRemapping: "NOT_TESTED",
  };
}
