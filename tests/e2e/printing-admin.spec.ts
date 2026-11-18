import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createBridge } from "../../local-print-bridge/server.mjs";

/** A 32 x 16 PNG: black left half, white right half. */
function logoPng() {
  const crc = (bytes: Buffer) => {
    let c = ~0;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0);
  header.writeUInt32BE(16, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0), Buffer.alloc(16, 255)]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 16 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("authenticated owner configures TCP, submits a signed diagnostic and cannot substitute another branch", async ({
  browser,
}) => {
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E_BASE_URL
  )
    throw new Error("Disposable loopback-only printing acceptance required");
  const fixture = JSON.parse(readFileSync(resolve(".seramet/e2e-fixture.json"), "utf8"));
  if (!/^e2e-[a-f0-9-]+$/.test(fixture.tenantId) || !process.env.SERAMET_PRINT_SIGNING_KEY)
    throw new Error("Disposable printer fixture required");
  const dataDir = await mkdtemp(join(tmpdir(), "seramet-print-browser-"));
  const chunks: Buffer[] = [];
  const tcp = createServer((socket) => socket.on("data", (bytes) => chunks.push(bytes)));
  const token = randomBytes(32).toString("hex");
  const bridgeId = randomUUID();
  const bridge = await createBridge(
    {
      bridgeId,
      tenantId: fixture.tenantId,
      branchId: fixture.firstBranchId,
      signingKey: createHmac("sha256", process.env.SERAMET_PRINT_SIGNING_KEY!)
        .update(
          JSON.stringify(["seramet-print-v1", fixture.tenantId, fixture.firstBranchId, bridgeId]),
        )
        .digest("hex"),
      token,
      dataDir,
      allowedOrigins: ["http://127.0.0.1:4173"],
      authorizationEndpoint: "http://127.0.0.1:4173/api/seramet/printing/consume",
    },
    { localTest: true },
  );
  const context = await browser.newContext();
  try {
    await new Promise<void>((done) => tcp.listen(0, "127.0.0.1", done));
    await new Promise<void>((done) => bridge.server.listen(0, "127.0.0.1", done));
    await context.route("**/api/seramet/**", (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          authorization: `Bearer ${fixture.managerAccessToken}`,
          "x-seramet-tenant-id": fixture.tenantId,
          "x-seramet-branch-id": fixture.firstBranchId,
        },
      }),
    );
    const page = await context.newPage();
    await page.goto("/login");
    await page.evaluate((fixture) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", fixture.tenantId);
      localStorage.setItem("seramet.session.user-id", fixture.userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId: fixture.firstBranchId }),
      );
    }, fixture);
    await page.goto("/seramet-printers");
    await page.getByRole("button", { name: "Add printer", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Disposable TCP printer");
    if (!(await page.getByLabel("Print bridge ID").isVisible()))
      await page.getByText("More printer settings", { exact: true }).click();
    await page.getByLabel("Print bridge ID").fill(bridgeId);
    await page.getByRole("combobox", { name: "How it connects", exact: true }).selectOption("TCP");
    await page.getByLabel("Printer IP address", { exact: true }).fill("127.0.0.1");
    await page
      .getByLabel("Port", { exact: true })
      .fill(String((tcp.address() as { port: number }).port));
    await page.getByRole("button", { name: "Save printer", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Printer saved");
    await page.getByText("Troubleshooting (for technicians)", { exact: true }).click();
    await page
      .getByLabel("Local bridge endpoint")
      .fill(`http://127.0.0.1:${bridge.server.address().port}`);
    await page.getByLabel("Local bridge token").fill(token);
    await page.getByLabel("Enable installed bridge").check();
    await page.getByRole("button", { name: "Save local connection", exact: true }).click();
    // Save a branch receipt logo; the test receipt must carry it to the printer.
    await page
      .locator("label", { hasText: /^Choose .* logo$/ })
      .last()
      .locator('input[type="file"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logoPng() });
    await page.getByRole("button", { name: "Save logo", exact: true }).click();
    await expect(page.getByText(/now prints this logo/)).toBeVisible();
    await page.getByRole("button", { name: "Test receipt", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Sent to the printer. Check that it printed." }),
    ).toBeVisible();
    // The test receipt is the real receipt template under a diagnostic banner.
    await expect
      .poll(() => Buffer.concat(chunks).toString("ascii"))
      .toContain("PRINTER TEST - NOT A SALE");
    // ESC a 1 then GS v 0 with a 4-byte-wide (32 dot), 16-row image, black on the left.
    const printed = Buffer.concat(chunks);
    const logoAt = printed.indexOf(Buffer.from([27, 97, 1, 29, 118, 48, 0, 4, 0, 16, 0]));
    expect(logoAt).toBeGreaterThanOrEqual(0);
    expect([...printed.subarray(logoAt + 11, logoAt + 15)]).toEqual([255, 255, 0, 0]);
    expect(logoAt).toBeLessThan(printed.indexOf(Buffer.from("PRINTER TEST - NOT A SALE")));
    expect(Buffer.concat(chunks).toString("ascii")).toContain("RECEIPT");
    await page.getByRole("button", { name: "Check print queue", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Sent to printer", exact: true }).first(),
    ).toBeVisible();
    const denied = await page.evaluate(
      async ({ branchId }) => {
        const response = await fetch("/api/seramet/printing/printers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branchId,
            name: "Forbidden branch target",
            bridgeId: crypto.randomUUID(),
            transport: "TCP",
            host: "127.0.0.1",
            roles: ["BILL"],
          }),
        });
        return response.status;
      },
      { branchId: fixture.secondBranchId },
    );
    expect(denied).toBe(403);
    await page.reload();
    await expect(
      page
        .getByRole("table", { name: "Your printers" })
        .getByRole("cell", { name: "Disposable TCP printer", exact: true }),
    ).toBeVisible();
    await mkdir(resolve(".seramet/printing-acceptance"), { recursive: true });
    await page.screenshot({
      path: resolve(".seramet/printing-acceptance/admin-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: resolve(".seramet/printing-acceptance/admin-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(page.getByRole("button", { name: "Enable", exact: true })).toBeVisible();
  } finally {
    await context.close().catch(() => undefined);
    await bridge.close();
    await new Promise<void>((done) => tcp.close(() => done()));
    await rm(dataDir, { recursive: true, force: true });
  }
});
