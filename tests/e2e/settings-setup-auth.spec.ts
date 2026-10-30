import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { createDefaultDemoPlatformState } from "../../src/platform/demo/default-demo-data";
import { buildModuleAccessProfile } from "../../src/platform/module-access-registry";
import type { OnboardingWizardState } from "../../src/onboarding/location-currency-types";

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
    await expect(page.getByRole("heading", { name: "Employee sign in" })).toBeVisible();
    await expect(page.getByText("Device not activated.")).toBeVisible();
    await expect(page.getByLabel("Email or employee code")).toBeEnabled();
    await expect(page.getByRole("button", { name: "1", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
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

const registrationDraft = {
  name: "Autofill browser test",
  email: "autofill-browser@example.test",
  password: "Local-only-autofill-56!",
};
const anonymousRegistrationSession = { ok: true, authenticated: false, restaurants: [] };

async function autofillRegistration(page: Page) {
  await page.getByLabel("Your name").fill(registrationDraft.name);
  await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
  // Password managers can fill the DOM without firing React change events.
  await page.getByLabel("Password", { exact: true }).evaluate((input, password) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, password);
    input.setAttribute("data-autofill-probe", "original-input");
  }, registrationDraft.password);
}

async function registrationReturn(page: Page, event: "focus" | "visibilitychange" | "pageshow") {
  await page.evaluate((event) => {
    if (event === "visibilitychange") document.dispatchEvent(new Event(event));
    else if (event === "pageshow")
      window.dispatchEvent(new PageTransitionEvent(event, { persisted: true }));
    else window.dispatchEvent(new Event(event));
  }, event);
}

async function registrationCheckFinished(page: Page, pending: Promise<Response>) {
  await (await pending).finished();
  // Allow the response consumer and React's rendering work to settle before checking retention.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

for (const width of [1366, 390]) {
  test(`registration retains autofilled fields at ${width}px during session rechecks`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let gate: { started: () => void; pending: Promise<void> } | undefined;
    await page.route("**/api/seramet/public/auth/status", async (route) => {
      const current = gate;
      current?.started();
      await current?.pending;
      await route.fulfill({ json: anonymousRegistrationSession });
    });
    let signup: unknown;
    await page.route("**/api/seramet/public/auth/signup", async (route) => {
      signup = route.request().postDataJSON();
      await route.fulfill({
        status: 202,
        json: { authenticated: false, verificationRequired: true },
      });
    });
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await autofillRegistration(page);
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    for (const event of ["focus", "visibilitychange", "pageshow"] as const) {
      let release!: () => void;
      let started!: () => void;
      const requested = new Promise<void>((resolve) => {
        started = resolve;
      });
      gate = {
        started,
        pending: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      const response = page.waitForResponse("**/api/seramet/public/auth/status");
      try {
        await registrationReturn(page, event);
        await requested;
        await expect(page.getByLabel("Your name")).toBeVisible({ timeout: 2000 });
        await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
          registrationDraft.password,
        );
      } finally {
        release();
      }
      await registrationCheckFinished(page, response);
      await expect(page.getByLabel("Your name")).toHaveValue(registrationDraft.name);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue(registrationDraft.email);
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
        "data-autofill-probe",
        "original-input",
      );
      gate = undefined;
    }
    expect(navigations).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`registration-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    expect(signup).toEqual(registrationDraft);
    await page.getByRole("button", { name: "I've verified my email" }).click();
    await expect(page).toHaveURL(/\/login\?account=1$/);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  });
}

test("registration retains drafts on background errors and preserves signup errors on refocus", async ({
  page,
}) => {
  let unavailable = false;
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({ status: unavailable ? 503 : 200, json: anonymousRegistrationSession }),
  );
  await page.route("**/api/seramet/public/auth/signup", (route) =>
    route.fulfill({ status: 400, json: { message: "Use another test email address." } }),
  );
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await autofillRegistration(page);
  unavailable = true;
  await registrationReturn(page, "focus");
  await expect(page.getByRole("alert")).toContainText("We could not confirm your session");
  await expect(page.getByLabel("Your name")).toHaveValue(registrationDraft.name);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    registrationDraft.password,
  );
  unavailable = false;
  await registrationReturn(page, "focus");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Use another test email address.");
  const response = page.waitForResponse("**/api/seramet/public/auth/status");
  await registrationReturn(page, "focus");
  await registrationCheckFinished(page, response);
  await expect(page.getByRole("alert")).toHaveText("Use another test email address.");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    registrationDraft.password,
  );
});

test("registration preserves restaurant details on returning to the tab", async ({ page }) => {
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({ json: { ok: true, authenticated: true, restaurants: [] } }),
  );
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "What is your business name?" })).toBeVisible();
  await page.getByLabel("Your name").fill("Test administrator");
  await page.getByLabel("Restaurant name", { exact: true }).fill("Local test restaurant");
  await page.getByLabel("Legal business name").fill("Local test business");
  await page.getByLabel("Public URL name").fill("local-test-business");
  const response = page.waitForResponse("**/api/seramet/public/auth/status");
  await registrationReturn(page, "pageshow");
  await registrationCheckFinished(page, response);
  await expect(page.getByLabel("Your name")).toHaveValue("Test administrator");
  await expect(page.getByLabel("Restaurant name", { exact: true })).toHaveValue(
    "Local test restaurant",
  );
  await expect(page.getByLabel("Legal business name")).toHaveValue("Local test business");
  await expect(page.getByLabel("Public URL name")).toHaveValue("local-test-business");
});

for (const width of [1366, 390]) {
  test(`restaurant setup prefills the account name at ${width}px without overwriting edits`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    let authenticated = false;
    await page.route("**/api/seramet/public/auth/status", (route) =>
      route.fulfill({
        json: authenticated
          ? {
              ok: true,
              authenticated: true,
              identity: { displayName: registrationDraft.name, email: registrationDraft.email },
              restaurants: [],
            }
          : anonymousRegistrationSession,
      }),
    );
    let registration: { administratorName: string } | undefined;
    await page.route("**/api/seramet/public/register", (route) => {
      registration = route.request().postDataJSON();
      return route.fulfill({
        status: 400,
        json: { message: "Fixture stopped before creating a restaurant." },
      });
    });
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await autofillRegistration(page);
    await page.getByLabel("Your name").fill("Unsubmitted account draft");
    authenticated = true;
    const signedIn = page.waitForResponse("**/api/seramet/public/auth/status");
    await registrationReturn(page, "focus");
    await registrationCheckFinished(page, signedIn);
    await expect(page.getByRole("heading", { name: "What is your business name?" })).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue(registrationDraft.name);
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Restaurant name", { exact: true })).toHaveValue("");
    await expect(page.locator('[data-autofill-probe="original-input"]')).toHaveCount(0);
    await expect(page.getByLabel("Legal business name")).toHaveValue("");
    await expect(page.getByLabel("Public URL name")).toHaveValue("");
    await page.reload();
    await expect(page.getByLabel("Your name")).toHaveValue(registrationDraft.name);
    await page.getByLabel("Restaurant name", { exact: true }).fill("Account name fixture");
    await page.screenshot({
      path: testInfo.outputPath(`account-name-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Continue to location" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Fixture stopped before creating a restaurant.",
    );
    expect(registration?.administratorName).toBe(registrationDraft.name);

    for (const name of ["Edited account owner", ""]) {
      await page.getByLabel("Your name").fill(name);
      const response = page.waitForResponse("**/api/seramet/public/auth/status");
      await registrationReturn(page, "focus");
      await registrationCheckFinished(page, response);
      await expect(page.getByLabel("Your name")).toHaveValue(name);
    }
  });
}

