import { beforeEach, describe, expect, it } from "vitest";
import {
  resolveDeliveryFulfilment,
  riderOutstandingForOrder,
} from "@/delivery/delivery-model";
import {
  TransactionEngine,
  createEmptyTransactionState,
  riderCollectionAmount,
  riderRemittedAmount,
} from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

describe("delivery fulfilment and rider custody", () => {
  let configuration: ConfigurationRepository;

  beforeEach(() => {
    configuration = new ConfigurationRepository(createDefaultDemoPlatformState());
    setConfigurationRepositoryForTests(configuration);
  });

  function createDeliveryOrder(channel: string, total = 1_800) {
    const branch = configuration.getBranch(DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID);
    let state = createEmptyTransactionState(DEMO_TENANT_ID);
    state = TransactionEngine.createOrder(
      state,
      {
        tenantId: DEMO_TENANT_ID,
        branchId: branch.id,
        branch: branch.name,
        customer: "Delivery guest",
        channel,
        cashier: "Dispatcher",
        lines: [
          {
            id: "line-delivery-1",
            name: "Pilau",
            category: "Mains",
            quantity: 1,
            unitPrice: total,
          },
        ],
      },
      "READY",
    );
    return state;
  }

  it("separates marketplace source from fulfilment ownership", () => {
    const uber = configuration
      .listOrderChannels(DEMO_TENANT_ID, true)
      .find((channel) => channel.displayName === "Uber Eats")!;
    const glovo = configuration
      .listOrderChannels(DEMO_TENANT_ID, true)
      .find((channel) => channel.displayName === "Glovo")!;

    const uberState = createDeliveryOrder(uber.code);
    const glovoState = createDeliveryOrder(glovo.code);

    expect(resolveDeliveryFulfilment(uberState.orders[0]!, uber)).toBe("OWN_DELIVERY");
    expect(resolveDeliveryFulfilment(glovoState.orders[0]!, glovo)).toBe("PROVIDER_DELIVERY");

    const providerOverride = {
      ...uberState.orders[0]!,
      externalSource: {
        connectionId: "connection-1",
        providerId: "provider-1",
        externalStoreId: "store-1",
        externalOrderId: "external-1",
        externallyPaid: true,
        fulfilmentType: "PROVIDER_DELIVERY" as const,
        isScheduled: false,
        receivedAt: new Date().toISOString(),
        metadata: {},
      },
    };
    expect(resolveDeliveryFulfilment(providerOverride, uber)).toBe("OWN_DELIVERY");
    expect(
      resolveDeliveryFulfilment(providerOverride, { ...uber, metadata: {} }),
    ).toBe("PROVIDER_DELIVERY");
  });

  it("records rider-held customer money without creating another sale", () => {
    const uber = configuration
      .listOrderChannels(DEMO_TENANT_ID, true)
      .find((channel) => channel.displayName === "Uber Eats")!;
    let state = createDeliveryOrder(uber.code, 1_800);
    const orderId = state.orders[0]!.id;

    state = TransactionEngine.assignDeliveryRider(state, orderId, "Wycliff", "Dispatcher");
    state = TransactionEngine.recordDeliveryCollection(
      state,
      orderId,
      { method: "CASH_TO_RIDER", amount: 1_800 },
      "Dispatcher",
    );

    expect(state.orders[0]!.total).toBe(1_800);
    expect(state.payments).toHaveLength(0);
    expect(riderCollectionAmount(state.orders[0]!)).toBe(1_800);
    expect(riderOutstandingForOrder(state, state.orders[0]!)).toBe(1_800);

    state = TransactionEngine.recordRiderRemittance(
      state,
      {
        rider: "Wycliff",
        branch: state.orders[0]!.branch,
        method: "CASH_HANDOVER",
        amount: 1_800,
      },
      "Supervisor",
    );

    expect(state.orders[0]!.total).toBe(1_800);
    expect(state.payments).toHaveLength(0);
    expect(state.riderRemittances).toHaveLength(1);
    expect(riderRemittedAmount(state, orderId)).toBe(1_800);
    expect(riderOutstandingForOrder(state, state.orders[0]!)).toBe(0);
  });

  it("requires a rider for rider-held funds and a reference for company Till", () => {
    const uber = configuration
      .listOrderChannels(DEMO_TENANT_ID, true)
      .find((channel) => channel.displayName === "Uber Eats")!;
    let state = createDeliveryOrder(uber.code, 1_800);
    const orderId = state.orders[0]!.id;

    expect(() =>
      TransactionEngine.recordDeliveryCollection(
        state,
        orderId,
        { method: "RIDER_MPESA", amount: 1_800 },
        "Dispatcher",
      ),
    ).toThrow(/Assign a restaurant rider/);

    expect(() =>
      TransactionEngine.recordDeliveryCollection(
        state,
        orderId,
        { method: "COMPANY_TILL", amount: 1_800 },
        "Dispatcher",
      ),
    ).toThrow(/transaction reference/);

    state = TransactionEngine.recordDeliveryCollection(
      state,
      orderId,
      { method: "COMPANY_TILL", amount: 1_800, reference: "rkx123" },
      "Dispatcher",
    );
    expect(state.orders[0]!.delivery?.collections?.[0]?.reference).toBe("RKX123");
    expect(riderCollectionAmount(state.orders[0]!)).toBe(0);
  });

  it("allocates a batch remittance across outstanding rider orders and blocks over-remittance", () => {
    const branch = configuration.getBranch(DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID);
    const uber = configuration
      .listOrderChannels(DEMO_TENANT_ID, true)
      .find((channel) => channel.displayName === "Uber Eats")!;

    let state = createEmptyTransactionState(DEMO_TENANT_ID);
    for (const [index, amount] of [1_000, 1_500].entries()) {
      state = TransactionEngine.createOrder(
        state,
        {
          tenantId: DEMO_TENANT_ID,
          branchId: branch.id,
          branch: branch.name,
          customer: `Guest ${index + 1}`,
          channel: uber.code,
          cashier: "Dispatcher",
          lines: [
            {
              id: `line-${index + 1}`,
              name: "Delivery meal",
              category: "Mains",
              quantity: 1,
              unitPrice: amount,
            },
          ],
        },
        "READY",
      );
      const orderId = state.orders[0]!.id;
      state = TransactionEngine.assignDeliveryRider(state, orderId, "Francis", "Dispatcher");
      state = TransactionEngine.recordDeliveryCollection(
        state,
        orderId,
        { method: "RIDER_MPESA", amount },
        "Dispatcher",
      );
    }

    expect(
      state.orders.reduce((sum, order) => sum + riderOutstandingForOrder(state, order), 0),
    ).toBe(2_500);

    state = TransactionEngine.recordRiderRemittance(
      state,
      {
        rider: "Francis",
        branch: branch.name,
        method: "MPESA_TO_TILL",
        amount: 2_000,
        reference: "till-2000",
      },
      "Supervisor",
    );

    expect(state.riderRemittances![0]?.reference).toBe("TILL-2000");
    expect(state.riderRemittances![0]?.allocations.reduce((sum, item) => sum + item.amount, 0)).toBe(
      2_000,
    );
    expect(
      state.orders.reduce((sum, order) => sum + riderOutstandingForOrder(state, order), 0),
    ).toBe(500);

    expect(() =>
      TransactionEngine.recordRiderRemittance(
        state,
        {
          rider: "Francis",
          branch: branch.name,
          method: "CASH_HANDOVER",
          amount: 501,
        },
        "Supervisor",
      ),
    ).toThrow(/exceeds/);
  });
});
