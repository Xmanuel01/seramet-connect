import type { Product } from "@/lib/menu-product";
import type { ExternalResourceMapping } from "@/integrations/runtime/models";
import { stableHash } from "@/integrations/runtime/idempotency-service";
import {
  parseMarketplaceConnectionConfig,
  type ChannelAvailabilityOverride,
  type MarketplaceMenuItem,
  type MarketplaceSyncPreview,
  type NormalizedMarketplaceMenu,
  type PriceList,
} from "@/integrations/marketplace/types";
import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";
import type { Branch, IntegrationConnection, Tenant } from "@/platform/types";

export type MarketplaceMenuBuildInput = {
  tenant: Tenant;
  branch: Branch;
  connection: IntegrationConnection;
  state: TransactionState;
  mappings: ExternalResourceMapping[];
  externalStoreId: string;
  catalog: Product[];
};

export async function buildMarketplaceMenu(
  input: MarketplaceMenuBuildInput,
): Promise<NormalizedMarketplaceMenu> {
  const priceList = parsePriceList(input.connection.configuration["priceList"], input.tenant.id);
  const overrides = parseAvailabilityOverrides(
    input.connection.configuration["availabilityOverrides"],
  );
  if (input.catalog.length === 0) {
    throw new Error("The authoritative menu catalog is empty; marketplace sync was not prepared");
  }
  const categories = Array.from(new Set(input.catalog.map((product) => product.category)));
  const items: MarketplaceMenuItem[] = input.catalog.map((product) => {
    const mapping = findMapping(input.mappings, "ITEM", product.id);
    const availability = TransactionEngine.getProductAvailability(
      input.state,
      input.branch.name,
      product.id,
    );
    const override = overrides.find(
      (candidate) =>
        candidate.connectionId === input.connection.id &&
        candidate.branchId === input.branch.id &&
        candidate.internalItemId === product.id,
    );
    const configuredPrice = priceList?.items.find(
      (candidate) => candidate.internalItemId === product.id && candidate.active,
    )?.price;
    const branchPrice = product.branchPrices?.[input.branch.name];
    const available =
      override?.available ??
      (product.branchAvailability?.[input.branch.name] !== false &&
        !product.out &&
        availability.available);
    return {
      internalId: product.id,
      ...(mapping?.externalId ? { externalId: mapping.externalId } : {}),
      ...(product.sku || product.itemCode ? { sku: product.sku ?? product.itemCode } : {}),
      name: product.name,
      price: configuredPrice ?? branchPrice ?? product.price,
      available,
      ...(override?.quantityAvailable !== undefined
        ? { quantityAvailable: override.quantityAvailable }
        : availability.portions !== undefined
          ? { quantityAvailable: Math.max(0, Math.floor(availability.portions)) }
          : {}),
      categoryIds: [categoryId(product.category)],
      modifierGroupIds: [],
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      metadata: {
        productionStation: product.productionStation ?? "NONE",
        prepMinutes: product.prep,
      },
    };
  });
  return {
    storeId: input.externalStoreId,
    currency: priceList?.currency ?? input.tenant.defaultCurrency,
    locale: input.tenant.locale,
    menus: [
      {
        internalId: `menu-${input.branch.id}`,
        name: `${input.branch.name} Menu`,
        categoryIds: categories.map(categoryId),
      },
    ],
    categories: categories.map((name) => {
      const internalId = categoryId(name);
      const mapping = findMapping(input.mappings, "CATEGORY", internalId);
      return {
        internalId,
        ...(mapping?.externalId ? { externalId: mapping.externalId } : {}),
        name,
        itemIds: input.catalog
          .filter((product) => product.category === name)
          .map((product) => product.id),
        metadata: {},
      };
    }),
    items,
    modifierGroups: [],
    metadata: {
      tenantId: input.tenant.id,
      branchId: input.branch.id,
      connectionId: input.connection.id,
      sourceOfTruth: parseMarketplaceConnectionConfig(input.connection.configuration).menuSyncMode,
    },
  };
}

