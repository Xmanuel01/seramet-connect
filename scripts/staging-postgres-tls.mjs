export function stagingTlsConfig(raw) {
  const url = new URL(raw);
  const mode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  if ((mode && mode !== "verify-full") || (ssl && ssl !== "true")) {
    throw new Error("STAGING_TLS_REQUIRES_VERIFY_FULL");
  }
  // pg reparses connectionString after applying config.ssl. Remove URI TLS
  // overrides so certificate and hostname verification cannot be replaced.
  for (const name of ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    if (!["sslmode", "ssl"].includes(name) && url.searchParams.has(name)) {
      throw new Error("STAGING_TLS_OVERRIDE_NOT_SUPPORTED");
    }
    url.searchParams.delete(name);
  }
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true } };
}
