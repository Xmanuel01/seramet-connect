import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "./pos-stability-helpers";

// Disposable local acceptance for store issues: a chef asks for items, the manager approves and
// issues them, stock and the COGS ledger move once; a chef records items taken, the manager
// rejects it and the stock comes back.
const suffix = randomUUID().slice(0, 8).toUpperCase();
const warehouseId = `e2e-store-${suffix}`;
const itemId = `e2e-item-flour-${suffix}`;
const KG = 1_000_000;

test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback store issue acceptance only");
  const db = new DatabaseSync(resolve(".seramet", "development.sqlite"));
  try {
    const t = fixture.tenantId;
    const stamp = new Date().toISOString();
    for (const [id, type] of [
      ["inventory", "ASSET"],
      ["cogs", "COGS"],
      ["waste", "EXPENSE"],
      ["variance", "EXPENSE"],
      ["payable", "LIABILITY"],
      ["opening", "EQUITY"],
    ])
      db.prepare(
        `INSERT INTO accounts (tenant_id,id,code,name,account_type,currency,active,payload_json)
         VALUES (?,?,?,?,?,'KES',1,'{}') ON CONFLICT DO NOTHING`,
      ).run(t, `e2e-si-${id}`, `SI-${id.toUpperCase()}`, `Store issue ${id}`, type);
    db.prepare(
      `INSERT INTO inventory_account_mappings
        (tenant_id,id,inventory_account_id,opening_balance_account_id,accounts_payable_account_id,
         cogs_account_id,wastage_account_id,variance_account_id,accounting_mode,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,'PERPETUAL',1,?,?) ON CONFLICT DO NOTHING`,
    ).run(
      t,
      "e2e-si-mapping",
      "e2e-si-inventory",
      "e2e-si-opening",
      "e2e-si-payable",
      "e2e-si-cogs",
      "e2e-si-waste",
      "e2e-si-variance",
      stamp,
      stamp,
    );
    db.prepare(
      `INSERT INTO warehouses (tenant_id,id,branch_id,code,name,active,payload_json,location_type,created_at,updated_at)
       VALUES (?,?,?,?,?,1,'{}','MAIN',?,?)`,
    ).run(t, warehouseId, fixture.firstBranchId, `SI-${suffix}`, `Dry store ${suffix}`, stamp, stamp);
    const unit = db
      .prepare(`SELECT id FROM unit_definitions WHERE tenant_id=? AND symbol='kg' LIMIT 1`)
      .get(t) as { id: string } | undefined;
    const unitId = unit?.id ?? `e2e-unit-kg-${suffix}`;
    if (!unit)
      db.prepare(
        `INSERT INTO unit_definitions (tenant_id,id,code,name,symbol,dimension,base_scale_numerator,base_scale_denominator,active,created_at,updated_at)
         VALUES (?,?,?,?,?,'MASS',1,1,1,?,?)`,
      ).run(t, unitId, `KG-${suffix}`, "Kilogram", "kg", stamp, stamp);
    db.prepare(
      `INSERT INTO inventory_items (tenant_id,id,sku,name,unit,active,payload_json,code,base_unit_id,purchase_unit_id,default_warehouse_id)
       VALUES (?,?,?,?,'kg',1,'{}',?,?,?,?)`,
    ).run(t, itemId, `FLOUR-${suffix}`, `Flour ${suffix}`, `FLOUR-${suffix}`, unitId, unitId, warehouseId);
    // 20 kg at 150.00/kg.
    db.prepare(
      `INSERT INTO inventory_movements
        (tenant_id,id,branch_id,warehouse_id,item_id,movement_type,quantity_minor,source_type,source_id,
         idempotency_key,correlation_id,payload_json,created_at,unit_cost_minor,total_cost_minor,
         business_date,occurred_at,actor_id,negative_override)
       VALUES (?,?,?,?,?,'OPENING',?,'OPENING',?,?,?,'{}',?,15000,300000,?,?,'system:e2e',0)`,
    ).run(
      t,
      `e2e-si-opening-${suffix}`,
      fixture.firstBranchId,
      warehouseId,
      itemId,
      20 * KG,
      `e2e-si-opening-${suffix}`,
      `e2e-si-opening-${suffix}`,
      randomUUID(),
      stamp,
      stamp.slice(0, 10),
      stamp,
    );
  } finally {
    db.close();
  }
});

function onHand() {
  const db = new DatabaseSync(resolve(".seramet", "development.sqlite"));
  try {
    return db
      .prepare(
        `SELECT quantity_minor FROM inventory_balances WHERE tenant_id=? AND warehouse_id=? AND item_id=?`,
      )
      .get(fixture.tenantId, warehouseId, itemId) as { quantity_minor: number };
  } finally {
    db.close();
  }
}

