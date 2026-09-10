import type { MarketplaceAdapterRuntime } from "@/integrations/delivery/adapter-runtime";
import { createMarketplaceAdapterRuntime } from "@/integrations/delivery/adapter-runtime";
import type { NormalizedMarketplaceMenu } from "@/integrations/marketplace/types";
import { normalizeIntegrationError } from "@/integrations/runtime/integration-errors";
import type {
  NormalizedExternalOrder,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderOperationResult,
  ProviderWebhookRequest,
} from "@/integrations/types";
import type { IntegrationConnection, ProviderDefinition } from "@/platform/types";

const uberApiBaseUrls = {
  SANDBOX: "https://test-api.uber.com",
  PRODUCTION: "https://api.uber.com",
} as const;
const uberLoginBaseUrls = {
  SANDBOX: "https://login.uber.com",
  PRODUCTION: "https://login.uber.com",
} as const;
const requiredScopes = [
  "eats.store",
  "eats.store.status.write",
  "eats.order",
  "eats.store.orders.read",
] as const;

export const uberEatsDefinition: ProviderDefinition = {
  id: "provider-delivery-uber-eats",
  code: "UBER_EATS",
  displayName: "Uber Eats",
  category: "DELIVERY",
  version: "eats-api-v2",
  capabilities: [
    "RECEIVE_ORDERS",
    "GET_ORDER",
    "RECOVER_ACTIVE_ORDERS",
    "ACCEPT_ORDER",
    "REJECT_ORDER",
    "CANCEL_ORDER",
    "MARK_ORDER_READY",
    "UPDATE_READY_TIME",
    "READ_STORE_STATUS",
    "UPDATE_STORE_STATUS",
    "FETCH_MENU",
    "SYNC_MENU",
    "SYNC_ITEMS",
    "SYNC_CATEGORIES",
    "SYNC_MODIFIERS",
    "SYNC_PRICES",
    "SYNC_AVAILABILITY",
    "WEBHOOK_CONFIRMATION",
    "ORDER_READY_NOTIFICATION",
  ],
  configurationSchema: {
    externalStoreId: { type: "string" },
    orderChannelId: { type: "string" },
    acceptancePolicy: { type: "string" },
    unmappedItemPolicy: { type: "string" },
    menuSyncMode: { type: "string" },
    availabilitySyncEnabled: { type: "boolean" },
    priceSyncEnabled: { type: "boolean" },
    storeStatusSyncEnabled: { type: "boolean" },
  },
  secretFields: ["clientId", "clientSecret"],
  adapterMetadata: {
    baseUrls: uberApiBaseUrls,
    webhookBodyLimitBytes: 1_048_576,
    documentationUrl: "https://developer.uber.com/docs/eats/references/api/order_suite",
  },
  enabled: true,
};

type UberWebhook = {
  event_id?: string;
  event_type?: string;
  event_time?: number;
  meta?: { resource_id?: string; user_id?: string; status?: string };
};

