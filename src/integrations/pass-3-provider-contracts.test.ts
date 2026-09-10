import { describe, expect, it } from "vitest";
import type { MarketplaceAdapterRuntime } from "@/integrations/delivery/adapter-runtime";
import { createBoltFoodAdapter } from "@/integrations/delivery/spec-gated-adapters";
import { createGlovoAdapter } from "@/integrations/delivery/glovo/adapter";
import {
  createUberEatsAdapter,
  serializeUberMenu,
} from "@/integrations/delivery/uber-eats/adapter";
import type { NormalizedMarketplaceMenu } from "@/integrations/marketplace/types";
import { ProviderHttpClient } from "@/integrations/runtime/provider-http-client";
import { StructuredIntegrationLogger } from "@/integrations/runtime/redaction";
import { ProviderTokenService } from "@/integrations/runtime/token-service";
import type { ProviderExecutionContext, ProviderWebhookRequest } from "@/integrations/types";
import type { IntegrationConnection } from "@/platform/types";
import { DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID } from "@/platform/demo/default-demo-data";

type CapturedCall = { url: string; method: string; headers: Headers; body: string };

function connection(
  providerId: string,
  configuration: Record<string, unknown>,
): IntegrationConnection {
  const now = new Date().toISOString();
  return {
    id: `connection-${providerId}`,
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    providerId,
    environment: "SANDBOX",
    status: "CONFIGURED",
    displayName: providerId,
    configuration: { currencyMinorUnitFactor: 100, ...configuration },
    secretReference: `secret://${providerId}`,
    metadata: {},
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function adapterRuntime(responder: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: CapturedCall[] = [];
  const fetcher = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url: url.toString(), method: init.method ?? "GET", headers, body });
    return responder(url, init);
  }) as typeof fetch;
  const runtime: MarketplaceAdapterRuntime = {
    http: new ProviderHttpClient(new StructuredIntegrationLogger(), fetcher),
    tokens: new ProviderTokenService(),
  };
  return { runtime, calls };
}

function context(
  value: IntegrationConnection,
  credentials: Record<string, string>,
): ProviderExecutionContext {
  return { connection: value, credentials, correlationId: "pass-3-contract" };
}

