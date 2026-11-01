import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, randomInt, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test("temporary PIN sign-in stays in credential setup until replacement is acknowledged", async ({
  page,
}) => {
  await page.route("**/api/seramet/public/device/startup", (route) =>
    route.fulfill({
      json: {
        state: "ACTIVE",
        device: {
          id: "disposable-terminal",
          name: "Pilot terminal",
          tenantName: "Pilot E2E",
          branchId: "disposable-branch",
          branchName: "Pilot branch",
        },
        policy: { pinLength: 6, allowEmployeeTiles: false, inactivityLockMinutes: 15 },
      },
    }),
  );
  await page.route("**/api/seramet/public/employee/login", (route) =>
    route.fulfill({ json: { ok: true, mustChangePin: true, nextPath: "/attendance" } }),
  );
  await page.route("**/api/seramet/public/employee/change-pin", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      currentPin: "602947",
      pin: "830275",
      pinConfirmation: "830275",
    });
    await route.fulfill({ json: { ok: true, reauthenticationRequired: true } });
  });
  await page.goto("/pos-login");
  await page.getByLabel("Email or employee code").fill("STAFF-SETUP");
  for (const digit of "602947")
    await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Replace temporary PIN" })).toBeVisible();
  await expect(page).toHaveURL(/\/pos-login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("seramet.session.interactive-sign-in")),
  ).not.toBe("1");
  await page.getByLabel("New PIN", { exact: true }).fill("830275");
  await page.getByLabel("Confirm new PIN", { exact: true }).fill("830276");
  await expect(page.getByRole("button", { name: "Change PIN", exact: true })).toBeDisabled();
  await page.getByLabel("Confirm new PIN", { exact: true }).fill("830275");
  await page.getByRole("button", { name: "Change PIN", exact: true }).click();
  await expect(page.getByText("PIN changed. Sign in with your new PIN.")).toBeVisible();
});

type Fixture = {
  tenantId: string;
  userId: string;
  managerAccessToken: string;
  phoneAccessToken: string;
  firstBranchId: string;
  secondBranchId: string;
};
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet", "e2e-fixture.json"), "utf8"),
) as Fixture;

async function authorize(
  context: BrowserContext,
  token = fixture.managerAccessToken,
  userId = fixture.userId,
) {
  await context.route("**/api/seramet/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${token}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-user-id": userId,
        "x-seramet-branch-id": fixture.firstBranchId,
      },
    });
  });
}
async function establishSession(page: Page, employeeId = fixture.userId) {
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
    { tenantId: fixture.tenantId, userId: employeeId, branchId: fixture.firstBranchId },
  );
}