test("registration ignores stale session checks and duplicate submission while signup is pending", async ({
  page,
}) => {
  let delayStatus = false;
  let requests = 0;
  let releaseStatus!: () => void;
  let statusStarted!: () => void;
  const statusRequested = new Promise<void>((resolve) => {
    statusStarted = resolve;
  });
  const statusPending = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  await page.route("**/api/seramet/public/auth/status", async (route) => {
    requests += 1;
    if (delayStatus) {
      statusStarted();
      await statusPending;
    }
    await route.fulfill({ json: anonymousRegistrationSession });
  });
  let signupCount = 0;
  let releaseSignup!: () => void;
  let signupStarted!: () => void;
  const signupRequested = new Promise<void>((resolve) => {
    signupStarted = resolve;
  });
  const signupPending = new Promise<void>((resolve) => {
    releaseSignup = resolve;
  });
  await page.route("**/api/seramet/public/auth/signup", async (route) => {
    signupCount += 1;
    signupStarted();
    await signupPending;
    await route.fulfill({
      status: 202,
      json: { authenticated: false, verificationRequired: true },
    });
  });
  try {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await autofillRegistration(page);
    delayStatus = true;
    await registrationReturn(page, "focus");
    await statusRequested;
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await signupRequested;
    const before = requests;
    await registrationReturn(page, "focus");
    await registrationReturn(page, "visibilitychange");
    await page.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
    expect(requests).toBe(before);
    expect(signupCount).toBe(1);
    releaseSignup();
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    const oldResponse = page.waitForResponse("**/api/seramet/public/auth/status");
    releaseStatus();
    await registrationCheckFinished(page, oldResponse);
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create your account" })).toHaveCount(0);
  } finally {
    releaseSignup();
    releaseStatus();
  }
});

