// Temporary branch-only CI formatting export. Remove this file and restore lint
// immediately after importing the formatted results into this PR's branch.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const paths = [
  "src/crm/use-crm-screen.ts",
  "src/routes/complaints.tsx",
  "src/routes/loyalty.tsx",
  "src/routes/segments.tsx",
  "src/routes/campaigns.tsx",
  "src/routes/crm-pipeline.tsx",
  "src/crm/crm-lead-service.ts",
  "src/crm/crm-lead-service.test.ts",
  "src/crm/schemas.ts",
  "src/crm/campaign-service.ts",
  "src/server/crm-api.ts",
];
const files = paths.filter((path) => fs.existsSync(path));
const before = new Map(files.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...files], { stdio: "inherit" });
for (const path of files) {
  const formatted = fs.readFileSync(path, "utf8");
  if (formatted !== before.get(path)) {
    process.stdout.write("CRM_AUTO_FORMAT " + JSON.stringify({ path, formatted }) + "\n");
  }
}