test("chef uses the shared POS PIN login and clocks in without administrator access", async ({
  browser,
  context,
}) => {
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !fixture.tenantId.startsWith("e2e-")
  )
    throw new Error("Disposable local PIN attendance verification required");
  const headers = {
    authorization: `Bearer ${fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
    origin: "http://127.0.0.1:4173",
  };
  const configuration = await context.request.get("/api/seramet/configuration", { headers });
  expect(configuration.ok()).toBe(true);
  const roles = (await configuration.json()).configuration.roles as Array<{
    id: string;
    code: string;
  }>;
  const chef = roles.find((role) => role.code === "PILOT_CHEF");
  expect(chef).toBeTruthy();
  const employeeCode = `CHEF-${randomUUID().slice(0, 8)}`;
  const pin = String(randomInt(234567, 876543));
  const employeeResponse = await context.request.post("/api/seramet/employees", {
    headers,
    data: {
      idempotencyKey: randomUUID(),
      fullName: "Disposable PIN chef",
      employeeCode,
      jobTitle: "Chef",
      roleId: chef!.id,
      assignedBranchIds: [fixture.firstBranchId],
      primaryBranchId: fixture.firstBranchId,
      pin,
      pinConfirmation: pin,
      temporaryPin: false,
      effectiveFrom: new Date(Date.now() - 60000).toISOString(),
    },
  });
  expect(employeeResponse.status()).toBe(201);
  const registered = await context.request.post("/api/seramet/devices/register", {
    headers,
    data: {
      branchId: fixture.firstBranchId,
      deviceType: "POS_TERMINAL",
      name: "Disposable chef terminal",
    },
  });
  expect(registered.ok()).toBe(true);
  const { device } = await registered.json();
  expect(
    (
      await context.request.post(`/api/seramet/devices/${device.id}/activate`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const worksite = await context.request.put("/api/seramet/attendance/geofence", {
    headers,
    data: {
      branchId: fixture.firstBranchId,
      enabled: true,
      latitude: -1.264,
      longitude: 36.806,
      radiusMeters: 10,
      maxAccuracyMeters: 8,
      maxFixAgeSeconds: 30,
      graceMinutes: 0,
      expectedVersion: 0,
    },
  });
  expect(worksite.status()).toBe(200);
  const staff = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: -1.264, longitude: 36.806, accuracy: 2 },
  });
  try {
    await staff.addCookies(
      (await context.cookies()).filter((cookie) => cookie.name === "seramet_device"),
    );
    expect(
      (await staff.cookies()).filter((cookie) => cookie.name === "seramet_device"),
    ).toHaveLength(1);
    const startup = await staff.request.get("/api/seramet/public/device/startup");
    expect((await startup.json()).state).toBe("ACTIVE");
    const page = await staff.newPage();
    await page.goto("/pos-login");
    await expect(page.getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Use administrator account" })).toBeVisible();
    await page.getByLabel("Email or employee code").fill(employeeCode);
    for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
    const login = page.waitForResponse((response) =>
      response.url().endsWith("/public/employee/login"),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const loginResponse = await login;
    expect(loginResponse.ok()).toBe(true);
    await expect(page).toHaveURL(/\/attendance$/);
    await expect(page.getByText("My attendance", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clock in", exact: true })).toBeEnabled();
    const attendance = page.getByRole("region", { name: "My attendance", exact: true });
    await expect(page.getByText("Recorded today", { exact: true })).toHaveCount(0);
    await expect(attendance.getByText("Not clocked in", { exact: true })).toBeVisible();
    for (const [device, width, height] of [
      ["android", 360, 800],
      ["iphone", 390, 844],
      ["desktop", 1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(
        attendance.getByRole("button", { name: "Clock in", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: test.info().outputPath(`attendance-${device}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await staff.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
    const punch = page.waitForResponse((response) => response.url().endsWith("/attendance/punch"));
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    expect((await punch).status()).toBe(200);
    await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
    expect((await staff.request.get("/api/seramet/employees")).status()).toBe(403);
    await page.screenshot({
      path: test.info().outputPath("chef-pin-attendance.png"),
      fullPage: true,
    });
    await attendance.getByText("Shift details", { exact: true }).click();
    await expect(attendance.getByText("Schedule", { exact: true })).toBeVisible();
    const clockOut = page.waitForResponse((response) =>
      response.url().endsWith("/attendance/punch"),
    );
    await attendance.getByRole("button", { name: "Clock out", exact: true }).click();
    expect((await clockOut).status()).toBe(200);
    await expect(attendance.getByText("Shift completed", { exact: true })).toBeVisible();
    await page.reload();
    await expect(attendance.getByText("Shift completed", { exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("attendance-completed-iphone.png"),
      fullPage: true,
    });
  } finally {
    await staff.close();
  }
});

