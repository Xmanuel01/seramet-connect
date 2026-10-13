import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const magic = Buffer.from("SERAMET_RECOVERY_V1\n");
export function recoveryKey(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value ?? ""))
    throw new Error("Recovery key must be 32 random bytes in canonical base64");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value)
    throw new Error("Invalid recovery key");
  return key;
}
export function sealRecovery(bytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(magic);
  return Buffer.concat([magic, iv, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
}
export function openRecovery(bytes, key) {
  if (bytes.length < magic.length + 28 || !bytes.subarray(0, magic.length).equals(magic))
    throw new Error("Invalid recovery envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    bytes.subarray(magic.length, magic.length + 12),
  );
  decipher.setAAD(magic);
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(magic.length + 12, -16)), decipher.final()]);
}
async function main() {
  try {
    const [mode, source, destination] = process.argv.slice(2);
    if (!["seal", "open"].includes(mode) || !source || !destination)
      throw new Error("Invalid arguments");
    const key = recoveryKey(process.env.SERAMET_STAGING_BACKUP_KEY);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const name of ["seramet-staging-public.dump", "seramet-staging-source-evidence.json"]) {
      const inputPath = join(source, name + (mode === "open" ? ".enc" : ""));
      if ((await stat(inputPath)).size > 512 * 1024 * 1024)
        throw new Error("Recovery file exceeds supported 512 MiB limit");
      const input = await readFile(inputPath);
      const result = mode === "seal" ? sealRecovery(input, key) : openRecovery(input, key);
      await writeFile(join(destination, name + (mode === "seal" ? ".enc" : "")), result, {
        mode: 0o600,
      });
    }
    console.log("Recovery envelope " + mode + ": PASS");
  } catch {
    console.error("Recovery envelope failed; no credentials or data logged.");
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
