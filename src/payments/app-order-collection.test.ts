import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerActor } from "@/lib/seramet-auth";
import { applyServerMutation } from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type TransactionState,
} from "@/lib/transaction-engine";
import { appOrderBalance, appOrderBalanceLabel } from "@/payments/app-order-balance";
import { custodyLedger } from "@/payments/custody-ledger";
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

beforeEach(() => configure());
afterEach(() => setConfigurationRepositoryForTests(undefined));

describe("a delivery-app order that is part prepaid, part pay-on-delivery", () => {
  it("shows what the app owes and what is still to collect", () => {
    const state = appOrder({ total: 950, paidInApp: 350, payOnDelivery: 600 });
    const balance = appOrderBalance(state, state.bills[0]!.id)!;
    expect(balance).toMatchObject({ appOwes: 350, toCollect: 600, collected: 0 });
    expect(appOrderBalanceLabel(balance)).toBe("To collect + owed by app");
  });

  it("is cleared at the counter in cash with no rider and no reference", () => {
    const state = appOrder({ total: 950, paidInApp: 350, payOnDelivery: 600 });
    const invoiceId = state.bills[0]!.id;
    const next = applyServerMutation(
      state,
      "recordDirectCompanyCollection",
      { input: collect(state, 60_000, "payment-demo-cash") },
      cashier(),
    );
    expect(appOrderBalance(next, invoiceId)).toMatchObject({
      appOwes: 350,
      toCollect: 0,
      collected: 600,
    });
    expect(appOrderBalanceLabel(appOrderBalance(next, invoiceId)!)).toBe("Owed by app");
    const obligation = next.paymentOperations!.custodyObligations[0]!;
    expect(obligation).toMatchObject({ status: "REMITTED", remittedMinor: 60_000 });
    expect(obligation.riderName).toBeUndefined();
    expect(next.paymentOperations!.custodyMovements[0]).toMatchObject({
      tender: "CASH",
      fromHolder: "CUSTOMER",
      toHolder: "CASH_DRAWER",
      destinationAccountId: "account-demo-cash",
      amountMinor: 60_000,
    });
    expect(next.paymentOperations!.collections[0]).toMatchObject({
      collectionState: "IN_HAND",
      accountId: "account-demo-cash",
      amountMinor: 60_000,
    });
    // The app still owes its own part until its payout is matched.
    expect(next.marketplaceReceivables[0]).toMatchObject({
      status: "PARTIALLY_SETTLED",
      merchantCollectedAmount: 600,
      outstandingAmount: 350,
    });
  });

  it("can be cleared in parts with different payment methods", () => {
    let state = appOrder({ total: 950, paidInApp: 350, payOnDelivery: 600 });
    const invoiceId = state.bills[0]!.id;
    state = applyServerMutation(
      state,
      "recordDirectCompanyCollection",
      { input: collect(state, 40_000, "payment-demo-cash") },
      cashier(),
    );
    expect(appOrderBalance(state, invoiceId)!.toCollect).toBe(200);
    expect(() =>
      applyServerMutation(
        state,
        "recordDirectCompanyCollection",
        { input: collect(state, 20_000, "payment-demo-mpesa-till") },
        cashier(),
      ),
    ).toThrow(/reference is required/);
    state = applyServerMutation(
      state,
      "recordDirectCompanyCollection",
      { input: { ...collect(state, 20_000, "payment-demo-mpesa-till"), reference: "rkx91" } },
      cashier(),
    );
    expect(appOrderBalance(state, invoiceId)!.toCollect).toBe(0);
    expect(state.paymentOperations!.custodyMovements[0]).toMatchObject({
      tender: "MOBILE_MONEY",
      toHolder: "MOBILE_MONEY_TILL",
      reference: "RKX91",
    });
  });

  it("refuses more than is left to collect", () => {
    const state = appOrder({ total: 950, paidInApp: 350, payOnDelivery: 600 });
    expect(() =>
      applyServerMutation(
        state,
        "recordDirectCompanyCollection",
        { input: collect(state, 60_100, "payment-demo-cash") },
        cashier(),
      ),
    ).toThrow(/exceeds/);
  });

  it("holds money against a rider only where the channel says riders carry it", () => {
    const state = appOrder({ total: 950, paidInApp: 0, payOnDelivery: 950 });
    const riderCollection = {
      input: { obligationId: obligationId(state), amountMinor: 95_000, tender: "CASH" },
    };
    expect(() =>
      applyServerMutation(state, "recordRiderCollection", riderCollection, cashier()),
    ).toThrow(/Riders do not carry money/);

    configure("RIDER");
    const held = applyServerMutation(state, "recordRiderCollection", riderCollection, cashier());
    expect(held.paymentOperations!.custodyMovements[0]).toMatchObject({
      toHolder: "RIDER",
      amountMinor: 95_000,
    });
  });
});

describe("a fully prepaid delivery-app order", () => {
  it("has nothing to collect and is owed by the app", () => {
    const state = appOrder({ total: 950, paidInApp: 950, payOnDelivery: 0 });
    const balance = appOrderBalance(state, state.bills[0]!.id)!;
    expect(balance).toMatchObject({ appOwes: 950, toCollect: 0 });
    expect(balance.obligationId).toBeUndefined();
    expect(appOrderBalanceLabel(balance)).toBe("Owed by app");
  });
});

function configure(cashHandledBy?: "COUNTER" | "RIDER") {
  const platform = createDefaultDemoPlatformState();
  if (cashHandledBy) {
    const channel = platform.orderChannels.find((row) => row.displayName === "Glovo")!;
    channel.metadata = {
      ...channel.metadata,
      deliverySettings: {
        fulfilment: "RESTAURANT",
        beneficiary: "BUSINESS",
        allowManual: false,
        cashHandledBy,
        rates: [],
      },
    };
  }
  setConfigurationRepositoryForTests(new ConfigurationRepository(platform));
}

function appOrder(input: { total: number; paidInApp: number; payOnDelivery: number }) {
  let state: TransactionState = TransactionEngine.createOrder(
    createEmptyTransactionState(tenantId),
    {
      tenantId,
      branchId,
      branch: "Westlands",
      customer: "App customer",
      channel: "Glovo",
      cashier: "Glovo",
      lines: [
        { id: "L1", name: "Chicken wrap", category: "Main", quantity: 1, unitPrice: input.total },
      ],
    },
    "OPEN",
  );
  const orderId = state.orders[0]!.id;
  state = TransactionEngine.recordMarketplaceReceivable(state, orderId, {
    connectionId: "connection-demo-glovo",
    providerId: "glovo",
    externalOrderId: "G-48213",
    currency: "KES",
    externallyCollectedAmount: input.paidInApp,
    receivableAccount: "account-demo-marketplace-receivable",
  });
  if (input.payOnDelivery > 0) {
    state = custodyLedger.createObligation(state, {
      tenantId,
      branchId,
      orderId,
      connectionId: "connection-demo-glovo",
      providerId: "glovo",
      externalOrderId: "G-48213",
      currency: "KES",
      collectionMode: input.paidInApp > 0 ? "MIXED" : "CASH_DUE",
      amountDueMinor: input.payOnDelivery * 100,
      merchantAmountDueMinor: input.payOnDelivery * 100,
      custodyAccountId: "account-demo-rider-custody",
    });
  }
  return state;
}

function obligationId(state: TransactionState) {
  return state.paymentOperations!.custodyObligations[0]!.id;
}

function collect(state: TransactionState, amountMinor: number, paymentMethodId: string) {
  return { obligationId: obligationId(state), amountMinor, paymentMethodId };
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
