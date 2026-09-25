import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function assessHealthPayload(endpoint, data, expectedSchemaVersion) {
  if (!data || typeof data !== "object" || data.ok !== true) {
    const issues = Array.isArray(data?.issues)
      ? data.issues.map((issue) => String(issue?.code ?? "UNKNOWN"))
      : ["INVALID_HEALTH_RESPONSE"];
    return { ready: false, issues };
  }
  if (endpoint !== "live" && data.environment !== "staging") {
    return { ready: false, issues: ["NOT_STAGING_ENVIRONMENT"] };
  }
  if (endpoint !== "live" && data.schemaVersion !== expectedSchemaVersion) {
    return { ready: false, issues: ["STALE_DATABASE_SCHEMA"] };
  }
  return { ready: true, issues: [] };
}

export async function verifyStagingEndpoint({
  endpoint,
  origin,
  expectedSchemaVersion,
  fetchFn = fetch,
  attempts = 10,
  retryMs = 5_000,
}) {
  if (!["live", "operational", "ready"].includes(endpoint)) {
    throw new Error("Unsupported staging health endpoint");
  }
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Staging health requires a trusted HTTPS origin without credentials");
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let status = "UNREACHABLE";
    try {
      const response = await fetchFn(new URL("/api/seramet/health/" + endpoint, parsed), {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const payload = await response.json();
        const check = assessHealthPayload(endpoint, payload, expectedSchemaVersion);
        if (check.ready) {
          console.log("Staging " + endpoint + " readiness: PASS");
          return;
        }
        status = check.issues.join(", ") || "HEALTH_NOT_READY";
        if (check.issues.includes("MALWARE_SCANNER_REQUIRED")) {
          throw new Error("MALWARE_SCANNER_REQUIRED: configure the real Cloudflare scanner service binding");
        }
      } else {
        status = "HTTP_" + response.status;
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("MALWARE_SCANNER_REQUIRED:")) {
        throw cause;
      }
      status = cause instanceof Error ? cause.name : "HEALTH_REQUEST_FAILED";
    }
    console.log("Staging " + endpoint + " check " + attempt + "/" + attempts + ": " + status);
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, retryMs));
  }
  throw new Error("Staging " + endpoint + " did not reach full readiness");
}

async function main() {
  const endpoint = process.argv[2];
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.SERAMET_PUBLIC_ORIGIN) {
    throw new Error("This health gate runs only in GitHub staging deployment");
  }
  const source = readFileSync("src/server/database/schema-version.ts", "utf8");
  const match = /CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(source);
  if (!match) throw new Error("Unable to determine required database schema version");
  await verifyStagingEndpoint({
    endpoint,
    origin: process.env.SERAMET_PUBLIC_ORIGIN,
    expectedSchemaVersion: Number(match[1]),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
