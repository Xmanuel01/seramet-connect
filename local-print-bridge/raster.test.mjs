import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import {
  buildThermalLayout,
  rasterMetrics,
  validateRenderJob,
} from "../printing-core/thermal-layout.mjs";
import { encodePrintDocument, rasterBands } from "./raster-renderer.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { deliverWithFallback } from "./transports.mjs";
import { parseRasterWire } from "../scripts/raster-wire-parser.mjs";
import { FONT } from "./font-5x8.mjs";
import { createBridge } from "./server.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const border = "+---+--------------------------+";
const row = (quantity, item) => `|${quantity.padStart(3)}|${item.padEnd(26)}|`;
const content = [
  "KITCHEN ORDER KOT #1",
  border,
  row("QTY", "ITEM"),
  border,
  row("2", "Long meal and modifiers"),
  `|${"   Allergy: no nuts".padEnd(30)}|`,
  border,
].join("\n");
function job(width = "58mm", dots = width === "58mm" ? 384 : 576) {
  return {
    v: 2,
    id: "disposable-raster",
    bridgeId: "bridge",
    tenantId: "tenant",
    branchId: "branch",
    documentType: "FOOD_KOT",
    expiresAt: Date.now() + 60000,
    content,
    document: buildThermalLayout(content, width),
    target: { id: "printer", transport: "TCP", host: "127.0.0.1", port: 9100 },
    profile: {
      paperWidth: width,
      encoding: "ascii",
      cutter: "partial",
      emphasis: true,
      renderingMode: "RASTER_ESC_POS",
      raster: {
        command: "GS_V_0",
        printableWidthDots: dots,
        dpi: 203,
        maxBandHeight: 32,
        maxHeightDots: 8192,
        maxBytes: 524288,
      },
    },
  };
}
function pixels(j) {
  const m = rasterMetrics(j.document, j.profile);
  const bands = [...rasterBands(j.document, j.profile)];
  return {
    m,
    bands,
    data: Buffer.concat(bands.map((b) => b.data)),
    black(x, y) {
      return Boolean(this.data[y * m.stride + (x >> 3)] & (0x80 >> (x & 7)));
    },
  };
}
test("solid borders and intersections remain continuous across raster band seams", () => {
  const j = job();
  const p = pixels(j);
  const cell = 12;
  const start = p.m.heights[0];
  for (let x = cell / 2; x <= 31 * cell + cell / 2; x++) assert.ok(p.black(x, start));
  for (let y = start; y < p.m.height; y++) {
    assert.ok(p.black(6, y), `left border y=${y}`);
    assert.ok(p.black(378, y), `right border y=${y}`);
  }
  assert.ok(p.bands.length > 1);
  assert.equal(encodePrintDocument(j).length, p.m.bytes);
  assert.deepEqual([...encodePrintDocument(j).subarray(-6)], [27, 100, 3, 29, 86, 1]);
  j.profile.cutter = "none";
  assert.equal(encodePrintDocument(j).length, rasterMetrics(j.document, j.profile).bytes);
});
test("independent wire decoder reconstructs pixels and rejects corrupt/truncated commands", () => {
  const j = job();
  const bytes = encodePrintDocument(j);
  const decoded = parseRasterWire(bytes);
  assert.deepEqual(decoded.data, pixels(j).data);
  assert.equal(decoded.feed, 3);
  assert.equal(decoded.cut, true);
  assert.deepEqual(
    [...FONT.subarray((65 - 32) * 5, (65 - 32) * 5 + 5)],
    [0x7c, 0x12, 0x11, 0x12, 0x7c],
  );
  for (const bad of [
    bytes.subarray(0, 20),
    bytes.subarray(0, -4),
    Buffer.concat([bytes, Buffer.from([0])]),
  ])
    assert.throws(() => parseRasterWire(bad));
  const huge = Buffer.from(bytes);
  huge[9] = 255;
  huge[10] = 255;
  assert.throws(() => parseRasterWire(huge));
});
test("geometry and deterministic pixels honor explicit printer widths and DPI", () => {
  const golden = {
    "58mm": "7b5bc8dbd785105ef4d455dd5294790e47c884cce05cced6b0c98da23f805ec1",
    "80mm": "1ef546e36fdd0787d387f4ef298d220e3f7e43d5bb21909c275ba79bfd6bda44",
  };
  for (const paper of ["58mm", "80mm"])
    for (const width of [384, 512, 576, 640, 832]) {
      const j = job(paper, width);
      const a = pixels(j);
      const b = pixels(j);
      assert.equal(a.m.stride, width / 8);
      assert.deepEqual(a.data, b.data);
      assert.ok(a.data.some((b) => b !== 0));
      const hash = createHash("sha256").update(a.data).digest("hex");
      if (width === (paper === "58mm" ? 384 : 576)) assert.equal(hash, golden[paper]);
      j.profile.raster.dpi = 300;
      assert.ok(pixels(j).m.height > a.m.height);
    }
});
test("oversized, unsupported, mismatched and altered layouts fail before any transport", () => {
  for (const mutate of [
    (j) => (j.profile.raster.command = "UNKNOWN"),
    (j) => (j.profile.raster.printableWidthDots = 8192),
    (j) => (j.profile.raster.maxBandHeight = 4096),
    (j) => (j.profile.raster.maxBytes = 4096),
    (j) => (j.profile.raster.maxHeightDots = 1),
    (j) => (j.target.transport = "WINDOWS"),
    (j) => (j.profile.renderingMode = "UNKNOWN"),
    (j) => (j.document.rows[1].text = "altered"),
    (j) => (j.document.renderer = "unknown"),
  ]) {
    const j = job();
    mutate(j);
    assert.throws(() => encodePrintDocument(j));
  }
  assert.throws(() => buildThermalLayout("x\n".repeat(513), "58mm"), /LIMIT/);
  assert.throws(() => buildThermalLayout("x".repeat(43), "80mm"), /LIMIT/);
});
test("HMAC and canonical layout bind data, renderer, profile, target and scope", () => {
  const j = job();
  const config = {
    signingKey: "k".repeat(40),
    bridgeId: j.bridgeId,
    tenantId: j.tenantId,
    branchId: j.branchId,
  };
  const sign = (v) => {
    const payload = Buffer.from(JSON.stringify(v)).toString("base64url");
    return {
      payload,
      signature: createHmac("sha256", config.signingKey).update(payload).digest("hex"),
    };
  };
  validateRenderJob(j);
  const proof = sign(j);
  const downgraded = structuredClone(j);
  downgraded.v = 1;
  assert.throws(() => verifyPrintAuthorization(sign(downgraded), config), /ENVELOPE/);
  assert.equal(verifyPrintAuthorization(proof, config).id, j.id);
  for (const mutate of [
    (v) => (v.content = "different"),
    (v) => (v.profile.raster.printableWidthDots = 512),
    (v) => (v.target.id = "other"),
    (v) => (v.branchId = "other"),
  ]) {
    const changed = structuredClone(j);
    mutate(changed);
    const altered = {
      ...proof,
      payload: Buffer.from(JSON.stringify(changed)).toString("base64url"),
    };
    assert.throws(() => verifyPrintAuthorization(altered, config), /INVALID_AUTHORIZATION/);
  }
  j.document.rows[0].text = "forged";
  assert.throws(() => verifyPrintAuthorization(sign(j), config), /INTEGRITY/);
});
test("text is an explicit separate mode and uncertain raster delivery never selects fallback", async () => {
  const j = job();
  const calls = [];
  j.fallbackTarget = { id: "text", transport: "TCP" };
  j.fallbackProfile = {
    paperWidth: "58mm",
    encoding: "ascii",
    cutter: "partial",
    emphasis: true,
    renderingMode: "TEXT_ESC_POS",
  };
  const result = await deliverWithFallback(j, async (target) => {
    calls.push(target.id);
    return { stage: "UNCERTAIN", code: "PARTIAL" };
  });
  assert.equal(result.stage, "UNCERTAIN");
  assert.deepEqual(calls, ["printer"]);
  const text = encodePrintDocument(j, j.fallbackProfile);
  assert.ok(text.includes(Buffer.from("KITCHEN ORDER KOT #1")));
  assert.ok(!text.includes(Buffer.from([29, 118, 48, 0])));
});

