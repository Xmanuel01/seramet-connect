import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assessProductionHealth(data, expectedSchemaVersion, expectedBuildId) {
  const issues = [];
  if (!data || typeof data !== "object" || data.ok !== true) issues.push("HEALTH_NOT_READY");
  if (data?.environment !== "production") issues.push("NOT_PRODUCTION_ENVIRONMENT");
  if (data?.schemaVersion !== expectedSchemaVersion) issues.push("STALE_DATABASE_SCHEMA");
  if (data?.database !== "authoritative") issues.push("DATABASE_NOT_AUTHORITATIVE");
  if (data?.queue !== "available") issues.push("DURABLE_QUEUE_UNAVAILABLE");
  if (data?.buildId !== expectedBuildId) issues.push("DEPLOYED_BUILD_MISMATCH");
  if (!Array.isArray(data?.issues) || data.issues.length !== 0)
    issues.push("RUNTIME_ISSUES_REMAIN");
  return { ready: issues.length === 0, issues };
}

export async function verifyProductionHealth({
  origin,
  expectedSchemaVersion,
  expectedBuildId,
  fetchFn = fetch,
}) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PRODUCTION_ORIGIN_INVALID");
  }
  if (
    !Number.isSafeInteger(expectedSchemaVersion) ||
    expectedSchemaVersion < 1 ||
    !/^[a-f0-9]{40}$/.test(expectedBuildId ?? "")
  ) {
    throw new Error("PRODUCTION_RELEASE_IDENTITY_INVALID");
  }
  const results = [];
  for (const endpoint of ["operational", "ready"]) {
    let response;
    let payload;
    try {
      response = await fetchFn(new URL(`/api/seramet/health/${endpoint}`, url), {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("HTTP_REJECTION");
      payload = await response.json();
    } catch {
      throw new Error(`PRODUCTION_${endpoint.toUpperCase()}_REQUEST_FAILED`);
    }
    const check = assessProductionHealth(payload, expectedSchemaVersion, expectedBuildId);
    if (!check.ready)
      throw new Error(`PRODUCTION_${endpoint.toUpperCase()}_REJECTED: ${check.issues.join(",")}`);
    results.push({ endpoint, ...check });
  }
  // Queue binding checks do not certify a running consumer, real providers or physical printing.
  return { runtimeReady: true, results, operationalAcceptance: "NOT_PERFORMED" };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const source = readFileSync("src/server/database/schema-version.ts", "utf8");
    const match = /CURRENT_SCHEMA_VERSION\s*=\s*(\d+)/.exec(source);
    if (!match) throw new Error("SCHEMA_VERSION_UNAVAILABLE");
    const result = await verifyProductionHealth({
      origin: process.env.SERAMET_PUBLIC_ORIGIN,
      expectedSchemaVersion: Number(match[1]),
      expectedBuildId: process.env.SERAMET_EXPECTED_BUILD_ID,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const message =
      error instanceof Error && /^PRODUCTION_|^SCHEMA_VERSION_UNAVAILABLE$/.test(error.message)
        ? error.message
        : "PRODUCTION_HEALTH_VERIFICATION_FAILED";
    process.stderr.write(message + "\n");
    process.exitCode = 1;
  }
}
