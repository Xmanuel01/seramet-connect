import { test, expect } from "@playwright/test";
import { openCashier, recordTrace } from "./pos-stability-helpers";

test("15 real minutes online have no unexpected navigation, remount or idle replay", async ({
  context,
  page,
}) => {
  test.setTimeout(20 * 60_000);
  await openCashier(context, page);
  let navigations = 0,
    replays = 0,
    sessionChecks = 0,
    fullSnapshots = 0,
    revisionChecks = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  page.on("request", (request) => {
    const path = new URL(request.url());
    if (path.pathname === "/api/seramet/offline/sync") replays++;
    if (path.pathname === "/api/seramet/auth/session") sessionChecks++;
    if (path.pathname === "/api/seramet/transactions") {
      if (path.searchParams.has("knownRevision")) revisionChecks++;
      else fullSnapshots++;
    }
  });
  const started = Date.now();
  for (let minute = 0; minute < 15; minute++) {
    await page.waitForTimeout(60_000);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByPlaceholder("Item note")).toHaveValue(
      "No onion - preserve cashier work",
    );
    await expect(page.getByLabel("Connection: Online")).toBeVisible();
    await expect(page.getByText("Saving", { exact: true })).not.toBeVisible();
  }
  const elapsedMs = Date.now() - started;
  const trace = await recordTrace(page, "15-minute-soak", {
    elapsedMs,
    navigations,
    replays,
    sessionChecks,
    fullSnapshots,
    revisionChecks,
  });
  expect(elapsedMs).toBeGreaterThanOrEqual(900_000);
  expect(navigations).toBe(0);
  expect(replays).toBe(0);
  expect(fullSnapshots).toBe(0);
  expect(sessionChecks).toBeGreaterThanOrEqual(10);
  expect(sessionChecks).toBeLessThanOrEqual(32);
  expect(
    new Set(trace.filter((event) => event.kind === "POS_MOUNT").map((event) => event.correlationId))
      .size,
  ).toBe(1);
  expect(
    trace.filter(
      (event) =>
        event.at >= started && ["POS_UNMOUNT", "APP_UNMOUNT", "PAGE_EXIT"].includes(event.kind),
    ),
  ).toHaveLength(0);
});
