import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const worker = (await import(pathToFileURL(resolve(".output/server/index.mjs")).href)).default;
assert.equal(typeof worker.fetch, "function");
let databaseCalls = 0;
const forbiddenDatabaseCall = () => {
  databaseCalls++;
  throw new Error("PUBLIC_RUNTIME_MUST_NOT_ACCESS_DATABASE");
};
const env = {
  SERAMET_ENVIRONMENT: "development",
  SERAMET_DB: { prepare: forbiddenDatabaseCall, batch: forbiddenDatabaseCall },
};
const context = { waitUntil() {}, passThroughOnException() {} };
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error("PUBLIC_RUNTIME_MUST_NOT_CONTACT_PROVIDERS");
};

try {
  for (const [method, path, foreignOrigin] of [
    ["GET", "/public/auth/config"],
    ["GET", "/public/device/startup"],
    ["GET", "/transactions"],
    ["POST", "/transactions/mutate"],
    ["POST", "/transactions/mutate", true],
    ["POST", "/public/auth/login"],
    ["POST", "/internal/file-scanner/claim"],
    ["POST", "/internal/file-scanner/verdict"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://restaurant.example/api/seramet${path}`, {
        method,
        headers: {
          host: "localhost",
          "x-forwarded-host": "localhost",
          ...(foreignOrigin ? { origin: "https://untrusted.example" } : {}),
        },
        ...(method === "POST" ? { body: "malformed JSON" } : {}),
      }),
      env,
      context,
    );
    assert.equal(response.status, 503, `${method} ${path}`);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await response.json()).code, "PUBLIC_DEVELOPMENT_RUNTIME");
  }
  const live = await worker.fetch(
    new Request("https://restaurant.example/api/seramet/health/live"),
    env,
    context,
  );
  assert.equal(live.status, 200);
  assert.equal(databaseCalls, 0);
  assert.equal(networkCalls, 0);
  console.info("COMPILED_PUBLIC_DEVELOPMENT_API_GUARD_PASS");
} finally {
  globalThis.fetch = originalFetch;
}
