import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Fixture = {
  tenantId: string;
  userId: string;
  firstBranchId: string;
  secondBranchId: string;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet", "e2e-fixture.json"), "utf8"),
) as Fixture;

async function authorize(context: BrowserContext, branchId = fixture.firstBranchId) {
  await context.route("**/api/seramet/**", async (route) => {
    const headers = {
      ...route.request().headers(),
      "x-seramet-dev-auth": "enabled",
      "x-seramet-tenant-id": fixture.tenantId,
      "x-seramet-user-id": fixture.userId,
      ...(route.request().headers()["x-seramet-branch-id"]
        ? {}
        : { "x-seramet-branch-id": branchId }),
    };
    await route.continue({ headers });
  });
}

async function establishSession(page: Page, branchId = fixture.firstBranchId) {
  await page.goto("/login");
  await page.evaluate(
    ({ tenantId, userId, branchId }) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", tenantId);
      localStorage.setItem("seramet.session.user-id", userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId }),
      );
    },
    { tenantId: fixture.tenantId, userId: fixture.userId, branchId },
  );
}

test("two terminals preserve local drafts and enforce one authoritative revision winner", async ({
  browser,
}) => {
  const cashier = await browser.newContext();
  const manager = await browser.newContext();
  await authorize(cashier);
  await authorize(manager);
  const cashierPage = await cashier.newPage();
  const managerPage = await manager.newPage();
  await establishSession(cashierPage);
  await establishSession(managerPage);

  await cashierPage.goto("/pos");
  await cashierPage.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
  await expect(cashierPage.getByRole("button", { name: "Add Pilot meal to order" })).toBeVisible();
  await cashierPage.getByRole("button", { name: "Add Pilot meal to order" }).click();
  await cashierPage.getByPlaceholder("Item note").fill("No onion - keep this draft");
  await cashierPage.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("seramet:realtime", { detail: { id: crypto.randomUUID() } }),
    ),
  );
  await expect(cashierPage.getByPlaceholder("Item note")).toHaveValue("No onion - keep this draft");
  await expect(cashierPage.getByLabel(/Connection: Online/)).toBeVisible();

  await cashierPage.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(cashierPage.getByText("Order held in active orders.")).toBeVisible();
  const heldOrder = await cashierPage.evaluate(async () => {
    const response = await fetch("/api/seramet/transactions");
    const result = (await response.json()) as {
      state: {
        orders: Array<{
          id: string;
          status: string;
          lines: Array<{ name: string; itemNote?: string }>;
        }>;
      };
    };
    return result.state.orders.find((order) => order.status === "HELD");
  });
  expect(heldOrder?.lines).toContainEqual(
    expect.objectContaining({ name: "Pilot meal", itemNote: "No onion - keep this draft" }),
  );
  await managerPage.goto("/orders");
  // The Orders view defaults to the restaurant-local business date. A held order
  // can legitimately belong to the previous business date near the cutoff;
  // cross-terminal visibility must be checked without that independent filter.
  await managerPage.getByRole("button", { name: "Clear all" }).click();
  await managerPage.getByRole("button", { name: heldOrder!.id, exact: true }).click();
  await expect(managerPage.getByRole("dialog").getByText("Pilot meal")).toBeVisible();
  await managerPage.reload();
  await expect(managerPage).toHaveURL(/\/orders$/);
  await expect(managerPage.getByRole("button", { name: "Clear all" })).toBeVisible();

  const current = await cashierPage.evaluate(async () => {
    const response = await fetch("/api/seramet/transactions");
    return response.json() as Promise<{ revision: number }>;
  });
  const payload = (label: string) => ({
    action: "upsertOrderDraft",
    payload: {
      draft: {
        tenantId: fixture.tenantId,
        branchId: fixture.firstBranchId,
        branch: fixture.firstBranchId,
        customer: label,
        channel: "DINE_IN",
        cashier: fixture.userId,
        lines: [
          {
            id: `line-${label}`,
            productId: "pilot-product",
            name: "Pilot meal",
            category: "MAIN MEALS",
            quantity: 1,
            unitPrice: 1000,
            productionStation: "MAIN",
          },
        ],
      },
      targetStatus: "OPEN",
    },
    idempotencyKey: `e2e-${label}-${crypto.randomUUID()}`,
    expectedRevision: current.revision,
  });
  const [first, second] = await Promise.all([
    cashierPage.evaluate(async (body) => {
      const response = await fetch("/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": body.idempotencyKey },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }, payload("cashier")),
    managerPage.evaluate(async (body) => {
      const response = await fetch("/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": body.idempotencyKey },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }, payload("manager")),
  ]);
  expect([first.status, second.status].sort()).toEqual([200, 409]);
  const conflict = first.status === 409 ? first.body : second.body;
  expect(conflict).toMatchObject({ code: "CONFLICT", current: { revision: current.revision + 1 } });

  await cashierPage.getByRole("button", { name: "Sign out" }).click();
  await expect(cashierPage).toHaveURL(/\/pos-login/);
  await cashier.unroute("**/api/seramet/**");
  await cashierPage.reload();
  await expect(cashierPage).toHaveURL(/\/pos-login/);
  await cashierPage.goto("/pos");
  await expect(cashierPage).toHaveURL(/\/pos-login/);
  await cashier.close();
  await manager.close();
});

test("POS clock ticks each second in branch time and catches up when refocused", async ({
  browser,
}) => {
  const context = await browser.newContext({ timezoneId: "America/Los_Angeles" });
  await authorize(context);
  const page = await context.newPage();
  await page.clock.install();
  await establishSession(page);
  await page.clock.pauseAt(new Date(Date.now() + 3000));
  await page.clock.setSystemTime(new Date("2026-10-14T20:59:59Z"));
  await page.goto("/pos");
  const clock = page.getByLabel("POS clock", { exact: true });
  await expect(clock).toBeVisible();
  await expect(clock).toHaveAttribute("title", "Africa/Nairobi");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(clock).toHaveText("23:59:59");
  await page.clock.runFor(1000);
  await expect(clock).toHaveText("00:00:00");
  await page.clock.runFor(1000);
  await expect(clock).toHaveText("00:00:01");
  await page.clock.setSystemTime(new Date("2026-10-15T02:00:00Z"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(clock).toHaveText("05:00:00");
  await expect(page).toHaveURL(/\/pos$/);
  await context.close();
});

test("server rejects a branch selector outside the authenticated assignment", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context, fixture.secondBranchId);
  const page = await context.newPage();
  await establishSession(page, fixture.secondBranchId);
  await page.goto("/");
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/seramet/transactions", {
      headers: { "x-seramet-branch-id": "not-an-assigned-branch" },
    });
    return response.status;
  });
  expect(status).toBe(403);
  await context.close();
});
