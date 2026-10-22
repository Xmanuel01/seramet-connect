import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assessProductionHealth, verifyProductionHealth } from "./verify-production-health.mjs";

const buildId = "a".repeat(40);
const healthy = {
  ok: true,
  environment: "production",
  schemaVersion: 30,
  database: "authoritative",
  queue: "available",
  buildId,
  issues: [],
};
const config = {
  origin: "https://restaurant.example",
  expectedSchemaVersion: 30,
  expectedBuildId: buildId,
};

test("HTTP 200 development, staging, stale schema and wrong revisions fail closed", () => {
  for (const changed of [
    { environment: "development" },
    { environment: "staging" },
    { schemaVersion: 29 },
    { buildId: "b".repeat(40) },
    { database: "unavailable" },
    { queue: "unavailable" },
    { ok: false },
    { issues: [{ code: "FAIL" }] },
  ]) {
    assert.equal(assessProductionHealth({ ...healthy, ...changed }, 30, buildId).ready, false);
  }
});

test("checks both independent endpoints once and does not claim operational acceptance", async () => {
  const paths = [];
  const result = await verifyProductionHealth({
    ...config,
    fetchFn: async (url, options) => {
      paths.push(url.pathname);
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.equal(options.method, undefined);
      assert.equal(options.headers, undefined);
      return new Response(JSON.stringify(healthy));
    },
  });
  assert.deepEqual(paths, ["/api/seramet/health/operational", "/api/seramet/health/ready"]);
  assert.equal(result.runtimeReady, true);
  assert.equal(result.operationalAcceptance, "NOT_PERFORMED");
});

test("rejects credentials, paths, queries and non-HTTPS before any request", async () => {
  let requests = 0;
  for (const origin of [
    "http://restaurant.example",
    "https://user:secret@restaurant.example",
    "https://restaurant.example/path",
    "https://restaurant.example?token=secret",
    "https://restaurant.example/#secret",
  ]) {
    await assert.rejects(
      verifyProductionHealth({
        ...config,
        origin,
        fetchFn: async () => {
          requests++;
        },
      }),
      /PRODUCTION_ORIGIN_INVALID/,
    );
  }
  assert.equal(requests, 0);
});

test("does not expose request errors, provider messages, tokens or SQL values", async () => {
  await assert.rejects(
    verifyProductionHealth({
      ...config,
      fetchFn: async () => {
        throw new Error("password=secret SQL SELECT private hostname.internal");
      },
    }),
    { message: "PRODUCTION_OPERATIONAL_REQUEST_FAILED" },
  );
  await assert.rejects(
    verifyProductionHealth({
      ...config,
      fetchFn: async () =>
        new Response(
          JSON.stringify({ ...healthy, ok: false, issues: [{ code: "password=secret" }] }),
        ),
    }),
    (error) => !error.message.includes("secret") && error.message.includes("HEALTH_NOT_READY"),
  );
});

test("rejects partial success and malformed responses without retries", async () => {
  let requests = 0;
  await assert.rejects(
    verifyProductionHealth({
      ...config,
      fetchFn: async () => {
        requests++;
        return new Response(requests === 1 ? JSON.stringify(healthy) : "invalid");
      },
    }),
    /PRODUCTION_READY_REQUEST_FAILED/,
  );
  assert.equal(requests, 2);
});

test("rejects missing release identity before connecting", async () => {
  await assert.rejects(
    verifyProductionHealth({
      ...config,
      expectedBuildId: "main",
      fetchFn: async () => {
        throw new Error("Must not connect");
      },
    }),
    /PRODUCTION_RELEASE_IDENTITY_INVALID/,
  );
});

test("manual verification remains main-only, owner-only and free of mutation credentials", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/production-runtime-verification.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.actor == github\.repository_owner/);
  assert.match(workflow, /github\.triggering_actor == github\.repository_owner/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: seramet-production/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /run: node scripts\/verify-production-health\.mjs/);
  assert.doesNotMatch(workflow, /secrets\.|write-all|contents: write|id-token: write/);
  assert.doesNotMatch(workflow, /migrate:postgres|wrangler deploy|lockdown|SERAMET_POSTGRES_URL/);
});
