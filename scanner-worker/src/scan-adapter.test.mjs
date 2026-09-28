import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    {
      ...result("CLEAN"),
      json: async () => ({
        status: "CLEAN",
        engine: "clamav",
        signatureVersion: "daily",
        reference: " ",
      }),
    },
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

test("WorkerEntrypoint exposes private scan RPC but rejects all HTTP requests", async () => {
  const source = await readFile(new URL("./index.mjs", import.meta.url), "utf8");
  const stub =
    "data:text/javascript," +
    encodeURIComponent("export class WorkerEntrypoint { constructor() { this.env = {}; } }");
  const adapter = new URL("./scan-adapter.mjs", import.meta.url).href;
  const injected = source
    .replace('"cloudflare:workers"', JSON.stringify(stub))
    .replace('"./scan-adapter.mjs"', JSON.stringify(adapter));
  const module = await import(
    "data:text/javascript;base64," + Buffer.from(injected).toString("base64")
  );
  const worker = new module.default();

  for (const method of ["GET", "POST"]) {
    const response = await worker.fetch(new Request("https://private.invalid/scan", { method }));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(await response.text(), "Not found");
  }
  assert.deepEqual(await worker.scan(input), { status: "ERROR" });
  const config = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /^workers_dev = false$/m);
});
