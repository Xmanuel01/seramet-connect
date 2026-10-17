import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createBridge } from "../../local-print-bridge/server.mjs";

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
    await page.getByLabel("Enrolled bridge ID").fill(bridgeId);
    await page.getByRole("combobox", { name: "Transport", exact: true }).selectOption("TCP");
    await page.getByLabel("Printer host").fill("127.0.0.1");
    await page.getByLabel("TCP port").fill(String((tcp.address() as { port: number }).port));
    await page.getByRole("button", { name: "Save printer", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Printer configuration saved");
    await page
      .getByLabel("Local bridge endpoint")
      .fill(`http://127.0.0.1:${bridge.server.address().port}`);
    await page.getByLabel("Local bridge token").fill(token);
    await page.getByLabel("Enable installed bridge").check();
    await page.getByRole("button", { name: "Save local connection", exact: true }).click();
    await page.getByRole("button", { name: "Test receipt", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "Transport submitted; physical delivery unconfirmed",
    );
    await expect.poll(() => Buffer.concat(chunks).toString("ascii")).toContain("TEST RECEIPT");
    await page.getByRole("button", { name: "Inspect bridge queue", exact: true }).click();
    await expect(page.getByText("BYTES_SUBMITTED", { exact: true })).toBeVisible();
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
      page.getByRole("cell", { name: "Disposable TCP printer", exact: true }),
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
