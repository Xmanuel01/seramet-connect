import { test, expect } from "@playwright/test";
import { openCashier, recordTrace } from "./pos-stability-helpers";

test("transient authentication/focus storms retain POS mount, inputs and deep link", async ({
  context,
  page,
}) => {
  await openCashier(context, page);
  const started = Date.now();
  let checks = 0,
    transactionReads = 0;
  let failure: "503" | "transport" | "healthy" = "503";
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/seramet/transactions") transactionReads++;
  });
  await context.route("**/api/seramet/auth/session", (route) => {
    checks++;
    return failure === "503"
      ? route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } })
      : failure === "transport"
        ? route.abort("timedout")
        : route.fallback();
  });
  await page.evaluate(() => {
    for (let n = 0; n < 100; n++) {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
  await expect(page.getByLabel("Connection: Connection unstable")).toBeVisible();
  await expect(page.getByPlaceholder("Item note")).toHaveValue("No onion - preserve cashier work");
  expect(checks).toBe(1);
  failure = "healthy";
  await page.waitForTimeout(5500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Connection: Online")).toBeVisible();
  const beforeStorm = transactionReads;
  await page.evaluate(() => {
    for (let n = 0; n < 50; n++)
      window.dispatchEvent(
        new CustomEvent("seramet:realtime", { detail: { id: "disposable-event" } }),
      );
  });
  await page.waitForTimeout(2500);
  expect(transactionReads - beforeStorm).toBeLessThanOrEqual(2);
  await expect(page.getByPlaceholder("Item note")).toHaveValue("No onion - preserve cashier work");
  const trace = await recordTrace(page, "transient-after", { checks, transactionReads });
  expect(
    new Set(trace.filter((event) => event.kind === "POS_MOUNT").map((event) => event.correlationId))
      .size,
  ).toBe(1);
  expect(
    trace.filter(
      (event) =>
        event.at >= started && (event.kind === "POS_UNMOUNT" || event.kind === "PAGE_EXIT"),
    ),
  ).toHaveLength(0);
  expect(trace.some((event) => event.kind === "SNAPSHOT_UNCHANGED")).toBe(true);
  await expect(page).toHaveURL(/\/pos$/);
});

test("browser recovery restores only permitted cashier draft fields", async ({ context, page }) => {
  await openCashier(context, page);
  await page.reload();
  await expect(page.getByPlaceholder("Item note")).toHaveValue("No onion - preserve cashier work");
  await expect(page.getByLabel("Connection: Online")).toBeVisible();
  const data = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("seramet.pos.draft.v1:"))
      .map((key) => JSON.parse(sessionStorage.getItem(key)!)),
  );
  expect(data).toHaveLength(1);
  expect(Object.keys(data[0]).sort()).toEqual(
    [
      "activeOrderId",
      "customerId",
      "itemNotes",
      "kitchenNote",
      "lines",
      "orderSource",
      "savedAt",
      "selectedTableNo",
    ].sort(),
  );
  await expect(page.getByText("Saving", { exact: true })).not.toBeVisible();
  await recordTrace(page, "refresh-recovery");
});

test("IndexedDB unavailable does not prevent authoritative order entry", async ({
  context,
  page,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open() {
          throw new DOMException("Fixture denied", "SecurityError");
        },
      },
    }),
  );
  await openCashier(context, page);
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByText("Order held in active orders.")).toBeVisible();
  await expect(page.getByLabel("Connection: Online")).toBeVisible();
});

test("a remote change cannot be overwritten by saving an older recalled cashier draft", async ({
  context,
  page,
}) => {
  await openCashier(context, page);
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByText("Order held in active orders.")).toBeVisible();
  const current = await page.evaluate(async () =>
    (await fetch("/api/seramet/transactions")).json(),
  );
  const held = current.state.orders.find(
    (order: { status: string; lines: Array<{ itemNote?: string }> }) =>
      order.status === "HELD" &&
      order.lines.some((line) => line.itemNote === "No onion - preserve cashier work"),
  );
  expect(held).toBeTruthy();
  await page.getByRole("button", { name: /^Orders\s+\d+$/ }).click();
  await page.getByRole("button", { name: new RegExp(held.id) }).click();
  await page.getByPlaceholder("Item note").fill("Local unsaved revision");
  const status = await page.evaluate(
    async ({ order, revision }) => {
      const key = crypto.randomUUID();
      const response = await fetch("/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          action: "upsertOrderDraft",
          payload: {
            orderId: order.id,
            draft: {
              ...order,
              lines: order.lines.map((line: Record<string, unknown>) => ({
                ...line,
                itemNote: "Other terminal authoritative note",
              })),
            },
            targetStatus: "HELD",
          },
          expectedRevision: revision,
          idempotencyKey: key,
        }),
      });
      return response.status;
    },
    { order: held, revision: current.revision },
  );
  expect(status).toBe(200);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("seramet:realtime", { detail: { id: crypto.randomUUID() } }),
    ),
  );
  await page.waitForTimeout(2500);
  await expect(page.getByPlaceholder("Item note")).toHaveValue("Local unsaved revision");
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByLabel("Connection: Sync conflict")).toBeVisible();
  const saved = await page.evaluate(
    async (id) =>
      (
        (await (await fetch("/api/seramet/transactions")).json()).state.orders as Array<{
          id: string;
          lines: Array<{ itemNote?: string }>;
        }>
      ).find((order) => order.id === id),
    held.id,
  );
  expect(saved?.lines[0]?.itemNote).toBe("Other terminal authoritative note");
  await expect(page.getByPlaceholder("Item note")).toHaveValue("Local unsaved revision");
});

test("offline hold replays once only after verification and never syncs an idle queue", async ({
  context,
  page,
}) => {
  await openCashier(context, page);
  let replays = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/seramet/offline/sync") replays++;
  });
  await context.setOffline(true);
  await expect(page.getByLabel("Connection: Offline")).toBeVisible();
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByText(/offline command pending/)).toBeVisible();
  expect(replays).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => {
    for (let n = 0; n < 20; n++) window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => replays, { timeout: 45_000 }).toBe(1);
  await expect(page.getByText(/offline command pending/)).not.toBeVisible();
  await page.evaluate(() => {
    for (let n = 0; n < 20; n++) window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(6000);
  expect(replays).toBe(1);
  await expect(page.getByLabel("Connection: Online")).toBeVisible();
  await recordTrace(page, "offline-replay", { replays });
});

test("confirmed revocation denies access while refresh-service failure does not log out", async ({
  context,
  page,
}) => {
  await openCashier(context, page);
  await context.route("**/api/seramet/auth/session", (route) =>
    route.fulfill({ status: 401, json: { code: "SESSION_EXPIRED" } }),
  );
  await context.route("**/api/seramet/public/auth/refresh", (route) =>
    route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Connection: Connection unstable")).toBeVisible();
  await expect(page.getByPlaceholder("Item note")).toHaveValue("No onion - preserve cashier work");
  await context.route("**/api/seramet/public/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { code: "SESSION_REVOKED" } }),
  );
  await page.waitForTimeout(5500);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page).toHaveURL(/\/pos-login\?reason=session-expired/);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).some((key) => key.startsWith("seramet.pos.draft.v1:")),
    ),
  ).toBe(false);
});
