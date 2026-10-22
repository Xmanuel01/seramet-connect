/** Remote migration connections must verify both the certificate chain and hostname. */
export function migrationConnectionConfig(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("MIGRATION_POSTGRES_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("MIGRATION_POSTGRES_URL_REQUIRED");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const mode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  if (!local && ((mode && mode !== "verify-full") || (ssl && ssl !== "true"))) {
    throw new Error("MIGRATION_TLS_VERIFICATION_REQUIRED");
  }
  // pg reparses URI TLS options after config.ssl; none may replace verification.
  for (const name of ["sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) {
    if (!local && url.searchParams.has(name)) throw new Error("MIGRATION_TLS_OVERRIDE_FORBIDDEN");
  }
  if (local) return { connectionString: raw };
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true as const } };
}
