import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { TransactionState } from "../../src/lib/transaction-engine";
import { expectFitsViewport } from "./layout-helpers";

const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), ".seramet", "e2e-fixture.json"), "utf8"),
) as {
  tenantId: string;
  firstBranchId: string;
  userId: string;
  managerAccessToken: string;
};

test("chef PIN session operates KDS Start, Ready and Served with persisted state", async ({
  browser,
  context,
}) => {
  if (
    process.env.SERAMET_E2E !== "true" ||
    process.env.SERAMET_E2E_BASE_URL ||
    !fixture.tenantId.startsWith("e2e-")
  )
    throw new Error("Disposable local kitchen verification required");
  const headers = {
    authorization: `Bearer ${fixture.managerAccessToken}`,
    "x-seramet-tenant-id": fixture.tenantId,
    "x-seramet-branch-id": fixture.firstBranchId,
    origin: "http://127.0.0.1:4173",
  };
  const configuration = await context.request.get("/api/seramet/configuration", { headers });
  expect(configuration.ok()).toBe(true);
  const { configuration: settings } = await configuration.json();
  const chef = settings.roles.find((role: { code: string }) => role.code === "PILOT_CHEF");
  expect(chef).toBeTruthy();
  // Configure KDS through the existing administration API; no bridge is contacted.
  const hardware = await context.request.post("/api/seramet/printing/printers", {
    headers,
    data: {
      branchId: fixture.firstBranchId,
      name: "Disposable disabled KDS recovery printer",
      bridgeId: `disposable-${randomUUID()}`,
      transport: "TCP",
      host: "127.0.0.1",
      port: 9100,
      roles: ["KITCHEN"],
      stations: ["MAIN"],
      enabled: false,
      kitchenMode: "KDS_ONLY",
    },
  });
  expect(hardware.ok(), await hardware.text()).toBe(true);
  const employeeCode = `KDS-${randomUUID().slice(0, 8)}`;
  const pin = String(randomInt(234567, 876543));
  const employee = await context.request.post("/api/seramet/employees", {
    headers,
    data: {
      idempotencyKey: randomUUID(),
      fullName: "Disposable KDS chef",
      employeeCode,
      jobTitle: "Chef",
      roleId: chef.id,
      assignedBranchIds: [fixture.firstBranchId],
      primaryBranchId: fixture.firstBranchId,
      pin,
      pinConfirmation: pin,
      temporaryPin: false,
      effectiveFrom: new Date(Date.now() - 60000).toISOString(),
    },
  });
  expect(employee.status(), await employee.text()).toBe(201);
  const employeeId = (await employee.json()).employee.id as string;
  const station = settings.stations.find(
    (item: { branchId: string; code: string }) =>
      item.branchId === fixture.firstBranchId && item.code === "MAIN",
  );
  expect(station).toBeDefined();
  const registered = await context.request.post("/api/seramet/devices/register", {
    headers,
    data: {
      branchId: fixture.firstBranchId,
      deviceType: "POS_TERMINAL",
      name: "Disposable kitchen terminal",
    },
  });
  expect(registered.ok()).toBe(true);
  const { device } = await registered.json();
  expect(
    (
      await context.request.post(`/api/seramet/devices/${device.id}/activate`, {
        headers,
        data: {},
      })
    ).ok(),
  ).toBe(true);
  const snapshot = async () => {
    const response = await context.request.get("/api/seramet/transactions", { headers });
    expect(response.ok()).toBe(true);
    return response.json() as Promise<{ revision: number; state: TransactionState }>;
  };
  const mutate = async (action: string, payload: Record<string, unknown>) => {
    const { revision } = await snapshot();
    const idempotencyKey = randomUUID();
    const response = await context.request.post("/api/seramet/transactions/mutate", {
      headers: { ...headers, "Idempotency-Key": idempotencyKey },
      data: { action, payload, idempotencyKey, expectedRevision: revision },
    });
    expect(response.status(), await response.text()).toBe(200);
    return snapshot();
  };
  const before = await snapshot();
  const created = await mutate("upsertOrderDraft", {
    draft: {
      tenantId: fixture.tenantId,
      branchId: fixture.firstBranchId,
      branch: fixture.firstBranchId,
      customer: "Disposable kitchen browser check",
      channel: "DINE_IN",
      cashier: fixture.userId,
      lines: [
        {
          id: randomUUID(),
          productId: "pilot-product",
          name: "Pilot meal",
          category: "MAIN MEALS",
          quantity: 1,
          unitPrice: 1000,
          productionStation: "MAIN",
        },
      ],
    },
    targetStatus: "OPEN",
  });
  const order = created.state.orders.find(
    (item) => !before.state.orders.some((old) => old.id === item.id),
  );
  expect(order).toBeDefined();
  await mutate("sendToKitchen", { orderId: order!.id });
  const staff = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  try {
    await staff.addCookies(
      (await context.cookies()).filter((cookie) => cookie.name === "seramet_device"),
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
    await expect(page).toHaveURL(/\/attendance$/);
    await page.goto("/kitchen");
    await expect(page.getByRole("heading", { name: "Seramet Kitchen" })).toBeVisible();
    const ticket = page.getByRole("article").filter({ hasText: order!.id });
    const unassigned = await staff.request.get("/api/seramet/transactions");
    expect(unassigned.ok()).toBe(true);
    expect((await unassigned.json()).state.orders).toHaveLength(0);
    await expect(ticket).toHaveCount(0);
    const deniedKey = randomUUID();
    const deniedTransition = await staff.request.post("/api/seramet/transactions/mutate", {
      headers: { "Idempotency-Key": deniedKey },
      data: {
        action: "setProductionStationStatus",
        payload: { orderId: order!.id, station: "MAIN", status: "PREPARING" },
        idempotencyKey: deniedKey,
        expectedRevision: (await snapshot()).revision,
      },
    });
    expect(deniedTransition.status()).toBe(403);
    expect(
      (await snapshot()).state.orders.find((item) => item.id === order!.id)?.lines[0]
        ?.productionStatus,
    ).toBe("NEW");
    const assigned = await context.request.put(`/api/seramet/employees/${employeeId}/stations`, {
      headers,
      data: { branchId: fixture.firstBranchId, stationIds: [station.id], expectedVersion: 0 },
    });
    expect(assigned.ok(), await assigned.text()).toBe(true);
    await page.reload();
    await expect(ticket).toHaveCount(1);
    for (const [deviceName, width, height] of [
      ["tablet", 1024, 768],
      ["phone", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expectFitsViewport(page);
      await ticket.getByRole("button", { name: "Start", exact: true }).scrollIntoViewIfNeeded();
      await expect(ticket.getByRole("button", { name: "Start", exact: true })).toBeInViewport();
      await page.screenshot({
        path: test.info().outputPath(`chef-kds-${deviceName}.png`),
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    for (const [button, status] of [
      ["Start", "PREPARING"],
      ["Ready", "READY"],
      ["Served", "SERVED"],
    ] as const) {
      await page.setViewportSize(
        button === "Ready" ? { width: 390, height: 844 } : { width: 1024, height: 768 },
      );
      await expect(ticket.getByRole("button", { name: button, exact: true })).toBeEnabled();
      if (button === "Ready") {
        let replays = 0;
        page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api/seramet/offline/sync") replays++;
        });
        await staff.setOffline(true);
        await ticket.getByRole("button", { name: button, exact: true }).click();
        await expect(ticket.getByRole("button", { name: "Served", exact: true })).toBeVisible();
        expect(
          (await snapshot()).state.orders.find((item) => item.id === order!.id)?.lines[0]
            ?.productionStatus,
        ).toBe("PREPARING");
        expect(replays).toBe(0);
        const replay = page.waitForResponse(
          (response) => new URL(response.url()).pathname === "/api/seramet/offline/sync",
        );
        await staff.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        expect((await replay).ok()).toBe(true);
        expect(replays).toBe(1);
      } else {
        const update = page.waitForResponse(
          (response) =>
            response.url().endsWith("/transactions/mutate") &&
            response.request().method() === "POST",
        );
        await ticket.getByRole("button", { name: button, exact: true }).click();
        const response = await update;
        expect(response.status(), await response.text()).toBe(200);
      }
      await expect
        .poll(
          async () =>
            (await snapshot()).state.orders.find((item) => item.id === order!.id)?.lines[0]
              ?.productionStatus,
        )
        .toBe(status);
      const refreshed = page.waitForResponse((result) => {
        const url = new URL(result.url());
        return (
          url.pathname === "/api/seramet/transactions" &&
          !url.searchParams.has("knownRevision") &&
          result.request().method() === "GET"
        );
      });
      await page.reload();
      const refreshedResponse = await refreshed;
      expect(refreshedResponse.ok()).toBe(true);
      const refreshedOrder = (await refreshedResponse.json()).state.orders.find(
        (item: { id: string }) => item.id === order!.id,
      );
      expect(refreshedOrder?.lines[0]?.productionStatus).toBe(status);
      await expect(page.getByRole("heading", { name: "Seramet Kitchen" })).toBeVisible();
      if (status === "SERVED") await expect(ticket).toHaveCount(0);
      else await expect(ticket).toHaveCount(1);
    }
    const denied = await staff.request.get("/api/seramet/employees");
    expect(denied.status()).toBe(403);
    const deniedAssignment = await staff.request.put(
      `/api/seramet/employees/${employeeId}/stations`,
      {
        data: { branchId: fixture.firstBranchId, stationIds: [], expectedVersion: 1 },
      },
    );
    expect(deniedAssignment.status()).toBe(403);
    await page.screenshot({
      path: test.info().outputPath("chef-kds-completed.png"),
      fullPage: true,
    });
  } finally {
    await staff.close();
  }
});
