import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { permittedAddress, resolvePrinterTarget } from "./printer-target.mjs";
import { sendTcp, sendWindows } from "./transports.mjs";
import { PrintJobStore } from "./print-job-store.mjs";
import { PrintJobRunner } from "./job-runner.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { encodeEscPos } from "./escpos-encoder.mjs";
import { createBridge } from "./server.mjs";

const profile = { paperWidth: "58mm", encoding: "ascii", cutter: "partial", emphasis: true };
const job = () => ({
  id: "obligation:copy:0",
  v: 1,
  bridgeId: "bridge",
  tenantId: "tenant",
  branchId: "branch",
  target: { id: "printer", transport: "TCP", host: "10.0.0.2", port: 9100 },
  content: "KITCHEN\n2 x Meal\nNo salt\nKES 100.00",
  profile,
  documentType: "FOOD_KOT",
  expiresAt: Date.now() + 60000,
});
const signingKey = randomBytes(32).toString("hex");
const config = {
  bridgeId: "bridge",
  tenantId: "tenant",
  branchId: "branch",
  signingKey,
  token: randomBytes(32).toString("hex"),
};
const sign = (value) => {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return { payload, signature: createHmac("sha256", signingKey).update(payload).digest("hex") };
};
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), "seramet-print-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("targets deny public, metadata, loopback, IPv6 aliases and rebinding", async () => {
  for (const ip of [
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",
    "8.8.8.8",
    "10.0.0.255",
  ])
    assert.equal(permittedAddress(ip), false);
  assert.equal(permittedAddress("127.0.0.1", true), true);
  const target = { transport: "TCP", host: "printer.local", port: 9100 };
  const result = await resolvePrinterTarget(target, {
    resolve: async () => [{ address: "192.168.1.5", family: 4 }],
  });
  assert.equal(result.host, "192.168.1.5");
  await assert.rejects(
    resolvePrinterTarget(target, {
      resolve: async () => [
        { address: "10.0.0.2", family: 4 },
        { address: "8.8.8.8", family: 4 },
      ],
    }),
    /DESTINATION_DENIED/,
  );
});

test("signed authorization binds identity, content, expiry and tenant/branch", () => {
  assert.equal(verifyPrintAuthorization(sign(job()), config).id, job().id);
  for (const patch of [
    { branchId: "other" },
    { tenantId: "other" },
    { bridgeId: "other" },
    { expiresAt: 0 },
  ]) {
    assert.throws(
      () => verifyPrintAuthorization(sign({ ...job(), ...patch }), config),
      /SCOPE_DENIED/,
    );
  }
  const tampered = sign(job());
  tampered.payload += "A";
  assert.throws(() => verifyPrintAuthorization(tampered, config), /INVALID_AUTHORIZATION/);
  assert.throws(() => verifyPrintAuthorization(null, config), /AUTHORIZATION_REQUIRED/);
});

test("encoder emits bounded 58/80mm lines, safe text, feed and opted-in cut", () => {
  for (const paperWidth of ["58mm", "80mm"]) {
    const bytes = encodeEscPos("KOT\n" + "long item ".repeat(15) + "\n\x1bp malicious", {
      ...profile,
      paperWidth,
    });
    assert.deepEqual([...bytes.subarray(0, 5)], [27, 64, 27, 97, 0]);
    assert.deepEqual([...bytes.subarray(-6)], [27, 100, 3, 29, 86, 1]);
    assert.ok(bytes.includes(Buffer.from("?p malicious")));
  }
  assert.throws(() => encodeEscPos("x", { ...profile, encoding: "utf8" }), /UNSUPPORTED/);
  const bytes = encodeEscPos("receipt", { ...profile, cutter: "none" });
  assert.deepEqual([...bytes.subarray(-3)], [27, 100, 3]);
});

