import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { TransactionState } from "../../src/lib/transaction-engine";

const fixture = JSON.parse(readFileSync(".seramet/e2e-fixture.json", "utf8"));
const setup = JSON.parse(readFileSync(".seramet/printing-operational-fixture.json", "utf8"));
const scenario = Number(process.env.SERAMET_AUDIT_SCENARIO ?? "1");
const directory = resolve(`.seramet/site-audit/scenario-${scenario}`);
const branchId = scenario === 5 ? fixture.secondBranchId : fixture.firstBranchId;
const origin = "http://127.0.0.1:4173";

test.beforeAll(async () => {
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId) ||
    !Number.isInteger(scenario) ||
    scenario < 1 ||
    scenario > 6
  )
    throw new Error("Disposable loopback audit only");
  await mkdir(directory, { recursive: true });
});

test("all navigation pages and Sales tabs: desktop/mobile audit", async ({ browser }) => {
  test.skip(scenario !== 1, "Page inventory is exercised once on the unchanged candidate");
  test.setTimeout(600000);
  const context = await browser.newContext();
  await context.route("**/api/seramet/**", (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        authorization: `Bearer ${fixture.managerAccessToken}`,
        "x-seramet-tenant-id": fixture.tenantId,
        "x-seramet-branch-id": branchId,
      },
    }),
  );
  const page = await context.newPage();
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
  const nav = readFileSync("src/components/app/nav.ts", "utf8");
  const paths = [...new Set([...nav.matchAll(/to: "([^"]+)"/g)].map((m) => m[1]))];
  const sales = new Set([
    "/pos",
    "/orders",
    "/online-orders",
    "/marketplace",
    "/tables",
    "/invoices",
    "/pending",
    "/receipts",
    "/host",
    "/qr-management",
    "/returns",
    "/refunds",
    "/delivery",
    "/riders",
  ]);
  const results: Array<Record<string, unknown>> = [];
  for (const path of paths) {
    const errors: string[] = [];
    const failures: string[] = [];
    const onError = (error: Error) => errors.push(error.name + ": " + error.message.slice(0, 200));
    const onResponse = (response: import("@playwright/test").Response) => {
      if (response.status() >= 500)
        failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    };
    page.on("pageerror", onError);
    page.on("response", onResponse);
    try {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      await expect(page.locator("main")).toBeVisible();
      const crash = await page.getByText("This page didn't load", { exact: true }).isVisible();
      const title = await page.title();
      const controls = await page.locator("main button").evaluateAll((buttons) =>
        buttons.map((button) => ({
          label: button.textContent?.trim(),
          disabled: (button as HTMLButtonElement).disabled,
        })),
      );
      const tabs: string[] = [];
      if (sales.has(path)) {
        for (const tab of await page.getByRole("tab").all()) {
          if (await tab.isEnabled()) {
            tabs.push(await tab.innerText());
            await tab.click();
          }
        }
        if (path === "/returns") {
          const button = page.getByRole("button", { name: "Log return", exact: true });
          if (await button.isEnabled()) {
            const before = await page.locator("main").innerText();
            await button.click();
            results.push({
              path,
              probe: "Log return",
              visibleChange: before !== (await page.locator("main").innerText()),
              dialogs: await page.getByRole("dialog").count(),
            });
          }
        }
        await page.screenshot({
          path: resolve(directory, `${path.slice(1) || "dashboard"}-desktop.png`),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        await page.screenshot({
          path: resolve(directory, `${path.slice(1) || "dashboard"}-mobile.png`),
          fullPage: true,
        });
        results.push({
          path,
          title,
          crash,
          errors: [...errors],
          failures: [...failures],
          overflow,
          tabs,
          controls,
        });
      } else results.push({ path, title, crash, errors: [...errors], failures: [...failures] });
    } catch (error) {
      results.push({
        path,
        failed: error instanceof Error ? error.message.slice(0, 350) : "Audit failed",
        errors,
        failures,
      });
    } finally {
      page.off("pageerror", onError);
      page.off("response", onResponse);
      await writeFile(
        resolve(directory, "pages.json"),
        JSON.stringify(
          {
            commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            results,
          },
          null,
          2,
        ),
      );
      console.info(`AUDIT ${path}: ${results.at(-1)?.failed ? "BLOCKED" : "visited"}`);
    }
  }
  await writeFile(
    resolve(directory, "pages.json"),
    JSON.stringify(
      { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), results },
      null,
      2,
    ),
  );
  console.info(
    `AUDIT pages=${paths.length}; failures=${results.filter((r) => r.failed || r.crash).length}`,
  );
  expect(results.filter((result) => result.failed || result.crash)).toEqual([]);
  await context.close();
});

test("staff account creation through sale and supervisor business-day close", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const events: string[] = [];
  const admin = await browser.newContext();
  const staff = await browser.newContext();
  const headers = {
    authorization: `Bearer ${scenario === 5 ? fixture.secondBranchAccessToken : fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": branchId,
    "content-type": "application/json",
    origin,
  };
  await admin.route("**/api/seramet/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), ...headers } }),
  );
  const manager = await admin.newPage();
  const cashier = await staff.newPage();
  const api = async (path: string, data?: unknown) => {
    const response = await admin.request.fetch(`${origin}/api/seramet/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers,
      data,
    });
    const body = await response.json();
    if (!response.ok())
      throw new Error(
        `${path.split("/")[0]} HTTP ${response.status()}: ${body.message ?? body.code}`,
      );
    return body;
  };
  const snapshot = () =>
    api("transactions") as Promise<{ revision: number; state: TransactionState }>;
  const mutate = async (action: string, payload: unknown, idempotencyKey = randomUUID()) =>
    api("transactions/mutate", {
      action,
      payload,
      expectedRevision: (await snapshot()).revision,
      idempotencyKey,
    });
  const branchASnapshot = async () => {
    const response = await admin.request.get(`${origin}/api/seramet/transactions`, {
      headers: {
        ...headers,
        authorization: `Bearer ${fixture.managerAccessToken}`,
        "x-seramet-branch-id": fixture.firstBranchId,
      },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).state.orders as TransactionState["orders"];
  };
  let branchAControl: TransactionState["orders"] | undefined;
  const persistedBranchA = () => {
    const db = new DatabaseSync(resolve(".seramet/development.sqlite"), { readOnly: true });
    try {
      return db
        .prepare(
          "SELECT id,branch_id,status,total_minor,version,updated_at,payload_json FROM orders WHERE tenant_id=? AND branch_id=? ORDER BY id",
        )
        .all(fixture.tenantId, fixture.firstBranchId);
    } finally {
      db.close();
    }
  };
  let controlRows: ReturnType<typeof persistedBranchA> | undefined;
  let stage = "account creation";
  try {
    if (scenario === 5) {
      const aHeaders = {
        ...headers,
        authorization: `Bearer ${fixture.managerAccessToken}`,
        "x-seramet-branch-id": fixture.firstBranchId,
      };
      const before = await admin.request.get(`${origin}/api/seramet/transactions`, {
        headers: aHeaders,
      });
      const control = await admin.request.post(`${origin}/api/seramet/transactions/mutate`, {
        headers: aHeaders,
        data: {
          action: "upsertOrderDraft",
          expectedRevision: (await before.json()).revision,
          idempotencyKey: randomUUID(),
          payload: {
            targetStatus: "HELD",
            draft: {
              tenantId: fixture.tenantId,
              branchId: fixture.firstBranchId,
              branch: fixture.firstBranchId,
              customer: "Branch A isolation control",
              channel: "DINE_IN",
              cashier: fixture.userId,
              lines: [
                {
                  id: randomUUID(),
                  productId: fixture.menuItemId,
                  name: "Pilot meal",
                  category: "MAIN MEALS",
                  quantity: 1,
                  unitPrice: 1000,
                  productionStation: "MAIN",
                  itemNote: "Must remain unchanged during Branch B shift",
                },
              ],
            },
          },
        },
      });
      expect(control.ok()).toBe(true);
      branchAControl = await branchASnapshot();
      expect(branchAControl).toHaveLength(1);
      controlRows = persistedBranchA();
      expect(controlRows).toHaveLength(1);
    }
    const employeeCode = `AUD${randomUUID().slice(0, 8)}`;
    const pin = String(randomInt(234567, 876543));
    const employee = (
      await api("employees", {
        idempotencyKey: randomUUID(),
        fullName: `Audit cashier ${scenario}`,
        employeeCode,
        jobTitle: "Cashier",
        roleId: setup.roleId,
        assignedBranchIds: [branchId],
        primaryBranchId: branchId,
        pin,
        pinConfirmation: pin,
        effectiveFrom: new Date(Date.now() - 60000).toISOString(),
        temporaryPin: false,
      })
    ).employee;
    events.push(
      "Staff account created through authoritative employee API; owner identity is a seeded local test identity, not Supabase signup",
    );
    stage = "device activation and real PIN login";
    const device = (
      await api("devices/register", {
        branchId,
        deviceType: "POS_TERMINAL",
        name: `Audit terminal ${scenario}`,
      })
    ).device;
    await api(`devices/${device.id}/activate`, {});
    await staff.addCookies(
      (await admin.cookies()).filter((cookie) => cookie.name === "seramet_device"),
    );
    await cashier.goto("/pos-login");
    await cashier.getByLabel("Email or employee code").fill(employeeCode);
    for (const digit of pin)
      await cashier.getByRole("button", { name: digit, exact: true }).click();
    await cashier.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(cashier).toHaveURL(/\/pos$/);
    events.push("Device activation and employee code/PIN browser login succeeded");
    stage = "drawer opening";
    const opened = await mutate("openPaymentDrawer", {
      input: {
        tenantId: fixture.tenantId,
        branchId,
        employeeId: employee.id,
        openingFloatMinor: 10000,
        currency: "KES",
        deviceId: device.id,
        actor: employee.id,
      },
    });
    const drawer = opened.state.paymentOperations.drawerSessions.find(
      (d: { employeeId: string }) => d.employeeId === employee.id,
    );
    stage = "POS cart and Hold";
    await cashier.reload();
    await cashier.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
    await cashier.getByRole("button", { name: "Add Pilot meal to order", exact: true }).click();
    if (scenario === 3)
      await cashier.getByRole("button", { name: "Add Pilot meal", exact: true }).click();
    const note = `Simulation ${scenario}: no onion`;
    await cashier.getByPlaceholder("Item note").fill(note);
    if (scenario === 3) {
      await cashier.evaluate(() => {
        for (let n = 0; n < 30; n++)
          window.dispatchEvent(
            new CustomEvent("seramet:realtime", { detail: { id: crypto.randomUUID() } }),
          );
      });
      await expect(cashier.getByPlaceholder("Item note")).toHaveValue(note);
    }
    await cashier.getByRole("button", { name: "Hold", exact: true }).click();
    await expect(cashier.getByText("Order held in active orders.")).toBeVisible();
    let current = await snapshot();
    const held = current.state.orders.find((order) =>
      order.lines.some((line) => line.itemNote === note),
    )!;
    expect(held).toBeTruthy();
    if (scenario === 2) {
      await cashier.reload();
      await cashier.getByRole("button", { name: /^Orders\s+\d/ }).click();
      await cashier.getByRole("button", { name: new RegExp(held.id) }).click();
      await expect(cashier.getByPlaceholder("Item note")).toHaveValue(note);
    }
    events.push(
      `UI Hold persisted exact order ${held.id}; quantity ${held.lines[0].quantity}; ${note}`,
    );
    stage = "kitchen dispatch and invoice";
    await mutate("sendToKitchen", { orderId: held.id });
    await mutate("sendToKitchen", { orderId: held.id });
    current = await snapshot();
    expect(
      current.state.kitchenPrintObligations.filter((obligation) => obligation.orderId === held.id),
    ).toHaveLength(1);
    events.push(
      "Two server dispatch submissions produced one KOT obligation; physical print not acknowledged by this simulation",
    );
    await cashier.goto("/invoices");
    await cashier.getByRole("button", { name: "Create / open invoice", exact: true }).click();
    current = await snapshot();
    const bill = current.state.bills.find((invoice) => invoice.orderIds.includes(held.id))!;
    expect(bill).toBeTruthy();
    await mutate("prepareInvoiceForPayment", { orderId: held.id });
    expect(
      (await snapshot()).state.bills.filter((invoice) => invoice.orderIds.includes(held.id)),
    ).toHaveLength(1);
    stage = "cash settlement";
    const pay = async (amount: number) => {
      await cashier.reload();
      await cashier
        .getByRole("row")
        .filter({ hasText: `Invoice ${bill.id.replace(/^(?:BILL|INV)-/, "")}` })
        .getByRole("button", { name: "Settle", exact: true })
        .click();
      await cashier.getByRole("dialog").getByRole("button", { name: "Cash", exact: true }).click();
      await cashier.getByLabel("Amount", { exact: true }).fill(amount.toFixed(2));
      await cashier
        .getByRole("dialog")
        .getByRole("button", { name: "Settle invoice", exact: true })
        .click();
      await expect(cashier.getByText("Settlement recorded", { exact: true })).toBeVisible();
    };
    if (scenario === 4) {
      const half = Math.floor(bill.total * 50) / 100;
      await pay(half);
      await pay(bill.total - half);
    } else await pay(bill.total);
    current = await snapshot();
    expect(current.state.bills.find((invoice) => invoice.id === bill.id)?.paid).toBe(bill.total);
    expect(current.state.receipts.some((receipt) => receipt.invoiceId === bill.id)).toBe(true);
    events.push(
      `Invoice ${bill.id} settled, receipt persisted, total KES ${bill.total.toFixed(2)}`,
    );
    stage = "supervisor close confirmation";
    await manager.goto("/login?account=1");
    await manager.evaluate(
      ({ f, branch }) => {
        sessionStorage.setItem("seramet.session.interactive-sign-in", "1");
        localStorage.setItem("seramet.session.tenant-id", f.tenantId);
        localStorage.setItem("seramet.session.user-id", f.userId);
        localStorage.setItem(
          "seramet.session.branch-scope.v2",
          JSON.stringify({ type: "BRANCH", branchId: branch }),
        );
      },
      { f: fixture, branch: branchId },
    );
    await manager.goto("/payment-control");
    await manager.getByRole("button", { name: "Daily closing", exact: true }).click();
    await manager.getByRole("button", { name: "Close Business Day", exact: true }).click();
    const dialog = manager.getByRole("dialog");
    await dialog
      .getByLabel(`Counted KES ${drawer.id}`)
      .fill((100 + bill.total + (scenario === 6 ? 1 : 0)).toFixed(2));
    if (scenario === 6)
      await dialog
        .getByLabel("Variance explanation", { exact: true })
        .fill("Disposable simulation: one shilling cash overage");
    await dialog.getByRole("button", { name: "Review confirmation", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm & Close Business Day", exact: true }).click();
    await expect(
      manager.getByRole("region", { name: "Daily closing", exact: true }).getByRole("status"),
    ).toBeVisible();
    current = await snapshot();
    expect(
      current.state.paymentOperations!.drawerSessions.find((d) => d.id === drawer.id)?.status,
    ).toBe("CLOSED");
    const day = current.state.paymentOperations!.dayCloses.find(
      (d) => d.branchId === branchId && d.status === "CLOSED",
    )!;
    expect(day.snapshots).toHaveLength(1);
    expect(day.snapshot!.invoicedMinor).toBe(Math.round(bill.total * 100));
    expect(day.snapshot!.settledMinor).toBe(Math.round(bill.total * 100));
    if (branchAControl) {
      expect(await branchASnapshot()).toEqual(branchAControl);
      expect(persistedBranchA()).toEqual(controlRows);
      events.push(
        "A real Branch A held order remained unchanged across Branch B sale and close, including persisted SQL identity, version and values",
      );
    }
    const download = manager.waitForEvent("download");
    await manager.getByRole("button", { name: "Download PDF", exact: true }).click();
    await (await download).saveAs(resolve(directory, "closing.pdf"));
    await manager.screenshot({ path: resolve(directory, "closed.png"), fullPage: true });
    events.push(
      "Supervisor alone finalized drawer and business day, one immutable snapshot, secure PDF downloaded",
    );
    await writeFile(
      resolve(directory, "result.json"),
      JSON.stringify(
        {
          scenario,
          status: "PASS",
          events,
          day,
          financial: { invoice: bill.id, total: bill.total },
          ...(controlRows ? { isolation: { before: controlRows, after: persistedBranchA() } } : {}),
          limitations: [
            "Seeded owner identity; no live Supabase signup",
            "KOT physical delivery not simulated or asserted",
            "No live payment or email provider",
          ],
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile(
      resolve(directory, "result.json"),
      JSON.stringify(
        {
          scenario,
          status: "FAIL",
          stage,
          events,
          error: error instanceof Error ? error.message.slice(0, 1200) : "Unknown failure",
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await staff.close();
    await admin.close();
  }
});

test("Sales subviews and authoritative table setup", async ({ browser }) => {
  test.skip(scenario !== 2, "Subview audit runs once independently of the six sales");
  test.setTimeout(180000);
  const context = await browser.newContext();
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
  const page = await context.newPage();
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
  const evidence: Array<Record<string, unknown>> = [];
  for (const path of [
    "/reservations",
    "/host",
    "/waitlist",
    "/guest-service",
    "/marketplace",
    "/delivery",
    "/tables",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
    if (path === "/marketplace")
      for (const label of ["ORDERS", "MENU SYNC", "EXCEPTIONS"]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        evidence.push({ path, subview: label });
      }
    if (path === "/delivery")
      for (const label of ["Own dispatch (0)", "Platform delivery (0)", "All (0)"]) {
        await page.getByRole("button", { name: label, exact: true }).click();
        evidence.push({ path, subview: label });
      }
    if (path === "/tables") {
      await page.getByRole("button", { name: "Add table", exact: true }).click();
      await page.getByLabel("Table number", { exact: true }).fill("AUDIT01");
      await page.getByRole("button", { name: "Create table", exact: true }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: /^Table AUDIT01\b/ })).toBeVisible();
      evidence.push({
        path,
        operation: "Table created by browser UI and retained after authoritative reload",
      });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    evidence.push({
      path,
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      text: (await page.locator("main").innerText()).slice(0, 250),
    });
    await page.screenshot({
      path: resolve(directory, `${path.slice(1)}-subview-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await writeFile(resolve(directory, "sales-subviews.json"), JSON.stringify(evidence, null, 2));
  await context.close();
});