test("employee clock-in enforces GPS, supervisor config and immutable server time", async ({
  browser,
}) => {
  const context = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: -1.26, longitude: 36.806, accuracy: 2 },
  });
  // A personal phone: the manager token is bound to the branch till, which clocks in without GPS.
  await authorize(context, fixture.phoneAccessToken);
  const page = await context.newPage();
  await establishSession(page);
  const document = await page.goto("/attendance");
  expect(document?.headers()["permissions-policy"]).toBe(
    "camera=(), microphone=(), geolocation=(self), payment=()",
  );
  await expect(page.getByText("Workplace location for clock-in")).toBeVisible();
  await page.getByRole("button", { name: "Use my current location" }).click();
  await expect(page.getByLabel("Latitude")).toHaveValue("-1.26");
  await expect(page.getByLabel("Longitude")).toHaveValue("36.806");
  await page.getByLabel("Latitude").fill("-1.264");
  await page.getByLabel("Longitude").fill("36.806");
  await page.getByLabel("Require staff to be on site").check();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/attendance/geofence") && response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save location" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByLabel("Require staff to be on site")).toBeChecked();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeEnabled();
  // Chromium timestamps its emulated fix when configured, not when requested.
  // Refresh the sensor after cold-start hydration; keep the server age guard intact.
  await context.setGeolocation({ latitude: -1.26, longitude: 36.806, accuracy: 2 });
  const rejected = page.waitForResponse((response) => response.url().endsWith("/attendance/punch"));
  await page.getByRole("button", { name: "Clock in" }).click();
  expect((await rejected).status()).toBe(422);
  const deniedDialog = page.getByRole("dialog", { name: "Attendance not confirmed" });
  await expect(deniedDialog).toContainText(/within \d+ metres/);
  await deniedDialog.getByRole("button", { name: "Report a delay", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Report a delay" })).toBeVisible();
  await page.keyboard.press("Escape");
  await context.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  await page.getByRole("button", { name: "Clock in" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Clock-in recorded by the server." }),
  ).toBeVisible();
  await expect(page.getByText("Clocked in", { exact: true })).toBeVisible();
  await context.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByText("Shift completed")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Shift completed")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await context.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  let committed = 0;
  await page.route(
    "**/api/seramet/attendance/punch",
    async (route) => {
      const response = await route.fetch({
        headers: {
          ...route.request().headers(),
          authorization: `Bearer ${fixture.phoneAccessToken}`,
          "x-seramet-tenant-id": fixture.tenantId,
          "x-seramet-branch-id": fixture.firstBranchId,
        },
        maxRetries: 0,
      });
      expect(response.status()).toBe(200);
      committed += 1;
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Clock in", exact: true }).click();
  const uncertainDialog = page.getByRole("dialog", { name: "Attendance not confirmed" });
  await expect(uncertainDialog).toContainText("Attendance is not confirmed");
  await uncertainDialog.getByRole("button", { name: "Back to attendance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check / retry request" })).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "Check / retry request" }).click();
  await expect(page.getByRole("button", { name: "Clock out", exact: true })).toBeEnabled();
  expect(committed).toBe(1);
  await expect(
    page.getByText("The server confirmed your previous attendance request."),
  ).toBeVisible();
  await context.close();
});

