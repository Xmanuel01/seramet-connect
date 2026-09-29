import {
  createMarketplaceAdapterRuntime,
  type MarketplaceAdapterRuntime,
} from "@/integrations/delivery/adapter-runtime";
import { normalizeIntegrationError } from "@/integrations/runtime/integration-errors";
import type {
  NormalizedExternalOrder,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderOperationResult,
  ProviderWebhookRequest,
} from "@/integrations/types";
import type { IntegrationConnection, ProviderDefinition } from "@/platform/types";

const glovoBaseUrls = {
  SANDBOX: "https://sandbox.partner.deliveryhero.io",
  PRODUCTION: "https://glovo.partner.deliveryhero.io",
} as const;

export const glovoDefinition: ProviderDefinition = {
  id: "provider-delivery-glovo",
  code: "GLOVO",
  displayName: "Glovo",
  category: "DELIVERY",
  version: "partner-api-v2.0.2",
  capabilities: [
    "RECEIVE_ORDERS",
    "GET_ORDER",
    "ACCEPT_ORDER",
    "MARK_ORDER_READY",
    "UPDATE_ORDER_STATUS",
    "ORDER_MODIFICATIONS",
    "FETCH_MENU",
    "SYNC_MENU",
    "SYNC_ITEMS",
    "SYNC_PRICES",
    "SYNC_AVAILABILITY",
    "READ_STORE_STATUS",
    "UPDATE_STORE_STATUS",
    "PAUSE_STORE",
    "WEBHOOK_CONFIRMATION",
    "SYNC_CANCELLATIONS",
    "ORDER_READY_NOTIFICATION",
  ],
  configurationSchema: {
    chainId: { type: "string" },
    externalStoreId: { type: "string" },
    webhookHeaderName: { type: "string" },
    orderChannelId: { type: "string" },
    acceptancePolicy: { type: "string" },
    unmappedItemPolicy: { type: "string" },
    menuSyncMode: { type: "string" },
  },
  secretFields: ["clientId", "clientSecret", "webhookToken"],
  adapterMetadata: {
    baseUrls: glovoBaseUrls,
    webhookBodyLimitBytes: 1_048_576,
    documentationUrl:
      "https://qcommerce.developer.glovoapp.com/en/documentation/api-partner-api-overview",
  },
  enabled: true,
};

