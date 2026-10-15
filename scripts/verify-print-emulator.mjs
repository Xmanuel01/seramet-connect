import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHmac, randomBytes, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createBridge } from "../local-print-bridge/server.mjs";

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
const evidence = resolve(".seramet/printing-acceptance");
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
  bridge = await createBridge(config, { localTest: true });
  await new Promise((done) => bridge.server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${bridge.server.address().port}/jobs`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  for (const fixture of printingAcceptanceFixtures()) {
    state.clearPrinterBuffer();
    state.clearHistory();
    // This emulator models 50/78/80mm only. Seramet's exact 58mm byte wrapping
    // is checked independently; its narrow visual preview uses 50mm mode.
    state.setPaperWidth(fixture.width === "58mm" ? 50 : 80);
    const job = {
      v: 1,
      id: fixture.name,
      bridgeId: config.bridgeId,
      tenantId: config.tenantId,
      branchId: config.branchId,
      expiresAt: Date.now() + 90000,
      localTest: true,
      documentType: fixture.name.startsWith("kot")
        ? "FOOD_KOT"
        : fixture.name.startsWith("bill")
          ? "BILL"
          : "RECEIPT",
      content: fixture.content,
      target: { id: "disposable-emulator", transport: "TCP", host: "127.0.0.1", port: 9100 },
      profile: { paperWidth: fixture.width, encoding: "ascii", emphasis: true, cutter: "partial" },
    };
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
    await new Promise((done) => setTimeout(done, 30));
    const snapshot = state.snapshot();
    const commands = snapshot.history.map((entry) => entry.command.type);
    assert.ok(commands.includes("InitializePrinter"));
    assert.ok(commands.includes("CutPaper"));
    assert.ok(commands.includes("LineFeed"));
    const text = snapshot.printer.buffer
      .filter((line) => line.kind === "Text")
      .map((line) => line.line.text)
      .join("\n");
    if (fixture.name.startsWith("kot")) {
      assert.match(text, /SAUCE/i);
      assert.match(text, /NO ONION/i);
    } else assert.match(text, /139\.45/);
    await writeFile(
      join(evidence, `${fixture.name}.commands.json`),
      JSON.stringify(snapshot, null, 2),
    );
    await writeFile(join(evidence, `${fixture.name}.txt`), text);
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
    await page.screenshot({ path: join(evidence, `${fixture.name}.png`), fullPage: true });
    const unknown = commands.filter((command) => command === "Unknown").length;
    assert.equal(unknown, 0);
    results.push({
      name: fixture.name,
      transportMilliseconds,
      stage: outcome.stage,
      physicalOutput: "NOT_VERIFIED",
      commands: commands.length,
      unknownCommands: unknown,
      textSha256: createHash("sha256").update(text).digest("hex"),
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
      evidence: ".seramet/printing-acceptance",
      physicalOutput: "NOT_VERIFIED",
    }),
  );
} finally {
  await browser?.close();
  await bridge?.close();
  await emulator.stop();
  await rm(config.dataDir, { recursive: true, force: true });
}
