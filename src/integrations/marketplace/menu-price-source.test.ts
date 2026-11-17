import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildMarketplaceMenu,
  marketplaceMenuPriceSource,
} from "@/integrations/marketplace/marketplace-service";
import type { Product } from "@/lib/menu-product";
import { createEmptyTransactionState } from "@/lib/transaction-engine";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";
import type { IntegrationConnection } from "@/platform/types";

const repository = () => new ConfigurationRepository(createDefaultDemoPlatformState());
beforeEach(() => setConfigurationRepositoryForTests(repository()));
afterEach(() => setConfigurationRepositoryForTests(undefined));

const catalog: Product[] = [
  {
    id: "wrap",
    name: "Chicken wrap",
    category: "Mains",
    price: 900,
    onlinePriceMinor: 109_000,
    prep: 10,
  },
  { id: "fries", name: "Fries", category: "Sides", price: 300, prep: 5 },
  { id: "soda", name: "Soda", category: "Drinks", price: 150, onlinePriceMinor: 0, prep: 1 },
];

describe("the price an app's menu carries", () => {
  it("is the store price when the channel does not use online prices", async () => {
    expect(await prices({ useOnlinePrice: false })).toEqual({ wrap: 900, fries: 300, soda: 150 });
  });

  it("is each item's online price when the channel uses online prices", async () => {
    // Fries has no online price, so it keeps the store price; an explicit zero is honoured.
    expect(await prices({ useOnlinePrice: true })).toEqual({ wrap: 1090, fries: 300, soda: 0 });
  });

  it("can be set per app connection, whatever the channel says", async () => {
    expect(await prices({ useOnlinePrice: true }, { menuPriceSource: "STORE" })).toEqual({
      wrap: 900,
      fries: 300,
      soda: 150,
    });
    expect(await prices({ useOnlinePrice: false }, { menuPriceSource: "ONLINE" })).toMatchObject({
      wrap: 1090,
    });
    expect(
      marketplaceMenuPriceSource({ configuration: { menuPriceSource: "nonsense" } }, undefined),
    ).toBe("STORE");
  });

  it("uses the branch's own store price where one is set", async () => {
    const menu = await build({ useOnlinePrice: false }, {}, [
      { ...catalog[1]!, branchPrices: { Westlands: 350 } },
    ]);
    expect(menu.items[0]!.price).toBe(350);
  });
});

async function prices(channelMetadata: Record<string, unknown>, configuration = {}) {
  const menu = await build(channelMetadata, configuration, catalog);
  return Object.fromEntries(menu.items.map((item) => [item.internalId, item.price]));
}

function build(
  channelMetadata: Record<string, unknown>,
  configuration: Record<string, unknown>,
  products: Product[],
) {
  const config = repository();
  const connection: IntegrationConnection = {
    id: "connection-demo-glovo",
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    providerId: "glovo",
    environment: "SANDBOX",
    status: "ACTIVE",
    displayName: "Glovo",
    configuration,
    metadata: {},
    consecutiveFailures: 0,
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
  } as IntegrationConnection;
  return buildMarketplaceMenu({
    tenant: config.getTenant(DEMO_TENANT_ID),
    branch: config.getBranch(DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID),
    connection,
    state: createEmptyTransactionState(DEMO_TENANT_ID),
    mappings: [],
    externalStoreId: "store-1",
    catalog: products,
    channel: { metadata: channelMetadata },
  });
}
