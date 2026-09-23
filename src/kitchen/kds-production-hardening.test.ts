import { beforeEach, describe, expect, it } from "vitest";
import { buildKitchenTickets, shouldShowKitchenOrder } from "@/kitchen/kds-model";
import {
  TransactionEngine,
  createEmptyTransactionState,
  type TransactionOrder,
} from "@/lib/transaction-engine";
import {
  SerametPrintService,
  branchHardwareProfiles,
  type OrderForPrint,
} from "@/lib/seramet-print-service";
import type { Product } from "@/lib/menu-product";
import type { Station } from "@/platform/types";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

beforeEach(() => {
  setConfigurationRepositoryForTests(new ConfigurationRepository(createDefaultDemoPlatformState()));
});

const branch = "Westlands";

function order(overrides: Partial<TransactionOrder> = {}): TransactionOrder {
  return {
    id: "ORD-KDS-001",
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    branch,
    table: "12",
    customer: "Guest",
    channel: "Dine-In",
    cashier: "Cashier",
    waiter: "Waiter",
    status: "SENT_TO_KITCHEN",
    paymentStatus: "UNPAID",
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    lines: [
      {
        id: "LINE-FRYER",
        productId: "FOOD-FRY",
        name: "Masala Chips",
        category: "Sides",
        quantity: 1,
        unitPrice: 450,
        productionStation: "FRYER-2",
        productionStatus: "NEW",
        sentAt: "2026-09-23T10:05:00.000Z",
        itemNote: "No salt",
      },
    ],
    subtotal: 450,
    tax: 0,
    total: 450,
    ...overrides,
  };
}

const stations: Station[] = [
  {
    id: "station-fryer-2",
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    code: "FRYER-2",
    name: "Fryer Two",
    stationType: "FRYER",
    active: true,
  },
];

const menu: Product[] = [
  {
    id: "FOOD-FRY",
    name: "Masala Chips",
    category: "Sides",
    price: 450,
    prep: 10,
    productionStation: "FRYER-2",
  },
];

