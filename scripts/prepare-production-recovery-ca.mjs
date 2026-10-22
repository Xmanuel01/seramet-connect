import { appendFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateStagingRoot } from "./prepare-staging-postgres-ca.mjs";
import { requireProductionRecoveryAuthorization } from "./production-recovery-core.mjs";

export function prepareProductionRecoveryCa(env = process.env) {
  requireProductionRecoveryAuthorization(env);
  if (
    env.GITHUB_ACTIONS !== "true" ||
    !isAbsolute(env.RUNNER_TEMP ?? "") ||
    !isAbsolute(env.GITHUB_ENV ?? "") ||
    /[\r\n]/.test(env.RUNNER_TEMP + env.GITHUB_ENV)
  )
    throw new Error("PRODUCTION_RECOVERY_RUNNER_INVALID");
  // Reuse certificate validation, not the staging authorization or identity guard.
  const pem = validateStagingRoot(
    env.SERAMET_PRODUCTION_POSTGRES_CA_PEM,
    env.SERAMET_PRODUCTION_POSTGRES_CA_SHA256,
  );
  const path = join(env.RUNNER_TEMP, "seramet-production-postgres-root.crt");
  writeFileSync(path, pem, { mode: 0o600, flag: "wx" });
  appendFileSync(env.GITHUB_ENV, `NODE_EXTRA_CA_CERTS=${path}\nPGSSLROOTCERT=${path}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    prepareProductionRecoveryCa();
    console.log("PRODUCTION_RECOVERY_CA_PREPARED");
  } catch {
    console.error("PRODUCTION_RECOVERY_CA_FAILED");
    process.exitCode = 1;
  }
}
