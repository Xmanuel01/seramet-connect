import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyExistingCloudflareQueue(payload, name) {
  if (!name?.trim()) throw new Error("An explicit queue name is required");
  if (payload?.success !== true) throw new Error("Could not verify existing Cloudflare queues");
  const rows = Array.isArray(payload.result) ? payload.result : payload.result?.queues;
  if (!Array.isArray(rows)) throw new Error("Unexpected Cloudflare queue response");
  if (!rows.some((row) => row && (row.queue_name ?? row.name) === name)) {
    throw new Error(`Queue ${name} could not be created or verified`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [name, path] = process.argv.slice(2);
  if (!path) throw new Error("An explicit queue response file is required");
  verifyExistingCloudflareQueue(JSON.parse(readFileSync(path, "utf8")), name);
  console.log(`Verified existing queue: ${name}`);
}
