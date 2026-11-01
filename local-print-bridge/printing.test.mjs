import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { permittedAddress, resolvePrinterTarget } from "./printer-target.mjs";
import { sendTcp, sendWindows, sendWindowsRaw, deliverWithFallback } from "./transports.mjs";
import { PrintJobStore } from "./print-job-store.mjs";
import { PrintJobRunner } from "./job-runner.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { encodeEscPos } from "./escpos-encoder.mjs";
import { emulateEscPos } from "./escpos-emulator.mjs";
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

test("authorized fallback is used only when definitely no bytes were submitted", async () => {
  const input = { ...job(), fallbackTarget: { id: "fallback" }, fallbackProfile: profile };
  let calls = 0;
  const accepted = await deliverWithFallback(input, async () =>
    ++calls === 1
      ? { stage: "NOT_SENT", code: "REFUSED" }
      : { stage: "BYTES_SUBMITTED", code: "OK" },
  );
  assert.equal(calls, 2);
  assert.equal(accepted.code, "FALLBACK_OK");
  calls = 0;
  const uncertain = await deliverWithFallback(input, async () => {
    calls++;
    return { stage: "UNCERTAIN", code: "PARTIAL" };
  });
  assert.equal(calls, 1);
  assert.equal(uncertain.stage, "UNCERTAIN");
});

test("encoder emits bounded 58/80mm lines, safe text, feed and opted-in cut", () => {
  for (const paperWidth of ["58mm", "80mm"]) {
    const bytes = encodeEscPos("KOT\n" + "long item ".repeat(15) + "\n\x1bp malicious", {
      ...profile,
      paperWidth,
    });
    // ESC @, FS . (single-byte mode), ESC t 0 (CP437), ESC a 0.
    assert.deepEqual([...bytes.subarray(0, 10)], [27, 64, 28, 46, 27, 116, 0, 27, 97, 0]);
    // GS V 66 0: feed to the cutter and cut, never a guessed line count.
    assert.deepEqual([...bytes.subarray(-4)], [29, 86, 66, 0]);
    assert.ok(bytes.includes(Buffer.from("?p malicious")));
    const columns = paperWidth === "58mm" ? 32 : 42;
    for (const line of bytes.subarray(10, -4).toString("latin1").split("\n"))
      assert.ok(line.replace(/\x1b(E.|3.|2)/g, "").length <= columns, line);
  }
  assert.throws(() => encodeEscPos("x", { ...profile, encoding: "utf8" }), /UNSUPPORTED/);
  assert.throws(() => encodeEscPos("x", { ...profile, ruleStyle: "DOTTED" }), /UNSUPPORTED/);
  const full = encodeEscPos("receipt", { ...profile, cutter: "full" });
  assert.deepEqual([...full.subarray(-4)], [29, 86, 65, 0]);
  const bytes = encodeEscPos("receipt", { ...profile, cutter: "none" });
  assert.deepEqual([...bytes.subarray(-3)], [27, 100, 3]);
});

test("semantic emphasis highlights totals and allergy instructions without leaking to other rows", () => {
  const bytes = encodeEscPos(
    "Merchant\n  TAX INVOICE\n|TOTAL    | KES 116.00|\n| Allergy: no nuts |\nOrdinary row",
    { ...profile, emphasis: true },
  );
  const on = Buffer.from([27, 69, 1]);
  const off = Buffer.from([27, 69, 0]);
  const vertical = Buffer.from([0xb3]);
  for (const text of ["Merchant", "  TAX INVOICE", " Allergy: no nuts "])
    assert.ok(bytes.includes(Buffer.concat([on, Buffer.from(text), off])), text);
  // Borders stay outside the bold run, so a bold row keeps thin lines. The
  // inner "|" has no rule above it, so it is cell text, not a border.
  assert.ok(
    bytes.includes(
      Buffer.concat([vertical, on, Buffer.from("TOTAL    | KES 116.00"), off, vertical]),
    ),
  );
  assert.ok(!bytes.includes(Buffer.concat([on, Buffer.from("Ordinary row")])));
  const disabled = encodeEscPos("TOTAL\nAllergy", { ...profile, emphasis: false });
  assert.ok(!disabled.includes(on));
  assert.deepEqual([...bytes.subarray(-4)], [29, 86, 66, 0]);
});

const ruledReceipt = [
  "        Seramet Test Kitchen",
  "+--------------------+---------+",
  "|Item                | Amount  |",
  "+--------------------+---------+",
  "|Pilau | extra       |   450.00|",
  "|Chapati             |    40.00|",
  "+--------------+-----+---------+",
  "|TOTAL         |         490.00|",
  "+==============+===============+",
  "Thank you!",
].join("\n");

