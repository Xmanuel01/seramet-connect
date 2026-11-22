import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));
test.use({ channel: process.env.SERAMET_E2E_BROWSER_CHANNEL });

test("configured rider delivery saves a separate amount and displays it on the delivery task", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  if (
    !baseURL ||
    !["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname) ||
    !fixture.tenantId.startsWith("e2e-")
  )
    throw new Error("Disposable local verification only");
  const headers = {
    authorization: `Bearer ${process.env.SERAMET_PRICE_TEST_TOKEN_FILE ? readFileSync(process.env.SERAMET_PRICE_TEST_TOKEN_FILE, "utf8").trim() : fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-user-id": fixture.userId,
    "x-seramet-branch-id": fixture.firstBranchId,
  };
  const api = async (path: string, data?: unknown, method = data ? "POST" : "GET") => {
    const response = await request.fetch(`/api/seramet/${path}`, { headers, method, data });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const catalog = await api(`menu/catalog?branchId=${fixture.firstBranchId}`);
  const name = `Delivery meal ${suffix}`;
  const { item } = await api("setup/manual-menu-items", {
    branchId: fixture.firstBranchId,
    requestKey: randomUUID(),
    code: `MEAL_${suffix}`,
    name,
    categoryCode: catalog.items[0].category_code,
    basePrice: "900",
    currency: "KES",
  });
  await page.route("**/api/seramet/**", (route) =>
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
  await page.goto("/settings");
  await page.getByRole("button", { name: /POS and restaurant/ }).click();
  await page.getByLabel("Display name", { exact: true }).fill(`Neighbourhood ${suffix}`);
  await page.getByLabel("Code", { exact: true }).fill(`LOCAL_${suffix}`);
  await page.getByRole("combobox", { name: /Channel type/ }).selectOption("OTHER");
  await page.getByRole("checkbox", { name: "Rider delivery", exact: true }).first().check();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/configuration/order-channels") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Add channel", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const { orderChannel: channel } = await response.json();
  expect(channel.metadata.deliverySettings).toMatchObject({
    fulfilment: "RESTAURANT",
    allowOrderAmount: true,
    beneficiary: "RIDER",
  });
  await page.goto("/pos");
  await page.getByRole("button", { name: channel.displayName, exact: true }).click();
  await page.getByPlaceholder("Search dishes or scan barcode").fill(name);
  await page.getByRole("button", { name: `Add ${name} to order`, exact: true }).click();
  await page.getByLabel("Customer name (optional)", { exact: true }).fill("Local Test Customer");
  await page
    .getByLabel("Delivery address (optional)", { exact: true })
    .fill("Test Road, Example Building");
  await page.getByLabel("Phone number (optional)", { exact: true }).fill("0700000000");
  await page.getByLabel("Door / unit number (optional)", { exact: true }).fill("4B");
  const amount = page.getByRole("spinbutton", { name: "Delivery amount (KES)", exact: true });
  await amount.fill("-1");
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  await expect(
    page.getByText("Enter a valid delivery amount before saving the order.", { exact: true }),
  ).toBeVisible();
  await amount.fill("150");
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/transactions/mutate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const { state } = await api("transactions");
  const order = state.orders.find((row: { channel: string }) => row.channel === channel.code);
  expect(order).toMatchObject({
    total: 1050,
    status: "HELD",
    delivery: {
      doorNumber: "4B",
      charge: { amountMinor: 15000, source: "ORDER", beneficiary: "RIDER" },
    },
  });
  expect(order.lines).toEqual([expect.objectContaining({ productId: item.id, unitPrice: 900 })]);
  await mkdir(".seramet/channel-rider-delivery", { recursive: true });
  await page.reload();
  await page.getByRole("button", { name: /^Orders\s+\d+/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(order.id, { exact: true }) })
    .click();
  await expect(amount).toHaveValue("150");
  await expect(
    page.getByText(`${order.id} loaded. Print routing is running in the background.`, {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".seramet/channel-rider-delivery/pos-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(amount).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".seramet/channel-rider-delivery/pos-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/delivery");
  const row = page.getByRole("row").filter({ has: page.getByText(order.id, { exact: true }) });
  await expect(row).toBeVisible();
  await expect(row).toContainText("150");
  await row.getByRole("button").first().click();
  await expect(
    page.getByRole("table").getByText("Test Road, Example Building", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("table").getByText("4B", { exact: true })).toBeVisible();
  await page.screenshot({ path: ".seramet/channel-rider-delivery/delivery.png", fullPage: true });
  await api(
    `configuration/order-channels/${channel.id}`,
    { riderDeliveryEnabled: false, reason: "Local channel-disable regression" },
    "PATCH",
  );
  expect(
    (await api("transactions")).state.orders.find(
      (record: { id: string }) => record.id === order.id,
    ).total,
  ).toBe(1050);
  await page.goto("/pos");
  await page.getByRole("button", { name: /^Orders\s+\d+/ }).click();
  await page
    .getByRole("button")
    .filter({ has: page.getByText(order.id, { exact: true }) })
    .click();
  await expect(amount).toHaveCount(0);
  await page.getByRole("button", { name: "Remove delivery charge", exact: true }).click();
  const updated = page.waitForResponse(
    (r) => r.url().endsWith("/transactions/mutate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  expect((await updated).ok()).toBe(true);
  const withoutFee = (await api("transactions")).state.orders.find(
    (record: { id: string }) => record.id === order.id,
  );
  expect(withoutFee.total).toBe(900);
  expect(withoutFee.delivery?.charge).toBeUndefined();
});