export function createUberEatsAdapter(
  runtime: MarketplaceAdapterRuntime = createMarketplaceAdapterRuntime(),
): ProviderAdapter {
  const execute = <T>(
    context: ProviderExecutionContext,
    request: (accessToken: string) => Promise<T>,
  ) =>
    providerOperation(async () => {
      const token = await uberToken(runtime, context);
      return request(token.accessToken);
    });

  return {
    definition: uberEatsDefinition,
    healthCheck: async (connection, context) => {
      if (!context?.credentials["clientId"] || !context.credentials["clientSecret"])
        return {
          status: "CONFIG_REQUIRED",
          checkedAt: new Date().toISOString(),
          message: "Uber client credentials and approved Eats scopes are required",
        };
      const storeId = stringConfig(connection, "externalStoreId");
      if (!storeId)
        return {
          status: "CONFIG_REQUIRED",
          checkedAt: new Date().toISOString(),
          message: "A mapped Uber store is required before activation",
        };
      const result = await execute(context, (accessToken) =>
        requestUber<unknown>(
          runtime,
          context,
          "store-status",
          `/v1/delivery/store/${encodeURIComponent(storeId)}/status`,
          accessToken,
        ),
      );
      return {
        status: result.ok ? "HEALTHY" : healthStatus(result),
        checkedAt: new Date().toISOString(),
        message: result.ok ? "Uber authentication and store access verified" : result.message,
        metadata: result.ok ? { approvedScopes: [...requiredScopes] } : {},
      };
    },
    verifyWebhook: verifyUberWebhook,
    parseWebhook: async (request) => {
      const parsed = parseJson<UberWebhook>(request);
      if (!parsed.event_id || !parsed.event_type || !parsed.meta?.resource_id)
        return failure(
          "VALIDATION",
          "Uber webhook is missing its immutable event or resource identifier",
        );
      const eventType = uberEventType(parsed.event_type);
      return {
        ok: true,
        value: {
          providerEventId: parsed.event_id,
          eventType,
          externalResourceId: parsed.meta.resource_id,
          ...(parsed.meta.user_id ? { externalStoreId: parsed.meta.user_id } : {}),
          ...(parsed.event_time
            ? {
                occurredAt: new Date(
                  parsed.event_time > 10_000_000_000 ? parsed.event_time : parsed.event_time * 1000,
                ).toISOString(),
              }
            : {}),
          payload: parsed,
          requiresOrderFetch: ["ORDER_CREATED", "ORDER_UPDATED"].includes(eventType),
        },
      };
    },
    getOrder: (externalOrderId, context) =>
      execute(context, (accessToken) =>
        requestUber<unknown>(
          runtime,
          context,
          "get-order",
          `/v2/eats/order/${encodeURIComponent(externalOrderId)}`,
          accessToken,
        ),
      ),
    recoverActiveOrders: (externalStoreId, context) =>
      execute(context, async (accessToken) => {
        const response = await requestUber<{
          orders?: Array<{ id?: string; placed_at?: string; current_state?: string }>;
        }>(
          runtime,
          context,
          "recover-active-orders",
          `/v1/eats/stores/${encodeURIComponent(externalStoreId)}/created-orders`,
          accessToken,
        );
        return (response.orders ?? []).flatMap((order) =>
          order.id
            ? [
                {
                  externalOrderId: order.id,
                  providerEventId: `uber-recovery:${order.id}:${order.placed_at ?? "created"}`,
                  ...(order.placed_at ? { placedAt: order.placed_at } : {}),
                  payload: order,
                },
              ]
            : [],
        );
      }),
    normalizeIncomingOrder: async (payload, connection) => normalizeUberOrder(payload, connection),
    acceptOrder: (externalOrderId, _connection, context, input) =>
      context
        ? execute(context, (accessToken) =>
            requestUber(
              runtime,
              context,
              "accept-order",
              `/v1/delivery/order/${encodeURIComponent(externalOrderId)}/accept`,
              accessToken,
              "POST",
              {
                ...(input?.estimatedReadyAt
                  ? { ready_for_pickup_time: input.estimatedReadyAt }
                  : {}),
                ...(input?.acceptedBy ? { accepted_by: input.acceptedBy } : {}),
              },
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Uber execution context is required")),
    rejectOrder: (externalOrderId, reason, _connection, context) =>
      context
        ? execute(context, (accessToken) =>
            requestUber(
              runtime,
              context,
              "deny-order",
              `/v1/delivery/order/${encodeURIComponent(externalOrderId)}/deny`,
              accessToken,
              "POST",
              { deny_reason: uberRejectionReason(reason) },
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Uber execution context is required")),
    cancelOrder: (externalOrderId, reason, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "cancel-order",
          `/v1/delivery/order/${encodeURIComponent(externalOrderId)}/cancel`,
          accessToken,
          "POST",
          {
            cancellation_reason: {
              type: "OTHER",
              info: reason,
              client_error_code: "SERAMET_RESTAURANT_CANCELLED",
            },
          },
        ),
      ),
    markOrderReady: (externalOrderId, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "mark-ready",
          `/v1/delivery/order/${encodeURIComponent(externalOrderId)}/ready`,
          accessToken,
          "POST",
          {},
        ),
      ),
    updateReadyTime: (externalOrderId, readyAt, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "update-ready-time",
          `/v1/delivery/order/${encodeURIComponent(externalOrderId)}/update-ready-time`,
          accessToken,
          "POST",
          { ready_for_pickup_time: readyAt },
        ),
      ),
    getStoreStatus: (externalStoreId, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "store-status",
          `/v1/delivery/store/${encodeURIComponent(externalStoreId)}/status`,
          accessToken,
        ),
      ),
    setStoreStatus: (externalStoreId, status, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "update-store-status",
          `/v1/delivery/store/${encodeURIComponent(externalStoreId)}/update-store-status`,
          accessToken,
          "POST",
          status === "OPEN"
            ? { status: "ONLINE" }
            : {
                status: "OFFLINE",
                reason:
                  status === "PAUSED" ? "Store temporarily paused" : "Store temporarily closed",
              },
        ),
      ),
    getMenu: (context) => {
      const storeId = stringConfig(context.connection, "externalStoreId");
      if (!storeId) return Promise.resolve(failure("VALIDATION", "Uber store ID is required"));
      return execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "get-menu",
          `/v2/eats/stores/${encodeURIComponent(storeId)}/menus`,
          accessToken,
        ),
      );
    },
    syncMenu: (menu, _connection, context) =>
      context
        ? execute(context, (accessToken) =>
            requestUber(
              runtime,
              context,
              "upload-menu",
              `/v2/eats/stores/${encodeURIComponent(menu.storeId)}/menus`,
              accessToken,
              "PUT",
              serializeUberMenu(menu, minorUnitFactor(context.connection)),
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Uber execution context is required")),
    syncAvailability: (availability, _connection, context) =>
      context
        ? execute(context, (accessToken) =>
            requestUber(
              runtime,
              context,
              "item-availability",
              `/v2/eats/stores/${encodeURIComponent(requiredStoreId(context.connection))}/menus/items/${encodeURIComponent(availability.externalItemId)}`,
              accessToken,
              "POST",
              {
                suspension_info: availability.available
                  ? { suspension: null, overrides: [] }
                  : {
                      suspension: { suspend_until: 4_102_444_799 },
                      overrides: [],
                    },
              },
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Uber execution context is required")),
    updateItemPrice: (item, context) =>
      execute(context, (accessToken) =>
        requestUber(
          runtime,
          context,
          "item-price",
          `/v2/eats/stores/${encodeURIComponent(requiredStoreId(context.connection))}/menus/items/${encodeURIComponent(item.externalItemId)}`,
          accessToken,
          "POST",
          { price_info: { price: toMinorUnits(item.price, context.connection) } },
        ),
      ),
  };
}

async function uberToken(runtime: MarketplaceAdapterRuntime, context: ProviderExecutionContext) {
  return runtime.tokens.getValidToken(context.connection.id, async () => {
    const clientId = context.credentials["clientId"];
    const clientSecret = context.credentials["clientSecret"];
    if (!clientId || !clientSecret) throw new Error("Uber client credentials are missing");
    // Official operation: OAuth 2.0 client-credentials token, Uber Eats authentication guide.
    const response = await runtime.http.request<{
      access_token: string;
      expires_in: number;
      token_type?: string;
      scope?: string;
    }>({
      tenantId: context.connection.tenantId,
      ...(context.connection.branchId ? { branchId: context.connection.branchId } : {}),
      connectionId: context.connection.id,
      providerId: context.connection.providerId,
      environment: context.connection.environment,
      operation: "oauth-token",
      correlationId: context.correlationId,
      baseUrls: uberLoginBaseUrls,
      path: "/oauth/v2/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: requiredScopes.join(" "),
      }).toString(),
      allowSharedEnvironmentUrl: true,
    });
    if (!response.data.access_token) throw new Error("Uber token response has no access token");
    return {
      connectionId: context.connection.id,
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + Math.max(60, response.data.expires_in) * 1000).toISOString(),
      ...(response.data.token_type ? { tokenType: response.data.token_type } : {}),
      scopes: response.data.scope?.split(/\s+/).filter(Boolean) ?? [...requiredScopes],
    };
  });
}

