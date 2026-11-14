import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8")) as {
  tenantId: string;
  userId: string;
  firstBranchId: string;
  managerAccessToken: string;
};

test("saved online price follows the configured POS channel and survives draft reload", async ({
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
    throw new Error("Disposable local POS pricing verification only");
  const headers = {
    authorization: `Bearer ${process.env.SERAMET_PRICE_TEST_TOKEN_FILE ? readFileSync(process.env.SERAMET_PRICE_TEST_TOKEN_FILE, "utf8").trim() : fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-user-id": fixture.userId,
    "x-seramet-branch-id": fixture.firstBranchId,
  };
  const api = async (path: string, data?: unknown, method = data ? "POST" : "GET") => {
    const response = await request.fetch(`/api/seramet/${path}`, {
      headers,
      method,
      data,
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const { orderChannel: online } = await api("configuration/order-channels", {
    displayName: `Online ${suffix}`,
    code: `ON_${suffix}`,
    channelType: "OTHER",
    useOnlinePrice: true,
    reason: "Disposable online price regression",
  });
  const { orderChannel: normal } = await api("configuration/order-channels", {
    displayName: `Normal ${suffix}`,
    code: `OFF_${suffix}`,
    channelType: "OWN_DELIVERY",
    useOnlinePrice: false,
    reason: "Disposable online price regression",
  });
  const catalog = await api(`menu/catalog?branchId=${fixture.firstBranchId}`);
  const name = `Price check ${suffix}`;
  const { item } = await api("setup/manual-menu-items", {
    branchId: fixture.firstBranchId,
    requestKey: randomUUID(),
    code: `PRICE_${suffix}`,
    name,
    categoryCode: catalog.items[0].category_code,
    basePrice: "900",
    onlinePrice: "1000",
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
  await page.goto("/pos");
  await page.getByRole("button", { name: online.displayName, exact: true }).click();
  await page.getByPlaceholder("Search dishes or scan barcode").fill(name);
  const card = page.getByRole("button", { name: `Add ${name} to order`, exact: true });
  await expect(card).toContainText("1,000");

  // Use the real editor and client-side navigation to exercise cache invalidation.
  if (!(await page.getByRole("link", { name: "Menu Import", exact: true }).isVisible()))
    await page.getByRole("button", { name: /^System/ }).click();
  await page.getByRole("link", { name: "Menu Import", exact: true }).click();
  await page.getByRole("row", { name: `Edit ${name}`, exact: true }).click();
  await page.getByLabel("Online price", { exact: true }).fill("1090");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  if (!(await page.getByRole("link", { name: "POS", exact: true }).isVisible()))
    await page.getByRole("button", { name: /^Sales/ }).click();
  await page.getByRole("link", { name: "POS", exact: true }).click();
  await page.getByPlaceholder("Search dishes or scan barcode").fill(name);
  await expect(card).toContainText("1,090");
  await page.getByRole("button", { name: normal.displayName, exact: true }).click();
  await expect(card).toContainText("900");
  await page.getByRole("button", { name: online.displayName, exact: true }).click();
  await expect(card).toContainText("1,090");
  await card.click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/transactions/mutate") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Hold", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  const { state } = await api("transactions");
  const order = state.orders.find((row: { channel: string }) => row.channel === online.code);
  expect(order).toMatchObject({ status: "HELD", total: 1090 });
  expect(order.lines).toEqual([
    expect.objectContaining({ productId: item.id, unitPrice: 1090, quantity: 1 }),
  ]);
  await page.reload();
  await page.getByPlaceholder("Search dishes or scan barcode").fill(name);
  await expect(card).toContainText("1,090");
  const persisted = (await api("transactions")).state.orders.find(
    (row: { id: string }) => row.id === order.id,
  );
  expect(persisted.total).toBe(1090);
  await mkdir(".seramet/online-price", { recursive: true });
  await page.screenshot({ path: ".seramet/online-price/pos.png", fullPage: true });

  await page.goto("/online-orders");
  const onlineRow = page
    .getByRole("row")
    .filter({ has: page.getByText(order.id, { exact: true }) });
  await expect(onlineRow).toBeVisible();
  await expect(onlineRow).toContainText(online.displayName);
  await api(
    `configuration/order-channels/${online.id}`,
    {
      useOnlinePrice: false,
      reason: "Disposable online order eligibility regression",
    },
    "PATCH",
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Online orders", exact: true })).toBeVisible();
  await expect(onlineRow).toHaveCount(0);
  await api(
    `configuration/order-channels/${online.id}`,
    {
      useOnlinePrice: true,
      reason: "Restore disposable test channel setting",
    },
    "PATCH",
  );
  await page.reload();
  await expect(onlineRow).toBeVisible();
  expect(
    (await api("transactions")).state.orders.find((row: { id: string }) => row.id === order.id),
  ).toMatchObject({ status: "HELD", total: 1090 });
  await page.screenshot({ path: ".seramet/online-price/online-orders.png", fullPage: true });
});
