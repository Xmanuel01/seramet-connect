import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { stagingTlsConfig } from "./staging-postgres-tls.mjs";
import { databaseFailureDiagnostic } from "./staging-database-diagnostics.mjs";

const project = "vnymbavsbxorwxpebkot";
const role = "seramet_staging_diagnostic";
const timeout = 8000;
function fail(code) {
  throw Object.assign(new Error("Diagnostic blocked"), { diagnosticCode: code });
}
export function diagnosticConfig(raw) {
  if (!raw) fail("READONLY_CREDENTIAL_MISSING");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("CONFIGURATION_INVALID");
  }
  const user = decodeURIComponent(url.username);
  const direct = url.hostname === `db.${project}.supabase.co` && user === role;
  const pooler = /(^|\.)pooler\.supabase\.com$/.test(url.hostname) && user === `${role}.${project}`;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !(direct || pooler) ||
    url.pathname !== "/postgres" ||
    (url.port && url.port !== "5432") ||
    !url.password
  )
    fail("TARGET_OR_ROLE_MISMATCH");
  for (const key of url.searchParams.keys()) {
    if (!["sslmode", "ssl"].includes(key)) fail("CONFIGURATION_OVERRIDE_REJECTED");
  }
  return {
    ...stagingTlsConfig(raw),
    options: "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=2000",
    connectionTimeoutMillis: timeout,
    query_timeout: timeout,
    application_name: "seramet-staging-readonly-diagnostic",
  };
}

export async function readonlyProbe(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const result = await client.query(
      "SELECT current_database() AS database_name, current_user AS role_name, " +
        "current_setting('transaction_read_only') AS read_only, " +
        "(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_ssl, " +
        "(SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls " +
        "FROM pg_roles WHERE rolname=current_user) AS elevated, " +
        "pg_has_role(current_user,'postgres','MEMBER') AS owner_member",
    );
    const row = result.rows[0];
    if (
      row?.database_name !== "postgres" ||
      row.role_name !== role ||
      row.read_only !== "on" ||
      row.elevated !== false ||
      row.owner_member !== false
    )
      fail("READONLY_IDENTITY_REJECTED");
    return row.backend_ssl === true;
  } finally {
    await client.query("ROLLBACK");
  }
}

async function tcpProbe(host, port, verifyTls) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let secure;
    const finish = (error) => {
      clearTimeout(timer);
      secure?.destroy();
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(Object.assign(new Error(), { code: "ETIMEDOUT" })),
      timeout,
    );
    socket.once("error", finish);
    socket.once("connect", () => {
      if (!verifyTls) return finish();
      // PostgreSQL SSLRequest precedes TLS. Never send credentials on this probe.
      const packet = Buffer.alloc(8);
      packet.writeInt32BE(8, 0);
      packet.writeInt32BE(80877103, 4);
      socket.write(packet);
      socket.once("data", (bytes) => {
        if (bytes.length !== 1 || bytes[0] !== 83)
          return finish(Object.assign(new Error(), { diagnosticCode: "TLS_NOT_SUPPORTED" }));
        secure = tls.connect({ socket, servername: host, rejectUnauthorized: true });
        secure.once("error", finish);
        secure.once("secureConnect", () => {
          if (!secure.authorized)
            return finish(Object.assign(new Error(), { diagnosticCode: "TLS_NOT_AUTHORIZED" }));
          finish();
        });
      });
    });
  });
}

export function reportFailure(error, stage) {
  const allowed = new Set([
    "READONLY_CREDENTIAL_MISSING",
    "CONFIGURATION_INVALID",
    "TARGET_OR_ROLE_MISMATCH",
    "CONFIGURATION_OVERRIDE_REJECTED",
    "READONLY_IDENTITY_REJECTED",
    "TLS_NOT_SUPPORTED",
    "TLS_NOT_AUTHORIZED",
  ]);
  const diagnostic = databaseFailureDiagnostic(error, stage === "query" ? "query" : "connect");
  return {
    stage: ["configuration", "dns", "tcp", "tls", "authentication", "query"].includes(stage)
      ? stage
      : "unknown",
    status: "FAIL",
    category: allowed.has(error?.diagnosticCode) ? "SECURITY_PREREQUISITE" : diagnostic.category,
    code: allowed.has(error?.diagnosticCode) ? error.diagnosticCode : diagnostic.code,
  };
}

async function main() {
  let stage = "configuration";
  let client;
  try {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_ACTOR !== process.env.GITHUB_REPOSITORY_OWNER ||
      process.env.SERAMET_ENVIRONMENT !== "staging"
    )
      fail("CONFIGURATION_INVALID");
    const config = diagnosticConfig(process.env.SERAMET_STAGING_READONLY_POSTGRES_URL);
    const url = new URL(config.connectionString);
    const pass = () => console.log(JSON.stringify({ stage, status: "PASS" }));
    pass();
    stage = "dns";
    let timer;
    try {
      await Promise.race([
        lookup(url.hostname),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error(), { code: "ETIMEDOUT" })),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    pass();
    stage = "tcp";
    await tcpProbe(url.hostname, Number(url.port || 5432), false);
    pass();
    stage = "tls";
    await tcpProbe(url.hostname, Number(url.port || 5432), true);
    pass();
    stage = "authentication";
    client = new pg.Client(config);
    await client.connect();
    if (!client.connection.stream.encrypted || !client.connection.stream.authorized)
      fail("TLS_NOT_AUTHORIZED");
    pass();
    stage = "query";
    const backendTls = await readonlyProbe(client);
    pass();
    console.log(
      JSON.stringify({
        stage: "query",
        category: "BACKEND_TLS",
        status: backendTls ? "PASS" : "FAIL",
        code: backendTls ? "VERIFIED" : "DATABASE_SSL_NOT_VERIFIED",
      }),
    );
    if (!backendTls) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify(reportFailure(error, stage)));
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
