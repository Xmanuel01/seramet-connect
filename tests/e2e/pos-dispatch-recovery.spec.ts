import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixture, openCashier } from "./pos-stability-helpers";
import type { TransactionState } from "../../src/lib/transaction-engine";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback dispatch acceptance only");
});

test("POS displays restaurant time and missing routing cannot dispatch a new order", async ({
  context,
  page,
}) => {
  await openCashier(context, page);
  await page.clock.setFixedTime(new Date("2026-10-18T11:21:00Z"));
  await expect(page.getByLabel("POS clock", { exact: true })).toHaveText("14:21:00");
  await expect(page.getByLabel("POS clock", { exact: true })).toHaveAttribute(
    "title",
    "Restaurant time (Africa/Nairobi)",
  );
  const count = () =>
    page.evaluate(
      async () => (await (await fetch("/api/seramet/transactions")).json()).state.orders.length,
    );
  const before = await count();
  await page.getByRole("button", { name: "Place Order", exact: true }).click();
  await expect(page.getByText(/Kitchen routing is unavailable:/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Check printers and kitchen routes" })).toBeVisible();
  await expect(page.getByPlaceholder("Item note")).toHaveValue("No onion - preserve cashier work");
  expect(await count()).toBe(before);
});

test("another terminal's durable acknowledgement clears a recovered order; uncertainty never retries", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const headers = {
    authorization: `Bearer ${fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
  };
  let releaseSnapshot = () => {};
  try {
    const api = async (path: string, data?: unknown) => {
      const response = await context.request.fetch(`http://127.0.0.1:4173/api/seramet/${path}`, {
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
    const { actor } = await api("auth/session");
    const { configuration } = await api("configuration");
    const channel = configuration.orderChannels.find(
      (item: { code: string }) => item.code === "DINE_IN",
    );
    await context.route("**/api/seramet/**", (route) =>
      route.continue({ headers: { ...route.request().headers(), ...headers } }),
    );
    const page = await context.newPage();
    await page.goto("/login?account=1");
    let pauseSnapshot = true;
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = () => {
        pauseSnapshot = false;
        resolve();
      };
    });
    await context.route(
      (url) => url.pathname === "/api/seramet/transactions",
      async (route) => {
        if (route.request().method() === "GET" && pauseSnapshot) await snapshotGate;
        await route.fallback();
      },
    );
    for (const outcome of ["BRIDGE_ACCEPTED", "UNCERTAIN"] as const) {
      const source = randomUUID();
      await mutate("upsertAndSendKitchen", {
        draft: {
          tenantId: fixture.tenantId,
          branchId: fixture.firstBranchId,
          branch: fixture.firstBranchId,
          customer: source,
          channel: "DINE_IN",
          cashier: fixture.userId,
          lines: [
            {
              id: source,
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
      const order = current.state.orders.find((item) => item.customer === source)!;
      expect(order).toBeTruthy();
      const tickets = current.state.kitchenPrintObligations!.filter(
        (item) => item.orderId === order.id,
      );
      expect(tickets).toHaveLength(1);
      const claimToken = randomUUID();
      await mutate("claimKitchenPrintObligations", {
        obligationIds: tickets.map((item) => item.id),
        claimToken,
      });
      // Disposable bridge-outcome fixture, not evidence of physical printer delivery.
      await mutate("settleKitchenPrintObligation", {
        obligationId: tickets[0]!.id,
        claimToken,
        outcome,
      });
      const key =
        "seramet.pos.draft.v1:" +
        [fixture.tenantId, fixture.firstBranchId, actor.id, actor.deviceId ?? "account"]
          .map(encodeURIComponent)
          .join(":");
      await page.evaluate(
        ({ f, key, orderId, channelId }) => {
          sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
          localStorage.setItem("seramet.session.tenant-id", f.tenantId);
          localStorage.setItem(
            "seramet.session.branch-scope.v2",
            JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
          );
          sessionStorage.setItem(
            key,
            JSON.stringify({
              lines: { [f.menuItemId]: 1 },
              itemNotes: {},
              kitchenNote: "",
              activeOrderId: orderId,
              selectedTableNo: null,
              customerId: null,
              orderSource: channelId,
              savedAt: Date.now(),
            }),
          );
        },
        { f: fixture, key, orderId: order.id, channelId: channel.id },
      );
      await page.goto("/pos");
      await expect(page.getByPlaceholder("Item note")).toBeVisible();
      if (outcome === "BRIDGE_ACCEPTED") {
        await expect(
          page.getByRole("button", { name: "Place Order", exact: true }),
        ).toBeDisabled();
        releaseSnapshot();
      }
      await expect(page.getByText("1 sent / 0 unsent", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Place Order", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Place Order", exact: true }).click();
      if (outcome === "BRIDGE_ACCEPTED") {
        await expect(
          page.getByText(`${order.id} is already in kitchen; no new KOT is required.`, {
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.getByPlaceholder("Item note")).toHaveCount(0);
      } else {
        await expect(
          page.getByText(/Verify the ticket in Printers before leaving this order/),
        ).toBeVisible();
        await expect(page.getByPlaceholder("Item note")).toBeVisible();
      }
      current = await snapshot();
      expect(
        current.state.kitchenPrintObligations!.filter((item) => item.orderId === order.id),
      ).toHaveLength(1);
      expect(
        current.state.kitchenPrintObligations!.find((item) => item.id === tickets[0]!.id)?.status,
      ).toBe(outcome);
      await page.goto("/login?account=1");
    }
  } finally {
    releaseSnapshot();
    await context.close();
  }
});
