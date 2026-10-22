import { expect, test } from "@playwright/test";

const startupUrl = "**/api/seramet/public/device/startup";
const activeDevice = {
  ok: true,
  state: "ACTIVE",
  device: {
    id: "disposable-device",
    name: "Test till",
    tenantName: "Test Restaurant",
    branchId: "test-branch",
    branchName: "Test Branch",
  },
  policy: { pinLength: 6, allowEmployeeTiles: false, inactivityLockMinutes: 5 },
  employees: [],
};

test("startup shows only the brand then enters login as soon as the device is verified", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(startupUrl, async (route) => {
    await pending;
    await route.fulfill({ json: activeDevice });
  });
  const requestStarted = page.waitForRequest(startupUrl);
  await page.goto("/pos-login");
  await requestStarted;
  await expect(page.getByRole("heading", { name: "Seramet", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Seramet");
  await expect(page.getByText("Validating the registered device...")).toHaveCount(0);
  await expect(page.getByText("Checking this POS")).toHaveCount(0);
  const logo = await page.locator('img[src="/brand/seramet-mark-light.png"]').boundingBox();
  const brand = await page.getByRole("heading", { name: "Seramet", exact: true }).boundingBox();
  expect(logo).not.toBeNull();
  expect(brand).not.toBeNull();
  expect(logo!.y + logo!.height).toBeLessThan(brand!.y);
  await page.screenshot({ path: test.info().outputPath("startup-phone.png") });
  release();
  await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
});

test("failed startup exits the splash and retry recovers without bypassing registration", async ({
  page,
}) => {
  let attempts = 0;
  await page.route(startupUrl, async (route) => {
    attempts++;
    if (attempts === 1) await route.fulfill({ status: 503, json: { ok: false } });
    else await route.fulfill({ json: { ok: true, state: "UNREGISTERED" } });
  });
  await page.goto("/pos-login");
  await expect(page.getByRole("heading", { name: "Sign in unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Use administrator account" })).toHaveAttribute(
    "href",
    "/login?account=1",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Device activation required" })).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("a stalled device request times out instead of leaving the brand screen forever", async ({
  page,
}) => {
  await page.route(startupUrl, () => {
    // Keep the request pending so the real browser timeout is exercised.
  });
  await page.goto("/pos-login");
  await expect(page.getByRole("heading", { name: "Seramet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in unavailable" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("revoked devices cannot reach employee PIN entry", async ({ page }) => {
  await page.route(startupUrl, (route) =>
    route.fulfill({ json: { ...activeDevice, state: "REVOKED" } }),
  );
  await page.goto("/pos-login");
  await expect(
    page.getByText("This device has been revoked and cannot sign in employees."),
  ).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toHaveCount(0);
});
