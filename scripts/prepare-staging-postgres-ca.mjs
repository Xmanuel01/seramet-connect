import { X509Certificate } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export function validateStagingRoot(pem, fingerprint, now = Date.now()) {
  if (
    typeof pem !== "string" ||
    pem.length > 16384 ||
    !/^\s*-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(
      pem,
    ) ||
    !/^[a-fA-F0-9]{64}$/.test(fingerprint ?? "")
  ) {
    throw new Error("STAGING_CA_CONFIGURATION_INVALID");
  }
  let certificate;
  try {
    certificate = new X509Certificate(pem);
  } catch {
    throw new Error("STAGING_CA_CERTIFICATE_INVALID");
  }
  if (
    !certificate.ca ||
    certificate.subject !== certificate.issuer ||
    !certificate.verify(certificate.publicKey) ||
    certificate.fingerprint256.replaceAll(":", "").toLowerCase() !== fingerprint.toLowerCase() ||
    !Number.isFinite(now) ||
    now < Date.parse(certificate.validFrom) ||
    now >= Date.parse(certificate.validTo)
  ) {
    throw new Error("STAGING_CA_TRUST_VALIDATION_FAILED");
  }
  return certificate.toString();
}

export function prepareStagingRoot(env = process.env) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.SERAMET_ENVIRONMENT !== "staging" ||
    !isAbsolute(env.RUNNER_TEMP ?? "") ||
    !isAbsolute(env.GITHUB_ENV ?? "") ||
    /[\r\n]/.test(env.RUNNER_TEMP + env.GITHUB_ENV)
  ) {
    throw new Error("STAGING_CA_RUNNER_INVALID");
  }
  const pem = validateStagingRoot(
    env.SERAMET_STAGING_POSTGRES_CA_PEM,
    env.SERAMET_STAGING_POSTGRES_CA_SHA256,
  );
  const path = join(env.RUNNER_TEMP, "seramet-staging-postgres-root.crt");
  writeFileSync(path, pem, { mode: 0o600, flag: "wx" });
  // Both clients retain certificate and hostname verification. Node reads this
  // additional trust anchor at startup; libpq uses the same verified root.
  appendFileSync(env.GITHUB_ENV, `NODE_EXTRA_CA_CERTS=${path}\nPGSSLROOTCERT=${path}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    prepareStagingRoot();
    console.log("STAGING_CA_PREPARED");
  } catch (error) {
    const code = /^STAGING_CA_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message
      : "STAGING_CA_PREPARATION_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}
