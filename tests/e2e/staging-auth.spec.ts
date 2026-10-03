import { expect, test } from "@playwright/test";

const email = process.env.SERAMET_STAGING_OWNER_EMAIL;
const password = process.env.SERAMET_STAGING_OWNER_PASSWORD;

test.describe("protected staging authentication", () => {
  test.skip(!email || !password, "Protected disposable staging credentials are required");

  test("verified owner login, reload and logout require an explicit session", async ({ page }) => {
    await page.goto("/login?account=1");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });
});
