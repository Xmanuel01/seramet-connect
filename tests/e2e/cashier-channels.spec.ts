import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { fixture } from "./pos-stability-helpers";
import { invoiceDisplayName } from "../../src/lib/invoice-split";
import type { TransactionState } from "../../src/lib/transaction-engine";

test.use({ trace: "off", screenshot: "only-on-failure" });
test.beforeAll(() => {
  if (
    process.env.CI !== "true" ||
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !/^e2e-[a-f0-9-]+$/.test(fixture.tenantId)
  )
    throw new Error("Disposable loopback cashier/channel acceptance only");
});

async function prepare(browser: Browser, admin: BrowserContext, channelType: string) {
  const headers = {
    authorization: `Bearer ${fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
    origin: "http://127.0.0.1:4173",
  };
  const api = async (path: string, data?: unknown) => {
    const response = await admin.request.fetch(`/api/seramet/${path}`, {
      headers,
      method: data === undefined ? "GET" : "POST",
      data,
    });
    expect(response.ok(), `${path}: HTTP ${response.status()}`).toBe(true);
    return response.json();
  };
  const snapshot = () =>
    api("transactions") as Promise<{ revision: number; state: TransactionState }>;
  const mutate = async (action: string, payload: unknown) =>
    api("transactions/mutate", {
      action,
      payload,
      idempotencyKey: randomUUID(),
      expectedRevision: (await snapshot()).revision,
    });
  const { configuration } = await api("configuration");
  const role = configuration.roles.find((row: { code: string }) => row.code === "PILOT_CASHIER");
  expect(role).toBeTruthy();
  expect(role.permissions).toContain("payments.collect");
  expect(role.permissions).not.toContain("settings.roles.manage");
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const { orderChannel: channel } = await api("configuration/order-channels", {
    displayName: `Acceptance ${channelType} ${suffix}`,
    code: `CHECK_${suffix}`,
    channelType,
    useOnlinePrice: false,
    reason: "Disposable configured sales channel acceptance",
  });
  expect(channel).toBeTruthy();
  const tableCode = channelType === "DINE_IN" ? `S-${suffix}` : undefined;
  if (tableCode) await api("tables/configuration", { code: tableCode, seats: 2 });
  await api("printing/printers", {
    branchId: fixture.firstBranchId,
    name: `Disposable KDS ${suffix}`,
    bridgeId: `disposable-${suffix}`,
    transport: "TCP",
    host: "127.0.0.1",
    port: 9100,
    roles: ["KITCHEN"],
    stations: ["MAIN"],
    enabled: false,
    kitchenMode: "KDS_ONLY",
  });
  const employeeCode = `SALE-${suffix}`;
  const pin = String(randomInt(234567, 876543));
  const { employee } = await api("employees", {
    idempotencyKey: randomUUID(),
    fullName: `Acceptance cashier ${suffix}`,
    employeeCode,
    jobTitle: "Cashier",
    roleId: role.id,
    assignedBranchIds: [fixture.firstBranchId],
    primaryBranchId: fixture.firstBranchId,
    pin,
    pinConfirmation: pin,
    temporaryPin: false,
    effectiveFrom: new Date(Date.now() - 60000).toISOString(),
  });
  const { device } = await api("devices/register", {
    branchId: fixture.firstBranchId,
    deviceType: "POS_TERMINAL",
    name: `Disposable sales device ${suffix}`,
  });
  await api(`devices/${device.id}/activate`, {});
  await mutate("openPaymentDrawer", {
    input: {
      tenantId: fixture.tenantId,
      branchId: fixture.firstBranchId,
      employeeId: employee.id,
      openingFloatMinor: 0,
      currency: "KES",
      deviceId: device.id,
      actor: employee.id,
    },
  });
  const staff = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await staff.addCookies(
      (await admin.cookies()).filter((cookie) => cookie.name === "seramet_device"),
    );
    const page = await staff.newPage();
    await page.goto("/pos-login");
    await page.getByLabel("Email or employee code").fill(employeeCode);
    for (const digit of pin) await page.getByRole("button", { name: digit, exact: true }).click();
    const login = page.waitForResponse((response) =>
      response.url().endsWith("/public/employee/login"),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    expect((await login).ok()).toBe(true);
    await expect(page).toHaveURL(/\/pos$/);
    const session = await staff.request.get("/api/seramet/auth/session");
    expect(session.ok()).toBe(true);
    expect((await session.json()).actor.id).toBe(employee.id);
    expect((await staff.request.get("/api/seramet/employees")).status()).toBe(403);
    expect(
      (
        await staff.request.get(`/api/seramet/transactions?branchId=${fixture.secondBranchId}`)
      ).status(),
    ).toBe(403);
    await page.getByRole("button", { name: channel.displayName, exact: true }).click();
    await page.getByPlaceholder("Search dishes or scan barcode").fill("Pilot meal");
    await page.getByRole("button", { name: "Add Pilot meal to order", exact: true }).click();
    return { staff, page, snapshot, channel, employee, tableCode };
  } catch (error) {
    await staff.close();
    throw error;
  }
}

for (const channelType of ["TAKEAWAY", "DINE_IN", "OWN_DELIVERY"]) {
  test(`cashier PIN-to-cash-sale persists for configured ${channelType}`, async ({
    browser,
    context,
  }) => {
    const { staff, page, snapshot, channel, employee, tableCode } = await prepare(
      browser,
      context,
      channelType,
    );
    try {
      const before = await snapshot();
      const send = page.getByRole("button", { name: "Send kitchen", exact: true });
      if (channelType === "OWN_DELIVERY") {
        await page.getByLabel("Customer name", { exact: true }).fill("Disposable recipient");
        await send.click();
        await expect(
          page.getByText("Delivery address is required (5-500 characters).", { exact: true }),
        ).toBeVisible();
        expect((await snapshot()).state.orders).toHaveLength(before.state.orders.length);
        await page
          .getByLabel("Delivery address", { exact: true })
          .fill("Westlands test destination 10");
        for (const [width, height] of [
          [390, 844],
          [1024, 768],
        ]) {
          await page.setViewportSize({ width, height });
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true);
          await mkdir(".seramet/cashier-channels", { recursive: true });
          await page.screenshot({
            path: `.seramet/cashier-channels/delivery-${width}.png`,
            fullPage: true,
          });
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Hold", exact: true }).click();
        await expect(page.getByText("Order held in active orders.", { exact: true })).toBeVisible();
        const held = (await snapshot()).state.orders.find((row) => row.channel === channel.code)!;
        expect(held.delivery?.address).toBe("Westlands test destination 10");
        await page.getByRole("button", { name: /^Orders\s+\d/ }).click();
        await page.getByRole("button", { name: new RegExp(held.id) }).click();
        await expect(page.getByLabel("Delivery address", { exact: true })).toHaveValue(
          "Westlands test destination 10",
        );
        await page.reload();
        await expect(page.getByLabel("Delivery address", { exact: true })).toHaveValue(
          "Westlands test destination 10",
        );
        expect(
          await page.evaluate(() =>
            Object.entries(sessionStorage).some(
              ([key, value]) =>
                key.startsWith("seramet.pos.draft") && value.includes("Westlands test destination"),
            ),
          ),
        ).toBe(false);
      }
      if (channelType === "DINE_IN") {
        expect(channel.requiresTable).toBe(true);
        await expect(
          page.getByRole("button", { name: "Send kitchen first", exact: true }),
        ).toBeDisabled();
        await send.click();
        const picker = page.getByRole("dialog", { name: "Select table", exact: true });
        await expect(picker).toBeVisible();
        expect((await snapshot()).state.orders).toHaveLength(before.state.orders.length);
        await picker.getByRole("button", { name: new RegExp(`Table ${tableCode} `) }).click();
      } else {
        expect(channel.requiresTable).toBe(false);
      }
      await send.click();
      await expect
        .poll(async () => (await snapshot()).state.orders.length)
        .toBe(before.state.orders.length + 1);
      const saved = (await snapshot()).state.orders.find(
        (row) => !before.state.orders.some((old) => old.id === row.id),
      )!;
      expect(saved.channel).toBe(channel.code);
      expect(saved.lines).toHaveLength(1);
      expect(saved.total).toBe(1000);
      if (tableCode) expect(saved.table).toBe(tableCode);
      if (channelType === "OWN_DELIVERY") {
        expect(saved.customer).toBe("Disposable recipient");
        expect(saved.delivery).toMatchObject({
          recipientName: "Disposable recipient",
          address: "Westlands test destination 10",
        });
      }
      expect(
        (await snapshot()).state.kitchenPrintObligations?.some((row) => row.orderId === saved.id),
      ).toBe(true);
      await page.goto("/invoices");
      await expect(page.getByText(saved.id, { exact: false }).first()).toBeVisible();
      await page
        .getByText(new RegExp(`^${saved.id} ·`))
        .locator("../..")
        .getByRole("button", { name: "Create / open invoice", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await snapshot()).state.bills.filter((row) => row.orderIds.includes(saved.id)).length,
        )
        .toBe(1);
      const bill = (await snapshot()).state.bills.find((row) => row.orderIds.includes(saved.id))!;
      await page.reload();
      await page
        .getByRole("row")
        .filter({ hasText: invoiceDisplayName(bill.id) })
        .getByRole("button", { name: "Settle", exact: true })
        .click();
      await page.getByRole("dialog").getByRole("button", { name: "Cash", exact: true }).click();
      await page.getByLabel("Amount", { exact: true }).fill(bill.total.toFixed(2));
      const settle = page
        .getByRole("dialog")
        .getByRole("button", { name: "Settle invoice", exact: true });
      let lostCommand: Record<string, unknown> | undefined;
      if (channelType === "DINE_IN") {
        await page.route("**/api/seramet/transactions/mutate", async (route) => {
          const command = route.request().postDataJSON();
          if (command.action === "settleInvoice" && !lostCommand) {
            const committed = await route.fetch();
            expect(committed.ok()).toBe(true);
            lostCommand = command;
            await route.abort("failed");
          } else await route.continue();
        });
      }
      if (channelType === "TAKEAWAY") {
        await staff.setOffline(true);
        await settle.click();
        await expect(
          page.getByText("settleInvoice is unavailable while the POS is offline", { exact: true }),
        ).toBeVisible();
        expect(
          (await snapshot()).state.receipts.filter((row) => row.invoiceId === bill.id),
        ).toHaveLength(0);
        await page
          .getByRole("dialog", { name: "Selection required", exact: true })
          .getByRole("button", { name: "OK", exact: true })
          .click();
        await staff.setOffline(false);
        await page.reload();
        await page
          .getByRole("row")
          .filter({ hasText: invoiceDisplayName(bill.id) })
          .getByRole("button", { name: "Settle", exact: true })
          .click();
        await page.getByRole("dialog").getByRole("button", { name: "Cash", exact: true }).click();
        await settle.dblclick();
      } else await settle.click();
      await expect
        .poll(async () => (await snapshot()).state.bills.find((row) => row.id === bill.id)?.status)
        .toBe("PAID");
      if (channelType === "DINE_IN") {
        expect(lostCommand).toBeDefined();
        const retry = await staff.request.post("/api/seramet/transactions/mutate", {
          data: lostCommand,
          headers: { origin: "http://127.0.0.1:4173" },
        });
        expect(retry.ok()).toBe(true);
        expect((await retry.json()).duplicate).toBe(true);
        await page.unroute("**/api/seramet/transactions/mutate");
      } else await expect(page.getByText("Settlement recorded", { exact: true })).toBeVisible();
      const reload = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/seramet/transactions" &&
          !new URL(response.url()).searchParams.has("revisionOnly") &&
          response.ok(),
      );
      await page.reload();
      await reload;
      const after = (await snapshot()).state;
      const receipts = after.receipts.filter((row) => row.orderId === saved.id);
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.total).toBe(bill.total);
      expect(receipts[0]!.paymentBreakdown).toHaveLength(1);
      expect(receipts[0]!.paymentBreakdown[0]!.method).toBe("CASH");
      expect(after.bills.find((row) => row.id === bill.id)?.status).toBe("PAID");
      await mkdir(".seramet/cashier-channels", { recursive: true });
      await writeFile(
        `.seramet/cashier-channels/${channelType}.json`,
        JSON.stringify({
          channelType,
          channelCode: channel.code,
          role: "PILOT_CASHIER",
          employeeId: employee.id,
          orderId: saved.id,
          invoiceId: bill.id,
          receiptId: receipts[0]!.id,
          total: bill.total,
          persistedAfterReload: true,
          offlineSettlementRefused: channelType === "TAKEAWAY",
          duplicateClickPreservedSingleReceipt: channelType === "TAKEAWAY",
          committedResponseLossReplayedOnce: channelType === "DINE_IN",
        }),
      );
      await page.screenshot({
        path: `.seramet/cashier-channels/${channelType}.png`,
        fullPage: true,
      });
    } finally {
      await staff.close();
    }
  });
}

test("own delivery rejects dispatch without the configured required customer and address", async ({
  browser,
  context,
}) => {
  const { staff, page, snapshot, channel } = await prepare(browser, context, "OWN_DELIVERY");
  const before = await snapshot();
  const mutations: Array<{ status: number; action?: string }> = [];
  try {
    expect(channel.requiresCustomer).toBe(true);
    expect(channel.requiresAddress).toBe(true);
    page.on("response", (response) => {
      if (new URL(response.url()).pathname === "/api/seramet/transactions/mutate")
        mutations.push({
          status: response.status(),
          action: response.request().postDataJSON()?.action,
        });
    });
    await page.getByRole("button", { name: "Send kitchen", exact: true }).click();
    // Wait for a real rejection or a completed request, not the ordinary customer-picker label.
    await expect
      .poll(
        async () =>
          mutations.length > 0 ||
          (await page
            .getByText(
              /(customer|delivery address).{0,80}(is required|are required|before sending|before dispatch)|select (a )?customer (before|and)/i,
            )
            .first()
            .isVisible()),
      )
      .toBe(true);
    expect((await snapshot()).state.orders).toHaveLength(before.state.orders.length);
    expect(mutations.filter((row) => row.status === 200)).toHaveLength(0);
    const draft = {
      tenantId: fixture.tenantId,
      branchId: fixture.firstBranchId,
      branch: fixture.firstBranchId,
      channel: channel.code,
      cashier: "Cashier",
      customer: "Unassigned table",
      lines: [
        {
          id: randomUUID(),
          productId: fixture.menuItemId,
          name: "Pilot meal",
          category: "MAIN_MEALS",
          quantity: 1,
          unitPrice: 1000,
          productionStation: "MAIN",
        },
      ],
    };
    for (const delivery of [
      undefined,
      { status: "UNASSIGNED", recipientName: "Recipient" },
      { status: "UNASSIGNED", recipientName: "Recipient", address: "x".repeat(501) },
    ]) {
      const rejected = await staff.request.post("/api/seramet/transactions/mutate", {
        data: {
          action: "upsertAndSendKitchen",
          payload: { draft: { ...draft, ...(delivery ? { delivery } : {}) } },
          idempotencyKey: randomUUID(),
          expectedRevision: (await snapshot()).revision,
        },
      });
      expect(rejected.status()).toBe(400);
      expect((await snapshot()).state.orders).toHaveLength(before.state.orders.length);
    }
    const foreignCustomer = await staff.request.post("/api/seramet/transactions/mutate", {
      data: {
        action: "upsertAndSendKitchen",
        payload: {
          draft: {
            ...draft,
            customerId: randomUUID(),
            delivery: { status: "UNASSIGNED", address: "Westlands test destination 10" },
          },
        },
        idempotencyKey: randomUUID(),
        expectedRevision: (await snapshot()).revision,
      },
    });
    expect(foreignCustomer.status()).toBe(400);
    expect((await snapshot()).state.orders).toHaveLength(before.state.orders.length);
  } finally {
    const orders = (await snapshot()).state.orders.filter(
      (row) => !before.state.orders.some((old) => old.id === row.id),
    );
    await mkdir(".seramet/cashier-channels", { recursive: true });
    await writeFile(
      ".seramet/cashier-channels/OWN_DELIVERY-rejections.json",
      JSON.stringify({
        requiredCustomer: channel.requiresCustomer,
        requiredAddress: channel.requiresAddress,
        mutations,
        newOrders: orders.map((row) => ({
          id: row.id,
          channel: row.channel,
          customerId: row.customerId,
          customer: row.customer,
          total: row.total,
          status: row.status,
        })),
      }),
    );
    await page.screenshot({
      path: ".seramet/cashier-channels/OWN_DELIVERY-rejections.png",
      fullPage: true,
    });
    await staff.close();
  }
});
