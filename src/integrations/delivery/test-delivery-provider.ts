import type { NormalizedExternalOrder, ProviderAdapter } from "@/integrations/types";
import type { ProviderDefinition } from "@/platform/types";

export const testDeliveryDefinition: ProviderDefinition = {
  id: "provider-test-delivery",
  code: "TEST_DELIVERY",
  displayName: "Test Delivery Provider",
  category: "DELIVERY",
  version: "test-v1",
  capabilities: [
    "RECEIVE_ORDERS",
    "GET_ORDER",
    "RECOVER_ACTIVE_ORDERS",
    "ACCEPT_ORDER",
    "REJECT_ORDER",
    "UPDATE_ORDER_STATUS",
    "ORDER_MODIFICATIONS",
    "WEBHOOK_CONFIRMATION",
    "MARK_ORDER_READY",
    "CANCEL_ORDER",
    "SYNC_MENU",
    "SYNC_PRICES",
    "SYNC_AVAILABILITY",
    "READ_STORE_STATUS",
    "UPDATE_STORE_STATUS",
  ],
  configurationSchema: {},
  secretFields: ["webhookSecret"],
  adapterMetadata: {
    baseUrls: {
      SANDBOX: "https://sandbox.test.invalid",
      PRODUCTION: "https://production.test.invalid",
    },
    webhookBodyLimitBytes: 64_000,
  },
  enabled: true,
};

export type TestDeliveryControls = {
  failuresRemaining?: number;
  failureCode?:
    "PROVIDER_UNAVAILABLE" | "AUTHENTICATION" | "AUTHORIZATION" | "VALIDATION" | "RATE_LIMITED";
  retryAfterMs?: number;
  acceptedOrders?: string[];
  rejectedOrders?: string[];
  readyOrders?: string[];
  cancelledOrders?: string[];
  menuSyncs?: unknown[];
  availabilitySyncs?: unknown[];
  priceSyncs?: unknown[];
  storeStatuses?: string[];
  recoverableOrders?: Array<{
    externalOrderId: string;
    providerEventId?: string;
    placedAt?: string;
    payload?: unknown;
  }>;
  ordersById?: Record<string, NormalizedExternalOrder>;
};

export function createTestDeliveryAdapter(controls: TestDeliveryControls = {}): ProviderAdapter {
  const maybeFail = () => {
    if ((controls.failuresRemaining ?? 0) <= 0) return null;
    controls.failuresRemaining = (controls.failuresRemaining ?? 0) - 1;
    const code = controls.failureCode ?? "PROVIDER_UNAVAILABLE";
    return {
      ok: false as const,
      code,
      message: `Injected ${code}`,
      retryable: code === "PROVIDER_UNAVAILABLE" || code === "RATE_LIMITED",
      ...(controls.retryAfterMs ? { retryAfterMs: controls.retryAfterMs } : {}),
    };
  };
  return {
    definition: testDeliveryDefinition,
    healthCheck: async () => ({
      status: (controls.failuresRemaining ?? 0) > 0 ? "DEGRADED" : "HEALTHY",
      checkedAt: new Date().toISOString(),
      message: "Test provider health",
    }),
    verifyWebhook: (request) =>
      request.headers["x-test-signature"] === request.credentials["webhookSecret"],
    parseWebhook: async (request) => {
      const failure = maybeFail();
      if (failure) return failure;
      try {
        const payload = JSON.parse(new TextDecoder().decode(request.rawBody)) as {
          eventId?: string;
          eventType?: string;
          order?: NormalizedExternalOrder;
          storeId?: string;
          resourceId?: string;
        };
        if (!payload.eventId || !payload.eventType)
          return {
            ok: false,
            code: "VALIDATION",
            message: "Malformed test payload",
            retryable: false,
          };
        return {
          ok: true,
          value: {
            providerEventId: payload.eventId,
            eventType: payload.eventType as "ORDER_CREATED",
            ...((payload.resourceId ?? payload.order?.providerOrderId)
              ? { externalResourceId: payload.resourceId ?? payload.order?.providerOrderId }
              : {}),
            ...((payload.storeId ?? payload.order?.externalStoreId)
              ? { externalStoreId: payload.storeId ?? payload.order?.externalStoreId }
              : {}),
            payload: payload.order ?? payload,
          },
        };
      } catch {
        return { ok: false, code: "VALIDATION", message: "Malformed test JSON", retryable: false };
      }
    },
    normalizeIncomingOrder: async (payload) => ({
      ok: true,
      value: payload as NormalizedExternalOrder,
    }),
    getOrder: async (id) => {
      const value = controls.ordersById?.[id];
      return value
        ? { ok: true, value }
        : { ok: false, code: "VALIDATION", message: `No test order ${id}`, retryable: false };
    },
    recoverActiveOrders: async () => ({ ok: true, value: controls.recoverableOrders ?? [] }),
    acceptOrder: async (id) => {
      const failure = maybeFail();
      if (failure) return failure;
      (controls.acceptedOrders ??= []).push(id);
      return { ok: true, value: { accepted: true } };
    },
    rejectOrder: async (id) => {
      (controls.rejectedOrders ??= []).push(id);
      return { ok: true, value: { rejected: true } };
    },
    markOrderReady: async (id) => {
      (controls.readyOrders ??= []).push(id);
      return { ok: true, value: { ready: true } };
    },
    cancelOrder: async (id) => {
      (controls.cancelledOrders ??= []).push(id);
      return { ok: true, value: { cancelled: true } };
    },
    syncMenu: async (menu) => {
      const failure = maybeFail();
      if (failure) return failure;
      (controls.menuSyncs ??= []).push(menu);
      return { ok: true, value: { synced: true } };
    },
    syncAvailability: async (availability) => {
      (controls.availabilitySyncs ??= []).push(availability);
      return { ok: true, value: { synced: true } };
    },
    updateItemPrice: async (item) => {
      (controls.priceSyncs ??= []).push(item);
      return { ok: true, value: { synced: true } };
    },
    getStoreStatus: async () => ({ ok: true, value: { status: "OPEN" } }),
    setStoreStatus: async (_id, status) => {
      (controls.storeStatuses ??= []).push(status);
      return { ok: true, value: { status } };
    },
  };
}
