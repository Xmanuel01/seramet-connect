import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));

test("finance pages show real account checks, redirect old links and recover from invalid filters", async ({
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
    // Old addresses land on the merged pages.
    for (const [path, expected, name] of [
      ["/daily-sales-journal", "/general-ledger?source=sales", "sales-journal"],
      ["/profit-loss", "/statements?tab=profit-loss", "statements"],
      ["/general-ledger", "/general-ledger", "general-ledger"],
    ] as const) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(expected.replace(/[?]/g, "\\?") + "$"));
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      const main = page.locator("main");
      // The shared tenant has genuine cash/receivable accounts for the cash shift.
      // Missing classifications and journals must still remain visible below.
      await expect(main.getByText("Your accounts aren't set up yet", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        main.getByText("Cash and bank accounts aren't marked", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByText("Nothing was posted in this period", { exact: true }),
      ).toBeVisible();
      await expect(
        main.getByRole("link", { name: "Set up accounts in Setup Centre" }),
      ).toHaveAttribute("href", "/seramet-setup?section=ACCOUNTING");
      if (name === "sales-journal") {
        await expect(main.getByLabel("Show", { exact: true })).toHaveValue("sales");
        await expect(
          main.getByText("No sales were posted in this period.", { exact: true }),
        ).toBeVisible();
      }
      if (name === "statements") {
        await expect(main.getByRole("tab", { name: "Profit & Loss" })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(main.getByText("Net result", { exact: true }).first()).toBeVisible();
        await main.getByRole("tab", { name: "Trial Balance" }).click();
        await expect(page).toHaveURL(/\/statements\?tab=trial-balance$/);
        // This disposable tenant has posted nothing, so there is no table to show.
        await expect(
          main.getByText("Nothing recorded in this period.", { exact: true }),
        ).toBeVisible();
        await expect(main.getByText("Out of balance", { exact: true })).toHaveCount(0);
      }
      // No internal codes or developer wording on screen.
      await expect(main).not.toContainText(
        /authoritative|idempoten|backend|server-side|[A-Z]{3,}_[A-Z]{3,}/,
      );
      await page.screenshot({
        path: resolve(directory, `${name}-desktop.png`),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await page.screenshot({
        path: resolve(directory, `${name}-mobile.png`),
        fullPage: true,
      });
      const from = main.getByLabel("From", { exact: true });
      const original = await from.inputValue();
      await from.fill("");
      // A cleared date is explained on the page; nothing is sent to the server.
      await expect(
        main.getByText("Couldn't load this report", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        main.getByText("Choose a start and end date.", { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("This page didn't load", { exact: true })).toHaveCount(0);
      await from.fill(original);
      await expect(
        main.getByText("Cash and bank accounts aren't marked", { exact: true }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
