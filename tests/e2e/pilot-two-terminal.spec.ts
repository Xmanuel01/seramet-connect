import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { invoiceDisplayName } from "../../src/lib/invoice-split";
import type { TransactionState } from "../../src/lib/transaction-engine";

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
  await expect(clock).toHaveAttribute("title", "Restaurant time (Africa/Nairobi)");
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

test("disposable cash shift persists hold, kitchen, invoice, receipt, drawer and financial close", async ({
  browser,
}) => {
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(fixture.tenantId)
  ) {
    throw new Error("Authoritative isolation inspection requires disposable local E2E data");
  }
  const branchARecords = () => {
    const database = new DatabaseSync(resolve(process.cwd(), ".seramet", "development.sqlite"), {
      readOnly: true,
    });
    try {
      return database
        .prepare(
          `SELECT tenant_id, entity_type, entity_id, branch_id, business_date, status,
                version, payload_json, created_at, updated_at
         FROM authoritative_records WHERE tenant_id = ? AND branch_id = ?
         ORDER BY entity_type, entity_id`,
        )
        .all(fixture.tenantId, fixture.firstBranchId);
    } finally {
      database.close();
    }
  };
  // Seed the control through normal branch-authorized UI, so this focused test
  // cannot pass vacuously when run without the other browser scenarios.
  const control = await browser.newContext();
  try {
    await authorize(control);
    const controlPage = await control.newPage();
    await establishSession(controlPage);
    await controlPage.goto("/pos");
    await controlPage.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
    await controlPage.getByRole("button", { name: "Add Pilot meal to order" }).click();
    await controlPage.getByPlaceholder("Item note").fill("Branch A isolation sentinel");
    await controlPage.getByRole("button", { name: "Hold", exact: true }).click();
    await expect(controlPage.getByText("Order held in active orders.")).toBeVisible();
  } finally {
    await control.close();
  }
  const branchABefore = branchARecords();
  const sentinel = branchABefore.find(
    (record) =>
      record.entity_type === "state:orders" &&
      String(record.payload_json).includes("Branch A isolation sentinel"),
  );
  expect(sentinel, "Branch A must contain a real persisted control order").toBeDefined();
  expect(Number(sentinel!.version)).toBeGreaterThan(0);
  const context = await browser.newContext();
  await authorize(context, fixture.secondBranchId);
  const page = await context.newPage();
  await establishSession(page, fixture.secondBranchId);
  type Snapshot = { state: TransactionState; revision: number };
  const snapshot = () =>
    page.evaluate(async () => {
      const response = await fetch("/api/seramet/transactions");
      if (!response.ok) throw new Error(`Snapshot rejected: ${response.status}`);
      return response.json() as Promise<Snapshot>;
    });
  const mutate = async (
    action: string,
    payload: Record<string, unknown>,
    key = crypto.randomUUID(),
  ) => {
    const { revision } = await snapshot();
    const result = await page.evaluate(
      async (body) => {
        const response = await fetch("/api/seramet/transactions/mutate", {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": body.idempotencyKey },
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
      },
      { action, payload, idempotencyKey: key, expectedRevision: revision },
    );
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    return snapshot();
  };
  const scope = { tenantId: fixture.tenantId, branchId: fixture.secondBranchId };
  await page.goto("/pos");
  const before = await snapshot();
  await mutate("openPaymentDrawer", {
    input: {
      ...scope,
      employeeId: fixture.userId,
      openingFloatMinor: 50000,
      currency: "KES",
      actor: "Pilot manager",
    },
  });
  await page.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
  await page.getByRole("button", { name: "Add Pilot meal to order" }).click();
  await page.getByPlaceholder("Item note").fill("Disposable cash shift - no onion");
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByText("Order held in active orders.")).toBeVisible();
  const held = (await snapshot()).state.orders.find(
    (order) => !before.state.orders.some((old) => old.id === order.id),
  )!;
  expect(held).toMatchObject({ ...scope, status: "HELD" });
  expect(held.lines[0]?.itemNote).toBe("Disposable cash shift - no onion");

  // Exercise the real mutation endpoint, not a mocked printer or delivery ACK.
  const dispatchKey = crypto.randomUUID();
  await mutate("sendToKitchen", { orderId: held.id }, dispatchKey);
  const sent = await mutate("sendToKitchen", { orderId: held.id }, dispatchKey);
  const obligations = sent.state.kitchenPrintObligations.filter((item) => item.orderId === held.id);
  expect(obligations).toHaveLength(1);
  expect(obligations[0]?.status).toBe("PENDING");
  await mutate("prepareInvoiceForPayment", { orderId: held.id });
  const billed = await mutate("prepareInvoiceForPayment", { orderId: held.id });
  const invoices = billed.state.bills.filter((bill) => bill.orderIds.includes(held.id));
  expect(invoices).toHaveLength(1);
  const invoice = invoices[0]!;
  expect(invoice.branchId).toBe(scope.branchId);
  expect(invoice.paid).toBe(0);

  await page.goto("/invoices");
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: invoiceDisplayName(invoice.id) });
  await row.getByRole("button", { name: "Settle", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settle invoice", exact: true });
  await dialog.getByRole("button", { name: "Cash", exact: true }).click();
  const [settlementResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/seramet/transactions/mutate") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "settleInvoice",
    ),
    dialog.getByRole("button", { name: "Settle invoice", exact: true }).click(),
  ]);
  expect(settlementResponse.status(), await settlementResponse.text()).toBe(200);
  await expect(page.getByRole("dialog", { name: "Settlement recorded" })).toBeVisible();
  const settled = await snapshot();
  expect(settled.state.bills.find((bill) => bill.id === invoice.id)).toMatchObject({
    paymentStatus: "PAID",
    paid: invoice.total,
  });
  const receipts = settled.state.receipts.filter((receipt) => receipt.invoiceId === invoice.id);
  expect(receipts).toHaveLength(1);
  expect(
    settled.state.paymentOperations?.allocations.filter((item) => item.invoiceId === invoice.id),
  ).toHaveLength(1);
  const drawer = settled.state.paymentOperations!.drawerSessions.find(
    (item) => item.branchId === scope.branchId && item.status === "OPEN",
  )!;
  expect(drawer.expectedCashMinor).toBe(50000 + Math.round(invoice.total * 100));
  const closeInput = {
    ...scope,
    businessDate: drawer.businessDate,
    actor: "Pilot manager",
    currency: "KES",
  };
  const pending = await mutate("prepareDayClose", { input: closeInput });
  const day = pending.state.paymentOperations!.dayCloses.find(
    (item) => item.branchId === scope.branchId,
  )!;
  const priorDay = before.state.paymentOperations?.dayCloses.find((item) => item.id === day.id);
  const priorSnapshots = priorDay?.snapshots ?? (priorDay?.snapshot ? [priorDay.snapshot] : []);
  expect(day.readiness?.some((issue) => issue.code === "OPEN_CASH_DRAWER")).toBe(true);
  await mutate("closePaymentDrawer", {
    input: {
      tenantId: scope.tenantId,
      drawerSessionId: drawer.id,
      countedCashMinor: drawer.expectedCashMinor,
      confirmed: true,
      actor: "Pilot manager",
    },
  });
  const ready = await mutate("prepareDayClose", { input: closeInput });
  expect(
    ready.state.paymentOperations!.dayCloses.find((item) => item.id === day.id)?.readiness,
  ).toEqual([]);
  const firstClosed = await mutate("closeDay", {
    input: {
      tenantId: scope.tenantId,
      dayCloseId: day.id,
      actor: "Pilot manager",
      confirmed: true,
    },
  });
  const closed = await mutate("closeDay", {
    input: {
      tenantId: scope.tenantId,
      dayCloseId: day.id,
      actor: "Pilot manager",
      confirmed: true,
    },
  });
  const finalDay = closed.state.paymentOperations!.dayCloses.find((item) => item.id === day.id)!;
  expect(finalDay.status).toBe("CLOSED");
  expect(finalDay.snapshots).toHaveLength(priorSnapshots.length + 1);
  expect(finalDay.snapshots!.slice(0, priorSnapshots.length)).toEqual(priorSnapshots);
  expect(finalDay).toEqual(
    firstClosed.state.paymentOperations!.dayCloses.find((item) => item.id === day.id),
  );
  const earlierSettledMinor = before.state.bills
    .filter(
      (bill) =>
        bill.branchId === scope.branchId &&
        bill.businessDate === drawer.businessDate &&
        bill.paymentStatus === "PAID",
    )
    .reduce((total, bill) => total + Math.round(bill.total * 100), 0);
  expect(finalDay.snapshot?.settledMinor).toBe(
    earlierSettledMinor + Math.round(invoice.total * 100),
  );
  expect(
    closed.state.paymentOperations!.drawerSessions.find((item) => item.id === drawer.id),
  ).toMatchObject({
    status: "CLOSED",
    varianceMinor: 0,
  });
  expect(
    closed.state.kitchenPrintObligations.find((item) => item.id === obligations[0]!.id)?.status,
  ).toBe("PENDING");
  expect(closed.state.bills.filter((bill) => bill.orderIds.includes(held.id))).toHaveLength(1);
  expect(closed.state.receipts.filter((receipt) => receipt.invoiceId === invoice.id)).toHaveLength(
    1,
  );
  // Compare persisted identities, per-record revisions and full values, not the
  // branch-filtered API response or the legitimately advancing tenant revision.
  expect(branchARecords()).toEqual(branchABefore);
  await page.reload();
  const reloaded = await snapshot();
  expect(
    reloaded.state.paymentOperations!.dayCloses.find((item) => item.id === day.id)?.status,
  ).toBe("CLOSED");
  expect(branchARecords()).toEqual(branchABefore);
  await context.close();
});