test("ruled tables print as continuous CP437 box lines with touching rows", () => {
  const bytes = encodeEscPos(ruledReceipt, { ...profile, emphasis: false });
  const sheet = emulateEscPos(bytes, { widthDots: 384 });
  const text = bytes.toString("latin1");
  // No ASCII rules survive; a "|" typed inside a cell stays text.
  assert.ok(!/\+-|-{3}|={3}/.test(text));
  assert.ok(text.includes("Pilau | extra"));
  assert.ok(bytes.includes(Buffer.from([0xda, 0xc4, 0xc4])), "top-left corner");
  assert.ok(bytes.includes(Buffer.from([0xc3])) && bytes.includes(Buffer.from([0xc5])), "tees");
  assert.ok(bytes.includes(Buffer.from([0xd4, 0xcd])) && bytes.includes(Buffer.from([0xbe])));
  // The table runs at zero line spacing; the default is restored before the next text.
  const tableStart = bytes.indexOf(Buffer.from([0xda]));
  assert.deepEqual([...bytes.subarray(tableStart - 3, tableStart)], [27, 51, 0]);
  const restored = bytes.indexOf(Buffer.from([27, 50]));
  assert.ok(restored > bytes.lastIndexOf(Buffer.from([0xb3])));
  assert.ok(restored < bytes.indexOf(Buffer.from("Thank you")));
  // Left and right borders are unbroken from the top rule to the closing rule.
  const top = sheet.rows.findIndex((row) => row?.[6]);
  let bottom = top;
  while (sheet.rows[bottom + 1]?.[6]) bottom++;
  // From the middle of the top rule to the upper stroke of the double rule, 7 rows below.
  assert.ok(bottom - top >= 7 * 24 - 2 - 12, "left border spans every table row");
  for (let y = top; y <= bottom; y++) assert.ok(sheet.rows[y]?.[31 * 12 + 6], `right y=${y}`);
  assert.equal(sheet.cuts.length, 1);
  assert.equal(sheet.cuts[0].feedsToCutter, true);
});

