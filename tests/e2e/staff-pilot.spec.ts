import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { expect, test, type Browser } from "@playwright/test";
const fixture = JSON.parse(readFileSync(resolve(".seramet/e2e-fixture.json"), "utf8")) as {
  tenantId: string;
  firstBranchId: string;
  secondBranchId: string;
  userId: string;
  managerAccessToken: string;
  staff: Record<string, { id: string; token: string }>;
};
async function session(browser: Browser, staff: { id: string; token: string }) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/api/seramet/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${staff.token}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-branch-id": fixture.firstBranchId,
      },
    }),
  );
  const page = await context.newPage();
  await page.goto("/staff-login");
  await page.evaluate(
    ({ tenant, branch, user }) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", tenant);
      localStorage.setItem("seramet.session.user-id", user);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId: branch }),
      );
    },
    { tenant: fixture.tenantId, branch: fixture.firstBranchId, user: staff.id },
  );
  return { context, page };
}
const headers = (staff: { token: string }) => ({
  authorization: `Bearer ${staff.token}`,
  "x-seramet-tenant-id": fixture.tenantId,
  "x-seramet-branch-id": fixture.firstBranchId,
  origin: "http://127.0.0.1:4173",
});
test("employee reports a delay away from work and another supervisor decides without creating attendance", async ({
  browser,
}) => {
  const employee = await session(browser, fixture.staff.chef!),
    supervisor = await session(browser, fixture.staff.supervisor!);
  await employee.page.goto("/attendance");
  await employee.page.getByRole("button", { name: "Report a delay", exact: true }).click();
  const reason = "Disposable transport disruption before arrival";
  await employee.page.getByLabel("Expected arrival in (minutes)").fill("30");
  await employee.page.getByLabel("Reason for delay").fill(reason);
  const submitted = employee.page.waitForResponse(
    (response) =>
      response.url().endsWith("/attendance/delays") && response.request().method() === "POST",
  );
  await employee.page.getByRole("button", { name: "Send delay request" }).click();
  const result = await submitted;
  expect(result.status()).toBe(201);
  await expect(
    employee.page.getByText("Delay request recorded. You must still clock in when you arrive."),
  ).toBeVisible();
  const body = (await result.json()) as { id: string };
  const duplicate = await employee.context.request.post("/api/seramet/attendance/delays", {
    headers: headers(fixture.staff.chef!),
    data: result.request().postDataJSON(),
  });
  expect(duplicate.status()).toBe(200);
  await supervisor.page.goto("/attendance");
  await expect(supervisor.page.getByText(reason, { exact: true })).toBeVisible();
  await supervisor.page.getByRole("button", { name: "Review delay", exact: true }).click();
  await supervisor.page
    .getByLabel("Supervisor response")
    .fill("Approved; clock in when you arrive.");
  await supervisor.page.getByRole("button", { name: "Approve delay", exact: true }).click();
  await expect(
    supervisor.page.getByText("Decision recorded. Actual attendance is unchanged."),
  ).toBeVisible();
  await employee.page.reload();
  await expect(employee.page.getByText("APPROVED", { exact: true })).toBeVisible();
  const attendance = await employee.context.request.get(
    `/api/seramet/attendance?branchId=${fixture.firstBranchId}`,
    { headers: headers(fixture.staff.chef!) },
  );
  expect((await attendance.json()).me).toBeNull();
  const denied = await employee.context.request.post(
    `/api/seramet/attendance/delays/${body.id}/decision`,
    {
      headers: headers(fixture.staff.chef!),
      data: {
        branchId: fixture.firstBranchId,
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
        status: "APPROVED",
        note: "Attempt self approval",
      },
    },
  );
  expect(denied.status()).toBe(403);
  expect(
    await employee.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await mkdir(".seramet/staff-acceptance", { recursive: true });
  await employee.page.screenshot({
    path: ".seramet/staff-acceptance/attendance-phone.png",
    fullPage: true,
  });
  await employee.context.close();
  await supervisor.context.close();
});
test("phone cashier gets order-only views and cannot submit sales commands or read another branch", async ({
  browser,
}) => {
  const cashier = await session(browser, fixture.staff.cashier!);
  await cashier.page.goto("/orders");
  await expect(
    cashier.page.getByText(
      "Read-only account access. Sales and payments require an enrolled sales terminal.",
    ),
  ).toBeVisible();
  const snapshot = await cashier.context.request.get("/api/seramet/transactions", {
    headers: headers(fixture.staff.cashier!),
  });
  const data = await snapshot.json();
  expect(data.state.bills).toEqual([]);
  expect(data.state.payments).toEqual([]);
  expect(data.state.journalEntries).toEqual([]);
  for (const action of [
    "createOrder",
    "sendToKitchen",
    "prepareInvoiceForPayment",
    "recordCashPayment",
  ]) {
    const denied = await cashier.context.request.post("/api/seramet/transactions/mutate", {
      headers: headers(fixture.staff.cashier!),
      data: {
        action,
        payload: { branch: fixture.firstBranchId },
        idempotencyKey: crypto.randomUUID(),
        expectedRevision: data.revision,
      },
    });
    expect(denied.status(), action).toBe(403);
  }
  const branch = await cashier.context.request.get(
    `/api/seramet/transactions?branchId=${fixture.secondBranchId}`,
    { headers: headers(fixture.staff.cashier!) },
  );
  expect(branch.status()).toBe(403);
  await cashier.page.goto("/pos");
  await expect(cashier.page.getByRole("button", { name: "Hold", exact: true })).toHaveCount(0);
  await cashier.context.close();
});
test("staff invitation setup clears URL credentials and waits for acknowledgement", async ({
  page,
}) => {
  const token = "disposable-provider-token-never-persisted";
  await page.route("**/api/seramet/public/auth/accept-invitation", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      accessToken: token,
      password: "Disposable-password-672!",
    });
    await route.fulfill({ json: { ok: true, reauthenticationRequired: true } });
  });
  await page.goto(
    `/staff-login?invitation=${crypto.randomUUID()}#access_token=${token}&refresh_token=disposable-refresh`,
  );
  await expect(page.getByRole("heading", { name: "Activate staff account" })).toBeVisible();
  await expect(page).not.toHaveURL(/access_token|refresh_token/);
  await page.getByLabel("New password", { exact: true }).fill("Disposable-password-672!");
  await page.getByLabel("Confirm password", { exact: true }).fill("Disposable-password-672!");
  await page.getByRole("button", { name: "Activate account", exact: true }).click();
  await expect(
    page.getByText("Account activated. Sign in with your email and new password."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (value) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(value),
      token,
    ),
  ).toBe(false);
});

