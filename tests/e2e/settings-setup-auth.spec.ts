import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Fixture = {
  tenantId: string;
  userId: string;
  managerAccessToken: string;
  firstBranchId: string;
};

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet", "e2e-fixture.json"), "utf8"),
) as Fixture;

test("employee entry is default and administrator access is explicit on any device", async ({
  page,
}) => {
  await page.route("**/api/seramet/public/device/startup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: "UNREGISTERED" }),
    }),
  );
  for (const path of [
    "/",
    "/pos",
    "/login",
    "/login?account=0",
    "/login?verified=1",
    "/pos-login?reason=session-expired",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/pos-login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Device activation required" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/pos.webmanifest");
  }
  const manifest = await (await page.request.get("/pos.webmanifest")).json();
  expect(manifest).toMatchObject({ id: "/pos-login", start_url: "/pos-login", scope: "/" });
  await expect
    .poll(() =>
      page.getByRole("link", { name: "Use administrator account" }).evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        const label = text.getBoundingClientRect();
        const button = element.getBoundingClientRect();
        return label.top >= button.top && label.bottom <= button.bottom;
      }),
    )
    .toBe(true);
  await page.getByRole("link", { name: "Use administrator account" }).click();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Administrator sign in", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to employee sign in" }).click();
  await expect(page).toHaveURL(/\/pos-login$/);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.goto("/login?account=1&verified=1");
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Create a restaurant", exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);

  await page.route("**/api/seramet/public/device/startup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "ACTIVE",
        device: {
          id: fixture.firstBranchId,
          name: "Disposable terminal",
          tenantName: "Disposable restaurant",
          branchId: fixture.firstBranchId,
          branchName: "Disposable branch",
        },
        policy: { pinLength: 6 },
      }),
    }),
  );
  await page.goto("/pos-login");
  await expect(page.getByLabel("Email or employee code")).toBeVisible();
  await page.getByRole("link", { name: "Use administrator account" }).click();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.goto("/register");
  await expect(page).toHaveURL(/\/register/);
  await page.goto("/guest/unpublished-local-fixture");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  expect(await (await page.request.get("/manifest.webmanifest")).json()).toMatchObject({
    start_url: "/guest/",
  });
});

async function authorize(context: BrowserContext) {
  await context.route("**/api/seramet/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${fixture.managerAccessToken}`,
        "x-seramet-dev-auth": "enabled",
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-user-id": fixture.userId,
        ...(route.request().headers()["x-seramet-branch-id"]
          ? {}
          : { "x-seramet-branch-id": fixture.firstBranchId }),
      },
    });
  });
}

async function establishSession(page: Page) {
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
    { tenantId: fixture.tenantId, userId: fixture.userId, branchId: fixture.firstBranchId },
  );
}

test("authenticated deep links survive refresh and logout returns to employee entry", async ({
  browser,
}) => {
  const context = await browser.newContext();
  try {
    await authorize(context);
    const page = await context.newPage();
    await establishSession(page);
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/pos-login$/);
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await page.goto("/");
    await expect(page).toHaveURL(/\/pos-login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/pos-login$/);
  } finally {
    await context.close();
  }
});

test("settings waits for authoritative persistence and Setup Centre fails visibly", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  const methodName = `E2E tender ${Date.now()}`;
  const methodCode = `E2E_${Date.now()}`;

  await page.goto("/settings");
  await page.getByRole("button", { name: "Finance 4", exact: true }).click();
  await page.getByLabel("Display name").fill(methodName);
  await page.getByLabel("Code").fill(methodCode);
  await page.getByLabel("Category").selectOption("CUSTOM");
  await page.route("**/api/seramet/configuration/payment-methods", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Settings persistence is temporarily unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "Add method" }).click();
  await expect(page.getByText("Settings persistence is temporarily unavailable")).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue(methodName);
  await expect(page.getByLabel("Code")).toHaveValue(methodCode);
  await page.unroute("**/api/seramet/configuration/payment-methods");
  await page.getByRole("button", { name: "Add method" }).click();
  await expect(page.getByText(`${methodName} was saved and is now available`)).toBeVisible();
  await expect(page.getByText(methodName, { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Finance 4", exact: true }).click();
  await expect(page.getByText(methodName, { exact: true })).toBeVisible();

  const methodRow = page
    .getByText(methodName, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'justify-between')][1]");
  await methodRow.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByText(`${methodName} was disabled.`)).toBeVisible();
  await expect(page.getByText(methodName, { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Finance 4", exact: true }).click();
  await expect(page.getByText(methodName, { exact: true })).toHaveCount(0);

  await page.route("**/api/seramet/setup/centre**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Setup summary is temporarily unavailable" }),
    }),
  );
  await page.goto("/seramet-setup?section=BUSINESS_PROFILE");
  await expect(page.getByText("Setup data could not be loaded")).toBeVisible();
  await expect(page.getByText(/Setup summary is temporarily unavailable/)).toBeVisible();
  await context.close();
});

