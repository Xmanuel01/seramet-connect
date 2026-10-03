import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type BrowserContext } from "@playwright/test";

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
  await context.addInitScript(
    ({ tenantId, userId, branchId }) => {
      if (!/^https?:$/.test(window.location.protocol)) return;
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

test("two terminals preserve local drafts and enforce one authoritative revision winner", async ({
  browser,
}) => {
  const cashier = await browser.newContext();
  const manager = await browser.newContext();
  await authorize(cashier);
  await authorize(manager);
  const cashierPage = await cashier.newPage();
  const managerPage = await manager.newPage();

  await cashierPage.goto("/pos");
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
  await managerPage.getByRole("button", { name: heldOrder!.id, exact: true }).click();
  await expect(managerPage.getByRole("dialog").getByText("Pilot meal")).toBeVisible();

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
  await expect(cashierPage).toHaveURL(/\/login/);
  await cashierPage.reload();
  await expect(cashierPage).toHaveURL(/\/login/);
  await cashier.close();
  await manager.close();
});

test("server rejects a branch selector outside the authenticated assignment", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context, fixture.secondBranchId);
  const page = await context.newPage();
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