test("actual loopback TCP captures exact bytes without a Windows printer", async (t) => {
  const chunks = [];
  let complete;
  const received = new Promise((resolve) => {
    complete = resolve;
  });
  const server = createServer((socket) => {
    socket.on("data", (data) => chunks.push(data));
    socket.on("end", () => complete());
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const bytes = encodeEscPos(job().content, profile);
  const result = await sendTcp(
    bytes,
    { transport: "TCP", host: "127.0.0.1", port: server.address().port },
    { localTest: true },
  );
  await received;
  assert.equal(result.stage, "BYTES_SUBMITTED");
  assert.equal(result.printerStatus, "UNKNOWN");
  assert.deepEqual(Buffer.concat(chunks), bytes);
});

class FakeSocket extends EventEmitter {
  setTimeout() {}
  destroy() {}
  connect(_endpoint, ready) {
    this.ready = ready;
  }
  end(_bytes, _callback) {}
}
test("connect timeout and interrupted write are classified without unsafe retry", async () => {
  const target = { transport: "TCP", host: "10.0.0.2", port: 9100 };
  const waiting = new FakeSocket();
  assert.equal(
    (await sendTcp(Buffer.from("x"), target, { socketFactory: () => waiting, connectMs: 10 }))
      .stage,
    "NOT_SENT",
  );
  const partial = new FakeSocket();
  partial.connect = (_endpoint, ready) => {
    ready();
    queueMicrotask(() => partial.emit("error", new Error("private server message")));
  };
  const outcome = await sendTcp(Buffer.from("x"), target, { socketFactory: () => partial });
  assert.deepEqual(outcome, {
    stage: "UNCERTAIN",
    code: "CONNECTION_FAILED",
    printerStatus: "UNKNOWN",
  });
});

test("Windows remains text spool transport with timeout and sanitized uncertainty", async () => {
  let options;
  const outcome = await sendWindows(
    "C:\\temp\\ticket.txt",
    { transport: "WINDOWS", osPrinterName: "Kitchen's printer" },
    {
      exec: (_exe, args, opts, callback) => {
        options = opts;
        assert.ok(args.at(-1).includes("Kitchen''s"));
        callback(null);
      },
    },
  );
  assert.equal(outcome.stage, "SPOOL_ACCEPTED");
  assert.ok(options.timeout > 0);
  const failed = await sendWindows(
    "x",
    { transport: "WINDOWS", osPrinterName: "x" },
    { exec: (_e, _a, _o, cb) => cb(new Error("secret")) },
  );
  assert.equal(failed.stage, "UNCERTAIN");
  assert.ok(!JSON.stringify(failed).includes("secret"));
});

test("durable queue deduplicates, rejects altered reuse, survives restart and bounds retries", async (t) => {
  const path = join(await temporary(t), "queue.sqlite");
  let store = new PrintJobStore(path);
  store.enqueue(job());
  store.enqueue(job());
  assert.equal(store.pending().length, 1);
  assert.throws(() => store.enqueue({ ...job(), content: "changed" }), /ALTERED/);
  assert.equal(store.claim(job().id), true);
  assert.equal(store.claim(job().id), false);
  store.close();
  store = new PrintJobStore(path);
  assert.equal(store.get(job().id).stage, "UNCERTAIN");
  assert.throws(() => store.retry(job().id), /AUTHORIZATION/);
  store.retry(job().id, "reviewed-claim-2");
  assert.equal(store.get(job().id).stage, "QUEUED");
  store.record(job().id, "UNCERTAIN", "LOST_ACK");
  assert.throws(() => store.retry(job().id, "reviewed-claim-2"), /AUTHORIZATION/);
  store.close();
});

test("runner serializes aliases of one physical endpoint and preserves jobs", async (t) => {
  const store = new PrintJobStore(join(await temporary(t), "queue.sqlite"));
  for (let n = 0; n < 3; n++)
    store.enqueue({ ...job(), id: `job-${n}`, target: { ...job().target, id: `alias-${n}` } });
  let active = 0;
  let max = 0;
  const runner = new PrintJobRunner(store, async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return { stage: "BYTES_SUBMITTED", code: "OK" };
  });
  runner.pump();
  while (store.pending().length || runner.tasks.size) await new Promise((r) => setTimeout(r, 10));
  assert.equal(max, 1);
  await runner.stop();
  store.close();
});

test("bridge rejects origin, bearer and unsigned requests before transport", async (t) => {
  let delivered = 0;
  const dataDir = await mkdtemp(join(tmpdir(), "seramet-print-http-"));
  const bridge = await createBridge(
    { ...config, dataDir, allowedOrigins: ["https://pos.example"] },
    {
      deliver: async () => {
        delivered++;
        return { stage: "BYTES_SUBMITTED", code: "OK" };
      },
    },
  );
  await new Promise((resolve) => bridge.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await bridge.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${bridge.server.address().port}/jobs`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` };
  assert.equal(
    (
      await fetch(url, {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers, body: "{}" })).status, 400);
  assert.equal(delivered, 0);
  const signed = JSON.stringify({ authorization: sign(job()) });
  assert.equal((await fetch(url, { method: "POST", headers, body: signed })).status, 202);
  assert.equal((await fetch(url, { method: "POST", headers, body: signed })).status, 202);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(delivered, 1);
});