async function requestUber<T>(
  runtime: MarketplaceAdapterRuntime,
  context: ProviderExecutionContext,
  operation: string,
  path: string,
  accessToken: string,
  method = "GET",
  body?: unknown,
) {
  // Official paths map to Uber Eats Order, Store and Menu API suites.
  const response = await runtime.http.request<T>({
    tenantId: context.connection.tenantId,
    ...(context.connection.branchId ? { branchId: context.connection.branchId } : {}),
    connectionId: context.connection.id,
    providerId: context.connection.providerId,
    environment: context.connection.environment,
    operation,
    correlationId: context.correlationId,
    baseUrls: uberApiBaseUrls,
    path,
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  });
  return response.data;
}

function normalizeUberOrder(
  payload: unknown,
  connection: IntegrationConnection,
): Promise<ProviderOperationResult<NormalizedExternalOrder>> {
  const order = recordValue(payload);
  const id = stringAt(order, "id") ?? stringAt(order, "order_id");
  const storeId = stringAt(order, "store", "id") ?? stringAt(order, "store_id");
  const cart = arrayAt(order, "cart", "items") ?? arrayAt(order, "items");
  if (!id || !storeId || !cart)
    return Promise.resolve(failure("VALIDATION", "Uber order details are incomplete"));
  const factor = minorUnitFactor(connection);
  const items = cart.map((entry, index) => normalizeUberItem(entry, index, factor));
  const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
  const subtotal =
    moneyAt(order, factor, "payment", "charges", "sub_total", "amount") ?? itemsTotal;
  const promotionalSubtotal = moneyAt(
    order,
    factor,
    "payment",
    "charges",
    "sub_total_promo_applied",
    "amount",
  );
  const discount =
    promotionalSubtotal === undefined ? 0 : Math.max(0, subtotal - promotionalSubtotal);
  const taxes = moneyAt(order, factor, "payment", "charges", "tax", "amount") ?? 0;
  const serviceFee = moneyAt(order, factor, "payment", "charges", "total_fee", "amount") ?? 0;
  const total =
    moneyAt(order, factor, "payment", "charges", "total", "amount") ??
    subtotal - discount + taxes + serviceFee;
  const customerName = [
    stringAt(order, "eater", "first_name"),
    stringAt(order, "eater", "last_name"),
  ]
    .filter(Boolean)
    .join(" ");
  const address =
    stringAt(order, "deliveries", "0", "location", "formatted_address") ??
    stringAt(order, "delivery", "location", "formatted_address");
  const instructions = stringAt(order, "special_instructions");
  const externalCustomerId = stringAt(order, "eater", "id");
  const customerPhone = stringAt(order, "eater", "phone");
  const providerPaymentReference = stringAt(order, "payment", "payment_method");
  const scheduledFor =
    stringAt(order, "scheduled_order_info", "deliver_at") ??
    stringAt(order, "estimated_ready_for_pickup_at");
  return Promise.resolve({
    ok: true,
    value: {
      providerOrderId: id,
      connectionId: connection.id,
      externalStoreId: storeId,
      orderType: stringAt(order, "type") === "PICK_UP" ? "PICKUP" : "DELIVERY",
      createdAt: stringAt(order, "placed_at") ?? new Date().toISOString(),
      ...(scheduledFor ? { scheduledFor } : {}),
      currency: stringAt(order, "payment", "charges", "total", "currency_code") ?? "KES",
      customer: {
        ...(externalCustomerId ? { externalCustomerId } : {}),
        ...(customerName ? { name: customerName } : {}),
        ...(customerPhone ? { phone: customerPhone } : {}),
      },
      delivery: {
        type: stringAt(order, "type") === "PICK_UP" ? "PICKUP" : "PROVIDER",
        providerManaged: stringAt(order, "type") !== "PICK_UP",
        ...(address ? { address } : {}),
      },
      items,
      pricing: {
        subtotal,
        discounts: discount,
        taxes,
        ...(serviceFee ? { serviceFee } : {}),
        total,
      },
      payment: {
        externallyPaid: true,
        amountPaid: total,
        ...(providerPaymentReference ? { providerPaymentReference } : {}),
      },
      ...(discount
        ? {
            charges: [
              {
                type: "PROMOTION",
                description: "Marketplace promotion applied to order",
                amount: discount,
                currency: stringAt(order, "payment", "charges", "total", "currency_code") ?? "KES",
                source: "PROVIDER_ORDER",
                externalReference: id,
                metadata: { providerField: "sub_total_promo_applied" },
              },
            ],
          }
        : {}),
      providerStatus: stringAt(order, "current_state") ?? "RECEIVED",
      ...(instructions ? { specialInstructions: instructions } : {}),
      rawExternalReference: stringAt(order, "display_id") ?? id,
    },
  });
}

