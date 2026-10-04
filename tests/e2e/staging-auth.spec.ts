import { createClient, type User } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const certificationRequired = process.env.SERAMET_STAGING_AUTH_CERTIFICATION === "true";
const configuration = {
  ownerEmail: process.env.SERAMET_STAGING_OWNER_EMAIL,
  ownerPassword: process.env.SERAMET_STAGING_OWNER_PASSWORD,
  restaurantName: process.env.SERAMET_STAGING_RESTAURANT_NAME,
  signupEmail: process.env.SERAMET_STAGING_SIGNUP_EMAIL,
  signupPassword: process.env.SERAMET_STAGING_SIGNUP_PASSWORD,
  supabaseUrl: process.env.SERAMET_STAGING_SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SERAMET_STAGING_SUPABASE_SERVICE_ROLE_KEY,
  deviceId: process.env.SERAMET_STAGING_DEVICE_ID,
  deviceName: process.env.SERAMET_STAGING_DEVICE_NAME,
  staffIdentifier: process.env.SERAMET_STAGING_STAFF_IDENTIFIER,
  staffPin: process.env.SERAMET_STAGING_STAFF_PIN,
  branchName: process.env.SERAMET_STAGING_BRANCH_NAME,
};

if (certificationRequired) {
  const missing = Object.entries(configuration)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`Protected staging authentication is not configured: ${missing.join(", ")}`);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("protected staging authentication", () => {
  test("signup cannot authenticate until the real Supabase identity is verified", async ({
    page,
  }) => {
    test.skip(
      !configuration.signupEmail ||
        !configuration.signupPassword ||
        !configuration.supabaseUrl ||
        !configuration.supabaseServiceRoleKey,
      "Disposable signup and protected Supabase administrator credentials are required",
    );
    const email = uniqueEmail(configuration.signupEmail!);
    const admin = createClient(configuration.supabaseUrl!, configuration.supabaseServiceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let user: User | undefined;

    try {
      await page.goto("/register");
      await page.getByLabel("Your name").fill("Seramet staging certification");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(configuration.signupPassword!);
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();

      await page.getByRole("button", { name: "I've verified my email" }).click();
      await expect(page).toHaveURL(/\/login/);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(configuration.signupPassword!);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByRole("alert")).toBeVisible();

      user = await findSupabaseUser(admin, email);
      const verification = await admin.auth.admin.updateUserById(user.id, {
        email_confirm: true,
      });
      if (verification.error) throw verification.error;

      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/register/);
      await expect(
        page.getByRole("heading", { name: "What is your business name?" }),
      ).toBeVisible();
    } finally {
      if (user) {
        await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
      }
    }
  });

  test("verified owner login, reload and logout require an explicit session", async ({ page }) => {
    test.skip(
      !configuration.ownerEmail || !configuration.ownerPassword || !configuration.restaurantName,
      "Protected disposable owner credentials and restaurant selection are required",
    );
    await ownerLogin(page);
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await signOut(page);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });

  test("owner activates this browser and branch-assigned staff signs in with an individual PIN", async ({
    page,
  }) => {
    test.skip(
      !configuration.ownerEmail ||
        !configuration.ownerPassword ||
        !configuration.restaurantName ||
        !configuration.deviceId ||
        !configuration.deviceName ||
        !configuration.staffIdentifier ||
        !configuration.staffPin ||
        !configuration.branchName,
      "A disposable staging device and branch-assigned employee are required",
    );
    await ownerLogin(page);
    await revokeDevice(page, "Prepare protected staging authentication certification");

    await page.goto("/seramet-setup");
    await page.getByRole("button", { name: "Printers / devices" }).click();
    const deviceRow = page.getByRole("row").filter({ hasText: configuration.deviceName! });
    await expect(deviceRow).toBeVisible();
    await deviceRow.getByRole("button", { name: "Activate" }).click();
    await expect(
      page.getByText("This browser is now securely activated for employee POS sign-in."),
    ).toBeVisible();

    await signOut(page);
    await page.goto("/pos-login");
    await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
    await expect(page.getByText(configuration.branchName!, { exact: true })).toBeVisible();
    await page.getByLabel("Email or employee code").fill(configuration.staffIdentifier!);
    for (const digit of configuration.staffPin!) {
      await page.getByRole("button", { name: digit, exact: true }).click();
    }
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/pos(?:[/?#]|$)/);
    await signOut(page);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);

    await ownerLogin(page);
    await revokeDevice(page, "Reset disposable device after staging authentication certification");
    await signOut(page);
  });
});

async function ownerLogin(page: Page) {
  await page.goto("/login?account=1");
  await page.getByLabel("Email").fill(configuration.ownerEmail!);
  await page.getByLabel("Password").fill(configuration.ownerPassword!);
  await page.getByRole("button", { name: "Sign in" }).click();

  const restaurant = page.getByRole("button", { name: configuration.restaurantName!, exact: true });
  await expect(async () => {
    expect(!new URL(page.url()).pathname.endsWith("/login") || (await restaurant.isVisible())).toBe(
      true,
    );
  }).toPass();
  if (await restaurant.isVisible()) await restaurant.click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function revokeDevice(page: Page, reason: string) {
  const response = await page.request.post(
    `/api/seramet/devices/${encodeURIComponent(configuration.deviceId!)}/revoke`,
    { data: { reason } },
  );
  expect(response.ok(), `Device reset failed with ${response.status()}`).toBe(true);
}

async function findSupabaseUser(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<User> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (result.error) throw result.error;
    const user = result.data.users.find((candidate) => candidate.email === email);
    if (user) return user;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Disposable staging signup was not persisted by Supabase");
}

function uniqueEmail(template: string) {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (template.includes("{nonce}")) return template.replace("{nonce}", nonce);
  const separator = template.lastIndexOf("@");
  if (separator < 1) throw new Error("SERAMET_STAGING_SIGNUP_EMAIL must be an email address");
  return `${template.slice(0, separator)}+${nonce}${template.slice(separator)}`;
}