test("HTTP preflight rejects invalid raster before reservation; worker renders only the verified signed payload", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seramet-raster-"));
  const j = job();
  const config = {
    dataDir: dir,
    token: "t".repeat(40),
    signingKey: "k".repeat(40),
    bridgeId: j.bridgeId,
    tenantId: j.tenantId,
    branchId: j.branchId,
  };
  let consumed = 0,
    delivered;
  const bridge = await createBridge(config, {
    localTest: true,
    consume: async () => {
      consumed++;
    },
    deliver: async (v) => {
      delivered = v;
      return { stage: "BYTES_SUBMITTED", code: "UNIT_TEST" };
    },
  });
  try {
    bridge.runner.stopped = true;
    await new Promise((done) => bridge.server.listen(0, "127.0.0.1", done));
    const send = async (v) => {
      const payload = Buffer.from(JSON.stringify(v)).toString("base64url");
      return fetch(`http://127.0.0.1:${bridge.server.address().port}/jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          authorization: {
            payload,
            signature: createHmac("sha256", config.signingKey).update(payload).digest("hex"),
          },
        }),
      });
    };
    const invalid = structuredClone(j);
    invalid.document.rows[0].text = "forged";
    assert.equal((await send(invalid)).status, 400);
    assert.equal(consumed, 0);
    assert.equal(bridge.store.list().length, 0);
    assert.equal((await send(j)).status, 202);
    const stored = JSON.parse(bridge.store.get(j.id).payload);
    stored.content = "LOCAL TAMPERING";
    bridge.store.db
      .prepare("UPDATE jobs SET payload=? WHERE id=?")
      .run(JSON.stringify(stored), j.id);
    bridge.runner.stopped = false;
    bridge.runner.pump();
    for (let i = 0; i < 100 && !delivered; i++) await new Promise((done) => setTimeout(done, 10));
    assert.equal(consumed, 1);
    assert.equal(delivered.content, j.content);
    assert.deepEqual(delivered.document, j.document);
    const altered = structuredClone(j);
    altered.document.rows[0].text = "changed";
    assert.throws(() => bridge.store.enqueue(altered), /ALTERED_JOB_IDENTITY/);
  } finally {
    await bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});
