import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { recoveryKey, sealRecovery, openRecovery } from "./staging-recovery-envelope.mjs";

test("encrypted recovery round trip preserves bytes and rejects tampering and wrong keys", () => {
  const key = recoveryKey(randomBytes(32).toString("base64"));
  const data = randomBytes(8192);
  const sealed = sealRecovery(data, key);
  assert.deepEqual(openRecovery(sealed, key), data);
  assert.notDeepEqual(sealRecovery(data, key), sealed);
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 20] ^= 1;
  assert.throws(() => openRecovery(tampered, key));
  assert.throws(() => openRecovery(sealed, randomBytes(32)));
  assert.throws(() => recoveryKey("short"));
  assert.throws(() => openRecovery(Buffer.alloc(8), key));
});

test("CLI encrypts and recovers both files from retained ciphertext without logging the key", async () => {
  const root = await mkdtemp(join(tmpdir(), "seramet-recovery-test-"));
  const key = randomBytes(32).toString("base64");
  const names = ["seramet-staging-public.dump", "seramet-staging-source-evidence.json"];
  try {
    for (const name of names) await writeFile(join(root, name), randomBytes(200));
    const encrypted = join(root, "encrypted");
    const recovered = join(root, "recovered");
    for (const args of [
      ["seal", root, encrypted],
      ["open", encrypted, recovered],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/staging-recovery-envelope.mjs", ...args],
        {
          encoding: "utf8",
          env: { ...process.env, SERAMET_STAGING_BACKUP_KEY: key },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key));
    }
    for (const name of names)
      assert.deepEqual(await readFile(join(root, name)), await readFile(join(recovered, name)));
    const failed = spawnSync(
      process.execPath,
      ["scripts/staging-recovery-envelope.mjs", "open", encrypted, join(root, "wrong-key")],
      {
        encoding: "utf8",
        env: { ...process.env, SERAMET_STAGING_BACKUP_KEY: randomBytes(32).toString("base64") },
      },
    );
    assert.equal(failed.status, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