function json(value: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const uberOrderFixture = {
  id: "uber-order-1",
  display_id: "UB001",
  placed_at: "2026-08-29T12:00:00+03:00",
  type: "DELIVERY_BY_UBER",
  current_state: "CREATED",
  store: { id: "uber-store-1" },
  eater: { id: "eater-1", first_name: "Amina", last_name: "Wanjiku" },
  cart: {
    items: [
      {
        id: "dish-1",
        title: "Chicken Biryani",
        quantity: 1,
        price: {
          unit_price: { amount: 300000, currency_code: "KES" },
          total_price: { amount: 300000, currency_code: "KES" },
        },
        selected_modifier_groups: [
          {
            selected_items: [
              {
                id: "modifier-1",
                title: "Extra gravy",
                quantity: 1,
                price: { unit_price: { amount: 0, currency_code: "KES" } },
              },
            ],
          },
        ],
        special_instructions: "No chilli",
      },
    ],
  },
  payment: {
    payment_method: "UBER",
    charges: {
      sub_total: { amount: 300000, currency_code: "KES" },
      tax: { amount: 0, currency_code: "KES" },
      total_fee: { amount: 0, currency_code: "KES" },
      total: { amount: 300000, currency_code: "KES" },
    },
  },
};

const glovoOrderFixture = {
  accepted_for: "2026-08-29T12:30:00Z",
  order_id: "glovo-order-1",
  order_code: "GL001",
  status: "RECEIVED",
  client: { store_id: "glovo-vendor-1" },
  customer: {
    _id: "customer-1",
    first_name: "Amina",
    last_name: "Wanjiku",
    phone_number: "+254700000000",
    delivery_address: {
      street: "Kipro Centre",
      number: "8",
      city: "Nairobi",
      formattedAddress: "Kipro Centre, Sports Road, Nairobi",
    },
  },
  order_type: "DELIVERY",
  transport_type: "LOGISTICS_DELIVERY",
  currency: "KES",
  items: [
    {
      _id: "glovo-line-1",
      sku: "dish-1",
      name: "Chicken Biryani",
      instructions: "No chilli",
      original_pricing: {
        pricing_type: "UNIT",
        quantity: 1,
        unit_price: 3000,
        total_price: 3000,
      },
      pricing: {
        pricing_type: "UNIT",
        quantity: 1,
        unit_price: 2700,
        total_price: 2700,
      },
      promotion: [{ name: "Launch offer", discount_amount: 300 }],
      status: "IN_CART",
    },
  ],
  payment: {
    additional_fees: { holiday_fee: 50 },
    delivery_fee: 100,
    discount: -300,
    discounts: [{ name: "Launch offer", value: -300 }],
    order_total: 2850,
    service_fee: 0,
    sub_total: 2700,
    total_taxes: 0,
    type: "PAID",
  },
  sys: { created_at: "2026-08-29T12:00:00Z" },
};

async function uberSignature(body: Uint8Array, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, body.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Pass 3 Uber Eats official contract", () => {
  it("verifies signed webhooks and normalizes the documented v2 order shape", async () => {
    const adapter = createUberEatsAdapter();
    const connectionValue = connection("provider-delivery-uber-eats", {
      externalStoreId: "uber-store-1",
    });
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        event_type: "orders.notification",
        event_id: "event-1",
        event_time: 1_787_990_400,
        meta: { resource_id: "uber-order-1", user_id: "uber-store-1", status: "pos" },
      }),
    );
    const request: ProviderWebhookRequest = {
      rawBody,
      headers: { "x-uber-signature": await uberSignature(rawBody, "client-secret") },
      connection: connectionValue,
      credentials: { clientSecret: "client-secret" },
    };
    expect(await adapter.verifyWebhook!(request)).toBe(true);
    expect(await adapter.parseWebhook!(request)).toMatchObject({
      ok: true,
      value: { eventType: "ORDER_CREATED", externalResourceId: "uber-order-1" },
    });
    const normalized = await adapter.normalizeIncomingOrder!(uberOrderFixture, connectionValue);
    expect(normalized).toMatchObject({
      ok: true,
      value: {
        providerOrderId: "uber-order-1",
        externalStoreId: "uber-store-1",
        pricing: { subtotal: 3000, total: 3000 },
        payment: { externallyPaid: true, amountPaid: 3000 },
      },
    });
  });

  it("uses documented OAuth scopes, order lifecycle, recovery, and store paths", async () => {
    const mock = adapterRuntime((url) => {
      if (url.hostname === "login.uber.com")
        return json({ access_token: "uber-token", expires_in: 7200, token_type: "Bearer" });
      if (url.pathname.endsWith("/created-orders"))
        return json({
          orders: [
            { id: "uber-order-1", current_state: "CREATED", placed_at: "2026-08-29T12:00:00Z" },
          ],
        });
      return json({}, url.pathname.endsWith("/ready") ? 200 : 200);
    });
    const adapter = createUberEatsAdapter(mock.runtime);
    const connectionValue = connection("provider-delivery-uber-eats", {
      externalStoreId: "uber-store-1",
    });
    const execution = context(connectionValue, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(
      await adapter.acceptOrder!("uber-order-1", connectionValue, execution, {
        estimatedReadyAt: "2026-08-29T12:30:00Z",
        acceptedBy: "Seramet",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await adapter.rejectOrder!("uber-order-2", "ITEM_UNAVAILABLE", connectionValue, execution),
    ).toMatchObject({ ok: true });
    expect(await adapter.markOrderReady!("uber-order-1", execution)).toMatchObject({ ok: true });
    expect(await adapter.setStoreStatus!("uber-store-1", "PAUSED", execution)).toMatchObject({
      ok: true,
    });
    expect(await adapter.recoverActiveOrders!("uber-store-1", execution)).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ externalOrderId: "uber-order-1" })],
    });

    const tokenCall = mock.calls.find((call) => call.url.includes("/oauth/v2/token"))!;
    expect(tokenCall.body).toContain("grant_type=client_credentials");
    expect(tokenCall.body).toContain("eats.store.orders.read");
    expect(mock.calls.map((call) => new URL(call.url).pathname)).toEqual(
      expect.arrayContaining([
        "/v1/delivery/order/uber-order-1/accept",
        "/v1/delivery/order/uber-order-2/deny",
        "/v1/delivery/order/uber-order-1/ready",
        "/v1/delivery/store/uber-store-1/update-store-status",
        "/v1/eats/stores/uber-store-1/created-orders",
      ]),
    );
  });

  it("serializes mapped menu IDs, lowest-denomination prices, and Unix suspension time", () => {
    const menu: NormalizedMarketplaceMenu = {
      storeId: "uber-store-1",
      currency: "KES",
      locale: "en-KE",
      menus: [{ internalId: "menu-1", name: "Main", categoryIds: ["category-1"] }],
      categories: [
        {
          internalId: "category-1",
          externalId: "uber-category-1",
          name: "Main Meals",
          itemIds: ["item-1"],
          metadata: {},
        },
      ],
      items: [
        {
          internalId: "item-1",
          externalId: "uber-item-1",
          name: "Chicken Biryani",
          price: 3000,
          available: false,
          categoryIds: ["category-1"],
          modifierGroupIds: ["group-1"],
          metadata: {},
        },
      ],
      modifierGroups: [
        {
          internalId: "group-1",
          externalId: "uber-group-1",
          name: "Extras",
          minSelections: 0,
          maxSelections: 2,
          modifiers: [
            {
              internalId: "modifier-1",
              externalId: "uber-modifier-1",
              name: "Extra gravy",
              price: 100,
              available: true,
              metadata: {},
            },
          ],
          metadata: {},
        },
      ],
      metadata: {},
    };
    expect(serializeUberMenu(menu, 100)).toMatchObject({
      menus: [{ category_ids: ["uber-category-1"] }],
      categories: [{ entities: [{ id: "uber-item-1", type: "ITEM" }] }],
      items: [
        {
          id: "uber-item-1",
          price_info: { price: 300000 },
          suspension_info: {
            suspension: { suspend_until: 4_102_444_799 },
            overrides: [],
          },
          modifier_group_ids: ["uber-group-1"],
        },
        {
          id: "uber-modifier-1",
          price_info: { price: 10000 },
          suspension_info: { suspension: null, overrides: [] },
        },
      ],
      modifier_groups: [{ id: "uber-group-1" }],
    });
  });
});

