import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = [
  "local-print-bridge/server.mjs",
  "local-print-bridge/spool-ledger.mjs",
  "local-print-bridge/spool-ledger.test.mjs",
  "src/hooks/use-seramet-print-queue.ts",
  "src/lib/durable-kot-client.ts",
  "src/lib/durable-kot-client.test.ts",
  "src/lib/kitchen-print-outbox.ts",
  "src/lib/kitchen-print-outbox.test.ts",
  "src/lib/seramet-api.ts",
  "src/lib/seramet-repository.ts",
  "src/lib/seramet-print-service.ts",
  "src/lib/transaction-engine.ts",
  "src/routes/pos.tsx",
  "src/routes/seramet-printers.tsx",
  "src/platform/permissions.ts",
  "src/server/pass-5-production-foundation.test.ts",
  "src/server/database/authoritative-transaction-repository.ts",
];
execFileSync("./node_modules/.bin/prettier", ["--write", ...paths], { stdio: "inherit" });
const changed = new Set(
  execFileSync("git", ["diff", "--name-only", "--", ...paths], { encoding: "utf8" })
    .trim()
    .split("\n"),
);
let total = 0;
for (const path of paths) {
  if (!changed.has(path)) continue;
  const encoded = encodeURIComponent(readFileSync(path, "utf8"));
  let i = 0;
  for (let offset = 0; offset < encoded.length; offset += 1500) {
    console.log(`__SERAMET_FMT__::${path}::${i++}::${encoded.slice(offset, offset + 1500)}`);
  }
  total += 1;
}
console.log(`__SERAMET_FMT_DONE__::${total}`);
