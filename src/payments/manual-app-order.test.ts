import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type OrderDraft,
  type TransactionState,
} from "@/lib/transaction-engine";
import { appOrderBalance } from "@/payments/app-order-balance";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import { allPermissionCodes } from "@/platform/permissions";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const tenantId = DEMO_TENANT_ID;
const branchId = DEMO_WESTLANDS_BRANCH_ID;

beforeEach(() =>
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState())),
);
afterEach(() => setConfigurationRepositoryForTests(undefined));

describe("a delivery-app order typed into the POS", () => {
  it("is booked as owed by the app when it is fully prepaid", () => {
    const next = send({ externalOrderId: "G-1001" });
    const order = next.orders[0]!;
    expect(order.status).toBe("SENT_TO_KITCHEN");
    expect(order.paymentStatus).toBe("PROVIDER_RECEIVABLE");
    expect(order.externalSource).toMatchObject({
      externalOrderId: "G-1001",
      collectionMode: "PLATFORM_PREPAID",
      metadata: { manualEntry: true },
    });
    expect(next.bills).toHaveLength(1);
    expect(next.bills[0]!.status).toBe("PROVIDER_RECEIVABLE");
    // The receivable is booked to a real account, never a display name.
    expect(next.marketplaceReceivables[0]!.receivableAccount).toBe(
      "account-demo-customer-receivable",
    );
    expect(appOrderBalance(next, next.bills[0]!.id)).toMatchObject({ appOwes: 950, toCollect: 0 });
  });

  it("leaves the pay-on-delivery part to be collected", () => {
    const next = send({ externalOrderId: "G-1002", dueOnDeliveryMinor: 60_000 });
    expect(appOrderBalance(next, next.bills[0]!.id)).toMatchObject({
      appOwes: 350,
      toCollect: 600,
    });
    expect(next.orders[0]!.externalSource?.collectionMode).toBe("MIXED");
    const collected = applyServerMutation(
      next,
      "recordDirectCompanyCollection",
      {
        input: {
          obligationId: next.orders[0]!.externalSource!.custodyObligationId,
          amountMinor: 60_000,
          paymentMethodId: "payment-demo-cash",
        },
      },
      cashier(),
    );
    expect(appOrderBalance(collected, next.bills[0]!.id)).toMatchObject({
      appOwes: 350,
      toCollect: 0,
    });
  });

  it("needs the app's order number", () => {
    expect(() => send(undefined)).toThrow(/Glovo order number/);
    expect(() => send({ externalOrderId: "  " })).toThrow(/order number/);
  });

  it("refuses the same app order number twice", () => {
    const first = send({ externalOrderId: "G-1003" });
    expect(() => send({ externalOrderId: "g-1003" }, first)).toThrow(/already ORD-/);
  });

  it("refuses more due on delivery than the order total", () => {
    expect(() => send({ externalOrderId: "G-1004", dueOnDeliveryMinor: 95_001 })).toThrow(
      /more than the order total/,
    );
  });

  it("is not billed again at the till", () => {
    const next = send({ externalOrderId: "G-1005" });
    const orderId = next.orders[0]!.id;
    expect(() =>
      applyServerMutation(next, "prepareInvoiceForPayment", { orderId }, cashier()),
    ).toThrow(/paid through the app/);
    expect(TransactionEngine.createOpenBill(next, orderId).bills).toHaveLength(1);
  });

  it("refuses extra items once booked to the app", () => {
    const next = send({ externalOrderId: "G-1006" });
    expect(() =>
      applyServerMutation(
        next,
        "upsertAndSendKitchen",
        { orderId: next.orders[0]!.id, draft: draft(), appOrder: { externalOrderId: "G-1006" } },
        cashier(),
      ),
    ).toThrow(/Ring extra items as a new order/);
  });

  it("leaves other channels as ordinary sales", () => {
    const next = applyServerMutation(
      createEmptyTransactionState(tenantId),
      "upsertAndSendKitchen",
      { draft: { ...draft(), channel: "Dine-In", table: "04" } },
      cashier(),
    );
    expect(next.orders[0]!.externalSource).toBeUndefined();
    expect(next.marketplaceReceivables).toHaveLength(0);
  });
});

function draft(): OrderDraft {
  return {
    tenantId,
    branchId,
    branch: "Westlands",
    customer: "App customer",
    channel: "Glovo",
    cashier: "Amina",
    lines: [
      {
        id: "ln-1",
        productId: "p1",
        name: "Chicken wrap",
        category: "Main Meals",
        quantity: 1,
        unitPrice: 950,
        productionStation: "MAIN KITCHEN",
      },
    ],
  };
}

function send(
  appOrder: { externalOrderId: string; dueOnDeliveryMinor?: number } | undefined,
  state: TransactionState = createEmptyTransactionState(tenantId),
) {
  return applyServerMutation(
    state,
    "upsertAndSendKitchen",
    { draft: draft(), ...(appOrder ? { appOrder } : {}) },
    cashier(),
  );
}

function cashier(): ServerActor {
  return {
    id: "user-demo-amina",
    name: "Amina",
    tenantId,
    roleIds: ["cashier"],
    permissions: [...allPermissionCodes],
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: "Westlands" }],
    branchScope: { type: "BRANCH" },
    branchId,
    branch: "Westlands",
    role: "Cashier",
  } as ServerActor;
}

describe("the app's payout file for orders typed into the POS", () => {
  it("matches each order by the app's order number", async () => {
    const { parseDeliveryAppPayout } = await import("@/payments/delivery-app-payout-files");
    const { ReconciliationEngine } = await import("@/payments/reconciliation-engine");
    const booked = send({ externalOrderId: "G-2001" });
    const preview = await parseDeliveryAppPayout(
      [
        "Glovo code,Products price,Glovo commission,Partner payout,Invoice number",
        "g-2001,950.00,-142.50,807.50,GL-1",
        "G-9999,100.00,-15.00,85.00,GL-1",
      ].join("\n"),
      { connectionId: "connection-demo-glovo", currency: "KES" },
    );
    const { state, batch } = new ReconciliationEngine().importSettlement(booked, {
      tenantId,
      branchId,
      importedBy: "Accountant",
      normalized: preview.recognized[0]!,
      alsoMatchConnectionIds: ["manual:channel-demo-glovo"],
    });
    const lines = state.paymentOperations!.settlementLines.filter(
      (line) => line.settlementBatchId === batch.id && line.type === "GROSS_SALE",
    );
    expect(lines.find((line) => line.externalOrderId === "g-2001")?.orderId).toBe(
      booked.orders[0]!.id,
    );
    // An order the restaurant has no record of is flagged, not silently accepted.
    expect(
      state.paymentOperations!.exceptions.some(
        (row) => row.reason === "MISSING_ORDER" && row.detail.includes("G-9999"),
      ),
    ).toBe(true);
  });
});
