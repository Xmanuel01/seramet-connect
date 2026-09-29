import { afterEach, describe, expect, it } from "vitest";
import type { ProviderAdapter } from "@/integrations/types";
import { ProviderRegistry } from "@/integrations/provider-registry";
import { ProviderService } from "@/integrations/provider-service";
import { SerametPrintService, type OrderForPrint } from "@/lib/seramet-print-service";
import { authorizeSerametMutation, type ServerActor } from "@/lib/seramet-auth";
import { MemoryTransactionRepository } from "@/lib/seramet-repository";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import { OrderChannelService } from "@/orders/order-channel-service";
import { PaymentMethodService } from "@/payments/payment-method-service";
import { createDefaultDemoPlatformState } from "@/platform/demo/default-demo-data";
import { getConfiguredBranchHardwareProfile } from "@/platform/adapters/print-profile-adapter";
import { migrateLegacyPlatformState } from "@/platform/migrations/legacy-platform-migration";
import { permissions } from "@/platform/permissions";
import {
  ConfigurationRepository,
  PlatformConfigurationError,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import type { PlatformState, ProviderDefinition } from "@/platform/types";

const tenantA = "tenant-harbor-house";
const tenantB = "tenant-forest-cafe";
const branchA = "branch-harbor-quay";
const branchB = "branch-forest-hill";

afterEach(() => {
  setConfigurationRepositoryForTests(undefined);
});

describe.sequential("pass 1 platform foundation acceptance", () => {
  it("isolates configuration and operational snapshots by tenant", async () => {
    const repository = new ConfigurationRepository(twoTenantState());
    expect(repository.listBranches(tenantA).map((branch) => branch.id)).toEqual([branchA]);
    expect(repository.listBranches(tenantB).map((branch) => branch.id)).toEqual([branchB]);
    expect(() =>
      repository.upsertBranch(tenantA, {
        ...repository.getBranch(tenantB, branchB),
        name: "Cross tenant write",
      }),
    ).toThrow("Cross-tenant");

    const transactions = new MemoryTransactionRepository();
    const actorA = actor(tenantA, branchA, [permissions.ordersCreate]);
    const actorB = actor(tenantB, branchB, [permissions.ordersCreate]);
    const stateA = createEmptyTransactionState(tenantA);
    const stateB = createEmptyTransactionState(tenantB);
    stateA.orders = [];
    stateB.orders = [];
    await transactions.saveState(stateA, actorA, "Tenant A acceptance state");
    await transactions.saveState(stateB, actorB, "Tenant B acceptance state");
    expect((await transactions.loadState(tenantA)).tenantId).toBe(tenantA);
    expect((await transactions.loadState(tenantB)).tenantId).toBe(tenantB);
    await expect(transactions.saveState(stateA, actorB, "Blocked")).rejects.toThrow("Cross-tenant");
  });

  it("adds an arbitrary branch without changing source", () => {
    const repository = new ConfigurationRepository(twoTenantState());
    repository.upsertBranch(tenantA, {
      id: "branch-harbor-airport",
      tenantId: tenantA,
      code: "AIR",
      name: "Airport Concourse",
      address: "Terminal 4",
      phone: "+1 555 0104",
      email: "airport@example.test",
      active: true,
      metadata: {},
    });
    expect(repository.resolveBranch(tenantA, "Airport Concourse").id).toBe("branch-harbor-airport");
  });

  it("exposes an arbitrary wallet through the payment configuration service", () => {
    const repository = new ConfigurationRepository(twoTenantState());
    repository.upsertPaymentMethod(tenantA, {
      id: "payment-example-wallet",
      tenantId: tenantA,
      code: "EXAMPLE_WALLET",
      displayName: "Example Wallet",
      category: "DIGITAL_WALLET",
      enabled: true,
      sortOrder: 10,
      requiresReference: true,
      requiresCustomer: false,
      supportsRefund: true,
      supportsSplit: true,
      settlementAccountId: "wallet-clearing",
      metadata: {},
    });
    expect(new PaymentMethodService(repository).listActive(tenantA)[0]?.displayName).toBe(
      "Example Wallet",
    );
  });

  it("exposes an arbitrary marketplace through the order channel service", () => {
    const repository = new ConfigurationRepository(twoTenantState());
    repository.upsertOrderChannel(tenantA, {
      id: "channel-example-marketplace",
      tenantId: tenantA,
      code: "EXAMPLE_MARKETPLACE",
      displayName: "Example Marketplace",
      channelType: "MARKETPLACE",
      enabled: true,
      requiresCustomer: false,
      requiresTable: false,
      requiresAddress: false,
      isExternallyPaid: true,
      sortOrder: 10,
      metadata: { priceMultiplier: 1.08 },
    });
    expect(new OrderChannelService(repository).listActive(tenantA)[0]?.displayName).toBe(
      "Example Marketplace",
    );
  });

  it("registers and resolves a dummy provider by ID and capability", () => {
    const definition: ProviderDefinition = {
      id: "provider-example",
      code: "EXAMPLE",
      displayName: "Example Provider",
      category: "PAYMENT",
      version: "v1",
      capabilities: ["PAYMENT_PROMPT"],
      configurationSchema: {},
      secretFields: ["apiKey"],
      enabled: true,
    };
    const adapter: ProviderAdapter = {
      definition,
      healthCheck: async () => ({
        status: "HEALTHY",
        checkedAt: new Date().toISOString(),
        message: "Ready",
      }),
    };
    const state = twoTenantState();
    state.providers.push(definition);
    state.connections.push({
      id: "connection-example",
      tenantId: tenantA,
      branchId: branchA,
      providerId: definition.id,
      environment: "SANDBOX",
      status: "SANDBOX",
      consecutiveFailures: 0,
      displayName: "Example account",
      configuration: {},
      secretReference: "secret://example/provider",
      metadata: {},
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const service = new ProviderService(
      new ConfigurationRepository(state),
      new ProviderRegistry().register(adapter),
    );
    expect(
      service.resolveConnection(tenantA, "connection-example", "PAYMENT_PROMPT").adapter.definition
        .id,
    ).toBe(definition.id);
    expect(() => service.resolveConnection(tenantA, "connection-example", "REFUND")).toThrow(
      "does not support",
    );
  });

  it("routes arbitrary printer device IDs to primary and fallback destinations", () => {
    const state = configuredRestaurantState();
    const kitchen = state.devices.find((device) => device.id === "device-harbor-kitchen")!;
    kitchen.healthStatus = "OFFLINE";
    const repository = new ConfigurationRepository(state);
    setConfigurationRepositoryForTests(repository);
    const profile = getConfiguredBranchHardwareProfile(branchA, tenantA);
    const resolution = SerametPrintService.resolvePrinter(profile, "FOOD_KOT", "MAIN KITCHEN");
    expect(resolution.routeMode).toBe("fallback");
    expect(resolution.fallbackPrinter?.id).toBe("device-harbor-counter");
  });

  it("renders configured identity in bill, receipt, invoice and KOT output", () => {
    const repository = new ConfigurationRepository(configuredRestaurantState());
    setConfigurationRepositoryForTests(repository);
    const profile = getConfiguredBranchHardwareProfile(branchA, tenantA);
    const order = printOrder();
    const customerDocuments = (["BILL", "RECEIPT", "INVOICE"] as const).map(
      (type) => SerametPrintService.createDocumentJob(profile, order, type).content,
    );
    const kot = SerametPrintService.createProductionTicketJobs(profile, order, [], "NEW").jobs[0]
      ?.content;
    [...customerDocuments, kot].forEach((content) => {
      expect(content?.toUpperCase()).toContain("HARBOR HOUSE");
    });
    expect(customerDocuments[2]).toContain("TAX-HH-7788");
    expect(customerDocuments[0]).toContain("9 Quay Avenue");
  });

  it("migrates arbitrary legacy branch names and preserves records", () => {
    const migrated = migrateLegacyPlatformState({
      companyName: "Forest Cafe",
      branches: ["All Branches", "Hill Pavilion", "River Annex"],
      warehouses: [
        { name: "Dry Store", branch: "Hill Pavilion", type: "MAIN" },
        { name: "Cold Room", branch: "River Annex", type: "COLD" },
      ],
      paymentMethods: ["Example Wallet", "Notes and Coins"],
      orderChannels: ["Patio QR", "Example Marketplace"],
      roles: [{ name: "Service Captain", permissions: [permissions.ordersCreate] }],
    });
    expect(migrated.branches.map((branch) => branch.name)).toEqual([
      "Hill Pavilion",
      "River Annex",
    ]);
    expect(migrated.warehouses).toHaveLength(2);
    expect(migrated.paymentMethods).toHaveLength(2);
    expect(migrated.orderChannels).toHaveLength(2);
    expect(migrated.roles[0]?.name).toBe("Service Captain");
    migrated.warehouses.forEach((warehouse) => expect(warehouse.branchId).toBeTruthy());
  });

  it("authorizes a custom role by permission rather than role name", () => {
    const customActor = actor(tenantA, branchA, [permissions.ordersUpdate]);
    customActor.role = "Service Captain";
    expect(() =>
      authorizeSerametMutation(customActor, "sendToKitchen", tenantA, branchA),
    ).not.toThrow();
  });

  it("returns explicit errors when active configuration is missing", () => {
    const repository = new ConfigurationRepository(twoTenantState());
    expect(() => new PaymentMethodService(repository).requireActive(tenantA, "missing")).toThrow(
      "No active payment methods",
    );
    expect(() => new OrderChannelService(repository).requireActive(tenantA, "missing")).toThrow(
      "No active order channels",
    );
    expect(() => repository.getDocumentIdentity(tenantA, branchA)).toThrow(
      "Business profile not configured",
    );
    expect(() =>
      new ProviderService(repository, new ProviderRegistry()).resolveConnection(tenantA, "missing"),
    ).toThrow("Provider connection incomplete");
  });
});

function actor(tenantId: string, branchId: string, actorPermissions: string[]): ServerActor {
  return {
    id: `actor-${tenantId}`,
    name: "Configured operator",
    tenantId,
    roleIds: ["role-custom"],
    permissions: actorPermissions,
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branchId }],
    branchScope: { type: "BRANCH", branchId },
    branchId,
    role: "Arbitrary configured role",
    branch: branchId,
  };
}

function twoTenantState(): PlatformState {
  const updatedAt = "2026-08-01T00:00:00.000Z";
  return {
    schemaVersion: 2,
    tenants: [tenant(tenantA, "Harbor House"), tenant(tenantB, "Forest Cafe")],
    brands: [],
    branches: [branch(tenantA, branchA, "Harbor Quay"), branch(tenantB, branchB, "Forest Hill")],
    warehouses: [],
    departments: [],
    stations: [],
    serviceAreas: [],
    tables: [],
    paymentMethods: [],
    orderChannels: [],
    providers: [],
    connections: [],
    devices: [],
    printRoutes: [],
    documentIdentities: [],
    documentTemplates: [],
    roles: [],
    users: [],
    updatedAt,
  };
}

function configuredRestaurantState(): PlatformState {
  const state = twoTenantState();
  state.branches[0]!.metadata = {
    kitchenMode: "PRINTER_ONLY",
    posTerminals: 1,
    capabilities: {
      POS_ENABLED: true,
      TABLE_SERVICE: true,
      KDS_ENABLED: false,
      KITCHEN_PRINTING: true,
      BAR_PRINTING: true,
      RESERVATIONS: true,
      TAKEAWAY: true,
      DELIVERY: true,
      ONLINE_ORDERS: true,
      LOYALTY: true,
      CUSTOMER_DISPLAY: false,
      BAR_MODULE: true,
      RECEIPT_PRINTING: true,
      INVOICE_PRINTING: true,
    },
  };
  state.stations.push({
    id: "station-harbor-kitchen",
    tenantId: tenantA,
    branchId: branchA,
    code: "MAIN-KITCHEN",
    name: "Main Kitchen",
    stationType: "KITCHEN",
    active: true,
  });
  state.devices.push(
    {
      id: "device-harbor-counter",
      tenantId: tenantA,
      branchId: branchA,
      name: "Quay Counter Device",
      deviceType: "PRINTER",
      connectionType: "NETWORK",
      driver: "ESC/POS",
      address: "10.0.0.21",
      enabled: true,
      healthStatus: "ONLINE",
      outputRoles: ["CUSTOMER_DOCUMENT", "OFFICE"],
      metadata: {},
    },
    {
      id: "device-harbor-kitchen",
      tenantId: tenantA,
      branchId: branchA,
      name: "Quay Production Device",
      deviceType: "PRINTER",
      connectionType: "NETWORK",
      driver: "ESC/POS",
      address: "10.0.0.22",
      enabled: true,
      healthStatus: "ONLINE",
      outputRoles: ["KITCHEN", "BAR"],
      metadata: {},
    },
    {
      id: "device-harbor-office",
      tenantId: tenantA,
      branchId: branchA,
      name: "Quay Office Device",
      deviceType: "PRINTER",
      connectionType: "NETWORK",
      driver: "PCL",
      address: "10.0.0.23",
      enabled: true,
      healthStatus: "ONLINE",
      outputRoles: ["REPORT"],
      metadata: {},
    },
  );
  state.printRoutes.push(
    ...["BILL", "RECEIPT", "INVOICE"].map((documentType) => ({
      id: `route-harbor-${documentType.toLowerCase()}`,
      tenantId: tenantA,
      branchId: branchA,
      documentType,
      primaryDeviceId: "device-harbor-counter",
      copies: 1,
      enabled: true,
    })),
    {
      id: "route-harbor-kot",
      tenantId: tenantA,
      branchId: branchA,
      documentType: "KOT",
      stationId: "station-harbor-kitchen",
      primaryDeviceId: "device-harbor-kitchen",
      fallbackDeviceId: "device-harbor-counter",
      copies: 1,
      enabled: true,
    },
    {
      id: "route-harbor-bar",
      tenantId: tenantA,
      branchId: branchA,
      documentType: "BAR_TICKET",
      primaryDeviceId: "device-harbor-kitchen",
      fallbackDeviceId: "device-harbor-counter",
      copies: 1,
      enabled: true,
    },
    ...["DISPATCH_TICKET", "KDS_TICKET", "REPORT"].map((documentType) => ({
      id: `route-harbor-${documentType.toLowerCase()}`,
      tenantId: tenantA,
      branchId: branchA,
      documentType,
      primaryDeviceId: "device-harbor-counter",
      copies: 1,
      enabled: true,
    })),
  );
  state.documentIdentities.push({
    id: "identity-harbor",
    tenantId: tenantA,
    branchId: branchA,
    businessName: "Harbor House",
    legalName: "Harbor House Hospitality Inc",
    address: "9 Quay Avenue",
    phone: "+1 555 0123",
    email: "hello@harbor.example",
    taxNumber: "TAX-HH-7788",
    currency: "USD",
    paymentInstructions: ["Example Wallet account HH-01"],
    footerMessage: "Thank you for dining with us.",
    metadata: { receiptBrand: "HARBOR HOUSE", payment: {} },
  });
  state.documentTemplates.push(
    ...["BILL", "RECEIPT", "KOT", "BAR_TICKET", "DISPATCH_TICKET", "KDS_TICKET", "REPORT"].map(
      (documentType) => ({
        id: `template-harbor-${documentType.toLowerCase()}`,
        tenantId: tenantA,
        branchId: branchA,
        documentType,
        width: "80mm" as const,
        copies: 1,
        showLogo: true,
        showBranch: true,
        showCashier: true,
        showCustomer: true,
        showTax: true,
        showPayment: true,
        showQrCode: false,
        footerMessage: "Thank you for dining with us.",
        layoutVersion: "seramet-approved-v1",
        active: true,
      }),
    ),
    {
      id: "template-harbor-invoice",
      tenantId: tenantA,
      branchId: branchA,
      documentType: "INVOICE",
      width: "A4",
      copies: 1,
      showLogo: true,
      showBranch: true,
      showCashier: true,
      showCustomer: true,
      showTax: true,
      showPayment: true,
      showQrCode: false,
      footerMessage: "Thank you for dining with us.",
      layoutVersion: "seramet-approved-v1",
      active: true,
    },
  );
  return state;
}

function tenant(id: string, name: string) {
  return {
    id,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    legalName: `${name} Limited`,
    tradingName: name,
    active: true,
    defaultCurrency: "USD",
    timezone: "America/New_York",
    locale: "en-US",
    countryCode: "US",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function branch(tenantId: string, id: string, name: string) {
  return {
    id,
    tenantId,
    code: name.slice(0, 3).toUpperCase(),
    name,
    address: "",
    phone: "",
    email: "",
    active: true,
    metadata: {},
  };
}

function printOrder(): OrderForPrint {
  return {
    orderId: "ORD-00001",
    branch: "Harbor Quay",
    terminalId: "HBR-POS-01",
    table: "Q4",
    orderType: "Dine-In",
    requestedBy: "Alex Morgan",
    cashier: "Alex Morgan",
    waiter: "Alex Morgan",
    createdAt: "2026-08-29T10:00:00.000Z",
    customer: "Walk-in Customer",
    lines: [
      {
        id: "line-1",
        name: "Quay Chowder",
        category: "Mains",
        quantity: 1,
        unitPrice: 2400,
        productionStation: "MAIN KITCHEN",
      },
    ],
    subtotal: 2400,
    tax: 240,
    total: 2640,
    paid: 2640,
    change: 0,
    paymentMethod: "Example Wallet",
    paymentReference: "EXAMPLE-1001",
  };
}
