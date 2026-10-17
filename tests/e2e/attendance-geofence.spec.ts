import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Fixture = {
  tenantId: string;
  userId: string;
  managerAccessToken: string;
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
          authorization: `Bearer ${fixture.managerAccessToken}`,
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
  await page.goto("/people");
  await page.getByRole("button", { name: "Add Employee" }).click();
  await expect(page).toHaveURL(/\/employees/);
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
  await expect(staffPage.getByText("Worksite geofence", { exact: true })).toHaveCount(0);
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
