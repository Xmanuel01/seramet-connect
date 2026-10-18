import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
export const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));
export async function openCashier(context: BrowserContext, page: Page) {
  await context.route("**/api/seramet/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${fixture.trustedAccessToken}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-branch-id": fixture.firstBranchId,
      },
    }),
  );
  await page.goto("/login?account=1");
  await page.evaluate(({ tenantId, firstBranchId }) => {
    sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
    localStorage.setItem("seramet.session.tenant-id", tenantId);
    localStorage.setItem(
      "seramet.session.branch-scope.v2",
      JSON.stringify({ type: "BRANCH", branchId: firstBranchId }),
    );
  }, fixture);
  await page.goto("/pos");
  await expect(page.getByLabel("Connection: Online")).toBeVisible();
  await page.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
  await page.getByRole("button", { name: "Add Pilot meal to order" }).click();
  await page.getByPlaceholder("Item note").fill("No onion - preserve cashier work");
}
export async function recordTrace(page: Page, name: string, extra = {}) {
  const entries = await page.evaluate(() => window.__serametPosTrace ?? []);
  mkdirSync(".seramet/pos-stability", { recursive: true });
  writeFileSync(
    `.seramet/pos-stability/${name}.json`,
    JSON.stringify({ ...extra, entries }, null, 2),
  );
  return entries;
}
