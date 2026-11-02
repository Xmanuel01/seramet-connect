import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture } from "./pos-stability-helpers";
import type { TransactionState } from "../../src/lib/transaction-engine";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback finance acceptance only");
});

const headers = {
  authorization: `Bearer ${fixture.managerAccessToken}`,
  "x-seramet-tenant-id": fixture.tenantId,
  "x-seramet-branch-id": fixture.firstBranchId,
};
// The seed names the cash method after the disposable tenant.
const cashMethodId = `e2e-cash-${fixture.tenantId.slice("e2e-".length)}`;

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

test("a cash sale on another terminal reaches Receipts live, and finance pages survive going offline", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const watcherContext = await browser.newContext();
  const errors: string[] = [];
  try {
    const watcher = await watcherContext.newPage();
    watcher.on("pageerror", (error) => errors.push(error.message));
    await signIn(watcherContext, watcher);
    await watcher.goto("/receipts");
    await expect(watcher.getByRole("heading", { name: "Receipts", exact: true })).toBeVisible();

    // The "other terminal": the same server commands the till sends.
    const api = async (path: string, data?: unknown) => {
      const response = await watcherContext.request.fetch(`/api/seramet/${path}`, {
        headers,
        method: data === undefined ? "GET" : "POST",
        data,
      });
      expect(response.ok(), `${path} HTTP ${response.status()}: ${await response.text()}`).toBe(
        true,
      );
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
    let state = (await snapshot()).state;
    const order = state.orders.find((item) => item.customer === customer)!;
    await mutate("prepareInvoiceForPayment", { orderId: order.id });
    state = (await snapshot()).state;
    const invoice = state.bills.find((item) => item.orderIds.includes(order.id))!;
    const drawerOpen = state.paymentOperations?.drawerSessions.some(
      (drawer) => drawer.branchId === fixture.firstBranchId && drawer.status === "OPEN",
    );
    if (!drawerOpen)
      await mutate("openPaymentDrawer", {
        input: {
          tenantId: fixture.tenantId,
          branchId: fixture.firstBranchId,
          employeeId: fixture.userId,
          openingFloatMinor: 0,
          currency: "KES",
          actor: "Pilot manager",
        },
      });
    const totalMinor = Math.round(invoice.total * 100);
    await mutate("applyConfiguredPayment", {
      invoiceId: invoice.id,
      paymentMethodId: cashMethodId,
      amountMinor: totalMinor,
      tenderedAmountMinor: totalMinor + 50_000,
    });
    const receipt = (await snapshot()).state.receipts.find((row) => row.invoiceId === invoice.id)!;
    expect(receipt.change).toBe(500);

    // The watching page shows it without a reload.
    await expect(watcher.getByText(receipt.id, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Finance pages keep their figures and explain going offline, then recover.
    await watcher.goto("/statements?tab=profit-loss");
    const main = watcher.locator("main");
    await expect(main.getByRole("tab", { name: "Profit & Loss" })).toBeVisible();
    await watcherContext.setOffline(true);
    await main.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(main.getByText(/You're offline\. Reconnect, then try again\./)).toBeVisible();
    await expect(main.getByRole("tab", { name: "Profit & Loss" })).toBeVisible();
    // Back online, the paused refresh resumes by itself.
    await watcherContext.setOffline(false);
    await expect(main.getByText(/You're offline/)).toHaveCount(0, { timeout: 15_000 });
    await expect(watcher.getByText("This page didn't load", { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await watcherContext.close();
  }
});
