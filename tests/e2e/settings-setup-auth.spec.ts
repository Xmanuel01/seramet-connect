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
  for (const path of ["/", "/pos", "/login", "/login?account=0"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/pos-login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Device activation required" })).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "Administrator sign in" }).click();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();

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
