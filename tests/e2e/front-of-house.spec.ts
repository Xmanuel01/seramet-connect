import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fixture } from "./pos-stability-helpers";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback Front of House acceptance only");
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
    localStorage.setItem(
      "seramet.session.branch-scope.v2",
      JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
    );
  }, fixture);
}

test("one Front of House destination retains table setup, live seating and all five tabs without document reload", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  await page.goto("/tables");
  await expect(page.getByRole("heading", { name: "Front of House", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Tables", exact: true })).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Front of House", exact: true }),
  ).toHaveAttribute("href", "/tables");
  const tabs = page.getByRole("navigation", { name: "Front of House sections" });
  await expect(tabs.getByRole("link")).toHaveText([
    "Tables",
    "Reservations",
    "Seating",
    "Waiting List",
    "Guest requests",
  ]);
  await page.getByRole("button", { name: "Add table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a restaurant table" });
  await dialog.getByLabel("Table number").fill("FOH-A");
  await dialog.getByLabel("Seats", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  await expect(dialog).toBeHidden();
  const table = page.getByRole("button", { name: /Table FOH-A 4 seats/ });
  await expect(table).toContainText("Available");
  const token = await page.evaluate(() => {
    const value = crypto.randomUUID();
    document.documentElement.dataset.fohDocument = value;
    return value;
  });
  await tabs.getByRole("link", { name: "Reservations", exact: true }).click();
  await expect(
    navigation.getByRole("link", { name: "Front of House", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Reservations & arrivals", exact: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Seating", exact: true }).click();
  await page.getByLabel("Guest name", { exact: true }).fill("Disposable walk-in");
  await expect(page.getByLabel("Guest name", { exact: true })).toHaveValue("Disposable walk-in");
  await page.getByLabel("Party size", { exact: true }).fill("2");
  await page
    .getByRole("combobox", { name: "Available table", exact: true })
    .selectOption({ label: "FOH-A · 4 seats" });
  await expect(page.getByLabel("Guest name", { exact: true })).toHaveValue("Disposable walk-in");
  await page.getByRole("button", { name: "Seat party", exact: true }).click();
  await expect(page.getByText("Walk-in seated and table session opened.")).toBeVisible();
  await tabs.getByRole("link", { name: "Tables", exact: true }).click();
  await expect(table).toContainText("Occupied");
  for (const label of ["Waiting List", "Guest requests"]) {
    await tabs.getByRole("link", { name: label, exact: true }).click();
    await expect(tabs.getByRole("link", { name: label, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      navigation.getByRole("link", { name: "Front of House", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  }
  expect(await page.evaluate(() => document.documentElement.dataset.fohDocument)).toBe(token);
  await tabs.getByRole("link", { name: "Tables", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await mkdir(".seramet/front-of-house-acceptance", { recursive: true });
  await page.screenshot({ path: ".seramet/front-of-house-acceptance/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: ".seramet/front-of-house-acceptance/phone.png", fullPage: true });
  const denied = await context.request.get(
    `/api/seramet/guest-admin/host?branchId=${fixture.firstBranchId}`,
    {
      headers: {
        ...headers,
        authorization: `Bearer ${fixture.restrictedAccessToken}`,
        "x-seramet-branch-id": fixture.secondBranchId,
      },
    },
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()).message).toBe("Branch access is not assigned");
  const otherBranch = await context.request.get(
    `/api/seramet/guest-admin/host?branchId=${fixture.secondBranchId}`,
    { headers },
  );
  expect(otherBranch.status()).toBe(200);
  expect(
    (await otherBranch.json()).tables.some((row: { code: string }) => row.code === "FOH-A"),
  ).toBe(false);
});

test("a real host API failure stays visible without claiming tables or reservations are empty", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  let fail = true;
  await page.route("**/api/seramet/guest-admin/host?*", (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "Disposable service outage" }),
        })
      : route.fallback(),
  );
  await page.goto("/host");
  await expect(page.getByRole("alert")).toContainText("Disposable service outage");
  await expect(page.getByText("No tables are configured for this branch.")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Front of House sections" })
    .getByRole("link", { name: "Reservations", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Disposable service outage");
  await expect(page.getByText("No reservations for this business date.")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
