import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrinterDiscovery } from "./printer-discovery.mjs";
import { createBridge } from "./server.mjs";

test("Windows enumeration is fixed, hidden, bounded, read-only and coalesced", async () => {
  let calls = 0,
    finish;
  const discover = createPrinterDiscovery({
    platform: "win32",
    execute: (file, args, options, callback) => {
      calls++;
      finish = callback;
      assert.equal(file, "powershell.exe");
      assert.equal(options.shell, false);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 20000);
      assert.match(args.at(-1), /Get-Printer -ErrorAction Stop/);
      assert.doesNotMatch(args.at(-1), /Out-Printer|Add-Printer|Remove-Printer/);
    },
  });
  const first = discover(),
    second = discover();
  finish(null, JSON.stringify({ Name: "厨房 ' USB", DriverName: "Thermal", PrinterStatus: 0 }));
  assert.equal((await first)[0].name, "厨房 ' USB");
  await second;
  assert.equal((await discover())[0].physicalStatus, "UNKNOWN");
  assert.equal(calls, 1);
});
test("unsupported platforms, execution errors and malformed output fail safely", async () => {
  await assert.rejects(createPrinterDiscovery({ platform: "linux" })(), /UNAVAILABLE/);
  for (const [error, output] of [
    [new Error("private details"), ""],
    [null, "not-json"],
    [null, '{"Name":"bad\\nname"}'],
  ])
    await assert.rejects(
      createPrinterDiscovery({
        platform: "win32",
        execute: (_f, _a, _o, cb) => cb(error, output),
      })(),
      /^Error: PRINTER_DISCOVERY_UNAVAILABLE$/,
    );
});
test("inventory requires origin and token authorization and returns the enrolled scope", async () => {
  const root = await mkdtemp(join(tmpdir(), "seramet-inventory-"));
  let reads = 0;
  const config = {
    dataDir: root,
    tenantId: "tenant",
    branchId: "branch",
    bridgeId: "bridge",
    token: "x".repeat(32),
    signingKey: "y".repeat(32),
    allowedOrigins: ["https://pos.test"],
  };
  const bridge = await createBridge(config, {
    consume: async () => {},
    discoverPrinters: async () => {
      reads++;
      return [{ name: "USB", driver: "Thermal", physicalStatus: "UNKNOWN" }];
    },
  });
  try {
    await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${bridge.server.address().port}/printers`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal(
      (
        await fetch(url, {
          headers: { Origin: "https://evil.test", Authorization: `Bearer ${config.token}` },
        })
      ).status,
      403,
    );
    assert.equal(reads, 0);
    const response = await fetch(url, {
      headers: { Origin: "https://pos.test", Authorization: `Bearer ${config.token}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      tenantId: "tenant",
      branchId: "branch",
      bridgeId: "bridge",
      printers: [{ name: "USB", driver: "Thermal", physicalStatus: "UNKNOWN" }],
    });
    assert.equal(bridge.store.list().length, 0);
  } finally {
    await bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
