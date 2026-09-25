import fs from "node:fs";
import { execFileSync } from "node:child_process";
const paths = ["src/routes/menu-import.tsx", "src/components/app/ManualMenuItemDialog.tsx", "src/onboarding/manual-menu-item.ts", "src/onboarding/manual-menu-item.test.ts"];
const before = new Map(paths.map((path) => [path, fs.readFileSync(path, "utf8")]));
execFileSync("./node_modules/.bin/prettier", ["--write", ...paths], { stdio: "inherit" });
for (const path of paths) {
  const content = fs.readFileSync(path, "utf8");
  if (content !== before.get(path)) process.stdout.write("MENU_AUTO_FORMAT " + JSON.stringify({path, content}) + "\n");
}