async function mockOwnerOnboarding(page: Page, overrides: Partial<OnboardingWizardState> = {}) {
  const configuration = createDefaultDemoPlatformState();
  const tenant = configuration.tenants[0]!;
  const branch = configuration.branches[0]!;
  const owner = configuration.users[0]!;
  const roles = configuration.roles.filter((role) => owner.roleIds.includes(role.id));
  const permissions = [...new Set(roles.flatMap((role) => role.permissions))];
  const responses: Record<string, unknown> = {
    "/health/operational": { database: "authoritative", environment: "staging" },
    "/auth/session": {
      actor: {
        id: owner.id,
        name: registrationDraft.name,
        tenantId: tenant.id,
        branchId: branch.id,
        branch: branch.name,
        primaryBranchId: branch.id,
        assignedBranches: [{ id: branch.id, name: branch.name, isPrimary: true }],
        roles: owner.roleIds,
        permissions,
        authLevel: "FULL",
        salesTerminal: false,
        moduleAccess: buildModuleAccessProfile({
          permissions,
          organizationalScopes: ["BRANCH"],
          entitlements: [],
          entitlementsEnforced: false,
        }),
      },
    },
    "/configuration": { configuration },
    "/setup/centre": {
      setup: {
        organisationName: tenant.tradingName,
        stages: [],
        results: [],
        goLiveState: "SETUP",
        status: "BLOCKED",
        counts: { branches: 1, menuItems: 0 },
      },
    },
    "/setup/organisation-structure": {
      brands: configuration.brands,
      branches: configuration.branches,
    },
    "/setup/options": {
      options: {
        accounts: [],
        roles: [],
        warehouses: [],
        stations: [],
        documentTemplates: [],
        inventoryItems: [],
        units: [],
        taxRules: [],
      },
    },
    "/setup/onboarding": {
      onboarding: {
        currentStep: 1,
        status: "IN_PROGRESS",
        completedSteps: [],
        responses: { _flow: 2 },
        version: 1,
        location: null,
        suggestedCurrency: null,
        acceptedCurrencies: [],
        canChangeBaseCurrency: true,
        baseCurrencyLockReason: null,
        ...overrides,
      },
    },
    "/setup/reference/location-currency": {
      countries: [
        {
          code: "KE",
          name: "Kenya",
          administrativeLevel1Label: "County",
          defaultCurrencyCode: "KES",
          callingCode: "+254",
          defaultTimezone: "Africa/Nairobi",
          defaultLocale: "en-KE",
        },
      ],
      currencies: [{ code: "KES", name: "Kenyan Shilling", symbol: "KES", minorDigits: 2 }],
    },
  };
  await page.route("**/api/seramet/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/seramet", "");
    const json = responses[path];
    return route.fulfill(
      json ? { json } : { status: 503, json: { message: "Outside onboarding navigation fixture" } },
    );
  });
  return tenant;
}

