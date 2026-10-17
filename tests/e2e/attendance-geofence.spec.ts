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
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-user-id": fixture.userId,
        "x-seramet-branch-id": fixture.firstBranchId,
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

test("employee clock-in enforces GPS, supervisor config and immutable server time", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: -1.26, longitude: 36.806, accuracy: 2 },
  });
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  const document = await page.goto("/attendance");
  expect(document?.headers()["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=(self), payment=()",
  );
  await expect(page.getByText("Worksite geofence")).toBeVisible();
  await page.getByLabel("Latitude").fill("-1.264");
  await page.getByLabel("Longitude").fill("36.806");
  await page.getByLabel("Enable geofence").check();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/attendance/geofence") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save worksite policy" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByLabel("Enable geofence")).toBeChecked();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeEnabled();
  // Chromium timestamps its emulated fix when configured, not when requested.
  // Refresh the sensor after cold-start hydration; keep the server age guard intact.
  await context.setGeolocation({ latitude: -1.26, longitude: 36.806, accuracy: 2 });
  const rejected = page.waitForResponse((response) => response.url().endsWith("/attendance/punch"));
  await page.getByRole("button", { name: "Clock in" }).click();
  expect((await rejected).status()).toBe(422);
  await expect(page.getByRole("status")).toContainText("OUTSIDE_GEOFENCE");
  await context.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  await page.getByRole("button", { name: "Clock in" }).click();
  await expect(page.getByRole("status")).toContainText("Clock-in recorded by the server.");
  await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
  await context.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByText("Shift completed")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Shift completed")).toBeVisible();
  await context.close();
});

test("People provides an Add Employee path to the authorized employee register", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  await page.goto("/people");
  await page.getByRole("button", { name: "Add Employee" }).click();
  await expect(page).toHaveURL(/\/employees/);
  await expect(page.getByRole("button", { name: "Add employee" })).toBeEnabled();
  await context.close();
});
