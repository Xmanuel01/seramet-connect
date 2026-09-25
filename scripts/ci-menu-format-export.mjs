import fs from "node:fs";
import { execFileSync } from "node:child_process";

const paths = [
  "src/components/app/MenuCatalogDialog.tsx",
  "src/routes/menu-import.tsx",
  "src/onboarding/onboarding-service.ts",
  "src/onboarding/use-setup-centre.ts",
  "src/server/onboarding-api.ts",
  "src/onboarding/pass-8-commercial-productization.test.ts",
  "src/onboarding/manual-menu-draft.ts",
  "src/onboarding/manual-menu-draft.test.ts",
  "scripts/verify-crm-postgres-runtime.ts",
];
const before = new Map(paths.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...paths], { stdio: "inherit" });
for (const path of paths) {
  const content = fs.readFileSync(path, "utf8");
  if (content !== before.get(path)) {
    process.stdout.write("MENU_FORMAT_JSON " + JSON.stringify({ path, content }) + "\n");
  }
}
