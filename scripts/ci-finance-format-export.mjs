// Branch-only formatting extraction: revert to ordinary lint and delete after applying results.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const paths = [
  "src/finance/financial-ledger-service.ts",
  "src/finance/financial-ledger-service.test.ts",
  "src/finance/use-finance-report.ts",
  "src/finance/finance-ui.tsx",
  "src/finance/FinancialReports.tsx",
  "src/server/finance-api.ts",
  "src/lib/seramet-api.ts",
];
const before = new Map(paths.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...paths], { stdio: "inherit" });
for (const path of paths) {
  const formatted = fs.readFileSync(path, "utf8");
  if (formatted !== before.get(path)) {
    process.stdout.write("FINANCE_AUTO_FORMAT " + JSON.stringify({ path, content: formatted }) + "\n");
  }
}
