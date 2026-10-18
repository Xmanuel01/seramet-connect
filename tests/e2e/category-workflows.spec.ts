import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fixture } from "./pos-stability-helpers";

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback category acceptance only");
});
const headers = {
  authorization: `Bearer ${fixture.managerAccessToken}`,
  "x-seramet-tenant-id": fixture.tenantId,
  "x-seramet-branch-id": fixture.firstBranchId,
};
async function signIn(context: BrowserContext, page: Page) {
  await context.route("**/api/seramet/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
  await page.goto("/login?account=1");
  await page.evaluate((f) => {
    sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
    localStorage.setItem("seramet.session.tenant-id", f.tenantId);
    localStorage.setItem("seramet.session.user-id", f.userId);
    localStorage.setItem(
      "seramet.session.branch-scope.v2",
      JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
    );
  }, fixture);
}

test("Sales through Finance routes load without page exceptions or API 5xx", async ({
  context,
  page,
}) => {
  test.setTimeout(600_000);
  await signIn(context, page);
  const nav = readFileSync("src/components/app/nav.ts", "utf8").split('group: "Accounting"')[0]!;
  const paths = [...new Set([...nav.matchAll(/to: "([^"]+)"/g)].map((match) => match[1]!))];
  const results: { path: string; errors: string[]; failures: string[]; crash: boolean }[] = [];
  for (const path of paths) {
    const errors: string[] = [],
      failures: string[] = [];
    const pending = new Set<import("@playwright/test").Request>();
    const onError = (error: Error) => errors.push(error.message.slice(0, 160));
    const onRequest = (request: import("@playwright/test").Request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/seramet/") && !/events|realtime|health/.test(url.pathname))
        pending.add(request);
    };
    const onFinished = (request: import("@playwright/test").Request) => pending.delete(request);
    const onResponse = (response: import("@playwright/test").Response) => {
      if (response.status() >= 500 && new URL(response.url()).pathname.startsWith("/api/seramet/"))
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    };
    page.on("pageerror", onError);
    page.on("request", onRequest);
    page.on("requestfinished", onFinished);
    page.on("requestfailed", onFinished);
    page.on("response", onResponse);
    let crash = false;
    try {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      await expect.poll(() => pending.size).toBe(0);
      crash = await page.getByText("This page didn't load", { exact: true }).isVisible();
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message.slice(0, 180) : "Route did not load");
    } finally {
      results.push({ path, errors, failures, crash });
      page.off("pageerror", onError);
      page.off("request", onRequest);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFinished);
      page.off("response", onResponse);
    }
  }
  await mkdir(".seramet/category-acceptance", { recursive: true });
  await writeFile(
    ".seramet/category-acceptance/routes.json",
    JSON.stringify({ localUncommittedCandidate: true, results }, null, 2),
  );
  expect(results.filter((row) => row.crash || row.errors.length || row.failures.length)).toEqual(
    [],
  );
});

test("table setup feeds QR selection; generated QR opens a real guest session and revocation is enforced", async ({
  context,
  page,
  browser,
}) => {
  await signIn(context, page);
  await page.goto("/tables");
  await page.getByRole("button", { name: "Add table", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add a restaurant table" });
  await dialog.getByLabel("Table number").fill("QR-ACCEPTANCE");
  await dialog.getByLabel("Seats", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "Create table", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto("/qr-management");
  const tables = page.getByRole("combobox", { name: "Table", exact: true });
  await expect(tables.locator("option").filter({ hasText: "QR-ACCEPTANCE" })).toHaveCount(1);
  await tables.selectOption(
    (await tables.locator("option").filter({ hasText: "QR-ACCEPTANCE" }).getAttribute("value"))!,
  );
  await page.getByRole("combobox", { name: "Mode", exact: true }).selectOption("MENU_ONLY");
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith("/guest-admin/qr/rotate") && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Generate or rotate", exact: true }).click();
  const issuedResponse = await response;
  expect(issuedResponse.status()).toBe(201);
  const { qr } = await issuedResponse.json();
  const image = page.getByRole("img", { name: "Table QR-ACCEPTANCE QR code", exact: true });
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element: HTMLImageElement) => element.complete && element.naturalWidth > 0,
    ),
  ).toBe(true);
  const guest = await browser.newContext();
  try {
    const url = new URL(qr.guestPath, "http://127.0.0.1:4173");
    const sessionPath = `/api/seramet/guest/restaurants/${fixture.tenantId}/branch-a/sessions`;
    const opened = await guest.request.post(sessionPath, {
      data: { sessionType: "QR", qrToken: url.searchParams.get("qr") },
    });
    const body = await opened.json();
    expect(opened.status(), body.message ?? "QR guest session").toBe(201);
    expect(body.session.qrMode).toBe("MENU_ONLY");
    await page.getByRole("button", { name: "Disable", exact: true }).click();
    await expect(
      page.getByText("QR disabled. Scans of that code no longer open a guest session."),
    ).toBeVisible();
    expect(
      (
        await guest.request.post(sessionPath, {
          data: { sessionType: "QR", qrToken: url.searchParams.get("qr") },
        })
      ).status(),
    ).toBe(403);
  } finally {
    await guest.close();
  }
  const denied = await context.request.get(
    `/api/seramet/guest-admin/qr/tables?branchId=${fixture.firstBranchId}`,
    {
      headers: {
        ...headers,
        authorization: `Bearer ${fixture.restrictedAccessToken}`,
        "x-seramet-branch-id": fixture.secondBranchId,
      },
    },
  );
  expect(denied.status()).toBe(403);
});

test("inventory item, category and location controls save authoritative records", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  await page.goto("/categories");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  await page.getByLabel("Category name", { exact: true }).fill("Acceptance store category");
  await page.getByLabel("Code", { exact: true }).fill("ACCEPT-CAT");
  await page.getByRole("button", { name: "Create category", exact: true }).click();
  await expect(
    page.getByText("Inventory category created successfully.", { exact: true }),
  ).toBeVisible();
  await page.goto("/warehouses");
  await page.getByRole("button", { name: "New location", exact: true }).click();
  await page.getByLabel("Location name", { exact: true }).fill("Acceptance store");
  await page.getByLabel("Code", { exact: true }).fill("ACCEPT-STORE");
  await page.getByRole("button", { name: "Create location", exact: true }).click();
  await expect(page.getByText("Warehouse created.", { exact: true })).toBeVisible();
  await page.goto("/inventory-items");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await page.getByLabel("Item name", { exact: true }).fill("Acceptance store item");
  await page.getByLabel("Item code", { exact: true }).fill("ACCEPT-ITEM");
  const warehouse = page.getByRole("combobox", { name: "Default warehouse", exact: true });
  await warehouse.selectOption(
    (await warehouse
      .locator("option")
      .filter({ hasText: "Acceptance store" })
      .getAttribute("value"))!,
  );
  const category = page.getByRole("combobox", { name: "Category", exact: true });
  await category.selectOption(
    (await category
      .locator("option")
      .filter({ hasText: "Acceptance store category" })
      .getAttribute("value"))!,
  );
  await page.getByRole("button", { name: "Create item", exact: true }).click();
  await expect(
    page.getByText("Inventory item created successfully.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "Acceptance store item", exact: true }),
  ).toBeVisible();
  const response = await context.request.get(
    `/api/seramet/inventory/items?branchId=${fixture.firstBranchId}&limit=100`,
    { headers },
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.items.some((row: { code: string }) => row.code === "ACCEPT-ITEM")).toBe(true);
});

test("requisition export downloads authorized server rows and requested quantities", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  const post = async (path: string, data: unknown) => {
    const response = await context.request.post(`/api/seramet/${path}`, { headers, data });
    const body = await response.json();
    expect(response.ok(), body.message ?? path).toBe(true);
    return body;
  };
  const { warehouse } = await post("inventory/warehouses", {
    branchId: fixture.firstBranchId,
    name: "Export store",
    code: `EXP-${randomUUID().slice(0, 8)}`,
    locationType: "MAIN",
  });
  const { units } = await (
    await context.request.get("/api/seramet/inventory/units", { headers })
  ).json();
  const kg = units.find((row: { symbol: string }) => row.symbol === "kg");
  expect(kg).toBeTruthy();
  const { item } = await post("inventory/items", {
    name: "Rice",
    code: `EXP-RICE-${randomUUID().slice(0, 8)}`,
    baseUnitId: kg.id,
    defaultWarehouseId: warehouse.id,
    trackInventory: true,
  });
  expect(item).toBeTruthy();
  const { requisition } = await post("procurement/requisitions", {
    branchId: fixture.firstBranchId,
    warehouseId: warehouse.id,
    sourceType: "MANUAL_REQUEST",
    lines: [{ inventoryItemId: item.id, requestedQuantityMicro: 2500000, unitId: kg.id }],
  });
  const { overview } = await (
    await context.request.get(
      `/api/seramet/procurement/overview?branchId=${fixture.firstBranchId}&limit=100`,
      { headers },
    )
  ).json();
  const expected = overview.requisitions.find((row: { id: string }) => row.id === requisition.id);
  expect(expected).toBeTruthy();
  await page.goto("/requisitions");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export requests", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain("seramet-requisitions-");
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv).toContain(expected.requisition_number);
  expect(csv).toContain('"Rice","2.5","kg"');
});

