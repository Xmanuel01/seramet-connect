import assert from "node:assert/strict";
import { test } from "node:test";
import { scanViaClamavGateway } from "./scan-adapter.mjs";

const input = {
  bytes: new TextEncoder().encode("safe fixture").buffer,
  contentType: "text/csv",
  fileName: "private-menu.csv",
};
const env = {
  AV_UPSTREAM_URL: "https://scanner.internal.example/scan",
  AV_UPSTREAM_TOKEN: "a-secure-test-token-longer-than-24-chars",
};
const result = (status) => ({
  ok: true,
  status: 200,
  json: async () => ({
    status,
    engine: "clamav",
    signatureVersion: "daily-definitions-verified",
    reference: "private-test-ref",
  }),
});

test("private RPC adapter accepts verified clean result without forwarding original name", async () => {
  let observed;
  const verdict = await scanViaClamavGateway(input, env, async (url, init) => {
    observed = { url, init };
    return result("CLEAN");
  });
  assert.deepEqual(verdict, { status: "CLEAN", reference: "private-test-ref" });
  assert.equal(observed.init.headers["X-File-Extension"], ".csv");
  assert.ok(!JSON.stringify(observed.init.headers).includes("private-menu"));
  assert.equal(observed.init.redirect, "error");
});

test("verified infected fixture rejects the file", async () => {
  assert.equal(
    (await scanViaClamavGateway(input, env, async () => result("INFECTED"))).status,
    "INFECTED",
  );
});

test("unconfigured, insecure and missing token services all fail closed", async () => {
  assert.equal(
    (await scanViaClamavGateway(input, {}, async () => result("CLEAN"))).status,
    "ERROR",
  );
  assert.equal(
    (
      await scanViaClamavGateway(
        input,
        { ...env, AV_UPSTREAM_URL: "http://local.test/scan" },
        async () => result("CLEAN"),
      )
    ).status,
    "ERROR",
  );
  assert.equal(
    (
      await scanViaClamavGateway(input, { ...env, AV_UPSTREAM_TOKEN: "" }, async () =>
        result("CLEAN"),
      )
    ).status,
    "ERROR",
  );
});

test("malformed or spoofed clean response fails closed", async () => {
  for (const response of [
    { ...result("CLEAN"), json: async () => ({ status: "CLEAN" }) },
    result("UNKNOWN"),
    { ok: false, status: 503, json: async () => ({ status: "CLEAN" }) },
  ]) {
    assert.equal((await scanViaClamavGateway(input, env, async () => response)).status, "ERROR");
  }
});

test("timeouts, redirects, oversized files and upstream exceptions fail closed", async () => {
  assert.equal(
    (
      await scanViaClamavGateway(input, env, async () => {
        throw new Error("timeout");
      })
    ).status,
    "ERROR",
  );
  assert.equal(
    (await scanViaClamavGateway(input, env, async () => ({ ...result("CLEAN"), status: 301 })))
      .status,
    "ERROR",
  );
  assert.equal(
    (
      await scanViaClamavGateway(
        { ...input, bytes: new ArrayBuffer(21 * 1024 * 1024) },
        env,
        async () => result("CLEAN"),
      )
    ).status,
    "ERROR",
  );
});
