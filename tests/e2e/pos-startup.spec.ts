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
  await page.addInitScript(() => Object.defineProperty(AbortSignal, "any", { value: undefined }));
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
  const verifiedAt = Date.now();
  release();
  await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible({
    timeout: 2000,
  });
  expect(Date.now() - verifiedAt).toBeLessThan(2000);
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
  await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
  await expect(page.getByText("We couldn't connect to Seramet. Please try again.")).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toBeDisabled();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Use administrator account" })).toHaveAttribute(
    "href",
    "/login?account=1",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("This browser is not registered as a Seramet POS device."),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toBeEnabled();
  expect(attempts).toBe(2);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
});

for (const width of [1366, 390]) {
  test(`unregistered browser accepts PIN input without authenticating at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let active = false;
    let loginRequests = 0;
    await page.route(startupUrl, (route) =>
      route.fulfill({
        json: active ? activeDevice : { ok: true, state: "UNREGISTERED" },
      }),
    );
    await page.route("**/api/seramet/public/employee/login", (route) => {
      loginRequests++;
      return route.fulfill({ status: 403, json: { ok: false } });
    });
    await page.goto("/pos-login");
    const identity = page.getByLabel("Email or employee code");
    await expect(identity).toBeEnabled();
    await identity.fill("DEMO-CHEF");
    const entered = page.getByLabel("PIN entry").locator("span.bg-primary");
    for (const digit of "123") await page.getByRole("button", { name: digit, exact: true }).click();
    await expect(entered).toHaveCount(3);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(entered).toHaveCount(2);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(entered).toHaveCount(0);
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.keyboard.type("23456");
    await expect(entered).toHaveCount(6);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("Use administrator account to activate this device.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Use administrator account", exact: true }),
    ).toBeFocused();
    await expect(entered).toHaveCount(0);
    expect(loginRequests).toBe(0);
    await expect(page).toHaveURL(/\/pos-login$/);
    await expect(page.getByRole("link")).toHaveCount(1);
    await page.getByRole("button", { name: "4", exact: true }).click();
    await expect(entered).toHaveCount(1);
    active = true;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    await expect(entered).toHaveCount(0);
    await expect(identity).toBeEnabled();
    await page.getByRole("button", { name: "5", exact: true }).click();
    await expect(entered).toHaveCount(1);
    expect(loginRequests).toBe(0);
  });
}

test("a stalled device request times out instead of leaving the brand screen forever", async ({
  page,
}) => {
  await page.route(startupUrl, () => {
    // Keep the request pending so the real browser timeout is exercised.
  });
  await page.goto("/pos-login");
  await expect(page.getByRole("heading", { name: "Seramet", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
  await expect(page.getByText("We couldn't connect to Seramet. Please try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("revoked devices keep the keypad visible without permitting employee PIN entry", async ({
  page,
}) => {
  let loginRequests = 0;
  await page.route("**/api/seramet/public/employee/login", (route) => {
    loginRequests++;
    return route.fulfill({ status: 401, json: { ok: false } });
  });
  await page.route(startupUrl, (route) =>
    route.fulfill({ json: { ...activeDevice, state: "REVOKED" } }),
  );
  await page.goto("/pos-login");
  await expect(
    page.getByText("This device has been revoked and cannot sign in employees."),
  ).toBeVisible();
  await expect(page.getByLabel("Email or employee code")).toBeDisabled();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1", exact: true })).toBeDisabled();
  await page.keyboard.type("123456");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("PIN entry").locator("span.bg-primary")).toHaveCount(0);
  await expect(page.getByLabel("PIN entry").locator("span.bg-transparent")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  expect(loginRequests).toBe(0);
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 320, height: 740 },
]) {
  test(`unified login retains its layout during connection failure and retry at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    let attempts = 0;
    let release!: () => void;
    const retryPending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(startupUrl, async (route) => {
      attempts++;
      if (attempts === 2) await retryPending;
      await route.fulfill({ status: 503, json: { ok: false } });
    });
    await page.goto("/pos-login");
    const heading = page.getByRole("heading", { name: "Employee sign in" });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("link", { name: "Use administrator account" })).toBeVisible();
    await expect(page.getByRole("link")).toHaveCount(1);
    await expect(page.locator('a[href="/staff-login"], a[href="/register"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Use administrator account" })).toHaveAttribute(
      "href",
      "/login?account=1",
    );
    const identity = await page.getByLabel("Email or employee code").boundingBox();
    const keypad = await page.getByRole("button", { name: "1", exact: true }).boundingBox();
    if (viewport.width > 768) expect(identity!.x + identity!.width).toBeLessThan(keypad!.x);
    else expect(identity!.y).toBeLessThan(keypad!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`unified-login-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(heading).toBeVisible();
    await expect(page.getByRole("status", { name: "Opening Seramet" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Connecting", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(attempts).toBe(2);
  });
}

test("a rejected saved session with a stalled fallback exits startup securely", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem("seramet.session.interactive-sign-in", "1"),
  );
  await page.route("**/api/seramet/health/operational", (route) =>
    route.fulfill({ json: { database: "authoritative", environment: "production" } }),
  );
  await page.route("**/api/seramet/auth/session", (route) =>
    route.fulfill({ status: 403, json: { ok: false } }),
  );
  await page.route(startupUrl, () => {
    // Exercise the authenticated-entry fallback's bounded request, not the POS route.
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Authentication required" })).toBeVisible();
  await expect(page.getByRole("status", { name: "Opening Seramet" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