function cogs() {
  const db = new DatabaseSync(resolve(".seramet", "development.sqlite"));
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(debit_minor-credit_minor),0) AS balance FROM journal_lines
          WHERE tenant_id=? AND account_id='e2e-si-cogs'`,
      )
      .get(fixture.tenantId) as { balance: number };
    return Number(row.balance);
  } finally {
    db.close();
  }
}

async function signInAs(context: BrowserContext, page: Page, token: string, userId: string) {
  await context.route("**/api/seramet/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${token}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-branch-id": fixture.firstBranchId,
      },
    }),
  );
  await page.goto("/login?account=1");
  await page.evaluate(
    ({ f, user }) => {
      sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
      localStorage.setItem("seramet.session.tenant-id", f.tenantId);
      localStorage.setItem("seramet.session.user-id", user);
      localStorage.setItem(
        "seramet.session.branch-scope.v2",
        JSON.stringify({ type: "BRANCH", branchId: f.firstBranchId }),
      );
    },
    { f: fixture, user: userId },
  );
}

async function fillIssueForm(page: Page, quantity: string, reason: string) {
  await page.getByLabel("From store").selectOption({ label: `Dry store ${suffix}` });
  await page.getByLabel("For department").selectOption({ label: "Kitchen" });
  await page.getByLabel("Reason").fill(reason);
  await page.getByLabel("Item").selectOption({ value: itemId });
  await page.getByLabel(/^Quantity/).fill(quantity);
}

test("a chef requests items, the manager issues them and stock and COGS move once", async ({
  browser,
}) => {
  const chef = fixture.staff.chef as { id: string; token: string };
  const chefContext = await browser.newContext();
  const chefPage = await chefContext.newPage();
  await signInAs(chefContext, chefPage, chef.token, chef.id);
  await chefPage.goto("/store-issues");
  await chefPage.getByRole("button", { name: "Request items", exact: true }).click();
  await fillIssueForm(chefPage, "4", `Bread ${suffix}`);
  await chefPage.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(chefPage.getByText("Request sent.")).toBeVisible();
  const chefRow = chefPage.getByRole("row", { name: new RegExp(`Bread ${suffix}`) });
  await expect(chefRow.getByText("Awaiting approval")).toBeVisible();
  // A chef cannot approve or issue.
  await expect(chefRow.getByRole("button", { name: "Issue" })).toHaveCount(0);
  expect(onHand().quantity_minor).toBe(20 * KG);
  await chefContext.close();

  const managerContext = await browser.newContext();
  const page = await managerContext.newPage();
  await signInAs(managerContext, page, fixture.managerAccessToken, fixture.userId);
  const cogsBefore = cogs();
  await page.goto("/store-issues");
  const row = page.getByRole("row", { name: new RegExp(`Bread ${suffix}`) });
  await row.getByRole("button", { name: "Issue", exact: true }).click();
  await page.getByLabel(`Flour ${suffix} quantity`).fill("3");
  await page.getByRole("button", { name: "Issue items", exact: true }).click();
  await expect(page.getByText("Items issued.")).toBeVisible();
  await page.getByRole("tab", { name: /History/ }).click();
  await expect(
    page.getByRole("row", { name: new RegExp(`Bread ${suffix}`) }).getByText("Issued"),
  ).toBeVisible();
  // 3 kg x 150.00 = 450.00
  expect(onHand().quantity_minor).toBe(17 * KG);
  expect(cogs() - cogsBefore).toBe(45_000);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/store-issues-history-mobile.png", fullPage: true });
  await managerContext.close();
});

test("a chef records items taken; rejecting it on review puts the stock back", async ({
  browser,
}) => {
  const chef = fixture.staff.chef as { id: string; token: string };
  const chefContext = await browser.newContext();
  const chefPage = await chefContext.newPage();
  await signInAs(chefContext, chefPage, chef.token, chef.id);
  const before = onHand().quantity_minor;
  await chefPage.goto("/store-issues");
  await chefPage.getByRole("button", { name: "Record items taken", exact: true }).click();
  await fillIssueForm(chefPage, "2", `Taken ${suffix}`);
  await chefPage.getByRole("button", { name: "Record items taken" }).last().click();
  await expect(chefPage.getByText("Recorded. Stock has been reduced")).toBeVisible();
  expect(onHand().quantity_minor).toBe(before - 2 * KG);
  await chefContext.close();

  const managerContext = await browser.newContext();
  const page = await managerContext.newPage();
  await signInAs(managerContext, page, fixture.managerAccessToken, fixture.userId);
  await page.goto("/store-issues");
  const row = page.getByRole("row", { name: new RegExp(`Taken ${suffix}`) });
  await expect(row.getByText("Taken - to review")).toBeVisible();
  await row.getByRole("button", { name: "Reject", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Not taken - counted again");
  await dialog.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Rejected. The stock is back")).toBeVisible();
  expect(onHand().quantity_minor).toBe(before);
  await page.screenshot({ path: "test-results/store-issues-desktop.png", fullPage: true });
  await managerContext.close();
});
