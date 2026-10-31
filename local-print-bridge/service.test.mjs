import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { startBridgeService } from "./service.mjs";

const origin = "https://pos.example.test";
const enrollment = (overrides = {}) => ({
  bridgeId: "front-desk-pc-3f2a",
  tenantId: "tenant",
  branchId: "branch",
  signingKey: randomBytes(32).toString("hex"),
  authorizationEndpoint: `${origin}/api/seramet/printing/consume`,
  token: randomBytes(32).toString("hex"),
  ...overrides,
});

async function service(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), "seramet-bridge-service-"));
  const configPath = join(dir, "config.json");
  const start = () =>
    startBridgeService({
      configPath,
      dataDir: join(dir, "data"),
      port: 0,
      pairingOrigins: [origin],
      bridgeOptions: {
        consume: async () => undefined,
        discoverPrinters: async () => [{ name: "Rooftop", driver: "Generic / Text Only" }],
      },
      ...options,
    });
  const running = await start();
  await running.listen();
  t.after(async () => {
    await running.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${running.server.address().port}`;
  const call = (path, init = {}) =>
    fetch(base + path, { ...init, headers: { Origin: origin, ...init.headers } });
  const pair = (body, headers = {}) =>
    call("/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { running, call, pair, configPath, start };
}

test("an unpaired bridge reports itself only to Seramet origins", async (t) => {
  const { call } = await service(t);
  const health = await call("/health");
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.paired, false);
  assert.equal(typeof body.machineName, "string");
  assert.equal(
    (await call("/health", { headers: { Origin: "https://evil.example" } })).status,
    403,
  );
  assert.equal((await call("/printers")).status, 503);
});

test("chrome's local network preflight is answered for Seramet origins", async (t) => {
  const { call } = await service(t);
  const preflight = await call("/pair", {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Private-Network": "true" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-private-network"), "true");
});

test("pairing stores the enrollment and serves printers with the new token", async (t) => {
  const { call, pair, configPath, running } = await service(t);
  const first = enrollment();
  const response = await pair(first);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).bridgeId, first.bridgeId);
  assert.equal(running.paired, true);
  const stored = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(stored.allowedOrigins, [origin]);
  assert.equal(stored.token, first.token);

  const health = await (await call("/health")).json();
  assert.equal(health.paired, true);
  assert.equal(health.bridgeId, first.bridgeId);
  assert.equal((await call("/printers")).status, 401);
  const printers = await call("/printers", {
    headers: { Authorization: `Bearer ${first.token}` },
  });
  assert.equal(printers.status, 200);
  assert.equal((await printers.json()).printers[0].name, "Rooftop");
});

test("pairing is bound to the requesting origin's own server", async (t) => {
  const { pair, running } = await service(t);
  const response = await pair(
    enrollment({ authorizationEndpoint: "https://elsewhere.example/api/seramet/printing/consume" }),
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_PAIRING");
  assert.equal(running.paired, false);
  assert.equal((await pair(enrollment({ token: "short" }))).status, 400);
});

test("a paired bridge re-pairs only with its current token", async (t) => {
  const { pair, running } = await service(t);
  const first = enrollment();
  assert.equal((await pair(first)).status, 200);
  const second = enrollment({ bridgeId: "front-desk-pc-9b1c" });
  const refused = await pair(second);
  assert.equal(refused.status, 409);
  assert.equal(running.config.bridgeId, first.bridgeId);
  const accepted = await pair(second, { Authorization: `Bearer ${first.token}` });
  assert.equal(accepted.status, 200);
  assert.equal(running.config.bridgeId, second.bridgeId);
});

test("the stored pairing is used again after a restart", async (t) => {
  const { pair, running, start } = await service(t);
  const first = enrollment();
  assert.equal((await pair(first)).status, 200);
  await running.close();
  const restarted = await start();
  try {
    assert.equal(restarted.paired, true);
    assert.equal(restarted.config.bridgeId, first.bridgeId);
  } finally {
    await restarted.close();
  }
});
