import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, connect } from "node:net";
import { randomUUID, randomInt, randomBytes, createHash } from "node:crypto";
import { createBridge } from "../../local-print-bridge/server.mjs";
import { parseMajorAmount } from "../../src/payments/money";
import { printBridgeConfigStorageKey } from "../../src/lib/print-bridge-client-config";

type EmulatorState = {
  setPaperWidth: (width: number) => void;
  clearPrinterBuffer: () => void;
  clearHistory: () => void;
  snapshot: () => {
    printer: { buffer: Array<{ kind: string; line: { text: string } }> };
    history: Array<{ command: { type: string } }>;
  };
};
type EmulatedDevice = {
  name: string;
  port: number;
  state: EmulatorState;
  listener: { stop: () => Promise<void> };
  printer?: Record<string, unknown>;
};

test.use({ trace: "off", screenshot: "off", actionTimeout: 30000 });
test("real employee POS to four independent ESC/POS emulators", async ({ browser }) => {
  test.setTimeout(360000);
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    process.versions.node.split(".")[0] !== "24"
  )
    throw new Error("Node 24 disposable loopback-only acceptance required");
  const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));
  const setup = JSON.parse(readFileSync(".seramet/printing-operational-fixture.json", "utf8"));
  if (!/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)) throw new Error("Disposable tenant required");
  const evidence = resolve(".seramet/printing-operational");
  await mkdir(evidence, { recursive: true });
  const source = resolve(".seramet/escpos-emulator");
  const revision = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  expect(revision).toBe("1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d");
  const { build } = createRequire(import.meta.url)(
    resolve(".seramet/escpos-emulator-runtime/node_modules/esbuild/lib/main.js"),
  );
  const bundle = join(evidence, "emulator.cjs");
  await build({
    stdin: {
      contents: `export {startServer} from ${JSON.stringify(join(source, "src/main/networking/server.ts"))};export {EmulatorState} from ${JSON.stringify(join(source, "src/main/emulator/emulator-state.ts"))};`,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    alias: { pino: resolve(".seramet/escpos-emulator-runtime/node_modules/pino/pino.js") },
    external: ["electron-log"],
  });
  const { EmulatorState, startServer } = createRequire(import.meta.url)(bundle);
  const devices: EmulatedDevice[] = [];
  const admin = await browser.newContext(),
    staff = await browser.newContext();
  const privateDir = await mkdtemp(join(tmpdir(), "seramet-operational-"));
  let bridge: Awaited<ReturnType<typeof createBridge>> | undefined;
  const origin = "http://127.0.0.1:4173";
  const headers = {
    Authorization: `Bearer ${fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
    "content-type": "application/json",
    Origin: origin,
  };
  const bridgeId = randomUUID();
  const events: string[] = [];
  async function api(path: string, data?: unknown) {
    const response = await admin.request.fetch(`${origin}/api/seramet/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers,
      data,
    });
    if (!response.ok())
      throw new Error(
        `Acceptance API ${path.split("/")[0]} failed: ${response.status()} ${(await response.json()).message ?? "request rejected"}`,
      );
    return response.json();
  }
  async function snapshot() {
    return api("transactions");
  }
  async function mutate(action: string, payload: unknown) {
    const current = await snapshot();
    return api("transactions/mutate", {
      action,
      payload,
      expectedRevision: current.revision,
      idempotencyKey: randomUUID(),
    });
  }
  const manager = await admin.newPage(),
    cashier = await staff.newPage(),
    viewer = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  async function capture(name: string, device: (typeof devices)[number], width: "58mm" | "80mm") {
    await new Promise((done) => setTimeout(done, 50));
    device.state.setPaperWidth(width === "58mm" ? 50 : 80);
    const state = device.state.snapshot();
    const text = state.printer.buffer
      .filter((line: { kind: string }) => line.kind === "Text")
      .map((line: { line: { text: string } }) => line.line.text)
      .join("\n");
    expect(
      state.history.some(
        (entry: { command: { type: string } }) => entry.command.type === "CutPaper",
      ),
    ).toBe(true);
    expect(
      state.history.some(
        (entry: { command: { type: string } }) => entry.command.type === "LineFeed",
      ),
    ).toBe(true);
    expect(
      state.history.filter(
        (entry: { command: { type: string } }) => entry.command.type === "Unknown",
      ),
    ).toHaveLength(0);
    if (width === "58mm")
      for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
    const renderer = await build({
      stdin: {
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ReceiptViewer from ${JSON.stringify(join(source, "src/renderer/components/ReceiptViewer.tsx"))};window.api={setPaperWidth:async()=>{},clearBuffer:async()=>{}};createRoot(document.getElementById('root')).render(React.createElement(ReceiptViewer,{snapshot:${JSON.stringify(state)}}));`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      alias: { "@shared": join(source, "src/shared") },
    });
    const css = await readFile(join(source, "src/renderer/styles.css"), "utf8");
    await viewer.setContent(
      `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    );
    await viewer.addScriptTag({ content: renderer.outputFiles[0].text });
    await viewer.getByText("Real Preview", { exact: false }).waitFor();
    await viewer.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
    await writeFile(
      join(evidence, `${name}.text.json`),
      JSON.stringify({ text, sha256: createHash("sha256").update(text).digest("hex") }),
    );
    events.push(`CAPTURE ${name}: actual ${device.port} TCP parser, feed/cut, no unknown commands`);
    return text;
  }
  try {
    for (const [name, port] of [
      ["Kitchen", 9100],
      ["Grill", 9101],
      ["Bar", 9102],
      ["Cashier", 9103],
    ] as const) {
      const state = new EmulatorState();
      const listener = await startServer(state, port);
      devices.push({
        name,
        port,
        state,
        listener,
        printer: undefined as Record<string, unknown> | undefined,
      });
    }
    events.push("Four distinct real upstream TCP listeners started on loopback 9100-9103");
    await admin.route("**/api/seramet/**", (route) =>
      route.continue({ headers: { ...route.request().headers(), ...headers } }),
    );
    await manager.goto("/login?account=1");
    await manager.evaluate((f) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", f.tenantId);
      localStorage.setItem("seramet.session.user-id", f.userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
      );
    }, fixture);
    await manager.goto("/seramet-printers");
    // Exercise the real administration form for the primary kitchen printer.
    await manager.getByRole("button", { name: "Add printer", exact: true }).click();
    await manager.getByLabel("Name", { exact: true }).fill("Kitchen Printer");
    await manager.getByLabel("Enrolled bridge ID").fill(bridgeId);
    await manager.getByRole("combobox", { name: "Transport", exact: true }).selectOption("TCP");
    await manager.getByLabel("Printer host").fill("127.0.0.1");
    await manager.getByLabel("TCP port").fill("9100");
    await manager.getByRole("checkbox", { name: "BILL", exact: true }).setChecked(false);
    await manager.getByRole("checkbox", { name: "RECEIPT", exact: true }).setChecked(false);
    await manager.getByRole("checkbox", { name: "KITCHEN", exact: true }).check();
    await manager.getByRole("checkbox", { name: "Main Kitchen", exact: true }).check();
    await manager.getByRole("combobox", { name: "Paper", exact: true }).selectOption("80mm");
    await manager.getByRole("combobox", { name: "Cutter", exact: true }).selectOption("partial");
    await manager.getByRole("button", { name: "Save printer", exact: true }).click();
    await expect(manager.getByRole("status")).toContainText("Printer configuration saved");
    const saved = (await api("printing/printers")).printers.find(
      (p: { name: string }) => p.name === "Kitchen Printer",
    );
    for (const device of devices) {
      const station = device.name === "Kitchen" ? "MAIN" : device.name.toUpperCase();
      const roles =
        device.name === "Cashier"
          ? ["BILL", "INVOICE", "RECEIPT"]
          : [device.name === "Bar" ? "BAR" : "KITCHEN"];
      device.printer = (
        await api("printing/printers", {
          ...(device.name === "Kitchen" ? saved : {}),
          branchId: fixture.firstBranchId,
          name: `${device.name} Printer`,
          bridgeId,
          transport: "TCP",
          host: "127.0.0.1",
          port: device.port,
          paperWidth: "80mm",
          encoding: "ascii",
          cutter: "partial",
          emphasis: true,
          copies: 1,
          enabled: true,
          roles,
          stations: device.name === "Cashier" ? [] : [station],
          kitchenMode: "PRINTER_ONLY",
        })
      ).printer;
    }
    events.push(
      "UI add kitchen printer; authenticated admin API sets exact MAIN/GRILL/BAR and cashier routes with persistent configuration",
    );
    const enrollment = await api("printing/enrollment", { bridgeId });
    const token = randomBytes(32).toString("hex");
    bridge = await createBridge(
      { ...enrollment, token, dataDir: privateDir, allowedOrigins: [origin] },
      { localTest: process.env.SERAMET_BRIDGE_MODE === "local-test" },
    );
    await new Promise<void>((done) => bridge!.server.listen(0, "127.0.0.1", done));
    const local = {
      enabled: true,
      endpoint: `http://127.0.0.1:${bridge.server.address().port}`,
      token,
    };
    const post = async (issued: unknown) => {
      const response = await fetch(`${local.endpoint}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(issued),
      });
      expect(response.status).toBe(202);
      return response.json();
    };
    const transmit = async (issued: unknown) => {
      let outcome = await post(issued);
      for (
        let attempt = 0;
        attempt < 100 && ["QUEUED", "TRANSMITTING"].includes(outcome.stage);
        attempt++
      ) {
        await new Promise((done) => setTimeout(done, 50));
        outcome = await post(issued);
      }
      return outcome;
    };
    const width = async (device: EmulatedDevice, paperWidth: "58mm" | "80mm") => {
      device.printer = (await api("printing/printers", { ...device.printer, paperWidth })).printer;
      device.state.clearPrinterBuffer();
      device.state.clearHistory();
    };
    await manager.reload();
    await manager.getByLabel("Local bridge endpoint").fill(local.endpoint);
    await manager.getByLabel("Local bridge token").fill(token);
    await manager.getByLabel("Enable installed bridge").check();
    await manager.getByRole("button", { name: "Save local connection", exact: true }).click();
    await manager.screenshot({ path: join(evidence, "admin-desktop.png"), fullPage: true });
    await manager.setViewportSize({ width: 390, height: 844 });
    expect(await manager.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await manager.screenshot({ path: join(evidence, "admin-mobile.png"), fullPage: true });
    await manager.setViewportSize({ width: 1440, height: 1000 });
    const employeeCode = `OP${randomUUID().slice(0, 8)}`,
      pin = String(randomInt(234567, 876543));
    const employee = (
      await api("employees", {
        idempotencyKey: randomUUID(),
        fullName: "Operational Cashier",
        employeeCode,
        jobTitle: "Cashier",
        roleId: setup.roleId,
        assignedBranchIds: [fixture.firstBranchId],
        primaryBranchId: fixture.firstBranchId,
        pin,
        pinConfirmation: pin,
        effectiveFrom: new Date(Date.now() - 60000).toISOString(),
        temporaryPin: false,
      })
    ).employee;
    const device = (
      await api("devices/register", {
        branchId: fixture.firstBranchId,
        deviceType: "POS_TERMINAL",
        name: "Disposable POS",
      })
    ).device;
    await api(`devices/${device.id}/activate`, {});
    await staff.addCookies((await admin.cookies()).filter((c) => c.name === "seramet_device"));
    expect((await staff.cookies()).filter((c) => c.name === "seramet_device")).toHaveLength(1);
    const startup = await staff.request.get(`${origin}/api/seramet/public/device/startup`);
    expect((await startup.json()).state).toBe("ACTIVE");
    console.info("OPERATIONAL: device cookie and real startup verified");
    await cashier.goto("/pos-login");
    await cashier.getByLabel("Email or employee code").fill(employeeCode);
    for (const digit of pin)
      await cashier.getByRole("button", { name: digit, exact: true }).click();
    await cashier.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(cashier).toHaveURL(/\/pos$/);
    events.push(
      "Employee creation/device activation: real authenticated admin APIs. Employee code + PIN sign-in: real browser UI and server cookies",
    );
    await mutate("openPaymentDrawer", {
      input: {
        tenantId: fixture.tenantId,
        branchId: fixture.firstBranchId,
        employeeId: employee.id,
        openingFloatMinor: 0,
        currency: "KES",
        deviceId: device.id,
        actor: employee.id,
      },
    });
    // Install the existing bridge configuration using its actual storage key.
    await cashier.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: printBridgeConfigStorageKey,
      value: local,
    });
    await cashier.reload();
    for (const product of setup.products) {
      await cashier.getByPlaceholder("Search dishes or scan barcode").fill(product.name);
      await cashier
        .getByRole("button", { name: `Add ${product.name} to order`, exact: true })
        .click();
      if (product.station === "MAIN")
        await cashier.getByRole("button", { name: `Add ${product.name}`, exact: true }).click();
    }
    await cashier
      .getByPlaceholder("Item note")
      .first()
      .fill("Modifier: no onion; sauce separate; allergy test only");
    await cashier
      .getByPlaceholder("Special request for kitchen or bar")
      .fill("Keep sauce separate; allergy test only");
    await cashier.getByRole("button", { name: "Hold", exact: true }).click();
    await expect(cashier.getByText("Order held in active orders.")).toBeVisible();
    const held = (await snapshot()).state.orders.find(
      (order: { status: string; lines: unknown[] }) =>
        order.status === "HELD" && order.lines.length === 3,
    );
    expect(held).toBeTruthy();
    await cashier.getByRole("button", { name: /^Orders\s+\d/ }).click();
    await cashier
      .getByRole("button", { name: new RegExp(held.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
      .click();
    await expect(cashier.getByText(`Order ${held.id}`, { exact: true })).toBeVisible();
    await cashier.getByRole("button", { name: "Send kitchen", exact: true }).click();
    await expect
      .poll(
        async () =>
          bridge!.store.list().filter((job: { stage: string }) => job.stage === "BYTES_SUBMITTED")
            .length,
        { timeout: 30000 },
      )
      .toBe(3);
    let state = (await snapshot()).state;
    const obligations = state.kitchenPrintObligations.filter(
      (item: { orderId: string }) => item.orderId === held.id,
    );
    expect(obligations).toHaveLength(3);
    expect(obligations.every((item: { status: string }) => item.status !== "PRINTED")).toBe(true);
    for (const device of devices.slice(0, 3)) {
      const text = await capture(`${device.name.toLowerCase()}-80mm`, device, "80mm");
      const product = setup.products.find(
        (product: { station: string }) =>
          product.station === (device.name === "Kitchen" ? "MAIN" : device.name.toUpperCase()),
      );
      expect(text.toUpperCase().replace(/\s+/g, " ")).toContain(product.name.toUpperCase());
      for (const other of setup.products.filter((item: { id: string }) => item.id !== product.id))
        expect(text.toUpperCase()).not.toContain(other.name.toUpperCase());
    }
    events.push(
      "UI create three-station order, quantity 2, item preparation note, Hold, exact recall, Send kitchen; three authoritative obligations and independent emulator destinations verified",
    );
    await cashier.screenshot({ path: join(evidence, "pos-sent.png"), fullPage: true });
    await cashier.goto("/invoices");
    await expect(cashier.getByText(held.id, { exact: false }).first()).toBeVisible();
    await cashier.getByRole("button", { name: "Create / open invoice", exact: true }).click();
    const bill = (await snapshot()).state.bills.find((item: { orderIds: string[] }) =>
      item.orderIds.includes(held.id),
    );
    expect(bill).toBeTruthy();
    const expectedSubtotalMinor = setup.products.reduce(
      (sum: number, item: { station: string; priceMinor: number }) =>
        sum + item.priceMinor * (item.station === "MAIN" ? 2 : 1),
      0,
    );
    expect(parseMajorAmount(bill.subtotal.toFixed(2), "KES")).toBe(expectedSubtotalMinor);
    expect(parseMajorAmount(bill.total.toFixed(2), "KES")).toBe(
      expectedSubtotalMinor + parseMajorAmount(bill.tax.toFixed(2), "KES"),
    );
    await manager.goto("/invoices");
    await manager
      .getByRole("row")
      .filter({ hasText: bill.id })
      .getByRole("button", { name: "Preview bill", exact: true })
      .click();
    await manager.getByRole("dialog").getByRole("button", { name: "Print", exact: true }).click();
    await expect
      .poll(
        async () =>
          bridge!.store.list().filter((job: { stage: string }) => job.stage === "BYTES_SUBMITTED")
            .length,
      )
      .toBe(4);
    const billText = await capture("bill-80mm", devices[3], "80mm");
    expect(billText).toContain((parseMajorAmount(bill.total.toFixed(2), "KES") / 100).toFixed(2));
    await width(devices[3], "58mm");
    const narrowBill = await api("printing/authorize", {
      printerId: devices[3].printer!.id,
      documentType: "BILL",
      recordId: bill.id,
      reprintId: randomUUID(),
      reprintReason: "Operator requested narrow bill acceptance copy",
    });
    expect((await transmit(narrowBill)).stage).toBe("BYTES_SUBMITTED");
    expect(await capture("bill-58mm", devices[3], "58mm")).toContain("DUPLICATE COPY");
    await width(devices[3], "80mm");
    devices[3].state.clearPrinterBuffer();
    devices[3].state.clearHistory();
    await cashier.reload();
    await cashier
      .getByRole("row")
      .filter({ hasText: bill.id })
      .getByRole("button", { name: "Settle", exact: true })
      .click();
    await cashier.getByRole("dialog").getByRole("button", { name: "Cash", exact: true }).click();
    await cashier.getByLabel("Amount", { exact: true }).fill(bill.total.toFixed(2));
    await cashier
      .getByRole("dialog")
      .getByRole("button", { name: "Settle invoice", exact: true })
      .click();
    await expect(cashier.getByText("Settlement recorded", { exact: true })).toBeVisible();
    await cashier.getByRole("button", { name: "Print receipt", exact: true }).click();
    await cashier.getByRole("dialog").getByRole("button", { name: "Print", exact: true }).click();
    state = (await snapshot()).state;
    const receipt = state.receipts.find((item: { orderId: string }) => item.orderId === held.id);
    expect(receipt).toBeTruthy();
    expect(receipt.invoiceId).toBe(bill.id);
    expect(receipt.paymentBreakdown).toHaveLength(1);
    expect(receipt.paymentBreakdown[0].method).toBe("CASH");
    expect(parseMajorAmount(receipt.total.toFixed(2), "KES")).toBe(
      parseMajorAmount(bill.total.toFixed(2), "KES"),
    );
    await expect
      .poll(
        async () =>
          bridge!.store.list().filter((job: { stage: string }) => job.stage === "BYTES_SUBMITTED")
            .length,
      )
      .toBe(6);
    const receiptText = await capture("receipt-80mm", devices[3], "80mm");
    expect(receiptText).toContain(receipt.id);
    events.push(
      "UI invoice creation for exact dispatched order; manager UI bill printing; employee UI invoice cash settlement and actual receipt printing -> cashier TCP",
    );
    await manager.goto("/seramet-printers");
    await manager
      .getByRole("row")
      .filter({ hasText: "Kitchen Printer" })
      .getByRole("button", { name: "Edit printer", exact: true })
      .click();
    await manager.getByRole("combobox", { name: "Paper", exact: true }).selectOption("58mm");
    await expect(
      manager.getByRole("checkbox", { name: "Main Kitchen", exact: true }),
    ).toBeChecked();
    await manager.getByRole("button", { name: "Save printer", exact: true }).click();
    await expect(manager.getByRole("status")).toContainText("Printer configuration saved");
    devices[0].printer = (await api("printing/printers")).printers.find(
      (p: { name: string }) => p.name === "Kitchen Printer",
    );
    devices[0].state.clearPrinterBuffer();
    devices[0].state.clearHistory();
    const originalKitchen = obligations.find(
      (item: { station: string }) => item.station === "MAIN",
    );
    const requested = await mutate("requestKitchenReprint", {
      obligationId: originalKitchen.id,
      reason: "Operator requested narrow kitchen acceptance copy",
    });
    const reprint = requested.state.kitchenPrintObligations.find(
      (item: { parentObligationId?: string; status: string }) =>
        item.parentObligationId === originalKitchen.id && item.status === "PENDING",
    );
    const claimToken = randomUUID();
    await mutate("claimKitchenPrintObligation", { obligationId: reprint.id, claimToken });
    const kitchenProof = await api("printing/authorize", {
      printerId: devices[0].printer!.id,
      documentType: "FOOD_KOT",
      recordId: reprint.id,
      claimToken,
    });
    expect((await transmit(kitchenProof)).stage).toBe("BYTES_SUBMITTED");
    await mutate("settleKitchenPrintObligation", {
      obligationId: reprint.id,
      claimToken,
      outcome: "BRIDGE_ACCEPTED",
    });
    expect(await capture("kitchen-58mm", devices[0], "58mm")).toContain("REPRINT");
    await width(devices[3], "58mm");
    const narrowReceipt = await api("printing/authorize", {
      printerId: devices[3].printer!.id,
      documentType: "RECEIPT",
      recordId: receipt.id,
      reprintId: randomUUID(),
      reprintReason: "Operator requested narrow receipt acceptance copy",
    });
    expect((await transmit(narrowReceipt)).stage).toBe("BYTES_SUBMITTED");
    expect(await capture("receipt-58mm", devices[3], "58mm")).toContain("DUPLICATE COPY");
    const auditedReceipt = (await snapshot()).state.receipts.find(
      (item: { id: string }) => item.id === receipt.id,
    );
    expect(auditedReceipt.reprints).toHaveLength(1);
    expect(auditedReceipt.reprints[0].reason).toBe(
      "Operator requested narrow receipt acceptance copy",
    );
    const historyBefore = devices[3].state.snapshot().history.length;
    await Promise.all(Array.from({ length: 12 }, () => post(narrowReceipt)));
    expect(devices[3].state.snapshot().history.length).toBe(historyBefore);
    const shadowDir = join(privateDir, "replacement");
    for (const phase of ["fresh-machine", "deleted-ledger"]) {
      const shadow = await createBridge(
        { ...enrollment, token, dataDir: shadowDir },
        { localTest: true },
      );
      try {
        await new Promise<void>((done) => shadow.server.listen(0, "127.0.0.1", done));
        const response = await fetch(`http://127.0.0.1:${shadow.server.address().port}/jobs`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(narrowReceipt),
        });
        expect(response.status).toBe(202);
        await expect.poll(() => shadow.store.list()[0]?.stage).toBe("UNCERTAIN");
        expect(devices[3].state.snapshot().history.length).toBe(historyBefore);
        events.push(`${phase}: real server reservation rejected replay; no extra TCP output`);
      } finally {
        await shadow.close();
        await rm(shadowDir, { recursive: true, force: true });
      }
    }
    events.push(
      "Authenticated API: explicit audited narrow bill/receipt/KOT copies; 12 duplicate HTTP submissions caused no additional TCP document",
    );

    await devices[1].listener.stop();
    devices[1].state.clearPrinterBuffer();
    devices[1].state.clearHistory();
    const originalGrill = obligations.find((item: { station: string }) => item.station === "GRILL");
    const offlineRequest = await mutate("requestKitchenReprint", {
      obligationId: originalGrill.id,
      reason: "Operator requested controlled offline recovery exercise",
    });
    const offline = offlineRequest.state.kitchenPrintObligations.find(
      (item: { parentObligationId?: string; status: string }) =>
        item.parentObligationId === originalGrill.id && item.status === "PENDING",
    );
    const oldToken = randomUUID();
    await mutate("claimKitchenPrintObligation", { obligationId: offline.id, claimToken: oldToken });
    const offlineProof = await api("printing/authorize", {
      printerId: devices[1].printer!.id,
      documentType: "FOOD_KOT",
      recordId: offline.id,
      claimToken: oldToken,
    });
    expect((await transmit(offlineProof)).stage).toBe("NOT_SENT");
    await mutate("settleKitchenPrintObligation", {
      obligationId: offline.id,
      claimToken: oldToken,
      outcome: "UNCERTAIN",
      failureReason: "Controlled emulator listener offline; operator review required",
    });
    await manager.reload();
    await manager.getByRole("button", { name: "Inspect bridge queue", exact: true }).click();
    await expect(manager.getByText("NOT_SENT", { exact: true })).toBeVisible();
    await manager.screenshot({ path: join(evidence, "offline-queue.png"), fullPage: true });
    devices[1].listener = await startServer(devices[1].state, devices[1].port);
    await new Promise((done) => setTimeout(done, 200));
    expect(devices[1].state.snapshot().history).toHaveLength(0);
    expect((await post(offlineProof)).stage).toBe("NOT_SENT");
    await mutate("reviewKitchenPrintObligation", {
      obligationId: offline.id,
      decision: "RETRY",
      reason: "Operator inspected empty emulator after offline failure and restart",
    });
    const newToken = randomUUID();
    await mutate("claimKitchenPrintObligation", { obligationId: offline.id, claimToken: newToken });
    const recovery = await api("printing/authorize", {
      printerId: devices[1].printer!.id,
      documentType: "FOOD_KOT",
      recordId: offline.id,
      claimToken: newToken,
    });
    expect(recovery.retry).toBe(true);
    expect((await transmit(recovery)).stage).toBe("BYTES_SUBMITTED");
    await mutate("settleKitchenPrintObligation", {
      obligationId: offline.id,
      claimToken: newToken,
      outcome: "BRIDGE_ACCEPTED",
    });
    const oldConsumption = await admin.request.post(`${origin}/api/seramet/printing/consume`, {
      data: { authorization: offlineProof.authorization },
    });
    expect([403, 409]).toContain(oldConsumption.status());
    events.push(
      "Actual grill listener offline -> NOT_SENT; reconnect did not replay; manager API review/new claim -> same logical job recovered; old claim consumption rejected",
    );

    const denied = await staff.request.post(`${origin}/api/seramet/printing/printers`, {
      data: { ...devices[3].printer, name: "Unauthorized PIN configuration" },
      headers: { Origin: origin },
    });
    expect(denied.status()).toBe(403);
    const branchDenied = await staff.request.get(`${origin}/api/seramet/transactions`, {
      headers: { "x-seramet-branch-id": fixture.secondBranchId },
    });
    expect(branchDenied.status()).toBe(200);
    const selectedState = (await branchDenied.json()).state;
    expect(selectedState.orders.some((item: { id: string }) => item.id === held.id)).toBe(true);
    expect(
      selectedState.orders.every(
        (item: { branchId: string; tenantId: string }) =>
          item.branchId === fixture.firstBranchId && item.tenantId === fixture.tenantId,
      ),
    ).toBe(true);
    const foreignBranch = await staff.request.get(
      `${origin}/api/seramet/transactions?branchId=${encodeURIComponent(fixture.secondBranchId)}`,
    );
    expect(foreignBranch.status()).toBe(403);
    events.push(
      "Real employee PIN session denied printer administration and unauthorized branch selector",
    );
    // Hold a genuine server response, not a fake authorization, to create a
    // deterministic crash between durable reservation and physical TCP I/O.
    let heldReservation = false,
      releaseResponse: () => void = () => {};
    const release = new Promise<void>((done) => {
      releaseResponse = done;
    });
    const authorityProxy = createHttpServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const upstream = await fetch(`${origin}/api/seramet/printing/consume`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: Buffer.concat(chunks),
        });
        const body = await upstream.text();
        if (upstream.ok && !heldReservation) {
          heldReservation = true;
          await release;
        }
        res.writeHead(upstream.status, { "content-type": "application/json" });
        res.end(body);
      } catch {
        res.writeHead(503);
        res.end();
      }
    });
    await new Promise<void>((done) => authorityProxy.listen(0, "127.0.0.1", done));
    const portProbe = createTcpServer();
    await new Promise<void>((done) => portProbe.listen(0, "127.0.0.1", done));
    const childPort = (portProbe.address() as { port: number }).port;
    await new Promise<void>((done) => portProbe.close(() => done()));
    const childConfig = join(privateDir, "crash.local.json");
    await writeFile(
      childConfig,
      JSON.stringify({
        ...enrollment,
        token,
        port: childPort,
        dataDir: join(privateDir, "crash-ledger"),
        authorizationEndpoint: `http://127.0.0.1:${(authorityProxy.address() as { port: number }).port}/api/seramet/printing/consume`,
      }),
      { mode: 0o600 },
    );
    let child: ReturnType<typeof spawn> | undefined;
    const stopChild = async () => {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
    };
    const startChild = async () => {
      child = spawn(process.execPath, ["local-print-bridge/server.mjs"], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...process.env,
          SERAMET_BRIDGE_CONFIG: childConfig,
          SERAMET_BRIDGE_MODE: "local-test",
        },
      });
      await expect
        .poll(
          async () =>
            fetch(`http://127.0.0.1:${childPort}/health`)
              .then((r) => r.ok)
              .catch(() => false),
          { timeout: 10000 },
        )
        .toBe(true);
    };
    try {
      await startChild();
      const crashProof = await api("printing/authorize", {
        printerId: devices[3].printer!.id,
        documentType: "TEST",
        recordId: randomUUID(),
      });
      const before = devices[3].state.snapshot().history.length;
      const response = await fetch(`http://127.0.0.1:${childPort}/jobs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(crashProof),
      });
      expect(response.status).toBe(202);
      await expect.poll(() => heldReservation).toBe(true);
      await stopChild();
      releaseResponse();
      await startChild();
      const history = await (
        await fetch(`http://127.0.0.1:${childPort}/jobs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      expect(history.jobs[0].stage).toBe("UNCERTAIN");
      expect(devices[3].state.snapshot().history.length).toBe(before);
      events.push(
        "Actual Node 24 bridge killed after genuine server reservation; restart recovered SQLite TRANSMITTING as UNCERTAIN without TCP output or automatic retry",
      );
    } finally {
      releaseResponse();
      await stopChild();
      await new Promise<void>((done) => authorityProxy.close(() => done()));
    }

    // Real network truncation forwards only a prefix to the actual emulator;
    // neither this proxy nor the emulator fabricates physical acknowledgement.
    devices[3].state.clearPrinterBuffer();
    devices[3].state.clearHistory();
    let connections = 0;
    const truncated = createTcpServer((client) => {
      connections++;
      const upstream = connect(devices[3].port, "127.0.0.1");
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.once("data", (bytes) => {
        upstream.end(bytes.subarray(0, 40));
        client.destroy();
      });
    });
    await new Promise<void>((done) => truncated.listen(0, "127.0.0.1", done));
    const normalPort = devices[3].port;
    try {
      devices[3].printer = (
        await api("printing/printers", {
          ...devices[3].printer,
          port: (truncated.address() as { port: number }).port,
        })
      ).printer;
      const partial = await api("printing/authorize", {
        printerId: devices[3].printer!.id,
        documentType: "TEST",
        recordId: randomUUID(),
      });
      const outcome = await transmit(partial);
      expect(["BYTES_SUBMITTED", "UNCERTAIN"]).toContain(outcome.stage);
      await expect.poll(() => connections).toBe(1);
      await new Promise((done) => setTimeout(done, 100));
      expect(
        devices[3].state.snapshot().history.some((entry) => entry.command.type === "CutPaper"),
      ).toBe(false);
      await Promise.all(Array.from({ length: 12 }, () => post(partial)));
      expect(connections).toBe(1);
      await writeFile(
        join(evidence, "interrupted-transmission.json"),
        JSON.stringify(
          {
            bridgeStage: outcome.stage,
            connections,
            completeCutCommand: false,
            physicalDelivery: "NOT_VERIFIED",
          },
          null,
          2,
        ),
      );
      events.push(
        `Real TCP prefix loss: bridge ${outcome.stage}, emulator has no completed cut; physical delivery stays unverified and 12 submissions caused no replay`,
      );
    } finally {
      await new Promise<void>((done) => truncated.close(() => done()));
      devices[3].printer = (
        await api("printing/printers", { ...devices[3].printer, port: normalPort })
      ).printer;
    }
    const acceptedBeforeDiagnostic = bridge.store
      .list()
      .filter((job: { stage: string }) => job.stage === "BYTES_SUBMITTED").length;
    await manager
      .getByRole("row")
      .filter({ hasText: "Cashier Printer" })
      .getByRole("button", { name: "Test receipt", exact: true })
      .click();
    await expect
      .poll(
        () =>
          bridge!.store.list().filter((job: { stage: string }) => job.stage === "BYTES_SUBMITTED")
            .length,
      )
      .toBe(acceptedBeforeDiagnostic + 1);
    await manager
      .getByRole("row")
      .filter({ hasText: "Bar Printer" })
      .getByRole("button", { name: "Disable", exact: true })
      .click();
    await expect(
      manager
        .getByRole("row")
        .filter({ hasText: "Bar Printer" })
        .getByRole("button", { name: "Enable", exact: true }),
    ).toBeVisible();
    const disabled = await admin.request.post(`${origin}/api/seramet/printing/authorize`, {
      headers,
      data: { printerId: devices[2].printer!.id, documentType: "TEST", recordId: randomUUID() },
    });
    expect(disabled.status()).toBe(403);
    events.push(
      "Manager UI inspected failed queue, edited paper/station configuration, sent real diagnostic, disabled bar printer; new authorization denied",
    );
    await writeFile(
      join(evidence, "result.json"),
      JSON.stringify(
        {
          baseline: "8607afc935471a75b175684d21a878bae2f67e5c",
          candidateCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          sourceHashes: Object.fromEntries(
            [
              "src/lib/transaction-engine.ts",
              "src/lib/print-order-adapter.ts",
              "src/routes/invoices.tsx",
              "scripts/run-pilot-e2e.mjs",
              "scripts/seed-printing-operational.ts",
              "tests/e2e/printing-operational.spec.ts",
            ].map((path) => [path, createHash("sha256").update(readFileSync(path)).digest("hex")]),
          ),
          node: process.version,
          emulatorRevision: revision,
          events,
          routing: devices.map((d) => ({ name: d.name, port: d.port })),
          moneyMinor: {
            subtotal: parseMajorAmount(bill.subtotal.toFixed(2), "KES"),
            tax: parseMajorAmount(bill.tax.toFixed(2), "KES"),
            total: parseMajorAmount(bill.total.toFixed(2), "KES"),
            receiptTotal: parseMajorAmount(receipt.total.toFixed(2), "KES"),
          },
          jobs: bridge.store.list().map((job: { stage: string }) => ({ stage: job.stage })),
          physicalOutput: "NOT_VERIFIED",
        },
        null,
        2,
      ),
    );
  } finally {
    await writeFile(join(evidence, "phases.json"), JSON.stringify({ events }, null, 2));
    await writeFile(
      join(evidence, "last-screen.private.txt"),
      await cashier
        .locator("body")
        .innerText()
        .catch(() => "Unavailable"),
    );
    await staff.close();
    await admin.close();
    await viewer.close();
    await bridge?.close();
    for (const device of devices) await device.listener.stop();
    await rm(privateDir, { recursive: true, force: true });
  }
});