export function createGlovoAdapter(
  runtime: MarketplaceAdapterRuntime = createMarketplaceAdapterRuntime(),
): ProviderAdapter {
  const execute = <T>(context: ProviderExecutionContext, work: (token: string) => Promise<T>) =>
    providerOperation(async () => {
      const token = await glovoToken(runtime, context);
      return work(token.accessToken);
    });

  const readOrder = (externalOrderId: string, context: ProviderExecutionContext, token: string) =>
    requestGlovo<Record<string, unknown>>(
      runtime,
      context,
      "get-order",
      `${orderPath(context.connection, externalOrderId)}`,
      token,
    );

  const updateOrder = async (
    externalOrderId: string,
    status: "ACCEPTED" | "READY_FOR_PICKUP" | "DISPATCHED",
    context: ProviderExecutionContext,
    acceptedFor?: string,
  ) => {
    const currentResult = await execute(context, (token) =>
      readOrder(externalOrderId, context, token),
    );
    if (!currentResult.ok) return currentResult;
    const current = recordValue(currentResult.value);
    const transportType = String(current["transport_type"] ?? "").toUpperCase();
    if (status === "READY_FOR_PICKUP" && transportType !== "LOGISTICS_DELIVERY")
      return failure(
        "UNSUPPORTED",
        "Glovo READY_FOR_PICKUP is only valid for logistics-delivery orders",
      );
    if (status === "DISPATCHED" && transportType !== "VENDOR_DELIVERY")
      return failure("UNSUPPORTED", "Glovo DISPATCHED is only valid for vendor-delivery orders");
    const items = Array.isArray(current["items"]) ? current["items"] : [];
    return execute(context, (token) =>
      requestGlovo(
        runtime,
        context,
        `order-${status.toLowerCase()}`,
        orderPath(context.connection, externalOrderId),
        token,
        "PUT",
        {
          order_id: externalOrderId,
          items,
          status,
          ...(status === "ACCEPTED" ? { accepted_for: acceptedFor ?? acceptedForTimestamp() } : {}),
        },
      ),
    );
  };

  return {
    definition: glovoDefinition,
    healthCheck: async (connection, context) => {
      if (!context?.credentials["clientId"] || !context.credentials["clientSecret"])
        return {
          status: "CONFIG_REQUIRED",
          checkedAt: new Date().toISOString(),
          message: "Glovo Partner API client credentials are required",
        };
      if (!chainId(connection) || !storeId(connection))
        return {
          status: "CONFIG_REQUIRED",
          checkedAt: new Date().toISOString(),
          message: "Glovo chain and vendor mappings are required",
        };
      const result = await execute(context, (token) =>
        requestGlovo(runtime, context, "store-status", storeStatusPath(connection), token),
      );
      return {
        status: result.ok ? "HEALTHY" : healthStatus(result),
        checkedAt: new Date().toISOString(),
        message: result.ok ? "Glovo token and vendor access verified" : result.message,
      };
    },
    verifyWebhook: verifyGlovoWebhook,
    parseWebhook: async (request) => {
      const payload = parseJson<Record<string, unknown>>(request);
      const externalOrderId =
        stringAt(payload, "order_id") ?? stringAt(payload, "external_order_id");
      const status = String(payload["status"] ?? "").toUpperCase();
      if (!externalOrderId || !status)
        return failure("VALIDATION", "Glovo webhook has no order ID or documented status");
      const eventType = glovoEventType(status, payload);
      return {
        ok: true,
        value: {
          ...(stringAt(payload, "event_id")
            ? { providerEventId: stringAt(payload, "event_id") }
            : {}),
          eventType,
          externalResourceId: externalOrderId,
          ...(stringAt(payload, "client", "store_id")
            ? { externalStoreId: stringAt(payload, "client", "store_id") }
            : {}),
          ...(stringAt(payload, "created_at")
            ? { occurredAt: stringAt(payload, "created_at") }
            : {}),
          payload,
          requiresOrderFetch: eventType !== "ORDER_CANCELLED" && !Array.isArray(payload["items"]),
        },
      };
    },
    getOrder: (externalOrderId, context) =>
      execute(context, (token) => readOrder(externalOrderId, context, token)),
    normalizeIncomingOrder: async (payload, connection) => normalizeGlovoOrder(payload, connection),
    acceptOrder: (externalOrderId, _connection, context, input) =>
      context
        ? updateOrder(
            externalOrderId,
            "ACCEPTED",
            context,
            acceptedForTimestamp(input?.estimatedReadyAt, input?.estimatedPrepMinutes),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Glovo execution context is required")),
    markOrderReady: (externalOrderId, context) =>
      updateOrder(externalOrderId, "READY_FOR_PICKUP", context),
    updateStatus: (externalOrderId, status, _connection, context) => {
      if (!context)
        return Promise.resolve(failure("NOT_CONFIGURED", "Glovo execution context is required"));
      const translated = glovoOutboundStatus(status);
      if (!translated)
        return Promise.resolve(failure("UNSUPPORTED", `Glovo does not support status ${status}`));
      return updateOrder(externalOrderId, translated, context);
    },
    getMenu: (context) =>
      execute(context, (token) =>
        requestGlovo(runtime, context, "get-catalog", catalogPath(context.connection), token),
      ),
    syncMenu: (menu, _connection, context) =>
      context
        ? execute(context, (token) =>
            requestGlovo(
              runtime,
              context,
              "update-catalog",
              catalogPath(context.connection),
              token,
              "PUT",
              {
                products: menu.items.map((item) => ({
                  sku: item.externalId ?? item.sku ?? item.internalId,
                  price: item.price,
                  active: item.available,
                  ...(item.quantityAvailable === undefined
                    ? {}
                    : { quantity: item.quantityAvailable }),
                })),
              },
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Glovo execution context is required")),
    syncAvailability: (availability, _connection, context) =>
      context
        ? execute(context, (token) =>
            requestGlovo(
              runtime,
              context,
              "update-availability",
              catalogPath(context.connection),
              token,
              "PUT",
              {
                products: [
                  {
                    sku: availability.externalItemId,
                    active: availability.available,
                    ...(availability.quantityAvailable === undefined
                      ? {}
                      : { quantity: availability.quantityAvailable }),
                  },
                ],
              },
            ),
          )
        : Promise.resolve(failure("NOT_CONFIGURED", "Glovo execution context is required")),
    updateItemPrice: (item, context) =>
      execute(context, (token) =>
        requestGlovo(
          runtime,
          context,
          "update-price",
          catalogPath(context.connection),
          token,
          "PUT",
          { products: [{ sku: item.externalItemId, price: item.price }] },
        ),
      ),
    getStoreStatus: (_externalStoreId, context) =>
      execute(context, (token) =>
        requestGlovo(runtime, context, "store-status", storeStatusPath(context.connection), token),
      ),
    setStoreStatus: (_externalStoreId, status, context) =>
      execute(context, (token) =>
        requestGlovo(
          runtime,
          context,
          "update-store-status",
          storeStatusPath(context.connection),
          token,
          "PUT",
          { status: status === "OPEN" ? "OPEN" : "CLOSED_TODAY" },
        ),
      ),
  };
}

async function glovoToken(runtime: MarketplaceAdapterRuntime, context: ProviderExecutionContext) {
  return runtime.tokens.getValidToken(context.connection.id, async () => {
    const clientId = context.credentials["clientId"];
    const clientSecret = context.credentials["clientSecret"];
    if (!clientId || !clientSecret) throw new Error("Glovo client credentials are missing");
    // Official operation: POST /v2/oauth/token using OAuth client credentials.
    const response = await runtime.http.request<{
      access_token: string;
      expires_in: number;
      token_type?: string;
    }>({
      tenantId: context.connection.tenantId,
      ...(context.connection.branchId ? { branchId: context.connection.branchId } : {}),
      connectionId: context.connection.id,
      providerId: context.connection.providerId,
      environment: context.connection.environment,
      operation: "oauth-token",
      correlationId: context.correlationId,
      baseUrls: glovoBaseUrls,
      path: "/v2/oauth/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    return {
      connectionId: context.connection.id,
      accessToken: response.data.access_token,
      expiresAt: new Date(Date.now() + Math.max(60, response.data.expires_in) * 1000).toISOString(),
      ...(response.data.token_type ? { tokenType: response.data.token_type } : {}),
    };
  });
}

async function requestGlovo<T>(
  runtime: MarketplaceAdapterRuntime,
  context: ProviderExecutionContext,
  operation: string,
  path: string,
  accessToken: string,
  method = "GET",
  body?: unknown,
) {
  // Official operations: Partner API v2 order, catalog and vendor status resources.
  const response = await runtime.http.request<T>({
    tenantId: context.connection.tenantId,
    ...(context.connection.branchId ? { branchId: context.connection.branchId } : {}),
    connectionId: context.connection.id,
    providerId: context.connection.providerId,
    environment: context.connection.environment,
    operation,
    correlationId: context.correlationId,
    baseUrls: glovoBaseUrls,
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

function normalizeGlovoOrder(
  payload: unknown,
  connection: IntegrationConnection,
): Promise<ProviderOperationResult<NormalizedExternalOrder>> {
  const order = recordValue(payload);
  const id = stringAt(order, "order_id") ?? stringAt(order, "external_order_id");
  const externalStoreId =
    stringAt(order, "client", "store_id") ?? stringAt(order, "store_id") ?? storeId(connection);
  const rows = Array.isArray(order["items"]) ? order["items"] : undefined;
  if (!id || !externalStoreId || !rows)
    return Promise.resolve(failure("VALIDATION", "Glovo order details are incomplete"));
  const payment = recordValue(order["payment"]);
  const items = rows.map((value, index) => {
    const item = recordValue(value);
    const pricing = recordValue(item["pricing"]);
    const originalPricing = recordValue(item["original_pricing"]);
    const notes = stringAt(item, "instructions");
    const quantity = numberAt(pricing, "quantity") ?? numberAt(item, "quantity") ?? 1;
    const unitPrice =
      moneyValue(originalPricing["unit_price"]) ||
      moneyValue(pricing["unit_price"]) ||
      moneyValue(item["price"]);
    const total =
      moneyValue(originalPricing["total_price"]) ||
      moneyValue(pricing["total_price"]) ||
      moneyValue(item["total_price"]) ||
      unitPrice * quantity;
    const modifiers = (Array.isArray(item["attributes"]) ? item["attributes"] : []).map(
      (value, modifierIndex) => {
        const modifier = recordValue(value);
        return {
          externalModifierId:
            stringAt(modifier, "id") ??
            stringAt(modifier, "external_id") ??
            `unmapped-modifier-${index}-${modifierIndex}`,
          name: stringAt(modifier, "name") ?? "External modifier",
          quantity: numberAt(modifier, "quantity") ?? 1,
          unitPrice: moneyValue(modifier["price"]),
        };
      },
    );
    return {
      externalItemId: stringAt(item, "sku") ?? stringAt(item, "id") ?? `unmapped-item-${index}`,
      name: stringAt(item, "name") ?? "External item",
      quantity,
      unitPrice,
      total,
      modifiers,
      ...(notes ? { notes } : {}),
    };
  });
  const itemTotal = items.reduce((sum, item) => sum + item.total, 0);
  const promotions = glovoDiscountTotal(payment, rows);
  const subtotal = itemTotal || moneyValue(payment["sub_total"]);
  const taxes = moneyValue(payment["total_taxes"]);
  const deliveryFee = moneyValue(payment["delivery_fee"]);
  const serviceFee = glovoCustomerFees(payment);
  const total =
    moneyValue(payment["order_total"]) || subtotal - promotions + taxes + deliveryFee + serviceFee;
  const charges = glovoCharges(order, connection, id);
  const status = String(order["status"] ?? "RECEIVED").toUpperCase();
  const scheduledFor = stringAt(order, "scheduled_for");
  const externalCustomerId =
    stringAt(order, "customer", "_id") ?? stringAt(order, "customer", "id");
  const customerName =
    [stringAt(order, "customer", "first_name"), stringAt(order, "customer", "last_name")]
      .filter(Boolean)
      .join(" ") || stringAt(order, "customer", "name");
  const customerPhone = stringAt(order, "customer", "phone_number");
  const deliveryAddress = glovoDeliveryAddress(order);
  const specialInstructions = stringAt(order, "comment") ?? stringAt(order, "special_instructions");
  return Promise.resolve({
    ok: true,
    value: {
      providerOrderId: id,
      connectionId: connection.id,
      externalStoreId,
      orderType: String(order["order_type"] ?? "DELIVERY")
        .toUpperCase()
        .includes("PICKUP")
        ? "PICKUP"
        : "DELIVERY",
      createdAt:
        stringAt(order, "sys", "created_at") ??
        stringAt(order, "created_at") ??
        new Date().toISOString(),
      ...(String(order["isPreorder"] ?? order["is_preorder"]) === "true" && scheduledFor
        ? { scheduledFor }
        : {}),
      currency: stringAt(order, "currency") ?? "KES",
      customer: {
        ...(externalCustomerId ? { externalCustomerId } : {}),
        ...(customerName ? { name: customerName } : {}),
        ...(customerPhone ? { phone: customerPhone } : {}),
      },
      delivery: {
        type: String(order["order_type"] ?? "DELIVERY")
          .toUpperCase()
          .includes("PICKUP")
          ? "PICKUP"
          : "PROVIDER",
        providerManaged: true,
        ...(deliveryAddress ? { address: deliveryAddress } : {}),
      },
      items,
      pricing: {
        subtotal,
        discounts: promotions,
        taxes,
        ...(deliveryFee ? { deliveryFee } : {}),
        ...(serviceFee ? { serviceFee } : {}),
        total,
      },
      payment: {
        externallyPaid: String(payment["type"] ?? "PAID").toUpperCase() === "PAID",
        amountPaid: total,
      },
      ...(charges.length ? { charges } : {}),
      providerStatus: status,
      ...(specialInstructions ? { specialInstructions } : {}),
      rawExternalReference: stringAt(order, "order_code") ?? id,
      fulfilmentMetadata: {
        transportType: order["transport_type"],
      },
    },
  });
}

function glovoCharges(
  order: Record<string, unknown>,
  connection: IntegrationConnection,
  id: string,
) {
  const payment = recordValue(order["payment"]);
  const currency = stringAt(order, "currency") ?? "KES";
  const charges: NonNullable<NormalizedExternalOrder["charges"]> = [];
  const discounts = Array.isArray(payment["discounts"]) ? payment["discounts"] : [];
  discounts.forEach((value, index) => {
    const discount = recordValue(value);
    const amount = Math.abs(moneyValue(discount["value"]));
    if (!amount) return;
    charges.push({
      type: "PROMOTION",
      description: stringAt(discount, "name") ?? "Provider-reported promotion",
      amount,
      currency,
      source: "PROVIDER_ORDER",
      externalReference: `${id}:promotion:${index}`,
      metadata: {},
    });
  });
  if (!discounts.length) {
    const amount = Math.abs(moneyValue(payment["discount"]));
    if (amount)
      charges.push({
        type: "PROMOTION",
        description: "Provider-reported promotion",
        amount,
        currency,
        source: "PROVIDER_ORDER",
        externalReference: `${id}:promotion`,
        metadata: {},
      });
  }
  return charges;
}

function verifyGlovoWebhook(request: ProviderWebhookRequest) {
  const configuredHeader = String(request.connection.configuration["webhookHeaderName"] ?? "")
    .trim()
    .toLowerCase();
  const expected = request.credentials["webhookToken"];
  if (!configuredHeader || !expected) return false;
  const received = request.headers[configuredHeader];
  return Boolean(received && constantTimeEqual(received, expected));
}

function glovoEventType(status: string, payload: Record<string, unknown>) {
  if (status === "RECEIVED") return "ORDER_CREATED" as const;
  if (status === "CANCELLED" || status === "CANCELED") return "ORDER_CANCELLED" as const;
  if (status === "UPDATE_CART" || Array.isArray(payload["items"])) return "ORDER_UPDATED" as const;
  return "UNKNOWN" as const;
}
function glovoOutboundStatus(status: string) {
  const normalized = status.toUpperCase();
  if (normalized === "READY") return "READY_FOR_PICKUP" as const;
  if (normalized === "DISPATCHED") return "DISPATCHED" as const;
  if (normalized === "ACCEPTED") return "ACCEPTED" as const;
  return undefined;
}
function orderPath(connection: IntegrationConnection, orderId: string) {
  return `/v2/chains/${encodeURIComponent(required(chainId(connection), "Glovo chainId"))}/orders/${encodeURIComponent(orderId)}`;
}
function catalogPath(connection: IntegrationConnection) {
  return `/v2/chains/${encodeURIComponent(required(chainId(connection), "Glovo chainId"))}/vendors/${encodeURIComponent(required(storeId(connection), "Glovo externalStoreId"))}/catalog`;
}
function storeStatusPath(connection: IntegrationConnection) {
  return `/v2/chains/${encodeURIComponent(required(chainId(connection), "Glovo chainId"))}/vendors/${encodeURIComponent(required(storeId(connection), "Glovo externalStoreId"))}/status`;
}
function chainId(connection: IntegrationConnection) {
  return stringConfig(connection, "chainId");
}
function storeId(connection: IntegrationConnection) {
  return stringConfig(connection, "externalStoreId");
}
function required(value: string, name: string) {
  if (!value) throw new Error(`${name} is required`);
  return value;
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
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringAt(value: unknown, ...path: string[]): string | undefined {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
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
function moneyValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function acceptedForTimestamp(estimatedReadyAt?: string, estimatedPrepMinutes = 25) {
  if (estimatedReadyAt && Number.isFinite(Date.parse(estimatedReadyAt)))
    return new Date(estimatedReadyAt).toISOString();
  return new Date(Date.now() + Math.max(1, estimatedPrepMinutes) * 60_000).toISOString();
}
function glovoDiscountTotal(payment: Record<string, unknown>, rows: unknown[]) {
  const discounts = Array.isArray(payment["discounts"])
    ? payment["discounts"].reduce(
        (sum, value) => sum + Math.abs(moneyValue(recordValue(value)["value"])),
        0,
      )
    : 0;
  if (discounts) return discounts;
  const direct = Math.abs(moneyValue(payment["discount"]));
  if (direct) return direct;
  return rows.reduce<number>((sum, value) => {
    const promotions = Array.isArray(recordValue(value)["promotion"])
      ? (recordValue(value)["promotion"] as unknown[])
      : [];
    return (
      sum +
      promotions.reduce<number>(
        (promotionSum, promotion) =>
          promotionSum + moneyValue(recordValue(promotion)["discount_amount"]),
        0,
      )
    );
  }, 0);
}
function glovoCustomerFees(payment: Record<string, unknown>) {
  const additionalFees = Object.values(recordValue(payment["additional_fees"])).reduce<number>(
    (sum, value) => sum + moneyValue(value),
    0,
  );
  return (
    moneyValue(payment["service_fee"]) +
    moneyValue(payment["container_charge"]) +
    moneyValue(payment["difference_to_minimum"]) +
    additionalFees
  );
}
function glovoDeliveryAddress(order: Record<string, unknown>) {
  const address = recordValue(recordValue(order["customer"])["delivery_address"]);
  const formatted = String(address["formattedAddress"] ?? "").trim();
  if (formatted) return formatted;
  const parts = [address["street"], address["number"], address["city"]]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  return parts.length ? parts.join(", ") : undefined;
}
function stringConfig(connection: IntegrationConnection, key: string) {
  const value = connection.configuration[key];
  return typeof value === "string" ? value.trim() : "";
}
function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1)
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}
