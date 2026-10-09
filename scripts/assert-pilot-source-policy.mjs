import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const findings = [];
await scan("src");
await scan("scanner-worker");
if (findings.length) {
  throw new Error(`Pilot source policy failed:\n${findings.join("\n")}`);
}
process.stdout.write("Pilot source policy passed\n");

async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      await scan(target);
      continue;
    }
    if (!/\.(?:ts|tsx|js|mjs)$/i.test(entry.name)) continue;
    const source = await readFile(target, "utf8");
    check(
      target,
      source,
      /stagingPrinterlessTestingEnabled|isStagingPrinterlessTestingEnabled/,
      "printer delivery bypass",
    );
    check(
      target,
      source,
      /SERAMET_MPESA_(?:CONSUMER_KEY|CONSUMER_SECRET|PASSKEY)\s*=\s*["'][^"']+["']/,
      "embedded M-Pesa credential",
    );
    check(
      target,
      source,
      /SERAMET_UBER_(?:CLIENT_ID|CLIENT_SECRET|WEBHOOK_SIGNING_SECRET)\s*=\s*["'][^"']+["']/,
      "embedded Uber credential",
    );
    check(
      target,
      source,
      /VITE_[A-Z0-9_]*(?:SECRET|PASSKEY|PRIVATE_KEY)/,
      "client-visible secret environment variable",
    );
    if (target.startsWith("src")) {
      check(
        target,
        source,
        /(?:from\s+|require\s*\(\s*)["'](?:node-clam|clamav|clamd)/i,
        "antivirus engine dependency in primary application source",
      );
    }
  }
}

function check(path, source, pattern, label) {
  if (pattern.test(source)) findings.push(`${path}: ${label}`);
}
