import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = {
  ...process.env,
  CI: "true",
  SERAMET_E2E: "true",
  SERAMET_JWT_SECRET: "seramet-e2e-disposable-jwt-secret",
  SERAMET_JWT_ISSUER: "seramet-e2e",
  SERAMET_JWT_AUDIENCE: "seramet-e2e-browser",
};
run(["exec", "vite-node", "scripts/seed-pilot-e2e.ts"], env);
run(
  [
    "exec",
    "playwright",
    "test",
    "tests/e2e/pilot-two-terminal.spec.ts",
    "tests/e2e/menu-import-pipeline.spec.ts",
  ],
  env,
);

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