function normalizeUberItem(entry: unknown, index: number, factor: number) {
  const item = recordValue(entry);
  const notes = stringAt(item, "special_instructions");
  const quantity = numberAt(item, "quantity") ?? 1;
  const unitPrice =
    moneyAt(item, factor, "price", "unit_price") ?? moneyAt(item, factor, "unit_price") ?? 0;
  const total = moneyAt(item, factor, "price", "total_price") ?? quantity * unitPrice;
  const modifierGroups =
    arrayAt(item, "selected_modifier_groups") ?? arrayAt(item, "modifier_groups") ?? [];
  const modifiers = modifierGroups.flatMap((group) => {
    const groupRecord = recordValue(group);
    return (arrayAt(groupRecord, "selected_items") ?? arrayAt(groupRecord, "items") ?? []).map(
      (modifier, modifierIndex) => {
        const row = recordValue(modifier);
        return {
          externalModifierId:
            stringAt(row, "id") ??
            stringAt(row, "external_data") ??
            `unmapped-modifier-${index}-${modifierIndex}`,
          name: stringAt(row, "title") ?? "External modifier",
          quantity: numberAt(row, "quantity") ?? 1,
          unitPrice: moneyAt(row, factor, "price", "unit_price") ?? 0,
        };
      },
    );
  });
  return {
    externalItemId: stringAt(item, "id") ?? stringAt(item, "external_data") ?? `unmapped-${index}`,
    name: stringAt(item, "title") ?? stringAt(item, "name") ?? "External item",
    quantity,
    unitPrice,
    total,
    modifiers,
    ...(notes ? { notes } : {}),
  };
}