test("solid tables use less paper than ASCII, which stays available for older printers", () => {
  const solid = emulateEscPos(encodeEscPos(ruledReceipt, profile), { widthDots: 384 });
  const plain = encodeEscPos(ruledReceipt, { ...profile, ruleStyle: "ASCII" });
  assert.ok(solid.heightDots < emulateEscPos(plain, { widthDots: 384 }).heightDots);
  // ASCII mode sends the ruled text as before: no code page or line spacing commands.
  assert.deepEqual([...plain.subarray(0, 5)], [27, 64, 27, 97, 0]);
  assert.ok(plain.includes(Buffer.from("+--------------------+---------+\n")));
  assert.ok(!plain.includes(Buffer.from([27, 51, 0])));
  assert.ok(!plain.includes(Buffer.from([28, 46])));
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

test("Windows thermal printers get RAW ESC/POS; only a refused spool may fall back", async () => {
  let call;
  const ok = await sendWindowsRaw(
    "C:\temp\ticket.bin",
    { transport: "WINDOWS", osPrinterName: "Kitchen's printer; Remove-Item" },
    {
      exec: (exe, args, opts, callback) => {
        call = { exe, args, opts };
        callback(null);
      },
    },
  );
  assert.equal(ok.stage, "SPOOL_ACCEPTED");
  assert.equal(call.opts.env.SERAMET_PRINTER_NAME, "Kitchen's printer; Remove-Item");
  assert.equal(call.opts.env.SERAMET_PRINT_FILE, "C:\temp\ticket.bin");
  assert.ok(!call.args.join(" ").includes("Remove-Item"));
  assert.ok(call.args.at(-1).includes("'RAW'") || call.args.at(-1).includes('"RAW"'));
  const refused = await sendWindowsRaw(
    "x",
    { transport: "WINDOWS", osPrinterName: "x" },
    { exec: (_e, _a, _o, cb) => cb(Object.assign(new Error("secret"), { code: 2 })) },
  );
  assert.equal(refused.stage, "NOT_SENT");
  const failed = await sendWindowsRaw(
    "x",
    { transport: "WINDOWS", osPrinterName: "x" },
    { exec: (_e, _a, _o, cb) => cb(Object.assign(new Error("secret"), { code: 1 })) },
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
    store.enqueue({
      ...job(),
      id: `job-${n}`,
      target: { ...job().target, id: `alias-${n}`, host: `printer-alias-${n}.local` },
    });
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

test("recovery IDs are consumed transactionally forever, including failed commits and restart", async (t) => {
  const path = join(await temporary(t), "atomic.sqlite");
  let store = new PrintJobStore(path);
  store.enqueue(job());
  store.record(job().id, "UNCERTAIN", "TEST_LOST_ACK");
  const original = store.recordInside;
  store.recordInside = () => {
    throw new Error("SIMULATED_CRASH");
  };
  assert.throws(() => store.retry(job().id, "approval-A"), /SIMULATED_CRASH/);
  store.recordInside = original;
  assert.equal(store.get(job().id).stage, "UNCERTAIN");
  store.retry(job().id, "approval-A");
  store.record(job().id, "UNCERTAIN", "TEST_LOST_ACK");
  store.retry(job().id, "approval-B");
  store.record(job().id, "UNCERTAIN", "TEST_LOST_ACK");
  store.close();
  store = new PrintJobStore(path);
  assert.throws(() => store.retry(job().id, "approval-A"), /AUTHORIZATION/);
  assert.throws(() => store.retry(job().id, "approval-B"), /AUTHORIZATION/);
  assert.throws(() => store.retry(job().id, "approval-C"), /LIMIT/);
  assert.equal(store.history(job().id).filter((a) => a.stage === "QUEUED").length, 3);
  store.close();
});

test("a reviewed authorization first seen after ledger loss cannot authorize its own retry", async (t) => {
  const store = new PrintJobStore(join(await temporary(t), "reviewed.sqlite"));
  const reviewed = { ...job(), recoveryId: "already-reviewed-approval" };
  store.enqueue(reviewed);
  store.record(reviewed.id, "UNCERTAIN", "TEST_LOST_ACK");
  assert.throws(() => store.retry(reviewed.id, reviewed.recoveryId), /AUTHORIZATION/);
  assert.equal(store.history(reviewed.id).filter((a) => a.stage === "QUEUED").length, 1);
  store.close();
});

test("one global reservation survives concurrent HTTP, second machine and local ledger deletion", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "seramet-print-reservation-"));
  const reservations = new Set();
  let delivered = 0;
  const options = {
    consume: async (proof) => {
      const value = JSON.parse(Buffer.from(proof.payload, "base64url").toString());
      if (reservations.has(value.id)) throw new Error("RECONCILIATION_REQUIRED");
      reservations.add(value.id);
    },
    deliver: async () => {
      delivered++;
      await new Promise((r) => setTimeout(r, 10));
      return { stage: "BYTES_SUBMITTED", code: "OK" };
    },
  };
  const bridges = [];
  async function machine(directory) {
    const bridge = await createBridge({ ...config, dataDir: join(root, directory) }, options);
    bridges.push(bridge);
    await new Promise((r) => bridge.server.listen(0, "127.0.0.1", r));
    return bridge;
  }
  const first = await machine("first"),
    second = await machine("second");
  t.after(async () => {
    for (const bridge of bridges) await bridge.close();
    await rm(root, { recursive: true, force: true });
  });
  const submit = (bridge) =>
    fetch(`http://127.0.0.1:${bridge.server.address().port}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ authorization: sign(job()) }),
    });
  await Promise.all(Array.from({ length: 20 }, (_, i) => submit(i % 2 ? first : second)));
  while (bridges.some((b) => b.runner.tasks.size)) await new Promise((r) => setTimeout(r, 10));
  assert.equal(delivered, 1);
  assert.deepEqual(bridges.map((b) => b.store.get(job().id).stage).sort(), [
    "BYTES_SUBMITTED",
    "UNCERTAIN",
  ]);
  await first.close();
  bridges.splice(bridges.indexOf(first), 1);
  await rm(join(root, "first"), { recursive: true, force: true });
  const replacement = await machine("first");
  await submit(replacement);
  while (replacement.runner.tasks.size) await new Promise((r) => setTimeout(r, 10));
  assert.equal(replacement.store.get(job().id).stage, "UNCERTAIN");
  assert.equal(delivered, 1);
});

test("completed payloads are scrubbed while replay protection and capacity remain durable", async (t) => {
  const store = new PrintJobStore(join(await temporary(t), "retention.sqlite"), { maxPending: 1 });
  store.enqueue(job());
  assert.throws(() => store.enqueue({ ...job(), id: "second" }), /CAPACITY/);
  store.record(job().id, "BYTES_SUBMITTED", "OK");
  assert.ok(!store.get(job().id).payload.includes(job().content));
  assert.equal(store.enqueue(job()).stage, "BYTES_SUBMITTED");
  assert.equal(store.enqueue({ ...job(), id: "second" }).stage, "QUEUED");
  store.close();
});

test("bridge rejects origin, bearer and unsigned requests before transport", async (t) => {
  let delivered = 0;
  const dataDir = await mkdtemp(join(tmpdir(), "seramet-print-http-"));
  const bridge = await createBridge(
    { ...config, dataDir, allowedOrigins: ["https://pos.example"] },
    {
      consume: async () => {},
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
