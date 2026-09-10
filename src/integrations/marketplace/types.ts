export type MarketplaceMenuSyncMode =
  "MANUAL" | "SERAMET_TO_PROVIDER" | "PROVIDER_TO_SERAMET" | "BIDIRECTIONAL";

export type MarketplaceAcceptancePolicy = "MANUAL" | "AUTO_ACCEPT_VALID" | "AUTO_ACCEPT_ALL_MAPPED";

export type MarketplaceUnmappedItemPolicy =
  "AUTO_REJECT" | "MANAGER_REVIEW" | "USE_EXTERNAL_DESCRIPTION";

export type MarketplaceCapacityMode = "NORMAL" | "BUSY" | "VERY_BUSY" | "PAUSED";
export type MarketplaceStoreStatus = "OPEN" | "PAUSED" | "CLOSED_TEMPORARILY";

export type MarketplaceConnectionConfig = {
  orderChannelId: string;
  acceptancePolicy: MarketplaceAcceptancePolicy;
  unmappedItemPolicy: MarketplaceUnmappedItemPolicy;
  menuSyncMode: MarketplaceMenuSyncMode;
  availabilitySyncEnabled: boolean;
  priceSyncEnabled: boolean;
  auto86Enabled: boolean;
  storeStatusSyncEnabled: boolean;
  defaultPrepMinutes: number;
  maximumPrepMinutes: number;
  scheduledOrderBufferMinutes: number;
  allowScheduledOrders: boolean;
  fallbackStationId?: string;
  externalPaymentMethodId?: string;
  settlementAccountId?: string;
  currencyMinorUnitFactor: number;
  slaWarningMinutes: number;
  metadata: Record<string, unknown>;
};

export type MarketplaceFulfilmentType = "PROVIDER_DELIVERY" | "OWN_DELIVERY" | "PICKUP";

export type NormalizedMarketplaceMenu = {
  storeId: string;
  currency: string;
  locale: string;
  menus: Array<{
    internalId: string;
    name: string;
    categoryIds: string[];
    serviceAvailability?: Array<{
      dayOfWeek: string;
      startTime: string;
      endTime: string;
    }>;
  }>;
  categories: Array<{
    internalId: string;
    externalId?: string;
    name: string;
    description?: string;
    itemIds: string[];
    metadata: Record<string, unknown>;
  }>;
  items: MarketplaceMenuItem[];
  modifierGroups: Array<{
    internalId: string;
    externalId?: string;
    name: string;
    minSelections: number;
    maxSelections: number;
    modifiers: Array<{
      internalId: string;
      externalId?: string;
      name: string;
      price: number;
      available: boolean;
      metadata: Record<string, unknown>;
    }>;
    metadata: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
};

export type MarketplaceMenuItem = {
  internalId: string;
  externalId?: string;
  sku?: string;
  name: string;
  description?: string;
  price: number;
  tax?: number;
  imageUrl?: string;
  available: boolean;
  quantityAvailable?: number;
  categoryIds: string[];
  modifierGroupIds: string[];
  metadata: Record<string, unknown>;
};

export type PriceList = {
  id: string;
  tenantId: string;
  name: string;
  currency: string;
  active: boolean;
  items: PriceListItem[];
  metadata: Record<string, unknown>;
};

export type PriceListItem = {
  internalItemId: string;
  price: number;
  active: boolean;
};

export type ChannelPriceMapping = {
  id: string;
  tenantId: string;
  connectionId: string;
  priceListId: string;
  active: boolean;
};

export type ChannelAvailabilityOverride = {
  tenantId: string;
  branchId: string;
  connectionId: string;
  internalItemId: string;
  available: boolean;
  quantityAvailable?: number;
  reason?: string;
  updatedAt: string;
};

export type MarketplaceSyncStatus =
  "NOT_SYNCED" | "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT" | "SPEC_REQUIRED";

export type MarketplaceSyncPreview = {
  connectionId: string;
  providerId: string;
  menuHash: string;
  generatedAt: string;
  counts: {
    unchanged: number;
    priceChanges: number;
    availabilityChanges: number;
    newItems: number;
    unmapped: number;
    removed: number;
    conflicts: number;
  };
  operations: Array<{
    internalId: string;
    externalId?: string;
    name: string;
    operation:
      | "UNCHANGED"
      | "CREATE"
      | "UPDATE_PRICE"
      | "UPDATE_AVAILABILITY"
      | "UPDATE"
      | "REMOVE"
      | "CONFLICT"
      | "UNMAPPED";
    previous?: Record<string, unknown>;
    next?: Record<string, unknown>;
  }>;
  destructive: boolean;
};

export type MarketplaceRejectionReason =
  | "ITEM_UNAVAILABLE"
  | "STORE_CLOSED"
  | "ITEM_MAPPING_ERROR"
  | "PRICE_MISMATCH"
  | "INVALID_ORDER"
  | "CAPACITY"
  | "TECHNICAL_FAILURE"
  | "OTHER";

export function parseMarketplaceConnectionConfig(
  value: Record<string, unknown>,
): MarketplaceConnectionConfig {
  return {
    orderChannelId: stringValue(value["orderChannelId"] ?? value["channelId"]),
    acceptancePolicy: enumValue(
      value["acceptancePolicy"],
      ["MANUAL", "AUTO_ACCEPT_VALID", "AUTO_ACCEPT_ALL_MAPPED"] as const,
      "AUTO_ACCEPT_VALID",
    ),
    unmappedItemPolicy: enumValue(
      value["unmappedItemPolicy"],
      ["AUTO_REJECT", "MANAGER_REVIEW", "USE_EXTERNAL_DESCRIPTION"] as const,
      "AUTO_REJECT",
    ),
    menuSyncMode: enumValue(
      value["menuSyncMode"],
      ["MANUAL", "SERAMET_TO_PROVIDER", "PROVIDER_TO_SERAMET", "BIDIRECTIONAL"] as const,
      "SERAMET_TO_PROVIDER",
    ),
    availabilitySyncEnabled: booleanValue(value["availabilitySyncEnabled"], true),
    priceSyncEnabled: booleanValue(value["priceSyncEnabled"], true),
    auto86Enabled: booleanValue(value["auto86Enabled"], true),
    storeStatusSyncEnabled: booleanValue(value["storeStatusSyncEnabled"], false),
    defaultPrepMinutes: boundedNumber(value["defaultPrepMinutes"], 25, 1, 240),
    maximumPrepMinutes: boundedNumber(value["maximumPrepMinutes"], 90, 1, 480),
    scheduledOrderBufferMinutes: boundedNumber(value["scheduledOrderBufferMinutes"], 5, 0, 120),
    allowScheduledOrders: booleanValue(value["allowScheduledOrders"], true),
    ...(stringValue(value["fallbackStationId"])
      ? { fallbackStationId: stringValue(value["fallbackStationId"]) }
      : {}),
    ...(stringValue(value["externalPaymentMethodId"])
      ? { externalPaymentMethodId: stringValue(value["externalPaymentMethodId"]) }
      : {}),
    ...(stringValue(value["settlementAccountId"])
      ? { settlementAccountId: stringValue(value["settlementAccountId"]) }
      : {}),
    currencyMinorUnitFactor: boundedNumber(value["currencyMinorUnitFactor"], 100, 1, 1000),
    slaWarningMinutes: boundedNumber(value["slaWarningMinutes"], 20, 1, 240),
    metadata: objectValue(value["marketplaceMetadata"] ?? value["metadata"]),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}