test("employee sign-in uses Seramet branding without repeating identical restaurant names", async ({
  page,
}) => {
  await page.route("**/api/seramet/public/device/startup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        state: "ACTIVE",
        device: {
          id: "branding-test-device",
          name: "KITCHEN",
          tenantName: "Mona Swahili",
          branchId: "branding-test-branch",
          branchName: "Mona Swahili",
        },
        policy: {
          pinLength: 6,
          allowEmployeeTiles: false,
          inactivityLockMinutes: 15,
        },
        employees: [],
      }),
    }),
  );

  await page.goto("/pos-login");
  const heading = page.getByRole("heading", { name: "Employee sign in" });
  const signInPanel = heading.locator("xpath=ancestor::div[contains(@class,'bg-surface')][1]");

  await expect(signInPanel.getByRole("img", { name: "Seramet" })).toBeVisible();
  await expect(signInPanel.getByText("SERAMET", { exact: true })).toBeVisible();
  await expect(signInPanel.getByText("Mona Swahili", { exact: true })).toHaveCount(1);
  await expect(signInPanel.getByText("KITCHEN", { exact: true })).toHaveCount(0);
  await expect(heading).toHaveCSS("font-size", "30px");
});

test("attendance and payroll tolerate delayed hydration and pay edits wait for acknowledgement", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  await page.goto("/pos");
  await expect(page.getByLabel(/Connection: Online/)).toBeVisible();
  const name = `Payroll fixture ${Date.now()}`;
  const created = await page.evaluate(async (name) => {
    const snapshot = await (await fetch("/api/seramet/transactions")).json();
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/seramet/transactions/mutate", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        action: "addRider",
        payload: { name },
        idempotencyKey,
        expectedRevision: snapshot.revision,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, name);
  expect(created.status, JSON.stringify(created.body)).toBe(200);

  for (const path of ["/attendance", "/payroll"]) {
    const endpoint =
      path === "/attendance" ? "**/api/seramet/attendance?**" : "**/api/seramet/transactions?**";
    const attendanceName =
      path === "/attendance"
        ? await page.evaluate(async () => {
            const response = await fetch("/api/seramet/attendance");
            if (!response.ok) throw new Error("Attendance fixture unavailable");
            const body = await response.json();
            if (!body.employees.length)
              throw new Error("Expected an authenticated employee fixture");
            return body.employees[0].name as string;
          })
        : name;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(endpoint, async (route) => {
      await pending;
      await route.fallback();
    });
    await page.goto(path);
    await expect(
      page.getByRole("heading", {
        name: path === "/attendance" ? "Attendance" : "Payroll",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("This page didn't load")).toHaveCount(0);
    release();
    await expect(page.getByRole("cell", { name: attendanceName, exact: true })).toBeVisible();
    await page.unroute(endpoint);
  }

  const input = page.getByLabel(`Base net pay for ${name}`);
  await page.route("**/api/seramet/transactions/mutate", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Pay persistence unavailable" }),
    }),
  );
  await input.fill("15000");
  await input.press("Tab");
  await expect(page.getByText(/Pay persistence unavailable/)).toBeVisible();
  await expect(input).toHaveValue("15000");
  await expect(page.getByText(`${name}'s base net pay updated.`)).toHaveCount(0);
  await page.unroute("**/api/seramet/transactions/mutate");

  let acknowledge!: () => void;
  const pending = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  await page.route("**/api/seramet/transactions/mutate", async (route) => {
    await pending;
    await route.fallback();
  });
  await input.focus();
  await input.press("Tab");
  await expect(page.getByText(/Saving base net pay/)).toBeVisible();
  await expect(page.getByText(`${name}'s base net pay updated.`)).toHaveCount(0);
  acknowledge();
  await expect(page.getByText(`${name}'s base net pay updated.`, { exact: false })).toBeVisible();
  await page.unroute("**/api/seramet/transactions/mutate");
  await page.reload();
  await expect(page.getByLabel(`Base net pay for ${name}`)).toHaveValue("15000");
  await context.close();
});

test("mobile POS exposes the order recall control without horizontal clipping", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  await page.goto("/pos");
  const orders = page.getByRole("button", { name: /^Orders\s*\d+$/ });
  await expect(orders).toBeVisible();
  const bounds = await orders.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await orders.click();
  await expect(page.getByText("Active orders", { exact: true })).toBeVisible();
  await context.close();
});

test("a delayed Setup Centre response cannot replace the selected branch", async ({ browser }) => {
  const context = await browser.newContext();
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  let release!: () => void;
  let attempted!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delivered = new Promise<void>((resolve) => {
    attempted = resolve;
  });
  await page.route("**/api/seramet/setup/centre?**", async (route) => {
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${fixture.managerAccessToken}`,
      },
    });
    const payload = await response.json();
    const oldScope =
      new URL(route.request().url()).searchParams.get("branchId") === fixture.firstBranchId;
    payload.setup.organisationName = oldScope ? "Delayed branch A" : "Current branch B";
    if (oldScope) await pending;
    try {
      await route.fulfill({ response, json: payload });
    } catch (error) {
      if (!oldScope) throw error;
      // Aborting the old transport is expected; the completion guard is also unit tested.
    } finally {
      if (oldScope) attempted();
    }
  });
  await page.goto("/seramet-setup");
  await page.getByRole("button", { name: /Change active branch/ }).click();
  await page.getByRole("menuitem", { name: /Pilot Branch B/ }).click();
  await expect(page.getByText(/Current branch B/)).toBeVisible();
  release();
  await delivered;
  await expect(page.getByText(/Delayed branch A/)).toHaveCount(0);
  await expect(page.getByText(/Current branch B/)).toBeVisible();
  await context.close();
});