describe("KDS production hardening", () => {
  it("renders arbitrary configured stations and uses sent time plus menu prep for SLA", () => {
    const tickets = buildKitchenTickets(
      order(),
      stations,
      menu,
      Date.parse("2026-09-23T10:13:00.000Z"),
    );

    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      station: "FRYER-2",
      stationLabel: "Fryer Two",
      stationConfigured: true,
      ageMinutes: 8,
      targetMinutes: 10,
      slaState: "APPROACHING",
      items: [{ id: "LINE-FRYER", label: "Masala Chips x1", note: "No salt" }],
    });
  });

  it("keeps a financially paid order visible until production is actually complete", () => {
    const paid = order({ status: "PAID", paymentStatus: "PAID" });
    expect(shouldShowKitchenOrder(paid)).toBe(true);

    paid.lines[0]!.productionStatus = "SERVED";
    expect(shouldShowKitchenOrder(paid)).toBe(false);
  });

  it("keeps PAID as the financial terminal state while allowing unfinished production to advance", () => {
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    state.orders.push(order({ status: "PAID", paymentStatus: "PAID" }));

    const preparing = TransactionEngine.setProductionStationStatus(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "PREPARING",
      "Chef",
    );

    expect(preparing.orders[0]).toMatchObject({
      status: "PAID",
      paymentStatus: "PAID",
    });
    expect(preparing.orders[0]!.lines[0]).toMatchObject({
      productionStatus: "PREPARING",
    });
  });

  it("rejects skipped production stages", () => {
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    state.orders.push(order());

    expect(() =>
      TransactionEngine.setProductionStationStatus(
        state,
        "ORD-KDS-001",
        "FRYER-2",
        "READY",
        "Chef",
      ),
    ).toThrow(/advance one stage at a time/);
  });

  it("posts recipe inventory exactly once when KDS completes every active station", () => {
    let state = createEmptyTransactionState(DEMO_TENANT_ID);
    state.inventory.push({
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      sku: "POTATO",
      name: "Potatoes",
      category: "Vegetables",
      branch,
      stock: 10,
      par: 2,
      unit: "kg",
      averageCost: 100,
      supplier: "Supplier",
      updatedAt: "2026-09-23T09:00:00.000Z",
    });
    state.recipes.push({
      id: "REC-FRY",
      tenantId: DEMO_TENANT_ID,
      productId: "FOOD-FRY",
      dish: "Masala Chips",
      yieldLabel: "1 portion",
      ingredients: [{ sku: "POTATO", quantity: 0.5 }],
      updatedAt: "2026-09-23T09:00:00.000Z",
    });
    state.orders.push(order());

    state = TransactionEngine.setProductionStationStatus(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "PREPARING",
      "Chef",
    );
    state = TransactionEngine.setProductionStationStatus(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "READY",
      "Chef",
    );
    state = TransactionEngine.setProductionStationStatus(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "SERVED",
      "Chef",
    );

    expect(state.orders[0]!.status).toBe("SERVED");
    expect(state.orders[0]!.inventoryPostedAt).toBeTruthy();
    expect(state.inventory[0]!.stock).toBe(9.5);
    expect(
      state.stockMovements.filter(
        (movement) => movement.reference === "ORD-KDS-001" && movement.type === "SALE_CONSUMPTION",
      ),
    ).toHaveLength(1);

    const replay = TransactionEngine.setProductionStationStatus(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "SERVED",
      "Chef",
    );
    expect(replay.inventory[0]!.stock).toBe(9.5);
    expect(
      replay.stockMovements.filter(
        (movement) => movement.reference === "ORD-KDS-001" && movement.type === "SALE_CONSUMPTION",
      ),
    ).toHaveLength(1);
  });

  it("requires a reason for READY-to-PREPARING rework and records the recall", () => {
    const state = createEmptyTransactionState(DEMO_TENANT_ID);
    const ready = order({ status: "READY" });
    ready.lines[0]!.productionStatus = "READY";
    ready.lines[0]!.productionStartedAt = "2026-09-23T10:06:00.000Z";
    ready.lines[0]!.productionReadyAt = "2026-09-23T10:12:00.000Z";
    state.orders.push(ready);

    expect(() =>
      TransactionEngine.recallProductionStation(
        state,
        "ORD-KDS-001",
        "FRYER-2",
        "",
        "Kitchen Manager",
      ),
    ).toThrow(/rework reason/);

    const recalled = TransactionEngine.recallProductionStation(
      state,
      "ORD-KDS-001",
      "FRYER-2",
      "Wrong modifier",
      "Kitchen Manager",
    );
    expect(recalled.orders[0]!.lines[0]).toMatchObject({
      productionStatus: "PREPARING",
      productionReworkCount: 1,
      productionLastReworkReason: "Wrong modifier",
    });
    expect(recalled.auditEvents[0]).toMatchObject({
      action: "Recalled FRYER-2 for rework",
    });
  });

  it("creates a real routed duplicate KOT for a dynamic station", () => {
    const base = branchHardwareProfiles[branch]!;
    const profile = {
      ...base,
      kitchenMode: "PRINTER_ONLY" as const,
      stationRoutes: { ...base.stationRoutes, "FRYER-2": "KITCHEN" as const },
    };
    const printOrder: OrderForPrint = {
      orderId: "ORD-KDS-001",
      branch,
      terminalId: "KDS-WST",
      table: "12",
      orderType: "Dine-In",
      requestedBy: "Kitchen Manager",
      cashier: "Cashier",
      waiter: "Waiter",
      createdAt: "2026-09-23T10:00:00.000Z",
      lines: [
        {
          id: "LINE-FRYER",
          name: "Masala Chips",
          category: "Sides",
          quantity: 1,
          unitPrice: 450,
          productionStation: "FRYER-2",
          itemNote: "No salt",
        },
      ],
      subtotal: 450,
      tax: 0,
      total: 450,
    };

    const plan = SerametPrintService.createProductionTicketJobs(profile, printOrder, [], "REPRINT");
    const physical = plan.jobs.find((job) => job.kitchenDelivery === "PRODUCTION_PRINT");

    expect(physical).toMatchObject({
      orderId: "ORD-KDS-001",
      productionStation: "FRYER-2",
      destination: "KITCHEN",
      amendmentType: "REPRINT",
      status: "Queued",
    });
    expect(physical?.content).toContain("No salt");
  });
});
