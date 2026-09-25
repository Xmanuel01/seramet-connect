import assert from "node:assert/strict";
import { test } from "node:test";
import { assessHealthPayload, verifyStagingEndpoint } from "./verify-staging-health.mjs";

test("HTTP 200 with failed readiness is never treated as a successful deployment", () => {
  assert.deepEqual(
    assessHealthPayload(
      "ready",
      { ok: false, environment: "staging", issues: [{ code: "MALWARE_SCANNER_REQUIRED" }] },
      26,
    ),
    { ready: false, issues: ["MALWARE_SCANNER_REQUIRED"] },
  );
});

test("stale operational schema cannot pass the staging gate", () => {
  assert.deepEqual(
    assessHealthPayload("operational", { ok: true, environment: "staging", schemaVersion: 25 }, 26),
    { ready: false, issues: ["STALE_DATABASE_SCHEMA"] },
  );
});

test("only the correct staging environment and schema pass", () => {
  assert.deepEqual(
    assessHealthPayload("ready", { ok: true, environment: "staging", schemaVersion: 26 }, 26),
    { ready: true, issues: [] },
  );
  assert.equal(
    assessHealthPayload("ready", { ok: true, environment: "production", schemaVersion: 26 }, 26)
      .ready,
    false,
  );
});

test("a missing scanner fails immediately without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    verifyStagingEndpoint({
      endpoint: "ready",
      origin: "https://example.test",
      expectedSchemaVersion: 26,
      fetchFn: async () => {
        calls += 1;
        return {
          ok: true,
          async json() {
            return {
              ok: false,
              issues: [{ code: "MALWARE_SCANNER_REQUIRED" }],
              schemaVersion: 26,
              environment: "staging",
            };
          },
        };
      },
      retryMs: 0,
    }),
    /MALWARE_SCANNER_REQUIRED/,
  );
  assert.equal(calls, 1);
});

test("temporary stale schema retries and eventually passes when reloaded", async () => {
  let calls = 0;
  await verifyStagingEndpoint({
    endpoint: "operational",
    origin: "https://example.test",
    expectedSchemaVersion: 26,
    fetchFn: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { ok: true, environment: "staging", schemaVersion: calls === 1 ? 25 : 26 };
        },
      };
    },
    retryMs: 0,
    attempts: 2,
  });
  assert.equal(calls, 2);
});
