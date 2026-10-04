import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const env = { ...process.env, CI: "true", SERAMET_E2E: "true" };
run(["exec", "vite-node", "scripts/seed-pilot-e2e.ts"], env);
run(["exec", "playwright", "test", "tests/e2e/pilot-two-terminal.spec.ts"], env);

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