export function serializeUberMenu(menu: NormalizedMarketplaceMenu, factor = 100) {
  const locale = menu.locale.replace("-", "_").toLowerCase();
  const translated = (value: string) => ({ translations: { [locale]: value } });
  const categoryId = (internalId: string) =>
    menu.categories.find((category) => category.internalId === internalId)?.externalId ??
    internalId;
  const itemId = (internalId: string) =>
    menu.items.find((item) => item.internalId === internalId)?.externalId ?? internalId;
  const modifierGroupId = (internalId: string) =>
    menu.modifierGroups.find((group) => group.internalId === internalId)?.externalId ?? internalId;
  const modifierItems = menu.modifierGroups.flatMap((group) =>
    group.modifiers.map((modifier) => ({
      id: modifier.externalId ?? modifier.internalId,
      external_data: modifier.internalId,
      title: translated(modifier.name),
      price_info: { price: Math.round(modifier.price * factor) },
      suspension_info: modifier.available
        ? { suspension: null, overrides: [] }
        : { suspension: { suspend_until: 4_102_444_799 }, overrides: [] },
      modifier_group_ids: [],
    })),
  );
  return {
    menus: menu.menus.map((entry) => ({
      id: entry.internalId,
      title: translated(entry.name),
      category_ids: entry.categoryIds.map(categoryId),
      ...(entry.serviceAvailability
        ? {
            service_availability: entry.serviceAvailability.map((availability) => ({
              day_of_week: availability.dayOfWeek.toLowerCase(),
              time_periods: [
                { start_time: availability.startTime, end_time: availability.endTime },
              ],
            })),
          }
        : {}),
    })),
    categories: menu.categories.map((category) => ({
      id: category.externalId ?? category.internalId,
      title: translated(category.name),
      entities: category.itemIds.map((id) => ({ id: itemId(id), type: "ITEM" })),
    })),
    items: [
      ...menu.items.map((item) => ({
        id: item.externalId ?? item.internalId,
        external_data: item.internalId,
        title: translated(item.name),
        ...(item.description ? { description: translated(item.description) } : {}),
        price_info: { price: Math.round(item.price * factor) },
        ...(item.imageUrl ? { image_url: item.imageUrl } : {}),
        suspension_info: item.available
          ? { suspension: null, overrides: [] }
          : { suspension: { suspend_until: 4_102_444_799 }, overrides: [] },
        modifier_group_ids: item.modifierGroupIds.map(modifierGroupId),
      })),
      ...modifierItems,
    ],
    modifier_groups: menu.modifierGroups.map((group) => ({
      id: group.externalId ?? group.internalId,
      title: translated(group.name),
      quantity_info: {
        quantity: { min_permitted: group.minSelections, max_permitted: group.maxSelections },
      },
      modifier_options: group.modifiers.map((modifier) => ({
        id: modifier.externalId ?? modifier.internalId,
        type: "ITEM",
      })),
    })),
  };
}