test("assigned staff roles read the cookbook and stock requests without gaining purchasing approval", async ({
  browser,
}) => {
  for (const key of ["chef", "headChef", "bartender"]) {
    const staff = fixture.staff[key]!;
    const current = await session(browser, staff);
    try {
      const library = await current.context.request.get(
        `/api/seramet/cookbook/library?branchId=${fixture.firstBranchId}`,
        {
          headers: headers(staff),
        },
      );
      expect(library.status(), `${key} cookbook`).toBe(200);
      const workspace = await current.context.request.get(
        `/api/seramet/procurement/requisition-workspace?branchId=${fixture.firstBranchId}`,
        { headers: headers(staff) },
      );
      expect(workspace.status(), `${key} stock requests`).toBe(key === "chef" ? 403 : 200);
      if (key !== "chef") {
        const data = await workspace.json();
        expect(Array.isArray(data.items)).toBe(true);
        expect(Array.isArray(data.requests)).toBe(true);
        await current.page.goto("/requisitions");
        await expect(
          current.page.getByText("Request replenishment", { exact: true }),
        ).toBeVisible();
        expect(
          await current.page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      }
      const approval = await current.context.request.post(
        `/api/seramet/procurement/requisitions/${crypto.randomUUID()}/approve`,
        {
          headers: headers(staff),
          data: { reason: "Disposable unauthorized purchasing approval" },
        },
      );
      expect(approval.status(), `${key} cannot approve purchases`).toBe(403);
    } finally {
      await current.context.close();
    }
  }
});
