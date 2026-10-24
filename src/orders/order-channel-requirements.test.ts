import { afterEach, describe, expect, it } from "vitest";
import { orderChannelDispatchError } from "./order-channel-service";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type OrderDraft,
} from "@/lib/transaction-engine";

afterEach(() => setConfigurationRepositoryForTests(undefined));
describe("configured delivery dispatch requirements", () => {
  const channel = { requiresCustomer: true, requiresAddress: true };
  it("requires a recipient or linked customer and a bounded address", () => {
    expect(orderChannelDispatchError(channel, {})).toMatch(/Customer name/);
    expect(orderChannelDispatchError(channel, { delivery: { recipientName: "Guest" } })).toMatch(
      /address/,
    );
    expect(
      orderChannelDispatchError(channel, {
        customerId: "customer",
        delivery: { address: "Westlands 10" },
      }),
    ).toBeNull();
    expect(
      orderChannelDispatchError(channel, {
        delivery: { recipientName: "Guest", address: "Westlands 10" },
      }),
    ).toBeNull();
    expect(
      orderChannelDispatchError(channel, {
        delivery: { recipientName: " ", address: "Westlands 10" },
      }),
    ).toMatch(/Customer/);
    expect(
      orderChannelDispatchError(channel, {
        delivery: { recipientName: "Guest", address: "x".repeat(501) },
      }),
    ).toMatch(/address/);
    expect(
      orderChannelDispatchError({ requiresCustomer: false, requiresAddress: false }, {}),
    ).toBeNull();
  });
  it("rejects direct dispatch before any KOT/state change and persists valid delivery through hold/edit/send", () => {
    const settings = createDefaultDemoPlatformState();
    const repository = new ConfigurationRepository(settings);
    setConfigurationRepositoryForTests(repository);
    const tenant = settings.tenants[0]!;
    const branch = settings.branches.find((row) => row.tenantId === tenant.id)!;
    const delivery = {
      ...settings.orderChannels.find((row) => row.tenantId === tenant.id)!,
      id: "test-own-delivery",
      code: "CHECK_DELIVERY",
      channelType: "OWN_DELIVERY" as const,
      requiresCustomer: true,
      requiresAddress: true,
    };
    repository.upsertOrderChannel(tenant.id, delivery);
    expect(delivery.requiresAddress).toBe(true);
    const draft: OrderDraft = {
      tenantId: tenant.id,
      branchId: branch.id,
      branch: branch.name,
      customer: "Walk-in",
      channel: delivery.code,
      cashier: "Cashier",
      lines: [
        {
          id: "meal",
          name: "Meal",
          category: "MAIN",
          quantity: 1,
          unitPrice: 100,
          productionStation: "MAIN",
        },
      ],
    };
    const held = TransactionEngine.holdOrder(createEmptyTransactionState(tenant.id), draft);
    const unchanged = structuredClone(held);
    expect(() => TransactionEngine.sendToKitchen(held, held.orders[0]!.id, "Cashier")).toThrow(
      /Customer name/,
    );
    expect(held).toEqual(unchanged);
    const edited = TransactionEngine.updateOrderDraft(
      held,
      held.orders[0]!.id,
      {
        ...draft,
        delivery: {
          status: "UNASSIGNED",
          recipientName: "Test recipient",
          address: "Westlands 10",
        },
      },
      "Cashier",
    );
    const sent = TransactionEngine.sendToKitchen(edited, held.orders[0]!.id, "Cashier");
    expect(sent.orders[0]!.delivery).toMatchObject({
      recipientName: "Test recipient",
      address: "Westlands 10",
    });
    expect(sent.orders[0]!.status).toBe("SENT_TO_KITCHEN");
    expect(sent.kitchenPrintObligations?.length).toBeGreaterThan(0);
  });
});
