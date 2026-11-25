import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = "http://127.0.0.1:4197";
const output = ".seramet/marketplace-walkthrough";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const created = await fetch(origin + "/api/seramet/integrations/preview-order", {
    method: "POST",
  });
  assert.equal(created.status, 200);
  const { reference } = await created.json();
  await page.goto(origin + "/preview-access");
  await page
    .getByText("Local simulation · sample orders · no marketplace requests")
    .waitFor({ timeout: 120_000 });
  await page.getByRole("cell", { name: reference, exact: true }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Notifications \(/ }).click();
  await page.getByText(/marketplace order\(s\) awaiting confirmation/).waitFor({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: output + "/orders-desktop.png", fullPage: true });
  const first = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: reference, exact: true }) });
  await first.getByRole("button").click();
  const accept = page.getByRole("button", { name: "Accept", exact: true });
  await accept.waitFor();
  {
    await page.getByLabel("Preparation minutes", { exact: true }).fill("20");
    await accept.click();
    await page.getByText("Acceptance queued. Awaiting marketplace confirmation.").waitFor();
    await page.getByText("Kitchen queued", { exact: true }).first().waitFor({ timeout: 40_000 });
  }
  await page.reload();
  await page.getByRole("cell", { name: reference, exact: true }).waitFor({ timeout: 60_000 });
  assert.ok(
    (
      await page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { name: reference, exact: true }) })
        .innerText()
    ).includes("Accepted"),
  );
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("combobox").first().selectOption("local-preview-uber");
  await page.getByRole("button", { name: "Review menu", exact: true }).click();
  await page.getByLabel("Unavailable for").selectOption("30");
  if (await page.getByRole("button", { name: "Restore item", exact: true }).count()) {
    await page.getByRole("button", { name: "Restore item", exact: true }).first().click();
    await page
      .getByText("Confirmed available", { exact: false })
      .first()
      .waitFor({ timeout: 40_000 });
  }
  await page.getByRole("button", { name: "Mark unavailable", exact: true }).first().click();
  await page
    .getByText("Confirmed unavailable", { exact: false })
    .first()
    .waitFor({ timeout: 40_000 });
  await page.screenshot({ path: output + "/menu-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText("Confirmed: paused", { exact: true }).waitFor({ timeout: 40_000 });
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("combobox").first().selectOption("local-preview-uber");
  await page.getByText("Confirmed: paused", { exact: true }).waitFor({ timeout: 40_000 });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByText("Confirmed: open", { exact: true }).waitFor({ timeout: 40_000 });
  await page.getByLabel("Pause starts", { exact: true }).selectOption("15");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText("Pause scheduled", { exact: true }).waitFor({ timeout: 40_000 });
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("combobox").first().selectOption("local-preview-uber");
  await page.getByText("Pause scheduled", { exact: true }).waitFor({ timeout: 40_000 });
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByText("Confirmed: open", { exact: true }).waitFor({ timeout: 40_000 });
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByRole("heading", { name: "Marketplace connections", exact: true }).waitFor();
  await page.screenshot({ path: output + "/connections-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Daily closing", exact: true }).click();
  await page.getByRole("heading", { name: "Marketplace closing", exact: true }).waitFor();
  await page.screenshot({ path: output + "/closing-desktop.png", fullPage: true });
  const rejectResponse = await fetch(origin + "/api/seramet/integrations/preview-order", {
    method: "POST",
  });
  assert.equal(rejectResponse.status, 200);
  const rejected = await rejectResponse.json();
  await page.reload();
  const rejectedRow = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: rejected.reference, exact: true }),
  });
  await rejectedRow.getByRole("button").click();
  await page
    .getByLabel("Rejection reason", { exact: true })
    .fill("Local verification: unavailable item");
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await page.getByText("Rejection queued. Awaiting marketplace confirmation.").waitFor();
  await page.getByRole("checkbox", { name: "All history" }).check();
  await page.waitForFunction(
    (reference) =>
      [...document.querySelectorAll("tr")].some(
        (row) => row.textContent.includes(reference) && row.textContent.includes("Rejected"),
      ),
    rejected.reference,
    { timeout: 40_000 },
  );
  await page.reload();
  await page.getByRole("checkbox", { name: "All history" }).check();
  await rejectedRow.waitFor();
  assert.ok((await rejectedRow.innerText()).includes("Rejected"));
  await page.getByRole("checkbox", { name: "All history" }).uncheck();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "Orders", exact: true }).click();
    if (width < 768)
      await page
        .getByRole("button", { name: /Review ORD-/ })
        .first()
        .waitFor();
    else await page.getByRole("cell", { name: "SAMPLE-1", exact: true }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    assert.equal(overflow, false, `Page overflow at ${width}px`);
    await page.screenshot({ path: output + `/orders-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: local accept/reject + reload, notification bell, availability, timed/scheduled pause + reload, reopen, connection/closing views, 390/768px layout",
  );
} finally {
  await browser.close();
}
