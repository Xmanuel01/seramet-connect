import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(readFileSync(resolve(".seramet/e2e-fixture.json"), "utf8")) as {
  tenantId: string;
  userId: string;
  firstBranchId: string;
  managerAccessToken: string;
};

test("attendance management views, corrections, exports and responsive layouts", async ({
  page,
  context,
}) => {
  if (process.env.SERAMET_E2E_BASE_URL || !fixture.tenantId.startsWith("e2e-"))
    throw new Error("Disposable local browser fixture required");
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
  await page.goto("/login");
  await page.evaluate((f) => {
    sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
    localStorage.setItem("seramet.session.tenant-id", f.tenantId);
    localStorage.setItem("seramet.session.user-id", f.userId);
    localStorage.setItem(
      "seramet.session.branch-scope.v2",
      JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
    );
  }, fixture);
  const date = "2026-11-06";
  const now = date + "T13:00:00Z";
  const employee = {
    id: fixture.userId,
    name: "Pilot manager",
    employee_code: "QA-001",
    scheduled_start: "09:00",
    scheduled_end: "17:00",
    rest_day: 0,
    schedule_version: 1,
  };
  const record = {
    id: "30bdc65e-201b-4674-8419-de926e705001",
    employeeId: employee.id,
    employeeName: employee.name,
    branchId: fixture.firstBranchId,
    businessDate: date,
    clockInAt: date + "T06:00:00Z",
    clockOutAt: null,
    minutesLate: 0,
    clockInSource: "GEOFENCE",
    clockOutSource: null,
    version: 1,
    workedMinutes: null,
    scheduledMinutes: 480,
    earlyDepartureMinutes: null,
    overtimeMinutes: null,
    missingClockOut: false,
  };
  let corrections = 0;
  await page.route("**/api/seramet/attendance**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/delays")) {
      await route.fallback();
      return;
    }
    if (url.pathname.endsWith("/export")) {
      await route.fallback();
      return;
    }
    if (url.pathname.endsWith("/supervisor")) {
      const body = route.request().postDataJSON();
      expect(body).toMatchObject({
        employeeId: employee.id,
        sessionId: record.id,
        expectedVersion: 1,
        action: "EXPLAIN",
        reason: "Verified arrival with shift manager",
      });
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      corrections += 1;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    if (url.pathname.endsWith("/records")) {
      await route.fulfill({
        json: {
          records: [record],
          hasMore: false,
          serverNow: now,
          summary: {
            workedMinutes: 420,
            overtimeMinutes: 0,
            unassessedDays: 0,
            late: 0,
            missingClockOut: 0,
            sessions: 1,
          },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/history")) {
      await route.fulfill({
        json: {
          events: [
            {
              id: "audit-1",
              version: 1,
              type: "CLOCK_IN",
              reason: null,
              at: record.clockInAt,
              actor: employee.name,
              before_json: "{}",
              after_json: "{}",
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === "/api/seramet/attendance") {
      await route.fulfill({
        json: {
          ok: true,
          branchId: fixture.firstBranchId,
          branchTimezone: "Africa/Nairobi",
          businessDate: date,
          serverNow: now,
          me: record,
          myWeek: [record],
          mySchedule: employee,
          openElsewhere: false,
          canManage: true,
          canConfigure: true,
          tillClock: false,
          employees: [employee],
          records: [record],
          summary: {
            recorded: 1,
            working: 1,
            completed: 0,
            late: 0,
            not_recorded: 0,
            total: 1,
            exceptions: 0,
          },
          geofence: {
            enabled: true,
            latitude: -1.264,
            longitude: 36.806,
            radiusMeters: 100,
            maxAccuracyMeters: 100,
            maxFixAgeSeconds: 60,
            graceMinutes: 5,
            version: 1,
          },
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { message: "Unexpected test attendance request" } });
  });
  await page.goto("/attendance");
  const clock = page.getByRole("region", { name: "My attendance" });
  await expect(clock.getByRole("button", { name: "Clock out", exact: true })).toBeVisible();
  await expect(clock.getByLabel("Active shift duration")).toHaveText(/07:00:0\d/);
  const before = await clock.getByLabel("Active shift duration").textContent();
  await expect.poll(() => clock.getByLabel("Active shift duration").textContent()).not.toBe(before);
  await expect(page.getByText(/Start Break|End Break|Switch Job/)).toHaveCount(0);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.screenshot({ path: test.info().outputPath(`clock-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.goto("/schedule");
  await expect(page.getByRole("tab", { name: "Workday", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByText(employee.name, { exact: true }).last()).toBeVisible();
  for (const view of ["Workday", "Timecards", "Reports", "Settings"]) {
    await page.getByRole("tab", { name: view, exact: true }).click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.screenshot({
        path: test.info().outputPath(`${view.toLowerCase()}-${width}.png`),
        fullPage: true,
      });
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        containers: [...document.querySelectorAll("html,body,main,.overflow-x-auto")].map(
          (element) => ({
            tag: element.tagName,
            class: element.className,
            width: element.clientWidth,
            scroll: element.scrollWidth,
            overflow: getComputedStyle(element).overflowX,
            right: element.getBoundingClientRect().right,
          }),
        ),
        offenders: [...document.querySelectorAll("body *")]
          .filter(
            (element) =>
              element.getBoundingClientRect().right > innerWidth + 1 &&
              !element.closest(".overflow-x-auto"),
          )
          .slice(0, 8)
          .map((element) => ({
            tag: element.tagName,
            class: element.className,
            right: element.getBoundingClientRect().right,
          })),
      }));
      expect(layout.document, JSON.stringify({ view, ...layout })).toBeLessThanOrEqual(
        layout.width,
      );
    }
  }
  await page.getByRole("tab", { name: "Timecards", exact: true }).click();
  await page.getByRole("button", { name: "View correction history", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Attendance change history" })).toContainText(
    "CLOCK IN",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Correct attendance", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "Attendance correction" });
  await correction
    .getByLabel("Reason for exception (required)")
    .fill("Verified arrival with shift manager");
  await correction.getByRole("button", { name: "Record exception", exact: true }).click();
  await expect(correction).toContainText("Attendance correction recorded.");
  expect(corrections).toBe(1);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Reports", exact: true }).click();
  for (const format of ["CSV", "PDF"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: format, exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
  }
});
