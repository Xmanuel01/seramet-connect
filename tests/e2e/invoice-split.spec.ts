import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fixture } from "./pos-stability-helpers";
import { invoiceDisplayName } from "../../src/lib/invoice-split";
import { printBridgeConfigStorageKey } from "../../src/lib/print-bridge-client-config";
import type { TransactionState } from "../../src/lib/transaction-engine";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback invoice acceptance only");
});

const headers = {
  authorization: `Bearer ${fixture.managerAccessToken}`,
  "x-seramet-tenant-id": fixture.tenantId,
  "x-seramet-branch-id": fixture.firstBranchId,
};

async function signIn(context: BrowserContext, page: Page) {
  await context.route("**/api/seramet/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
  await page.goto("/login?account=1");
  await page.evaluate((f) => {
    sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
    localStorage.setItem("seramet.session.tenant-id", f.tenantId);
    localStorage.setItem("seramet.session.user-id", f.userId);
    localStorage.setItem(
      "seramet.session.branch-scope.v2",
      JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
    );
  }, fixture);
}

for (const multiple of [false, true]) {
  test(`custom ${multiple ? "multiple-person phone" : "two-person desktop"} invoice split is confirmed once and preserves failed drafts`, async ({
    context,
    page,
  }) => {
    await signIn(context, page);
    const api = async (path: string, data?: unknown) => {
      const response = await context.request.fetch(`/api/seramet/${path}`, {
        headers,
        method: data === undefined ? "GET" : "POST",
        data,
      });
      expect(response.ok(), `${path} HTTP ${response.status()}`).toBe(true);
      return response.json();
    };
    const snapshot = () =>
      api("transactions") as Promise<{ revision: number; state: TransactionState }>;
    const mutate = async (action: string, payload: unknown) =>
      api("transactions/mutate", {
        action,
        payload,
        expectedRevision: (await snapshot()).revision,
        idempotencyKey: randomUUID(),
      });
    const customer = randomUUID();
    await mutate("upsertAndSendKitchen", {
      draft: {
        tenantId: fixture.tenantId,
        branchId: fixture.firstBranchId,
        branch: fixture.firstBranchId,
        customer,
        channel: "DINE_IN",
        cashier: fixture.userId,
        lines: [
          {
            id: randomUUID(),
            productId: fixture.menuItemId,
            name: "Pilot meal",
            category: "MAIN_MEALS",
            quantity: 1,
            unitPrice: 1000,
            productionStation: "MAIN",
          },
        ],
      },
    });
    let current = await snapshot();
    const order = current.state.orders.find((item) => item.customer === customer)!;
    expect(order).toBeTruthy();
    await mutate("prepareInvoiceForPayment", { orderId: order.id });
    current = await snapshot();
    const invoice = current.state.bills.find((item) => item.orderIds.includes(order.id))!;
    const untouched = current.state.bills.filter((item) => item.id !== invoice.id);
    const amount = invoice.total;
    expect(amount).toBeGreaterThan(550);
    if (multiple) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/invoices");
    await page.getByRole("button", { name: invoiceDisplayName(invoice.id), exact: true }).click();
    const dialog = page.getByRole("dialog", { name: `Split ${invoiceDisplayName(invoice.id)}` });
    await expect(dialog).toBeVisible();
    expect((await snapshot()).state.bills.find((item) => item.id === invoice.id)?.status).toBe(
      "OPEN",
    );
    await expect(dialog.getByLabel("Person 1 amount")).toHaveValue("");
    await dialog.getByLabel("Person 1 amount").fill("90071992547409.91");
    await dialog.getByLabel("Person 2 amount").fill("90071992547409.91");
    await expect(dialog.getByText(/Amount exceeds supported range/)).toBeVisible();
    if (multiple) await dialog.getByRole("radio", { name: "Multiple people" }).check();
    await dialog.getByLabel("Person 1 amount").fill(multiple ? "200" : "400");
    await dialog.getByLabel("Person 2 amount").fill(String(amount));
    const confirm = dialog.getByRole("button", { name: "Confirm split", exact: true });
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByText(/Over by:/)).toBeVisible();
    await dialog.getByLabel("Person 2 amount").fill(multiple ? "300" : String(amount - 400));
    if (multiple) {
      await dialog.getByLabel("Person 3 amount").fill("50");
      await expect(confirm).toBeDisabled();
      await dialog.getByRole("button", { name: "Add person", exact: true }).click();
      await dialog.getByLabel("Person 4 amount").fill(String(amount - 550));
    }
    await expect(confirm).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await mkdir(".seramet/invoice-split-acceptance", { recursive: true });
    await page.screenshot({
      path: `.seramet/invoice-split-acceptance/${multiple ? "phone" : "desktop"}.png`,
      fullPage: true,
    });
    let attempts = 0;
    await page.route("**/api/seramet/transactions/mutate", async (route) => {
      if (route.request().postDataJSON().action !== "splitBill") return route.fallback();
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Disposable unavailable response" }),
        });
      await route.fallback();
    });
    await confirm.click();
    await expect(confirm).toBeEnabled();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("Person 1 amount")).toHaveValue(multiple ? "200" : "400");
    expect((await snapshot()).state.bills.find((item) => item.id === invoice.id)?.status).toBe(
      "OPEN",
    );
    await confirm.dblclick();
    await expect(dialog).toBeHidden();
    const after = (await snapshot()).state;
    expect(after.bills.find((item) => item.id === invoice.id)?.status).toBe("SPLIT");
    const children = after.bills.filter((item) => item.splitFromBillId === invoice.id);
    expect(children).toHaveLength(multiple ? 4 : 2);
    expect(children.reduce((sum, item) => sum + Math.round(item.total * 100), 0)).toBe(
      Math.round(amount * 100),
    );
    expect(after.bills.filter((item) => untouched.some((before) => before.id === item.id))).toEqual(
      untouched,
    );
    expect(attempts).toBe(2);
    await page.reload();
    for (const child of children)
      await expect(
        page.getByRole("button", { name: invoiceDisplayName(child.id), exact: true }),
      ).toBeVisible();
  });
}

