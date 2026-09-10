import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = [".output/public", ".output/server"];
const forbidden = [
  /sb_secret_[a-zA-Z0-9_-]+/,
  /service_role/i,
  /SERAMET_POSTGRES_URL/,
  /BEGIN PRIVATE KEY/,
  /tenant-mona-swahili/,
  /branch-westlands/,
  /branch-ngong-road/,
  /createLocalDevelopmentDatabase/,
  /createDefaultDemoPlatformState/,
];
const findings = [];
for (const root of roots) await scan(root);
if (findings.length) {
  throw new Error(`Production bundle audit failed:\n${findings.join("\n")}`);
}
process.stdout.write("Production bundle secret/demo identifier audit passed\n");

async function scan(path) {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) await scan(target);
    else if (/\.(?:js|mjs|json|html|css|map)$/i.test(entry.name)) {
      if (/local-development-database|default-demo-data|mock/i.test(entry.name)) {
        findings.push(`${target}: development-only artifact`);
      }
      const text = await readFile(target, "utf8");
      forbidden.forEach((pattern) => {
        if (pattern.test(text)) findings.push(`${target}: ${pattern}`);
      });
    }
  }
}