test("new owner completes verified sign-in and enters onboarding instead of employee login", async ({
  page,
  context,
}) => {
  const tenant = await mockOwnerOnboarding(page);
  let authenticated = false;
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        authenticated,
        restaurants: [],
        identity: authenticated ? { displayName: registrationDraft.name } : undefined,
      },
    }),
  );
  await page.route("**/api/seramet/public/auth/signup", (route) =>
    route.fulfill({ status: 202, json: { authenticated: false, verificationRequired: true } }),
  );
  await page.route("**/api/seramet/public/auth/login", (route) => {
    authenticated = true;
    return route.fulfill({ json: { ok: true, authenticated: true } });
  });
  await page.route("**/api/seramet/public/register", (route) =>
    route.fulfill({
      status: 201,
      json: { ok: true, organisation: { tenantId: tenant.id, nextPath: "/seramet-setup" } },
    }),
  );
  const destinations: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) destinations.push(new URL(frame.url()).pathname);
  });
  await page.goto("/register");
  await autofillRegistration(page);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  await page.getByRole("button", { name: "I've verified my email" }).click();
  await expect(page).toHaveURL(/\/login\?account=1$/);
  await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
  await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What is your business name?" })).toBeVisible();
  await page.getByLabel("Restaurant name", { exact: true }).fill("Onboarding navigation fixture");
  await page.getByRole("button", { name: "Continue to location" }).click();
  await expect(
    page.getByRole("heading", { name: "Where is your business located?" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/seramet-setup$/);
  const country = page.getByRole("combobox", { name: "Country", exact: true });
  await expect(country).toBeVisible();
  await country.selectOption("KE");
  await expect(country).toHaveValue("KE");
  expect(
    await page.evaluate(() => sessionStorage.getItem("seramet.session.interactive-sign-in")),
  ).toBe("1");
  expect(destinations).not.toContain("/pos-login");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Where is your business located?" }),
  ).toBeVisible();

  const freshTab = await context.newPage();
  await freshTab.goto("/seramet-setup");
  await expect(freshTab).toHaveURL(/\/pos-login$/);
  await freshTab.close();
});

test("an existing owner resumes unfinished onboarding without recreating the restaurant", async ({
  page,
}) => {
  const tenant = await mockOwnerOnboarding(page);
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({
      json: {
        ok: true,
        authenticated: true,
        restaurants: [
          {
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.tradingName,
            onboardingStatus: "IN_PROGRESS",
          },
        ],
      },
    }),
  );
  await page.route("**/api/seramet/public/auth/login", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  let registrationRequests = 0;
  await page.route("**/api/seramet/public/register", (route) => {
    registrationRequests += 1;
    return route.fulfill({ status: 500, json: { message: "Registration must not repeat" } });
  });
  await page.goto("/login?account=1");
  await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
  await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Where is your business located?" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/seramet-setup$/);
  expect(registrationRequests).toBe(0);
});

test("administrator sign-in preserves credentials entered before hydration", async ({ page }) => {
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  let credentials: unknown;
  await page.route("**/*", async (route) => {
    if (
      route.request().resourceType() === "script" &&
      new URL(route.request().url()).pathname !== "/theme-init.js"
    ) {
      await scriptsReady;
    }
    await route.continue();
  });
  await page.route("**/api/seramet/public/auth/login", (route) => {
    credentials = route.request().postDataJSON();
    return route.fulfill({ json: { authenticated: true } });
  });
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({ json: anonymousRegistrationSession }),
  );
  try {
    await page.goto("/login?account=1", { waitUntil: "commit" });
    await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
    await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
    const submit = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(submit).toBeDisabled();
    releaseScripts();
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(registrationDraft.email);
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
      registrationDraft.password,
    );
    await submit.click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(credentials).toEqual({
      email: registrationDraft.email,
      password: registrationDraft.password,
    });
    await expect(page).toHaveURL(/\/login\?account=1$/);
    expect(
      await page.evaluate(() => sessionStorage.getItem("seramet.session.interactive-sign-in")),
    ).toBeNull();
  } finally {
    releaseScripts();
  }
});