describe("Pass 3 Glovo Partner API contract", () => {
  it("requires the configured static webhook header and normalizes documented order fields", async () => {
    const adapter = createGlovoAdapter();
    const connectionValue = connection("provider-delivery-glovo", {
      chainId: "chain-1",
      externalStoreId: "glovo-vendor-1",
      webhookHeaderName: "x-glovo-token",
    });
    const rawBody = new TextEncoder().encode(JSON.stringify(glovoOrderFixture));
    const request: ProviderWebhookRequest = {
      rawBody,
      headers: { "x-glovo-token": "webhook-token" },
      connection: connectionValue,
      credentials: { webhookToken: "webhook-token" },
    };
    expect(await adapter.verifyWebhook!(request)).toBe(true);
    expect(await adapter.parseWebhook!(request)).toMatchObject({
      ok: true,
      value: { eventType: "ORDER_CREATED", externalResourceId: "glovo-order-1" },
    });
    expect(await adapter.normalizeIncomingOrder!(glovoOrderFixture, connectionValue)).toMatchObject(
      {
        ok: true,
        value: {
          providerOrderId: "glovo-order-1",
          externalStoreId: "glovo-vendor-1",
          customer: { externalCustomerId: "customer-1", name: "Amina Wanjiku" },
          pricing: {
            subtotal: 3000,
            discounts: 300,
            deliveryFee: 100,
            serviceFee: 50,
            total: 2850,
          },
          charges: [{ type: "PROMOTION", amount: 300 }],
        },
      },
    );
  });

  it("uses official token, order, catalog, and vendor status operations", async () => {
    const mock = adapterRuntime((url, init) => {
      if (url.pathname === "/v2/oauth/token")
        return json({ access_token: "glovo-token", expires_in: 7200, token_type: "Bearer" });
      if (url.pathname.endsWith("/orders/glovo-order-1") && (init.method ?? "GET") === "GET")
        return json(glovoOrderFixture);
      return json({}, (init.method ?? "GET") === "PUT" ? 202 : 200);
    });
    const adapter = createGlovoAdapter(mock.runtime);
    const connectionValue = connection("provider-delivery-glovo", {
      chainId: "chain-1",
      externalStoreId: "glovo-vendor-1",
      webhookHeaderName: "x-glovo-token",
    });
    const execution = context(connectionValue, {
      clientId: "client-id",
      clientSecret: "client-secret",
      webhookToken: "webhook-token",
    });
    expect(
      await adapter.acceptOrder!("glovo-order-1", connectionValue, execution, {
        estimatedReadyAt: "2026-08-29T12:30:00Z",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await adapter.syncAvailability!(
        {
          externalItemId: "dish-1",
          internalItemId: "item-1",
          available: false,
          quantityAvailable: 0,
        },
        connectionValue,
        execution,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await adapter.updateItemPrice!(
        { externalItemId: "dish-1", internalItemId: "item-1", price: 3200, currency: "KES" },
        execution,
      ),
    ).toMatchObject({ ok: true });
    expect(await adapter.setStoreStatus!("glovo-vendor-1", "PAUSED", execution)).toMatchObject({
      ok: true,
    });

    const paths = mock.calls.map((call) => new URL(call.url).pathname);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v2/oauth/token",
        "/v2/chains/chain-1/orders/glovo-order-1",
        "/v2/chains/chain-1/vendors/glovo-vendor-1/catalog",
        "/v2/chains/chain-1/vendors/glovo-vendor-1/status",
      ]),
    );
    const accepted = mock.calls.find(
      (call) => call.method === "PUT" && call.url.endsWith("/orders/glovo-order-1"),
    )!;
    expect(JSON.parse(accepted.body)).toMatchObject({
      order_id: "glovo-order-1",
      status: "ACCEPTED",
      accepted_for: "2026-08-29T12:30:00.000Z",
    });
    const priceUpdate = mock.calls.find(
      (call) => call.method === "PUT" && call.body.includes('"price":3200'),
    );
    expect(priceUpdate).toBeDefined();
  });

  it("enforces transport-specific ready and dispatched states", async () => {
    const mock = adapterRuntime((url, init) => {
      if (url.pathname === "/v2/oauth/token")
        return json({ access_token: "glovo-token", expires_in: 7200 });
      if ((init.method ?? "GET") === "GET") return json(glovoOrderFixture);
      return json({}, 200);
    });
    const adapter = createGlovoAdapter(mock.runtime);
    const connectionValue = connection("provider-delivery-glovo", {
      chainId: "chain-1",
      externalStoreId: "glovo-vendor-1",
    });
    const execution = context(connectionValue, {
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(await adapter.markOrderReady!("glovo-order-1", execution)).toMatchObject({ ok: true });
    expect(
      await adapter.updateStatus!("glovo-order-1", "DISPATCHED", connectionValue, execution),
    ).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });
});

describe("Pass 3 Bolt Food boundary", () => {
  it("returns SPEC_REQUIRED instead of simulated provider success", async () => {
    const adapter = createBoltFoodAdapter();
    const connectionValue = connection("provider-delivery-bolt-food", {});
    const execution = context(connectionValue, {});
    expect(adapter.definition.capabilities).toEqual([]);
    expect(await adapter.getOrder!("bolt-order", execution)).toMatchObject({
      ok: false,
      code: "SPEC_REQUIRED",
    });
    expect(await adapter.healthCheck(connectionValue, execution)).toMatchObject({
      status: "CONFIG_REQUIRED",
    });
  });
});
