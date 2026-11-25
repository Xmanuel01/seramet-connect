import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { encodePrintDocument } from "./raster-renderer.mjs";
import { verifyPrintAuthorization } from "./authorization.mjs";
import { parseRasterWire } from "../scripts/raster-wire-parser.mjs";
import { renderRichForProfile } from "../printing-core/rich-render.mjs";

// A typeset approved KOT, as the server sends it in a v3 envelope.
const rich = {
  v: 1,
  paper: "80mm",
  blocks: [
    { t: "text", runs: [{ s: "title", text: "KITCHEN ORDER" }], align: "center" },
    {
      t: "spread",
      left: [{ s: "status", text: "NEW ORDER" }],
      right: [{ s: "status", text: "KITCHEN" }],
    },
    { t: "rule", style: "solid" },
    { t: "text", runs: [{ s: "orderNo", text: "ORDER #06551" }] },
    {
      t: "text",
      runs: [
        { s: "label", text: "DATE: " },
        { s: "value", text: "22 Nov 2026" },
      ],
    },
    { t: "rule", style: "dashed" },
    { t: "text", runs: [{ s: "item", text: "2 x  Mbuzi Stew + Rice" }] },
    {
      t: "text",
      runs: [{ s: "note", text: "Item instructions: Extra soup on the side" }],
      indent: 40,
    },
    { t: "box", runs: [{ s: "box", text: "Pack items separately" }] },
    {
      t: "table",
      cols: [
        { w: 10, align: "center" },
        { w: 40 },
        { w: 24, align: "right" },
        { w: 26, align: "right" },
      ],
      head: ["QTY", "ITEM", "UNIT (KES)", "TOTAL (KES)"],
      rows: [["2", "Mbuzi Stew + Rice", "1,150.00", "2,300.00"]],
    },
    { t: "text", runs: [{ s: "section", text: "END OF KITCHEN ORDER" }], align: "center" },
  ],
};

function job(
  profileOverrides = {},
  target = { id: "printer", transport: "TCP", host: "127.0.0.1", port: 9100 },
) {
  return {
    v: 3,
    id: "disposable-rich",
    bridgeId: "bridge",
    tenantId: "tenant",
    branchId: "branch",
    documentType: "FOOD_KOT",
    expiresAt: Date.now() + 60000,
    content: "KITCHEN ORDER\nNEW ORDER  KITCHEN",
    rich,
    target,
    profile: {
      paperWidth: "80mm",
      encoding: "ascii",
      cutter: "partial",
      emphasis: true,
      renderingMode: "RASTER_ESC_POS",
      raster: {
        command: "GS_V_0",
        printableWidthDots: 576,
        dpi: 203,
        maxBandHeight: 128,
        maxHeightDots: 8192,
        maxBytes: 524288,
      },
      ...profileOverrides,
    },
  };
}

test("v3 printer bytes decode back to exactly the typeset bitmap the preview shows", () => {
  const j = job();
  const bytes = encodePrintDocument(j);
  const wire = parseRasterWire(bytes);
  const expected = renderRichForProfile(rich, j.profile.raster);
  assert.equal(wire.width, 576);
  assert.equal(wire.height, expected.height);
  assert.ok(wire.bands.every((band) => band.height <= 128));
  assert.ok(Buffer.from(expected.data).equals(wire.data), "printed pixels differ from preview");
  // Ends by feeding to the cutter and cutting.
  assert.deepEqual([...bytes.subarray(-4)], [29, 86, 66, 0]);
});

test("v3 prints over the Windows RAW spooler and at 300 dpi", () => {
  const windows = job({}, { id: "printer", transport: "WINDOWS", osPrinterName: "EPSON TM-T20" });
  assert.equal(parseRasterWire(encodePrintDocument(windows)).width, 576);
  const hi = job({ raster: { ...job().profile.raster, printableWidthDots: 832, dpi: 300 } });
  const wire = parseRasterWire(encodePrintDocument(hi));
  assert.equal(wire.width, 832);
  // Physical size is kept: laid out at the 203 dpi equivalent width (560 dots),
  // then 300/203 times as many rows.
  const base = renderRichForProfile(rich, { printableWidthDots: 560, dpi: 203 }).height;
  assert.ok(Math.abs(wire.height - Math.round((base * 300) / 203)) <= 2);
});

test("a text-mode fallback printer prints the ruled text, not the bitmap", () => {
  const j = job();
  const text = encodePrintDocument(j, {
    paperWidth: "80mm",
    encoding: "ascii",
    cutter: "partial",
  });
  assert.ok(text.includes(Buffer.from("KITCHEN ORDER")));
  assert.ok(!text.includes(Buffer.from([29, 118, 48, 0])));
});

test("v3 authorizations verify, and altered or downgraded envelopes are refused", () => {
  const config = {
    signingKey: "k".repeat(40),
    bridgeId: "bridge",
    tenantId: "tenant",
    branchId: "branch",
  };
  const sign = (value) => {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return {
      payload,
      signature: createHmac("sha256", config.signingKey).update(payload).digest("hex"),
    };
  };
  assert.equal(verifyPrintAuthorization(sign(job()), config).v, 3);
  for (const mutate of [
    (j) => (j.v = 2),
    (j) => delete j.rich,
    (j) => (j.rich.blocks[0].runs[0].s = "unknown"),
    (j) => (j.rich.paper = "58mm"),
    (j) => (j.logo = { width: 8, height: 1, data: "AA==" }),
    (j) => (j.profile.raster.maxHeightDots = 256),
  ]) {
    const j = structuredClone(job());
    mutate(j);
    assert.throws(() => verifyPrintAuthorization(sign(j), config));
  }
  // A signed payload that was changed afterwards fails the HMAC.
  const proof = sign(job());
  const tampered = JSON.parse(Buffer.from(proof.payload, "base64url").toString());
  tampered.rich.blocks[3].runs[0].text = "ORDER #99999";
  assert.throws(
    () =>
      verifyPrintAuthorization(
        { ...proof, payload: Buffer.from(JSON.stringify(tampered)).toString("base64url") },
        config,
      ),
    /INVALID_AUTHORIZATION/,
  );
});