for (const status of [200, 503]) {
  test(`administrator sign-in requires a confirmed server session after login (status ${status})`, async ({
    page,
  }) => {
    await page.route("**/api/seramet/public/auth/login", (route) =>
      route.fulfill({ json: { authenticated: true } }),
    );
    await page.route("**/api/seramet/public/auth/status", (route) =>
      route.fulfill({ status, json: anonymousRegistrationSession }),
    );
    await page.goto("/login?account=1");
    await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
    await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login\?account=1$/);
    expect(
      await page.evaluate(() => sessionStorage.getItem("seramet.session.interactive-sign-in")),
    ).toBeNull();
  });
}

async function openOnboardingStep(page: Page, step = 1) {
  const onboarding: OnboardingWizardState = {
    currentStep: step,
    status: "IN_PROGRESS",
    completedSteps: step > 1 ? Array.from({ length: step - 1 }, (_, index) => index + 1) : [],
    responses: { _flow: 2 },
    version: 2,
    location: {
      countryCode: "KE",
      administrativeLevel1: "Nairobi",
      administrativeLevel2: "",
      city: "Westlands",
      addressLine: "Disposable onboarding fixture",
      postalCode: "",
      latitudeMicrodegrees: null,
      longitudeMicrodegrees: null,
      status: "DRAFT",
    },
    suggestedCurrency: { code: "KES", name: "Kenyan Shilling", symbol: "KES", minorDigits: 2 },
    acceptedCurrencies: [],
    canChangeBaseCurrency: true,
    baseCurrencyLockReason: null,
  };
  const tenant = await mockOwnerOnboarding(page, onboarding);
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        restaurants: [
          {
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.tradingName,
            onboardingStatus: "IN_PROGRESS",
          },
        ],
      },
    }),
  );
  await page.route("**/api/seramet/public/auth/login", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  await page.goto("/login?account=1");
  await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
  await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: step === 12 ? "Review your restaurant" : "Where is your business located?",
      exact: true,
    }),
  ).toBeVisible();
  return onboarding;
}

test("onboarding advances from the saved response without waiting for unrelated setup reads", async ({
  page,
}) => {
  const onboarding = await openOnboardingStep(page);
  let releaseReads!: () => void;
  const readsReady = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let extraReads = 0;
  await page.route("**/api/seramet/setup/**", async (route) => {
    if (route.request().method() === "GET") {
      extraReads += 1;
      await readsReady;
    }
    await route.fallback();
  });
  const savedState = {
    ...onboarding,
    currentStep: 2,
    version: 3,
    completedSteps: [...onboarding.completedSteps, 1],
    location: { ...onboarding.location!, status: "CONFIRMED" },
  };
  await page.route("**/api/seramet/setup/onboarding/step", (route) =>
    route.fulfill({ json: { ok: true, onboarding: savedState } }),
  );
  try {
    await page.getByLabel("This address is correct").check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your currency", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    expect(extraReads).toBe(0);
    releaseReads();
    await page.route("**/api/seramet/setup/onboarding", (route) =>
      route.fulfill({
        json: { onboarding: savedState },
      }),
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your currency", exact: true })).toBeVisible();
  } finally {
    releaseReads();
  }
});

test("onboarding waits for save confirmation and recovers from a rejected save", async ({
  page,
}) => {
  const onboarding = await openOnboardingStep(page);
  let releaseSave!: () => void;
  const saveReady = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  let attempts = 0;
  await page.route("**/api/seramet/setup/onboarding/step", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await saveReady;
      return route.fulfill({ status: 503, json: { message: "Save could not be confirmed" } });
    }
    return route.fulfill({
      json: { ok: true, onboarding: { ...onboarding, currentStep: 2, version: 3 } },
    });
  });
  try {
    await page.getByLabel("This address is correct").check();
    const posted = page.waitForRequest("**/api/seramet/setup/onboarding/step");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await posted;
    await expect(
      page.getByRole("heading", { name: "Where is your business located?", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue|Saving/ })).toBeDisabled();
    for (const viewport of [
      { width: 1366, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`saving-${viewport.width}.png`),
        fullPage: true,
      });
    }
    expect(attempts).toBe(1);
    releaseSave();
    await expect(page.getByRole("alert")).toHaveText("Save could not be confirmed");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your currency", exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  } finally {
    releaseSave();
  }
});

