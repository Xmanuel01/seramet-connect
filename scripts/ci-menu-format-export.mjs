// Temporary PR-only formatter export. Removed immediately after exact CI formatting is applied.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const paths = [
  "src/routes/menu-import.tsx",
  "src/onboarding/onboarding-service.ts",
  "scripts/verify-crm-postgres-runtime.ts",
];
const files = paths.filter((path) => fs.existsSync(path));
const before = new Map(files.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...files], { stdio: "inherit" });
for (const path of files) {
  const formatted = fs.readFileSync(path, "utf8");
  if (formatted !== before.get(path)) {
    process.stdout.write("MENU_AUTO_FORMAT " + JSON.stringify({ path, formatted }) + "\n");
  }
}