async function verifyUberWebhook(request: ProviderWebhookRequest) {
  const signature = request.headers["x-uber-signature"];
  const clientSecret = request.credentials["clientSecret"];
  if (!signature || !clientSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    request.rawBody.slice().buffer as ArrayBuffer,
  );
  return constantTimeEqual(toHex(new Uint8Array(digest)), signature.toLowerCase());
}

function uberRejectionReason(
  reason: import("@/integrations/marketplace/types").MarketplaceRejectionReason,
) {
  const mapping: Record<typeof reason, { type: string; info: string; client_error_code: string }> =
    {
      ITEM_UNAVAILABLE: {
        type: "ITEM_AVAILABILITY",
        info: "One or more items are unavailable",
        client_error_code: "SERAMET_ITEM_UNAVAILABLE",
      },
      STORE_CLOSED: {
        type: "STORE_CLOSED",
        info: "The restaurant is closed",
        client_error_code: "SERAMET_STORE_CLOSED",
      },
      ITEM_MAPPING_ERROR: {
        type: "OTHER",
        info: "Order item mapping requires attention",
        client_error_code: "SERAMET_ITEM_MAPPING_ERROR",
      },
      PRICE_MISMATCH: {
        type: "OTHER",
        info: "Order pricing could not be validated",
        client_error_code: "SERAMET_PRICE_MISMATCH",
      },
      INVALID_ORDER: {
        type: "OTHER",
        info: "Order validation failed",
        client_error_code: "SERAMET_INVALID_ORDER",
      },
      CAPACITY: {
        type: "KITCHEN_FULL",
        info: "The restaurant cannot prepare the order in time",
        client_error_code: "SERAMET_CAPACITY",
      },
      TECHNICAL_FAILURE: {
        type: "OTHER",
        info: "A technical failure prevented acceptance",
        client_error_code: "SERAMET_TECHNICAL_FAILURE",
      },
      OTHER: { type: "OTHER", info: "Order rejected", client_error_code: "SERAMET_OTHER" },
    };
  return mapping[reason];
}

