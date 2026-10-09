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
