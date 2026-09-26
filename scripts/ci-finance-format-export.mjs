import fs from "node:fs";
import { execFileSync } from "node:child_process";
const paths = [
  "scripts/ci-finance-format-export.mjs",
  "scripts/verify-finance-postgres.ts",
  "src/finance/AdvancedFinanceModules.tsx",
  "src/finance/FinancialReports.tsx",
  "src/finance/finance-ui.tsx",
  "src/finance/financial-ledger-service.test.ts",
  "src/finance/financial-ledger-service.ts",
  "src/finance/use-finance-report.ts",
  "src/lib/seramet-api.ts",
  "src/routes/accounting.tsx",
  "src/routes/assets.tsx",
  "src/routes/balance-sheet.tsx",
  "src/routes/budgets.tsx",
  "src/routes/cash-flow.tsx",
  "src/routes/cost-centres.tsx",
  "src/routes/credit-notes.tsx",
  "src/routes/daily-sales-journal.tsx",
  "src/routes/depreciation.tsx",
  "src/routes/expenses.tsx",
  "src/routes/general-ledger.tsx",
  "src/routes/payables.tsx",
  "src/routes/prime-cost.tsx",
  "src/routes/profit-loss.tsx",
  "src/routes/receivables.tsx",
  "src/routes/tax-centre.tsx",
  "src/routes/trial-balance.tsx",
  "src/server/finance-api.ts"
];
const before = new Map(paths.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...paths], { stdio: "inherit" });
for (const path of paths) {
  const formatted = fs.readFileSync(path, "utf8");
  if (formatted === before.get(path)) continue;
  const chunkSize = 3500;
  for (let position = 0; position < formatted.length; position += chunkSize) {
    console.log("FINFMTCHUNK " + JSON.stringify({
      path, index: position / chunkSize, total: Math.ceil(formatted.length / chunkSize),
      part: formatted.slice(position, position + chunkSize),
    }));
  }
}
