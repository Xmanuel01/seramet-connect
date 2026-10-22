import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { resolve, join } from "node:path";
import { createHmac, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createBridge } from "../local-print-bridge/server.mjs";
import { buildThermalLayout } from "../printing-core/thermal-layout.mjs";
import { encodePrintDocument } from "../local-print-bridge/raster-renderer.mjs";
import { parseRasterWire } from "./raster-wire-parser.mjs";

const root = process.cwd();
const { build } = createRequire(import.meta.url)(
  resolve(".seramet/escpos-emulator-runtime/node_modules/esbuild/lib/main.js"),
);
const source = resolve(process.env.SERAMET_ESCPOS_EMULATOR_SOURCE ?? ".seramet/escpos-emulator");
const revision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const expected = "1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d";
if (revision !== expected)
  throw new Error("Review and pin the emulator source before executing it");
const raster = process.env.SERAMET_PRINT_RENDERING === "RASTER_ESC_POS";
const evidence = resolve(raster ? ".seramet/raster-acceptance" : ".seramet/printing-acceptance");
await mkdir(evidence, { recursive: true });
const pino = resolve(".seramet/escpos-emulator-runtime/node_modules/pino/pino.js");
const bundle = join(evidence, "emulator.cjs");
await build({
  stdin: {
    contents: `export { startServer } from ${JSON.stringify(join(source, "src/main/networking/server.ts"))}; export { EmulatorState } from ${JSON.stringify(join(source, "src/main/emulator/emulator-state.ts"))}; export { printingAcceptanceFixtures } from ${JSON.stringify(resolve("scripts/printing-acceptance-fixtures.ts"))};`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundle,
  alias: { pino },
  external: ["electron-log"],
});
const { startServer, EmulatorState, printingAcceptanceFixtures } = createRequire(import.meta.url)(
  bundle,
);
const state = new EmulatorState();
const emulator = await startServer(state, 9100);
let wireChunks = [];
const connections = new Set();
const tap = createServer((socket) => {
  const upstream = connect(9100, "127.0.0.1");
  connections.add(socket);
  connections.add(upstream);
  const capture = wireChunks;
  socket.on("data", (chunk) => capture.push(Buffer.from(chunk)));
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("close", () => connections.delete(socket));
  upstream.on("close", () => connections.delete(upstream));
  socket.pipe(upstream);
  upstream.pipe(socket);
});
await new Promise((done) => tap.listen(9104, "127.0.0.1", done));
const config = {
  token: randomBytes(32).toString("hex"),
  signingKey: randomBytes(32).toString("hex"),
  bridgeId: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  branchId: crypto.randomUUID(),
  dataDir: join(evidence, "disposable-jobs"),
};
let bridge;
let browser;
const results = [];
try {
  await rm(config.dataDir, { recursive: true, force: true });
  // Fixture-only issuer; authenticated gateway consumption is covered by E2E.
  const consumed = new Set();
  bridge = await createBridge(config, {
    localTest: true,
    consume: async (proof) => {
      if (consumed.has(proof.payload)) throw new Error("Fixture delivery already reserved");
      consumed.add(proof.payload);
    },
  });
  await new Promise((done) => bridge.server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${bridge.server.address().port}/jobs`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  for (const fixture of printingAcceptanceFixtures()) {
    wireChunks = [];
    state.clearPrinterBuffer();
    state.clearHistory();
    // This emulator models 50/78/80mm only. Seramet's exact 58mm byte wrapping
    // is checked independently; its narrow visual preview uses 50mm mode.
    state.setPaperWidth(fixture.width === "58mm" ? 50 : 80);
    const job = {
      v: raster ? 2 : 1,
      id: fixture.name,
      bridgeId: config.bridgeId,
      tenantId: config.tenantId,
      branchId: config.branchId,
      expiresAt: Date.now() + 90000,
      localTest: true,
      documentType: fixture.documentType,
      content: fixture.content,
      target: { id: "disposable-emulator", transport: "TCP", host: "127.0.0.1", port: 9104 },
      profile: {
        paperWidth: fixture.width,
        encoding: "ascii",
        emphasis: true,
        cutter: "partial",
        ...(raster
          ? {
              renderingMode: "RASTER_ESC_POS",
              raster: {
                command: "GS_V_0",
                printableWidthDots: fixture.width === "58mm" ? 384 : 576,
                dpi: 203,
                maxBandHeight: 128,
                maxHeightDots: 8192,
                maxBytes: 524288,
              },
            }
          : {}),
      },
      ...(raster ? { document: buildThermalLayout(fixture.content, fixture.width) } : {}),
    };
    const beforeMemory = process.memoryUsage();
    const encodeStarted = performance.now();
    const expectedBytes = encodePrintDocument(job);
    const localEncodeMs = Number((performance.now() - encodeStarted).toFixed(2));
    const afterMemory = process.memoryUsage();
    const payload = Buffer.from(JSON.stringify(job)).toString("base64url");
    const body = JSON.stringify({
      authorization: {
        payload,
        signature: createHmac("sha256", config.signingKey).update(payload).digest("hex"),
      },
    });
    let outcome;
    const transportStarted = performance.now();
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body,
      });
      assert.equal(response.status, 202);
      outcome = await response.json();
      if (outcome.stage === "BYTES_SUBMITTED") break;
      assert.ok(["QUEUED", "TRANSMITTING"].includes(outcome.stage));
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.equal(outcome.stage, "BYTES_SUBMITTED");
    const transportMilliseconds = Number((performance.now() - transportStarted).toFixed(1));
    for (
      let i = 0;
      i < 200 && !state.snapshot().history.some((h) => h.command.type === "CutPaper");
      i++
    )
      await new Promise((done) => setTimeout(done, 10));
    const snapshot = state.snapshot();
    const wire = Buffer.concat(wireChunks);
    assert.deepEqual(wire, expectedBytes);
    await writeFile(join(evidence, `${fixture.name}.bin`), wire);
    const commands = snapshot.history.map((entry) => entry.command.type);
    assert.ok(commands.includes("InitializePrinter"));
    assert.ok(commands.includes("CutPaper"));
    assert.ok(commands.includes("LineFeed"));
    const text = raster
      ? fixture.content
      : snapshot.printer.buffer
          .filter((line) => line.kind === "Text")
          .map((line) => line.line.text)
          .join("\n");
    if (fixture.name.startsWith("kot") || fixture.name.startsWith("bar")) {
      assert.match(text, /SAUCE/i);
      assert.match(text, /NO ONION/i);
      assert.match(text, /^(KITCHEN ORDER KOT|BAR ORDER BAR) /);
      assert.ok(!text.includes("Disposable Test Restaurant"));
      assert.ok(!/KITCHEN TICKET|BAR TICKET|NEW ORDER/.test(text));
    } else assert.match(text, /283\.90/);
    if (fixture.documentType === "INVOICE") assert.match(text, /TAX INVOICE/);
    assert.ok(!text.includes("Due Date: -"));
    assert.ok(
      text.split("\n").every((line) => line.length <= (fixture.width === "58mm" ? 32 : 42)),
    );
    await writeFile(
      join(evidence, `${fixture.name}.commands.json`),
      JSON.stringify(
        raster ? snapshot.history.map((h) => ({ type: h.command.type })) : snapshot,
        null,
        2,
      ),
    );
    await writeFile(join(evidence, `${fixture.name}${raster ? ".source" : ""}.txt`), text);
    let rasterEvidence = {};
    if (raster) {
      const decoded = parseRasterWire(wire);
      const upstreamBands = snapshot.printer.buffer.filter((line) => line.kind === "Bitmap");
      assert.deepEqual(Buffer.concat(upstreamBands.map((b) => Buffer.from(b.data))), decoded.data);
      await page.setViewportSize({ width: 1200, height: Math.max(1000, decoded.height + 20) });
      await page.setContent(
        `<canvas id="wire" width="${decoded.width}" height="${decoded.height}"></canvas>`,
      );
      await page.evaluate(
        ({ width, height, data }) => {
          const canvas = document.querySelector("canvas");
          const ctx = canvas.getContext("2d");
          const pixels = ctx.createImageData(width, height);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const black = data[y * (width / 8) + (x >> 3)] & (0x80 >> (x & 7));
              const p = (y * width + x) * 4;
              pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = black ? 0 : 255;
              pixels.data[p + 3] = 255;
            }
          ctx.putImageData(pixels, 0, 0);
        },
        { width: decoded.width, height: decoded.height, data: [...decoded.data] },
      );
      await page.locator("canvas").screenshot({ path: join(evidence, `${fixture.name}.png`) });
      rasterEvidence = {
        rasterBands: decoded.bands.length,
        heightDots: decoded.height,
        printableWidthDots: decoded.width,
        maxBandBytes: Math.max(...decoded.bands.map((b) => b.data.length)),
        pixelSha256: createHash("sha256").update(decoded.data).digest("hex"),
        displayRenderer: "INDEPENDENT_WIRE_BITMAP_STITCH",
        upstreamRasterParser: "MATCHED_ALL_PIXEL_BYTES",
      };
      const textImage = await readFile(
        resolve(".seramet/printing-acceptance", `${fixture.name}.png`),
      );
      const rasterImage = await readFile(join(evidence, `${fixture.name}.png`));
      await page.setContent(
        `<body style="margin:8px;background:#ddd;display:flex;gap:16px;font-family:monospace"><section><h2>TEXT ESC/POS</h2><img src="data:image/png;base64,${textImage.toString("base64")}"></section><section><h2>RASTER ESC/POS - decoded TCP pixels</h2><img src="data:image/png;base64,${rasterImage.toString("base64")}"></section></body>`,
      );
      await page.screenshot({
        path: join(evidence, `${fixture.name}.comparison.png`),
        fullPage: true,
      });
    } else {
      // Render the emulator's actual ReceiptViewer component, not a custom receipt.
      const renderer = await build({
        stdin: {
          contents: `import React from "react"; import {createRoot} from "react-dom/client"; import ReceiptViewer from ${JSON.stringify(join(source, "src/renderer/components/ReceiptViewer.tsx"))}; const snapshot=${JSON.stringify(snapshot)}; window.api={setPaperWidth:async()=>{},clearBuffer:async()=>{}}; createRoot(document.getElementById("root")).render(React.createElement(ReceiptViewer,{snapshot}));`,
          resolveDir: root,
          loader: "tsx",
        },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        jsx: "automatic",
        alias: { "@shared": join(source, "src/shared") },
      });
      const css = await (
        await import("node:fs/promises")
      ).readFile(join(source, "src/renderer/styles.css"), "utf8");
      await page.setContent(
        `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
      );
      await page.addScriptTag({ content: renderer.outputFiles[0].text });
      await page.getByText("Real Preview", { exact: false }).waitFor();
      const captureHeight = await page
        .locator(".workbench")
        .evaluate((element) =>
          Math.ceil(element.scrollHeight + element.getBoundingClientRect().top + 24),
        );
      await page.setViewportSize({ width: 1100, height: Math.max(1000, captureHeight) });
      await page.locator(".paper").screenshot({ path: join(evidence, `${fixture.name}.png`) });
    }
    const unknown = commands.filter((command) => command === "Unknown").length;
    assert.equal(unknown, 0);
    results.push({
      name: fixture.name,
      transportMilliseconds,
      stage: outcome.stage,
      physicalOutput: "NOT_VERIFIED",
      renderingMode: raster ? "RASTER_ESC_POS" : "TEXT_ESC_POS",
      encodedBytes: wire.length,
      wireSha256: createHash("sha256").update(wire).digest("hex"),
      localEncodeMs,
      memorySnapshots: {
        rssBefore: beforeMemory.rss,
        rssAfter: afterMemory.rss,
        heapBefore: beforeMemory.heapUsed,
        heapAfter: afterMemory.heapUsed,
      },
      ...rasterEvidence,
      commands: commands.length,
      encodedTextLines: commands.filter((command) => command === "NewLine").length,
      feedLines: 3,
      unknownCommands: unknown,
      ...(raster
        ? { sourceTextSha256: createHash("sha256").update(text).digest("hex") }
        : { textSha256: createHash("sha256").update(text).digest("hex") }),
    });
  }
  await writeFile(
    join(evidence, "summary.json"),
    JSON.stringify({ emulatorRevision: revision, results }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: results.length,
      emulatorRevision: revision,
      evidence: raster ? ".seramet/raster-acceptance" : ".seramet/printing-acceptance",
      physicalOutput: "NOT_VERIFIED",
    }),
  );
} finally {
  await browser?.close();
  await bridge?.close();
  for (const socket of connections) socket.destroy();
  await new Promise((done) => tap.close(done));
  await emulator.stop();
  await rm(config.dataDir, { recursive: true, force: true });
}