test("cookbook scales portions and a rice anchor without changing the stored recipe", async ({
  context,
  page,
}) => {
  await signIn(context, page);
  const path = `/api/seramet/cookbook/library?branchId=${fixture.firstBranchId}`;
  const before = await (await context.request.get(path, { headers })).json();
  await page.goto("/cookbook");
  await page.getByRole("button", { name: /Acceptance Rice/ }).click();
  const scaling = page.getByRole("region", { name: "Ingredient scaling" });
  await scaling.getByLabel(/Target portions/).fill("50");
  await expect(scaling.getByRole("row").filter({ hasText: "Rice" })).toContainText("4 kg");
  await scaling.getByLabel("Ingredient amount", { exact: true }).check();
  const ingredients = scaling.getByRole("combobox", { name: "Base ingredient", exact: true });
  const rice = ingredients.locator("option").filter({ hasText: /^Rice / });
  await expect(rice).toHaveCount(1);
  await ingredients.selectOption((await rice.getAttribute("value"))!);
  await scaling.getByLabel(/Target ingredient amount/).fill("3");
  await expect(scaling).toContainText("Scaled yield: 37.5");
  await expect(scaling.getByRole("row").filter({ hasText: "Rice" })).toContainText("3 kg");
  await page.getByRole("button", { name: /Acceptance Breakfast/ }).click();
  await scaling.getByLabel(/Target portions/).fill("2");
  await expect(scaling.getByRole("row").filter({ hasText: "Bread" })).toContainText("4 slice");
  const after = await (await context.request.get(path, { headers })).json();
  expect(after.library.recipes).toEqual(before.library.recipes);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(".seramet/category-acceptance", { recursive: true });
  await page.screenshot({
    path: ".seramet/category-acceptance/cookbook-phone.png",
    fullPage: true,
  });
});