test("saved enrolled bridge auto-discovers Windows printers without creating routes or printing", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  let discoveries = 0;
  let completedDiscoveries = 0;
  page.on("response", (response) => {
    if (response.url() === "http://127.0.0.1:48777/printers" && response.status() === 200)
      completedDiscoveries++;
  });
  let writes = 0;
  await page.route("**/api/seramet/printing/**", async (route) => {
    if (route.request().method() === "POST") writes++;
    await route.fallback();
  });
  const token = randomUUID() + randomUUID();
  await page.evaluate(
    ({ token, key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({ enabled: true, endpoint: "http://127.0.0.1:48777", token }),
      ),
    { token, key: printBridgeConfigStorageKey },
  );
  await page.route("http://127.0.0.1:48777/printers", (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    discoveries++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        bridgeId: "disposable-bridge",
        tenantId: fixture.tenantId,
        branchId: fixture.firstBranchId,
        printers: [
          {
            name: "Disposable Thermal Printer",
            driver: "Disposable Windows driver",
            physicalStatus: "UNKNOWN",
          },
        ],
      }),
    });
  });
  await page.goto("/seramet-printers");
  await expect(page.getByText("Disposable Thermal Printer", { exact: true })).toBeVisible();
  // Initial scope hydration may cancel its first request; only the live scope completes.
  expect(completedDiscoveries).toBe(1);
  expect(discoveries).toBeLessThanOrEqual(2);
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Configure printer", exact: true }).click();
  await expect(page.getByLabel("Installed printer name")).toHaveValue("Disposable Thermal Printer");
  await expect(page.getByLabel("Enrolled bridge ID")).toHaveValue("disposable-bridge");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.route("http://127.0.0.1:48777/printers", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        bridgeId: "disposable-bridge",
        tenantId: fixture.tenantId,
        branchId: fixture.secondBranchId,
        printers: [{ name: "Other branch printer", driver: "Windows", physicalStatus: "UNKNOWN" }],
      }),
    }),
  );
  await page.getByRole("button", { name: "Detect installed printers", exact: true }).click();
  await expect(
    page.getByText("This bridge is not enrolled for the selected restaurant and branch."),
  ).toBeVisible();
  await expect(page.getByText("Other branch printer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Disposable Thermal Printer", { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
