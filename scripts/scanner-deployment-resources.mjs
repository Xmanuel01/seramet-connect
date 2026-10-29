const resources = {
  staging: {
    worker: "seramet-staging",
    bucket: "seramet-staging-objects",
    scanQueue: "seramet-staging-file-scan",
    scanDlq: "seramet-staging-file-scan-dlq",
    scanner: "seramet-file-scanner-staging",
  },
  production: {
    worker: "seramet-connect",
    bucket: "seramet-production-objects",
    scanQueue: "seramet-production-file-scan",
    scanDlq: "seramet-production-file-scan-dlq",
    scanner: "seramet-file-scanner-production",
  },
};

export function scannerDeploymentResources(target, env, { requireDlq = true } = {}) {
  if (!Object.hasOwn(resources, target)) {
    throw new Error("Scanner target must be staging or production");
  }
  const expected = resources[target];
  const fields = {
    worker: "SERAMET_CLOUDFLARE_WORKER_NAME",
    bucket: "SERAMET_CLOUDFLARE_R2_BUCKET",
    scanQueue: "SERAMET_CLOUDFLARE_SCAN_QUEUE",
    ...(requireDlq ? { scanDlq: "SERAMET_CLOUDFLARE_SCAN_DLQ" } : {}),
  };
  for (const [field, name] of Object.entries(fields)) {
    if (env[name]?.trim() !== expected[field]) {
      throw new Error(`Scanner ${target} resource mismatch: ${name}`);
    }
  }
  if (
    env.SERAMET_CLOUDFLARE_SCANNER_WORKER_NAME &&
    env.SERAMET_CLOUDFLARE_SCANNER_WORKER_NAME !== expected.scanner
  ) {
    throw new Error("Scanner Worker must belong to the selected environment");
  }
  return expected;
}

export function assertPrimaryScannerResources(target, env) {
  scannerDeploymentResources(target, env, { requireDlq: false });
  if (target !== "production") return;
  if (env.SERAMET_REUSE_EXISTING_VARS === "true") {
    throw new Error("Production must not reuse variables from an unpromoted preview version");
  }
  const expected = {
    SERAMET_CLOUDFLARE_HYPERDRIVE_ID: "4538af733065451c94d47beb2028390e",
    SERAMET_CLOUDFLARE_QUEUE: "seramet-production-live-work",
    SERAMET_CLOUDFLARE_DLQ: "seramet-production-live-dlq",
    SERAMET_SUPABASE_URL: "https://qnhqylslyhxjcksuhgyq.supabase.co",
    SERAMET_PUBLIC_ORIGIN: "https://pos.seramet.co.ke",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name]?.trim() !== value) throw new Error(`Production resource mismatch: ${name}`);
  }
  if (!/^[a-f0-9]{40}$/.test(env.SERAMET_BUILD_ID ?? "")) {
    throw new Error("Production requires an exact tested commit SHA");
  }
  if (
    env.SERAMET_ALLOWED_ORIGINS &&
    env.SERAMET_ALLOWED_ORIGINS !== expected.SERAMET_PUBLIC_ORIGIN
  ) {
    throw new Error("Production origins must match the approved POS hostname");
  }
}
