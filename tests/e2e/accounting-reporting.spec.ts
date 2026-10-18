import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));

test("accounting pages preserve missing-configuration evidence and recover from invalid filters", async ({
  browser,
}) => {
  test.setTimeout(180000);
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback accounting acceptance only");

  const context = await browser.newContext();
  const errors: string[] = [];
  try {
    await context.route("**/api/seramet/**", (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          authorization: `Bearer ${fixture.managerAccessToken}`,
          "x-seramet-tenant-id": fixture.tenantId,
          "x-seramet-branch-id": fixture.firstBranchId,
        },
      }),
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/login?account=1");
    await page.evaluate((f) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", f.tenantId);
      localStorage.setItem("seramet.session.user-id", f.userId);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({
          type: "BRANCH",
          branchId: f.firstBranchId,
        }),
      );
    }, fixture);
    const directory = resolve(".seramet/accounting-photo-fixes");
    await mkdir(directory, { recursive: true });
    for (const path of ["/daily-sales-journal", "/tax-centre", "/general-ledger"]) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      const main = page.locator("main");
      await expect(
        main.getByText("Chart of accounts not configured", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("Cash and bank accounts need classification", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("No posted journals in this period", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("link", { name: "Review accounting mappings in Setup Centre" }),
      ).toHaveAttribute("href", "/seramet-setup?section=ACCOUNTING");
      if (path === "/daily-sales-journal") {
        await expect(
          main.getByRole("columnheader", { name: "Voucher", exact: true }),
        ).toBeVisible();
        await expect(
          main.getByText("No posted journals match this period and branch.", { exact: false }),
        ).toBeVisible();
        await expect(main.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
      }
      if (path === "/tax-centre") {
        await expect(
          main.getByText("Tax return preparation is not configured", { exact: true }),
        ).toBeVisible();
      }
      await page.screenshot({
        path: resolve(directory, `${path.slice(1)}-desktop.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await page.screenshot({
        path: resolve(directory, `${path.slice(1)}-mobile.png`),
        fullPage: true,
      });
      const from = main.getByLabel("From", { exact: true });
      const original = await from.inputValue();
      await from.fill("");
      await expect(
        main.getByText("Financial data could not be verified", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
      await from.fill(original);
      await expect(
        main.getByText("Chart of accounts not configured", { exact: true }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