test("onboarding does not advance without confirmed progress in the save response", async ({
  page,
}) => {
  await openOnboardingStep(page);
  await page.route("**/api/seramet/setup/onboarding/step", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.getByLabel("This address is correct").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Saved onboarding progress could not be confirmed",
  );
  await expect(
    page.getByRole("heading", { name: "Where is your business located?", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
});

test("a restaurant below 80% ready resumes guided setup from Setup Centre", async ({ page }) => {
  const finished: Partial<OnboardingWizardState> = {
    currentStep: 12,
    status: "COMPLETED",
    completedSteps: [1, 2, 3, 4, 5, 6, 12],
    responses: { _flow: 2, "3": { businessType: "RESTAURANT" } },
  };
  const tenant = await mockOwnerOnboarding(page, finished);
  const setupCentre = (overallScoreBps: number) => ({
    setup: {
      organisationName: tenant.tradingName,
      stages: [],
      results: [],
      goLiveState: "SETUP",
      status: "BLOCKED",
      overallScoreBps,
      counts: { branches: 1, menuItems: 0 },
    },
  });
  let score = 2_700;
  await page.route("**/api/seramet/setup/centre*", (route) =>
    route.fulfill({ json: setupCentre(score) }),
  );
  await page.route("**/api/seramet/public/auth/status", (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        restaurants: [
          {
            tenantId: tenant.id,
            slug: tenant.slug,
            name: tenant.tradingName,
            onboardingStatus: "COMPLETED",
          },
        ],
      },
    }),
  );
  await page.route("**/api/seramet/public/auth/login", (route) =>
    route.fulfill({ json: { authenticated: true } }),
  );
  let resumeRequests = 0;
  await page.route("**/api/seramet/setup/onboarding/resume", (route) => {
    resumeRequests += 1;
    return route.fulfill({
      json: {
        ok: true,
        onboarding: {
          ...finished,
          currentStep: 3,
          status: "IN_PROGRESS",
          completedSteps: [1, 2],
          version: 2,
          location: null,
          suggestedCurrency: null,
          acceptedCurrencies: [],
          canChangeBaseCurrency: true,
          baseCurrencyLockReason: null,
        },
      },
    });
  });
  await page.goto("/login?account=1");
  await page.getByLabel("Email", { exact: true }).fill(registrationDraft.email);
  await page.getByLabel("Password", { exact: true }).fill(registrationDraft.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Let the post-sign-in redirect finish; navigating during it aborts the navigation.
  await page.waitForURL((target) => !target.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
  await page.goto("/seramet-setup");
  await expect(page.getByRole("heading", { name: "Setup Centre", exact: true })).toBeVisible();
  await expect(page.getByText("This restaurant is 27% ready.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Resume guided setup", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What kind of business is this?", exact: true }),
  ).toBeVisible();
  expect(resumeRequests).toBe(1);

  // At 80% or more the remaining work belongs in Setup Centre, so the button is not offered.
  score = 8_500;
  await page.unroute("**/api/seramet/setup/onboarding/resume");
  await page.route("**/api/seramet/setup/onboarding", (route) =>
    route.fulfill({
      json: {
        onboarding: {
          ...finished,
          version: 3,
          location: null,
          suggestedCurrency: null,
          acceptedCurrencies: [],
          canChangeBaseCurrency: true,
          baseCurrencyLockReason: null,
        },
      },
    }),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Setup Centre", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume guided setup", exact: true })).toHaveCount(
    0,
  );
});

test("onboarding completion still refreshes authoritative setup data", async ({ page }) => {
  const onboarding = await openOnboardingStep(page, 12);
  const completed = { ...onboarding, status: "COMPLETED", version: 3 };
  let reads = 0;
  await page.route("**/api/seramet/setup/**", async (route) => {
    if (route.request().method() === "GET") reads += 1;
    await route.fallback();
  });
  await page.route("**/api/seramet/setup/onboarding", (route) =>
    route.fulfill({ json: { onboarding: completed } }),
  );
  await page.route("**/api/seramet/setup/onboarding/step", (route) =>
    route.fulfill({ json: { ok: true, onboarding: completed } }),
  );
  await page.getByRole("button", { name: "Finish and open Setup Centre", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Setup Centre", exact: true })).toBeVisible();
  expect(reads).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Review your restaurant", exact: true }),
  ).toHaveCount(0);
});
