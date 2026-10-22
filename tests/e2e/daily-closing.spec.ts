import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet/e2e-fixture.json"), "utf8"),
) as { tenantId: string; userId: string; secondBranchId: string };
test("supervisor confirms one combined close, downloads the snapshot and retains mobile layout", async ({
  page,
}) => {
  const branchId = fixture.secondBranchId;
  await page.route("**/api/seramet/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-seramet-dev-auth": "enabled",
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-user-id": fixture.userId,
        "x-seramet-branch-id": branchId,
      },
    }),
  );
  await page.goto("/login?account=1");
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
    { ...fixture, branchId },
  );
  await page.goto("/payment-control");
  await expect(page.getByRole("heading", { name: "Payment Control Centre" })).toBeVisible();
  const opened = await page.evaluate(
    async ({ tenantId, userId, branchId }) => {
      const current = await (await fetch("/api/seramet/transactions")).json();
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          idempotencyKey,
          expectedRevision: current.revision,
          action: "openPaymentDrawer",
          payload: {
            input: {
              tenantId,
              branchId,
              employeeId: userId,
              openingFloatMinor: 10000,
              currency: "KES",
              actor: userId,
            },
          },
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(body));
      return body.state.paymentOperations.drawerSessions[0].id as string;
    },
    { ...fixture, branchId },
  );
  await page.reload();
  await page.getByRole("button", { name: "Daily closing", exact: true }).click();
  const close = page.getByRole("button", { name: "Close Business Day", exact: true });
  await expect(close).toBeEnabled();
  await close.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const before = await page.evaluate(
    async () =>
      (await (await fetch("/api/seramet/transactions")).json()).state.paymentOperations.dayCloses,
  );
  expect(before.filter((day: { status: string }) => day.status === "CLOSED")).toHaveLength(0);
  await close.click();
  await dialog.getByLabel(`Counted KES ${opened}`).fill("100.00");
  await dialog.getByRole("button", { name: "Review confirmation", exact: true }).click();
  await expect(dialog.getByText(/snapshot will be immutable/)).toBeVisible();
  await mkdir(resolve(".seramet/daily-closing"), { recursive: true });
  await page.screenshot({
    path: resolve(".seramet/daily-closing/confirmation-desktop.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Confirm & Close Business Day", exact: true }).click();
  try {
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByText("Business day closed. The immutable report is available below."),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    const report = await download;
    expect(report.suggestedFilename()).toMatch(/daily-closing.*\.pdf/);
    await report.saveAs(resolve(".seramet/daily-closing/disposable-report.pdf"));
    await page.setViewportSize({ width: 390, height: 844 });
    const region = page.getByRole("region", { name: "Daily closing" });
    await expect(region).toBeVisible();
    expect(await region.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: resolve(".seramet/daily-closing/closed-mobile.png"),
      fullPage: true,
    });
    const stored = await page.evaluate(
      async () => (await (await fetch("/api/seramet/transactions")).json()).state.paymentOperations,
    );
    expect(stored.drawerSessions.find((d: { id: string }) => d.id === opened).status).toBe(
      "CLOSED",
    );
    const prior = before.find((day: { branchId: string }) => day.branchId === branchId);
    const closed = stored.dayCloses.find((day: { branchId: string }) => day.branchId === branchId);
    expect(closed.snapshots).toHaveLength((prior?.snapshots.length ?? 0) + 1);
    expect(closed.snapshots.slice(0, -1)).toEqual(prior?.snapshots ?? []);
  } finally {
    // Restore only the disposable fixture's trading state for other suites; no live data is used.
    const reopened = await page.evaluate(async (branchId) => {
      const current = await (await fetch("/api/seramet/transactions")).json();
      const day = current.state.paymentOperations.dayCloses.find(
        (row: { branchId: string; status: string }) =>
          row.branchId === branchId && row.status === "CLOSED",
      );
      if (!day) return 200;
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch("/api/seramet/transactions/mutate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          idempotencyKey,
          expectedRevision: current.revision,
          action: "reopenDay",
          payload: { dayCloseId: day.id, reason: "Disposable browser fixture cleanup" },
        }),
      });
      return response.status;
    }, branchId);
    expect(reopened).toBe(200);
  }
});
