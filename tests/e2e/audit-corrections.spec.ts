import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { fixture } from "./pos-stability-helpers";
import { pilotUnavailable } from "../../src/lib/pilot-unavailable";
import type { TransactionState } from "../../src/lib/transaction-engine";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback audit corrections only");
});
async function session(context: BrowserContext, page: Page, second = false) {
  const branchId = second ? fixture.secondBranchId : fixture.firstBranchId;
  const headers = {
    authorization: `Bearer ${second ? fixture.secondBranchAccessToken : fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": branchId,
  };
  const api = async (path: string, data?: unknown) => {
    const response = await context.request.fetch(`/api/seramet/${path}`, {
      headers,
      method: data === undefined ? "GET" : "POST",
      data,
    });
    const body = await response.json();
    expect(
      response.ok(),
      `${path} HTTP ${response.status()} ${body.code ?? ""} ${body.message ?? ""}`,
    ).toBe(true);
    return body;
  };
  const snapshot = () =>
    api("transactions") as Promise<{ revision: number; state: TransactionState }>;
  const command = async (action: string, payload: unknown) =>
    api("transactions/mutate", {
      action,
      payload,
      expectedRevision: (await snapshot()).revision,
      idempotencyKey: randomUUID(),
    });
  await context.route("**/api/seramet/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
  await page.goto("/login?account=1");
  await page.evaluate(
    ({ f, branchId }) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", f.tenantId);
      localStorage.setItem("seramet.session.user-id", f.userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId }),
      );
    },
    { f: fixture, branchId },
  );
  return { api, snapshot, command, headers, branchId };
}

test("refund request/approval uses exact receipt and selection, retains failed drafts and cannot duplicate", async ({
  context,
  page,
}) => {
  const { api, snapshot, command, branchId } = await session(context, page);
  const { configuration } = await api("configuration");
  const method = configuration.paymentMethods.find(
    (row: { category: string }) => row.category === "CASH",
  );
  await command("openPaymentDrawer", {
    input: {
      tenantId: fixture.tenantId,
      branchId,
      employeeId: fixture.userId,
      openingFloatMinor: 0,
      currency: "KES",
    },
  });
  const sources = [];
  for (const customer of ["First source", "Exact selected source"]) {
    await command("createOrder", {
      draft: {
        tenantId: fixture.tenantId,
        branchId,
        branch: branchId,
        cashier: fixture.userId,
        customer,
        channel: "DINE_IN",
        lines: [
          {
            id: randomUUID(),
            productId: fixture.menuItemId,
            name: "Pilot meal",
            category: "Food",
            quantity: 1,
            unitPrice: 1000,
            productionStation: "MAIN",
          },
        ],
      },
    });
    const order = (await snapshot()).state.orders.find((row) => row.customer === customer)!;
    await command("sendToKitchen", { orderId: order.id });
    await command("prepareInvoiceForPayment", { orderId: order.id });
    const invoice = (await snapshot()).state.bills.find((row) => row.orderIds.includes(order.id))!;
    await command("applyConfiguredPayment", {
      invoiceId: invoice.id,
      paymentMethodId: method.id,
      amountMinor: Math.round(invoice.total * 100),
      cashTenderedMinor: Math.round(invoice.total * 100),
    });
    sources.push((await snapshot()).state.receipts.find((row) => row.invoiceId === invoice.id)!);
  }
  await page.goto("/refunds");
  await expect(page.getByRole("button", { name: "Approve selected", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Request refund", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request a refund" });
  await expect(dialog.getByLabel("Source receipt")).toHaveValue("");
  await dialog.getByLabel("Source receipt").selectOption(sources[1]!.id);
  await dialog.getByLabel("Collected method").selectOption(sources[1]!.paymentBreakdown[0]!.method);
  await dialog.getByLabel("Refund amount").fill("2000");
  await dialog.getByLabel("Refund reason").fill("Selected customer returned an incorrect item");
  const confirm = dialog.getByRole("button", { name: "Confirm refund request", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Refund amount").fill("200");
  let failed = false;
  let submitted: Record<string, unknown> = {};
  await page.route("**/api/seramet/transactions/mutate", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== "requestRefund") return route.fallback();
    submitted = body.payload.input;
    if (!failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { message: "Disposable refund service outage" } });
    }
    await route.fallback();
  });
  await confirm.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Refund amount")).toHaveValue("200");
  await confirm.dblclick();
  await expect(dialog).toBeHidden();
  let current = (await snapshot()).state;
  expect(current.refunds).toHaveLength(1);
  const target = current.refunds[0]!;
  expect(target.receiptId).toBe(sources[1]!.id);
  expect(target.amount).toBe(200);
  await command("requestRefund", { input: submitted });
  expect((await snapshot()).state.refunds).toHaveLength(1);
  await command("requestRefund", {
    input: {
      ...submitted,
      receiptId: sources[0]!.id,
      invoiceId: sources[0]!.invoiceId,
      orderId: sources[0]!.orderId,
      amount: 150,
      requestKey: randomUUID(),
    },
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Approve selected", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: target.id, exact: true }).click();
  await page.getByRole("button", { name: "Approve selected", exact: true }).click();
  const approval = page.getByRole("dialog", { name: "Confirm refund approval" });
  await expect(approval).toContainText(sources[1]!.id);
  await approval.getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(approval).toBeHidden();
  current = (await snapshot()).state;
  expect(current.refunds.find((row) => row.id === target.id)?.status).toBe("APPROVED");
  expect(current.refunds.find((row) => row.receiptId === sources[0]!.id)?.status).toBe("REQUESTED");
  await expect(
    page.getByRole("status").filter({ hasText: "No payout has been confirmed" }),
  ).toBeVisible();
  const other = current.refunds.find((row) => row.receiptId === sources[0]!.id)!;
  await page.getByRole("button", { name: other.id, exact: true }).click();
  await page.getByRole("button", { name: "Reject selected", exact: true }).click();
  const rejection = page.getByRole("dialog", { name: "Confirm refund rejection" });
  await expect(rejection).toContainText(sources[0]!.id);
  await expect(
    rejection.getByRole("button", { name: "Confirm rejection", exact: true }),
  ).toBeDisabled();
  await rejection.getByLabel("Rejection reason").fill("Not eligible after supervisor review");
  await rejection.getByRole("button", { name: "Confirm rejection", exact: true }).click();
  await expect(rejection).toBeHidden();
  expect((await snapshot()).state.refunds.find((row) => row.id === other.id)).toMatchObject({
    status: "REJECTED",
    rejectionReason: "Not eligible after supervisor review",
  });
  await mkdir(".seramet/audit-corrections", { recursive: true });
  await page.screenshot({ path: ".seramet/audit-corrections/refunds-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".seramet/audit-corrections/refunds-phone.png", fullPage: true });
  await page.getByRole("button", { name: "Request refund", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Source receipt").selectOption(sources[1]!.id);
  await dialog.getByLabel("Collected method").selectOption(sources[1]!.paymentBreakdown[0]!.method);
  await dialog.getByLabel("Refund amount").fill("50");
  await dialog.getByLabel("Refund reason").fill("Phone review only - not submitted");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: ".seramet/audit-corrections/refund-dialog-phone.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("actual POS Hold carries known components through invoice, payment, immutable close and PDF", async ({
  context,
  page,
}) => {
  const { api, snapshot, command, headers, branchId } = await session(context, page, true);
  const { configuration } = await api("configuration");
  const method = configuration.paymentMethods.find(
    (row: { category: string }) => row.category === "CASH",
  );
  const opened = await command("openPaymentDrawer", {
    input: {
      tenantId: fixture.tenantId,
      branchId,
      employeeId: fixture.userId,
      openingFloatMinor: 10000,
      currency: "KES",
    },
  });
  const drawer = opened.state.paymentOperations.drawerSessions.find(
    (row: { branchId: string }) => row.branchId === branchId,
  );
  await page.goto("/pos");
  await page.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
  await page.getByRole("button", { name: "Add Pilot meal to order", exact: true }).click();
  const note = randomUUID();
  await page.getByPlaceholder("Item note").fill(note);
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(page.getByText("Order held in active orders.")).toBeVisible();
  const order = (await snapshot()).state.orders.find((row) =>
    row.lines.some((line) => line.itemNote === note),
  )!;
  expect(order.financialComponents).toMatchObject({
    version: 1,
    grossSalesMinor: 100000,
    discountsMinor: 0,
    netSalesMinor: 100000,
    serviceChargeMinor: 0,
    taxMinor: 0,
    totalMinor: 100000,
  });
  await command("sendToKitchen", { orderId: order.id });
  await command("prepareInvoiceForPayment", { orderId: order.id });
  const invoice = (await snapshot()).state.bills.find((row) => row.orderIds.includes(order.id))!;
  expect(invoice.financialComponents).toEqual(order.financialComponents);
  await command("applyConfiguredPayment", {
    invoiceId: invoice.id,
    paymentMethodId: method.id,
    amountMinor: 100000,
    cashTenderedMinor: 100000,
  });
  const closed = await command("closeBusinessDay", {
    businessDate: order.businessDate,
    drawerCounts: [{ drawerSessionId: drawer.id, countedByCurrency: { KES: 110000 } }],
    confirmed: true,
  });
  const day = closed.state.paymentOperations.dayCloses.find(
    (row: { branchId: string; status: string }) =>
      row.branchId === branchId && row.status === "CLOSED",
  );
  try {
    expect(day.snapshot.invoiceComponents.status).toBe("COMPLETE");
    expect(
      day.snapshot.dailyReport.invoices.find((row: { id: string }) => row.id === invoice.id)
        .financialComponents,
    ).toEqual(order.financialComponents);
    const path = `/api/seramet/daily-closing/reports/${day.id}/${day.snapshot.revision}.pdf`;
    const pdf = await context.request.get(path, { headers });
    expect(pdf.ok()).toBe(true);
    const bytes = await pdf.body();
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(Buffer.compare(bytes, await (await context.request.get(path, { headers })).body())).toBe(
      0,
    );
  } finally {
    // Restore only this disposable fixture through the authorized correction path.
    await command("reopenDay", {
      dayCloseId: day.id,
      reason: "Disposable sale-to-report browser fixture cleanup",
    });
  }
});

test("delivery links stay client-side and unavailable registers do not claim empty authoritative histories", async ({
  context,
  page,
}) => {
  await session(context, page);
  await page.goto("/delivery");
  const marker = await page.evaluate(() => {
    const id = crypto.randomUUID();
    document.documentElement.dataset.auditDocument = id;
    return id;
  });
  await page.getByRole("button", { name: "Rider accountability", exact: true }).click();
  await expect(page).toHaveURL(/\/riders$/);
  await page.getByRole("button", { name: "View delivery queue", exact: true }).click();
  await expect(page).toHaveURL(/\/delivery$/);
  expect(await page.evaluate(() => document.documentElement.dataset.auditDocument)).toBe(marker);
  for (const [path, name] of Object.entries(pilotUnavailable)) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: `${name} isn't available yet`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  }
});

test("rider creation waits for server acknowledgement, retains failures and survives refresh", async ({
  context,
  page,
}) => {
  const { snapshot, branchId } = await session(context, page);
  await page.goto("/riders");
  await page.getByRole("button", { name: "Add rider", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add rider" });
  const name = `Disposable rider ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel("Rider name").fill(name);
  await dialog.getByLabel("Rider shift").fill("08:00-16:00");
  let failed = false;
  await page.route("**/api/seramet/transactions/mutate", async (route) => {
    if (route.request().postDataJSON().action === "addRider" && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { message: "Disposable server unavailable" } });
    }
    return route.fallback();
  });
  await dialog.getByRole("button", { name: "Save rider", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Rider name")).toHaveValue(name);
  await dialog.getByRole("button", { name: "Save rider", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await snapshot()).state.employees.filter((row) => row.name === name)).toHaveLength(1);
  expect((await snapshot()).state.employees.find((row) => row.name === name)).toMatchObject({
    branchId,
    role: "Rider",
  });
  await page.reload();
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
});