export async function previewMarketplaceMenuSync(
  connection: IntegrationConnection,
  menu: NormalizedMarketplaceMenu,
  mappings: ExternalResourceMapping[],
): Promise<MarketplaceSyncPreview> {
  const operations: MarketplaceSyncPreview["operations"] = [];
  for (const item of menu.items) {
    const mapping = findMapping(mappings, "ITEM", item.internalId);
    const next = snapshot(item);
    const internalHash = await stableHash(next);
    const previous = objectValue(mapping?.metadata["lastSyncedSnapshot"]);
    const changedExternally = Boolean(
      mapping?.lastExternalHash &&
      mapping.lastSyncedHash &&
      mapping.lastExternalHash !== mapping.lastSyncedHash,
    );
    const changedInternally = Boolean(
      mapping?.lastSyncedHash && internalHash !== mapping.lastSyncedHash,
    );
    let operation: MarketplaceSyncPreview["operations"][number]["operation"];
    if (!mapping) operation = "CREATE";
    else if (changedExternally && changedInternally) operation = "CONFLICT";
    else if (!Object.keys(previous).length) operation = "UPDATE";
    else if (Number(previous["price"]) !== item.price) operation = "UPDATE_PRICE";
    else if (Boolean(previous["available"]) !== item.available) operation = "UPDATE_AVAILABILITY";
    else if (mapping.lastInternalHash && mapping.lastInternalHash === internalHash)
      operation = "UNCHANGED";
    else operation = "UPDATE";
    operations.push({
      internalId: item.internalId,
      ...(mapping?.externalId ? { externalId: mapping.externalId } : {}),
      name: item.name,
      operation,
      ...(Object.keys(previous).length ? { previous } : {}),
      next,
    });
  }
  const currentIds = new Set(menu.items.map((item) => item.internalId));
  mappings
    .filter(
      (mapping) =>
        mapping.resourceType === "ITEM" &&
        mapping.status !== "DISABLED" &&
        !currentIds.has(mapping.internalId),
    )
    .forEach((mapping) =>
      operations.push({
        internalId: mapping.internalId,
        externalId: mapping.externalId,
        name: String(mapping.metadata["displayName"] ?? mapping.internalId),
        operation: "REMOVE",
        previous: objectValue(mapping.metadata["lastSyncedSnapshot"]),
      }),
    );
  const count = (operation: MarketplaceSyncPreview["operations"][number]["operation"]) =>
    operations.filter((candidate) => candidate.operation === operation).length;
  return {
    connectionId: connection.id,
    providerId: connection.providerId,
    menuHash: await stableHash(menu),
    generatedAt: new Date().toISOString(),
    counts: {
      unchanged: count("UNCHANGED"),
      priceChanges: count("UPDATE_PRICE"),
      availabilityChanges: count("UPDATE_AVAILABILITY"),
      newItems: count("CREATE"),
      unmapped: operations.filter(
        (operation) => operation.operation !== "REMOVE" && !operation.externalId,
      ).length,
      removed: count("REMOVE"),
      conflicts: count("CONFLICT"),
    },
    operations,
    destructive: count("REMOVE") > 0,
  };
}

export async function itemSyncHash(item: MarketplaceMenuItem) {
  return stableHash(snapshot(item));
}

export function snapshot(item: MarketplaceMenuItem) {
  return {
    internalId: item.internalId,
    sku: item.sku ?? null,
    name: item.name,
    description: item.description ?? null,
    price: item.price,
    available: item.available,
    quantityAvailable: item.quantityAvailable ?? null,
    categoryIds: [...item.categoryIds].sort(),
    modifierGroupIds: [...item.modifierGroupIds].sort(),
    imageUrl: item.imageUrl ?? null,
  };
}

function findMapping(
  mappings: ExternalResourceMapping[],
  type: ExternalResourceMapping["resourceType"],
  internalId: string,
) {
  return mappings.find(
    (mapping) =>
      mapping.resourceType === type &&
      mapping.internalId === internalId &&
      mapping.status !== "DISABLED",
  );
}

function categoryId(name: string) {
  return `category-${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
}

function parsePriceList(value: unknown, tenantId: string): PriceList | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Partial<PriceList>;
  if (!row.id || !row.name || !row.currency || row.active === false || !Array.isArray(row.items))
    return undefined;
  return {
    id: row.id,
    tenantId,
    name: row.name,
    currency: row.currency,
    active: true,
    items: row.items.filter(
      (item) =>
        Boolean(item) && typeof item.internalItemId === "string" && Number.isFinite(item.price),
    ),
    metadata: objectValue(row.metadata),
  };
}

function parseAvailabilityOverrides(value: unknown): ChannelAvailabilityOverride[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is ChannelAvailabilityOverride =>
      Boolean(row) &&
      typeof row === "object" &&
      typeof (row as ChannelAvailabilityOverride).tenantId === "string" &&
      typeof (row as ChannelAvailabilityOverride).branchId === "string" &&
      typeof (row as ChannelAvailabilityOverride).connectionId === "string" &&
      typeof (row as ChannelAvailabilityOverride).internalItemId === "string" &&
      typeof (row as ChannelAvailabilityOverride).available === "boolean",
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