function uberEventType(value: string) {
  if (value === "orders.notification" || value === "orders.scheduled.notification")
    return "ORDER_CREATED" as const;
  if (value === "orders.cancel" || value === "orders.failure") return "ORDER_CANCELLED" as const;
  if (value === "orders.release") return "ORDER_RELEASED" as const;
  if (value === "store.provisioned") return "STORE_CONNECTED" as const;
  if (value === "store.deprovisioned") return "STORE_DISCONNECTED" as const;
  if (value === "store.status.changed") return "STORE_STATUS_CHANGED" as const;
  return "UNKNOWN" as const;
}

async function providerOperation<T>(work: () => Promise<T>): Promise<ProviderOperationResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const normalized = normalizeIntegrationError(error);
    const supported = [
      "AUTHENTICATION",
      "AUTHORIZATION",
      "VALIDATION",
      "MAPPING",
      "RATE_LIMITED",
      "TIMEOUT",
      "PROVIDER_UNAVAILABLE",
    ];
    return {
      ok: false,
      code: (supported.includes(normalized.code) ? normalized.code : "PROVIDER_ERROR") as Extract<
        ProviderOperationResult,
        { ok: false }
      >["code"],
      message: normalized.message,
      retryable: normalized.retryable,
      ...(normalized.retryAfterMs ? { retryAfterMs: normalized.retryAfterMs } : {}),
    };
  }
}

function healthStatus(result: Exclude<ProviderOperationResult, { ok: true }>) {
  if (result.code === "AUTHENTICATION" || result.code === "AUTHORIZATION")
    return "AUTH_ERROR" as const;
  if (result.code === "NOT_CONFIGURED") return "CONFIG_REQUIRED" as const;
  if (result.retryable) return "OFFLINE" as const;
  return "DEGRADED" as const;
}
function failure(
  code: Extract<ProviderOperationResult, { ok: false }>["code"],
  message: string,
): Extract<ProviderOperationResult, { ok: false }> {
  return { ok: false, code, message, retryable: false };
}
function parseJson<T>(request: ProviderWebhookRequest) {
  try {
    return JSON.parse(new TextDecoder().decode(request.rawBody)) as T;
  } catch {
    return {} as T;
  }
}
function stringConfig(connection: IntegrationConnection, key: string) {
  const value = connection.configuration[key];
  return typeof value === "string" ? value.trim() : "";
}
function requiredStoreId(connection: IntegrationConnection) {
  const value = stringConfig(connection, "externalStoreId");
  if (!value) throw new Error("Uber externalStoreId is required");
  return value;
}
function minorUnitFactor(connection: IntegrationConnection) {
  const value = Number(connection.configuration["currencyMinorUnitFactor"] ?? 100);
  return Number.isFinite(value) && value > 0 ? value : 100;
}
function toMinorUnits(value: number, connection: IntegrationConnection) {
  return Math.round(value * minorUnitFactor(connection));
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current = value;
  for (const part of path) {
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (current && typeof current === "object")
      current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof current === "string" ? current : undefined;
}
function numberAt(value: unknown, ...path: string[]): number | undefined {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "number" ? current : undefined;
}
function moneyAt(value: unknown, factor: number, ...path: string[]) {
  const amount = numberAt(value, ...path);
  return amount === undefined ? undefined : amount / factor;
}
function arrayAt(value: unknown, ...path: string[]): unknown[] | undefined {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return Array.isArray(current) ? current : undefined;
}
function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1)
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}
function toHex(value: Uint8Array) {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
