import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  CI: "true",
  SERAMET_E2E: "true",
  SERAMET_IDENTITY_PROVIDER: "internal",
  SERAMET_JWT_SECRET: "seramet-e2e-disposable-jwt-secret",
  SERAMET_JWT_ISSUER: "seramet-e2e",
  SERAMET_JWT_AUDIENCE: "seramet-e2e-browser",
  SERAMET_PRINT_SIGNING_KEY: randomBytes(32).toString("hex"),
};
run(["exec", "vite-node", "scripts/seed-pilot-e2e.ts"], env);
const focused = process.argv.slice(2);
const operational = "tests/e2e/printing-operational.spec.ts";
const audit = "tests/e2e/site-lifecycle-audit.spec.ts";
const auditCorrections = "tests/e2e/audit-corrections.spec.ts";
const categoryAcceptance = "tests/e2e/category-workflows.spec.ts";
const allowed = new Set([
  "tests/e2e/front-of-house.spec.ts",
  "tests/e2e/invoice-split.spec.ts",
  "tests/e2e/pos-dispatch-recovery.spec.ts",
  "tests/e2e/accounting-reporting.spec.ts",
  "tests/e2e/daily-closing.spec.ts",
  "tests/e2e/pilot-two-terminal.spec.ts",
  "tests/e2e/menu-import-pipeline.spec.ts",
  "tests/e2e/settings-setup-auth.spec.ts",
  "tests/e2e/attendance-geofence.spec.ts",
  "tests/e2e/staff-pilot.spec.ts",
  "tests/e2e/printing-admin.spec.ts",
  "tests/e2e/pos-stability.spec.ts",
  "tests/e2e/pos-startup.spec.ts",
  "tests/e2e/cashier-channels.spec.ts",
]);
if (
  focused.some(
    (suite) =>
      !allowed.has(suite) &&
      suite !== audit &&
      suite !== auditCorrections &&
      suite !== categoryAcceptance &&
      suite !== "tests/e2e/chef-kds.spec.ts" &&
      suite !== operational &&
      suite !== "tests/e2e/pos-session-soak.spec.ts",
  )
)
  throw new Error("Unknown local pilot acceptance suite");
if (
  focused.includes(operational) ||
  focused.includes(audit) ||
  focused.includes(auditCorrections) ||
  focused.includes(categoryAcceptance)
) {
  env.SERAMET_BRIDGE_MODE = "local-test";
  run(["exec", "vite-node", "scripts/seed-printing-operational.ts"], env);
}
if (focused.includes(categoryAcceptance))
  run(["exec", "vite-node", "scripts/seed-category-acceptance.ts"], env);
run(["exec", "playwright", "test", ...(focused.length ? focused : [...allowed])], env);

function run(args, environment) {
  const result = spawnSync(npm, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