test("People provides an Add Employee path to the authorized employee register", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await authorize(context);
  const page = await context.newPage();
  await establishSession(page);
  let releaseEmployeeLoad!: () => void;
  const employeeLoadReady = new Promise<void>((resolve) => {
    releaseEmployeeLoad = resolve;
  });
  await page.route("**/api/seramet/employees", async (route) => {
    if (route.request().method() === "GET") await employeeLoadReady;
    await route.fallback();
  });
  await page.goto("/people");
  await page.getByRole("button", { name: "Add Employee" }).click();
  await expect(page).toHaveURL(/\/employees/);
  await expect(page.getByRole("button", { name: "Add employee" })).toBeDisabled();
  releaseEmployeeLoad();
  await expect(page.getByRole("button", { name: "Add employee" })).toBeEnabled();
  await page.getByRole("button", { name: "Add employee" }).click();
  const employeeCode = "STAFF-" + randomUUID().slice(0, 8).toUpperCase();
  await page.getByLabel("Full name", { exact: true }).fill("Disposable attendance employee");
  await page.getByLabel("Employee code", { exact: true }).fill(employeeCode);
  await page.getByLabel("Job title", { exact: true }).fill("Waiter");
  await page
    .getByRole("combobox", { name: "Operational role", exact: true })
    .selectOption({ label: "Attendance employee" });
  await page.getByLabel("Temporary PIN", { exact: true }).fill("602947");
  await page.getByLabel("Confirm PIN", { exact: true }).fill("602947");
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/employees") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create employee", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const request = response.request().postDataJSON() as Record<string, unknown>;
  expect(request).not.toHaveProperty("email");
  expect(request).not.toHaveProperty("phone");
  const body = (await response.json()) as { employee: { id: string } };
  expect(body.employee.id).toBeTruthy();
  await expect(page.getByText(employeeCode, { exact: true })).toBeVisible();
  // The same creation request is acknowledged without duplicating the identity.
  const replay = await context.request.post("/api/seramet/employees", {
    data: request,
    headers: {
      authorization: `Bearer ${fixture.managerAccessToken}`,
      "x-seramet-tenant-id": fixture.tenantId,
      "x-seramet-branch-id": fixture.firstBranchId,
      origin: "http://127.0.0.1:4173",
    },
  });
  expect(replay.status()).toBe(201);
  expect(((await replay.json()) as { employee: { id: string } }).employee.id).toBe(
    body.employee.id,
  );
  // Internal disposable authentication is not live Supabase linking certification.
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !fixture.tenantId.startsWith("e2e-")
  )
    throw new Error("Disposable local attendance session required");
  const db = new DatabaseSync(resolve(".seramet", "development.sqlite"));
  const sessionId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.prepare(
      "INSERT INTO auth_sessions(tenant_id,id,user_id,issued_at,expires_at,last_seen_at,token_version,metadata_json) VALUES(?,?,?,?,?,?,1,'{}')",
    ).run(
      fixture.tenantId,
      sessionId,
      body.employee.id,
      new Date().toISOString(),
      new Date(Date.now() + 3600000).toISOString(),
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      sub: body.employee.id,
      tid: fixture.tenantId,
      sid: sessionId,
      iss: process.env.SERAMET_JWT_ISSUER,
      aud: process.env.SERAMET_JWT_AUDIENCE,
      iat: now,
      nbf: now - 1,
      exp: now + 3600,
      jti: randomUUID(),
    });
  const token =
    unsigned +
    "." +
    createHmac("sha256", process.env.SERAMET_JWT_SECRET!).update(unsigned).digest("base64url");
  const staff = await browser.newContext({
    permissions: ["geolocation"],
    geolocation: { latitude: -1.264, longitude: 36.806, accuracy: 2 },
  });
  await authorize(staff, token, body.employee.id);
  const staffPage = await staff.newPage();
  await establishSession(staffPage, body.employee.id);
  await staffPage.goto("/attendance");
  await expect(staffPage.getByText("My attendance", { exact: true })).toBeVisible();
  await expect(staffPage.getByText("Workplace location for clock-in", { exact: true })).toHaveCount(
    0,
  );
  await expect(staffPage.getByText("Supervisor · Live attendance", { exact: true })).toHaveCount(0);
  await staff.setGeolocation({ latitude: -1.264, longitude: 36.806, accuracy: 2 });
  await staffPage.getByRole("button", { name: "Clock in", exact: true }).click();
  await expect(staffPage.getByText("Clocked in", { exact: true })).toBeVisible();
  const staffHeaders = {
    authorization: `Bearer ${token}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
    origin: "http://127.0.0.1:4173",
  };
  const bootstrap = await staff.request.get("/api/seramet/configuration", {
    headers: staffHeaders,
  });
  expect(bootstrap.status()).toBe(200);
  const configuration = (await bootstrap.json()) as {
    configuration: { users: Array<{ id: string }> };
  };
  expect(configuration.configuration.users.map((user) => user.id)).toEqual([body.employee.id]);
  expect(
    (
      await staff.request.get(`/api/seramet/attendance?branchId=${fixture.secondBranchId}`, {
        headers: staffHeaders,
      })
    ).status(),
  ).toBe(403);
  expect(
    (await staff.request.get("/api/seramet/employees", { headers: staffHeaders })).status(),
  ).toBe(403);
  expect(
    (
      await staff.request.post("/api/seramet/attendance/supervisor", {
        headers: staffHeaders,
        data: {
          branchId: fixture.firstBranchId,
          employeeId: fixture.userId,
          action: "IN",
          idempotencyKey: randomUUID(),
          reason: "Unauthorized manager impersonation",
        },
      })
    ).status(),
  ).toBe(403);
  await staff.close();
  await context.close();
});
