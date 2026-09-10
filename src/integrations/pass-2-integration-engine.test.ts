import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { products } from "@/platform/demo/legacy-ui-fixtures";
import {
  createTestDeliveryAdapter,
  testDeliveryDefinition,
  type TestDeliveryControls,
} from "@/integrations/delivery/test-delivery-provider";
import { createDefaultProviderRegistry, ProviderRegistry } from "@/integrations/provider-registry";
import { StaticCredentialResolver } from "@/integrations/runtime/credential-resolver";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import {
  AuthenticationError,
  ProviderUnavailableError,
  RateLimitError,
} from "@/integrations/runtime/integration-errors";
import {
  createIntegrationRepository,
  resetIntegrationMemoryForTests,
} from "@/integrations/runtime/integration-repository";
import type { ExternalResourceMapping } from "@/integrations/runtime/models";
import { ProviderHttpClient } from "@/integrations/runtime/provider-http-client";
import {
  redactSensitive,
  StructuredIntegrationLogger,
  type IntegrationLogEntry,
} from "@/integrations/runtime/redaction";
import { RetryService } from "@/integrations/runtime/retry-service";
import type { NormalizedExternalOrder } from "@/integrations/types";
import type { ServerActor } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import {
  createEmptyTransactionState,
  TransactionEngine,
  type TransactionState,
} from "@/lib/transaction-engine";
import { createInitialTransactionState } from "@/testing/transaction-state-fixture";
import {
  createDefaultDemoPlatformState,
  DEMO_TENANT_ID,
  DEMO_WESTLANDS_BRANCH_ID,
} from "@/platform/demo/default-demo-data";
import {
  ConfigurationRepository,
  setConfigurationRepositoryForTests,
} from "@/platform/repositories/configuration-repository";

const connectionId = "connection-test-delivery";
const externalStoreId = "external-store-001";
const externalItemId = "external-item-001";
const internalItemId = "product-internal-001";
const externalModifierId = "external-modifier-001";
const internalModifierId = "modifier-internal-001";

class TestTransactionRepository implements TransactionRepository {
  readonly authoritative = false;
  state = createEmptyTransactionState(DEMO_TENANT_ID);
  idempotency = new Map<string, import("@/lib/seramet-repository").IdempotencyRecord>();
  providerEvents: import("@/lib/seramet-repository").ProviderWebhookEvent[] = [];
  async migrate() {}
  async revision() {
    return 0;
  }
  async commitMutation(): Promise<never> {
    throw new Error("Typed transaction commands are not used by this integration fixture");
  }
  async loadState(tenantId: string) {
    return tenantId === this.state.tenantId
      ? structuredClone(this.state)
      : createEmptyTransactionState(tenantId);
  }
  async saveState(state: TransactionState, actor: ServerActor) {
    if (state.tenantId !== actor.tenantId) throw new Error("Cross tenant");
    this.state = structuredClone(state);
  }
  async getIdempotency(tenantId: string, key: string) {
    return this.idempotency.get(`${tenantId}:${key}`) ?? null;
  }
  async saveIdempotency(record: import("@/lib/seramet-repository").IdempotencyRecord) {
    this.idempotency.set(`${record.tenantId}:${record.key}`, record);
  }
  async appendProviderEvent(event: import("@/lib/seramet-repository").ProviderWebhookEvent) {
    this.providerEvents.push(event);
  }
}

type Fixture = ReturnType<typeof fixture>;

function fixture(
  controls: TestDeliveryControls = {},
  options: {
    storeMapping?: boolean;
    itemMapping?: boolean;
    unmappedItemPolicy?: string;
    acceptancePolicy?: string;
    retry?: RetryService;
  } = {},
) {
  const state = createDefaultDemoPlatformState();
  state.providers.push(testDeliveryDefinition);
  state.connections.push({
    id: connectionId,
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    providerId: testDeliveryDefinition.id,
    environment: "SANDBOX",
    status: "CONFIGURED",
    displayName: "Test delivery sandbox",
    configuration: {
      channelId: "channel-test-delivery",
      unmappedItemPolicy: options.unmappedItemPolicy ?? "AUTO_REJECT",
      acceptancePolicy: options.acceptancePolicy ?? "AUTO_ACCEPT_VALID",
      availabilitySyncEnabled: true,
      priceSyncEnabled: true,
      storeStatusSyncEnabled: true,
      settlementAccountId: "Marketplace Receivables - Test",
    },
    secretReference: "secret://test/delivery",
    metadata: {},
    consecutiveFailures: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.orderChannels.push({
    id: "channel-test-delivery",
    tenantId: DEMO_TENANT_ID,
    code: "TEST_DELIVERY",
    displayName: "Test Delivery",
    channelType: "MARKETPLACE",
    enabled: true,
    deliveryProviderConnectionId: connectionId,
    requiresCustomer: false,
    requiresTable: false,
    requiresAddress: true,
    isExternallyPaid: true,
    sortOrder: 99,
    metadata: {},
  });
  const configuration = new ConfigurationRepository(state);
  setConfigurationRepositoryForTests(configuration);
  const registry = new ProviderRegistry().register(createTestDeliveryAdapter(controls));
  const repository = createIntegrationRepository();
  const transactions = new TestTransactionRepository();
  const retry =
    options.retry ??
    new RetryService(
      { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 4, jitterRatio: 0 },
      async () => undefined,
      () => 0.5,
    );
  const runtime = createIntegrationRuntime(
    {},
    {
      configuration,
      registry,
      repository,
      transactions,
      credentials: new StaticCredentialResolver({
        "secret://test/delivery": { webhookSecret: "test-signature" },
      }),
      retry,
      catalog: async () => products,
    },
  );
  const now = new Date().toISOString();
  const mappings: ExternalResourceMapping[] = [];
  if (options.storeMapping !== false)
    mappings.push({
      id: "mapping-store",
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      connectionId,
      providerId: testDeliveryDefinition.id,
      resourceType: "STORE",
      internalId: DEMO_WESTLANDS_BRANCH_ID,
      externalId: externalStoreId,
      status: "MAPPED",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
  if (options.itemMapping !== false)
    mappings.push({
      id: "mapping-item",
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      connectionId,
      providerId: testDeliveryDefinition.id,
      resourceType: "ITEM",
      internalId: internalItemId,
      externalId: externalItemId,
      status: "MAPPED",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
  mappings.push({
    id: "mapping-modifier",
    tenantId: DEMO_TENANT_ID,
    branchId: DEMO_WESTLANDS_BRANCH_ID,
    connectionId,
    providerId: testDeliveryDefinition.id,
    resourceType: "MODIFIER",
    internalId: internalModifierId,
    externalId: externalModifierId,
    status: "MAPPED",
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
  return {
    runtime,
    repository,
    transactions,
    configuration,
    controls,
    ready: Promise.all(mappings.map((mapping) => repository.upsertMapping(mapping))),
  };
}

function order(overrides: Partial<NormalizedExternalOrder> = {}): NormalizedExternalOrder {
  return {
    providerOrderId: "external-order-001",
    connectionId,
    externalStoreId,
    orderType: "DELIVERY",
    createdAt: new Date().toISOString(),
    currency: "KES",
    customer: { name: "Test customer", phone: "254700000000" },
    delivery: { type: "PROVIDER", providerManaged: true, address: "Test address" },
    items: [
      {
        externalItemId,
        name: "Mapped dish",
        quantity: 2,
        unitPrice: 500,
        total: 1000,
        modifiers: [],
        notes: "No chilli",
      },
    ],
    pricing: { subtotal: 1000, discounts: 0, taxes: 0, total: 1000 },
    payment: {
      externallyPaid: true,
      providerPaymentReference: "provider-payment-001",
      amountPaid: 1000,
    },
    ...overrides,
  };
}

function webhook(externalOrder = order(), eventId = "event-001", eventType = "ORDER_CREATED") {
  const rawBody = new TextEncoder().encode(
    JSON.stringify({
      eventId,
      eventType,
      resourceId: externalOrder.providerOrderId,
      storeId: externalOrder.externalStoreId,
      order: externalOrder,
    }),
  );
  return {
    tenantId: DEMO_TENANT_ID,
    providerCode: testDeliveryDefinition.code,
    connectionId,
    rawBody,
    headers: { "x-test-signature": "test-signature", "x-correlation-id": `corr-${eventId}` },
  };
}

beforeEach(() => resetIntegrationMemoryForTests());
afterEach(() => {
  setConfigurationRepositoryForTests(undefined);
  vi.restoreAllMocks();
});

describe("Pass 2 acceptance A-V", () => {
  it("A. valid webhook creates exactly one immutable event", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    const events = await f.repository.listEvents(DEMO_TENANT_ID);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("PROCESSED");
    expect(events[0]?.payload).toBeTruthy();
  });

  it("B. duplicate webhook does not create a duplicate order", async () => {
    const f = fixture();
    await f.ready;
    const first = await f.runtime.handleWebhook(webhook());
    const duplicate = await f.runtime.handleWebhook(webhook());
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(f.transactions.state.orders).toHaveLength(1);
    expect(await f.repository.listEvents(DEMO_TENANT_ID)).toHaveLength(1);
  });

  it("C. invalid webhook signature is rejected before persistence", async () => {
    const f = fixture();
    await f.ready;
    const input = webhook();
    input.headers["x-test-signature"] = "wrong";
    await expect(f.runtime.handleWebhook(input)).rejects.toMatchObject({
      code: "WEBHOOK_VERIFICATION",
    });
    expect(await f.repository.listEvents(DEMO_TENANT_ID)).toHaveLength(0);
  });

  it("D. Tenant A cannot access Tenant B integration records", async () => {
    const f = fixture();
    await f.ready;
    await f.repository.upsertMapping({
      id: "tenant-b-map",
      tenantId: "tenant-b",
      connectionId: "connection-b",
      providerId: "provider-b",
      resourceType: "ITEM",
      internalId: "internal-b",
      externalId: "external-b",
      status: "MAPPED",
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(await f.repository.listMappings(DEMO_TENANT_ID)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "tenant-b-map" })]),
    );
    expect(
      await f.repository.getMapping(DEMO_TENANT_ID, "connection-b", "ITEM", "external-b"),
    ).toBeNull();
  });

  it("E. branch store mapping resolves to the configured branch", async () => {
    const f = fixture();
    await f.ready;
    const result = await f.runtime.handleWebhook(webhook());
    expect(result.result).toMatchObject({ branchId: DEMO_WESTLANDS_BRANCH_ID });
    expect(f.transactions.state.orders[0]?.branchId).toBe(DEMO_WESTLANDS_BRANCH_ID);
  });

  it("F. unknown store produces a durable mapping issue", async () => {
    const f = fixture({}, { storeMapping: false });
    await f.ready;
    await expect(f.runtime.handleWebhook(webhook())).rejects.toMatchObject({ code: "MAPPING" });
    const events = await f.repository.listEvents(DEMO_TENANT_ID);
    expect(events[0]?.status).toBe("DEAD_LETTER");
    expect((await f.repository.listDeadLetters(DEMO_TENANT_ID))[0]?.error).toContain("store");
  });

  it("G. external item mapping resolves to the internal product", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    expect(f.transactions.state.orders[0]?.lines[0]?.productId).toBe(internalItemId);
  });

  it("H. unmapped item follows AUTO_REJECT and USE_EXTERNAL_DESCRIPTION policies", async () => {
    const safe = fixture({}, { itemMapping: false });
    await safe.ready;
    await expect(safe.runtime.handleWebhook(webhook())).rejects.toMatchObject({ code: "MAPPING" });
    expect(safe.transactions.state.orders).toHaveLength(0);
    resetIntegrationMemoryForTests();
    const permissive = fixture(
      {},
      { itemMapping: false, unmappedItemPolicy: "USE_EXTERNAL_DESCRIPTION" },
    );
    await permissive.ready;
    await permissive.runtime.handleWebhook(
      webhook(order({ providerOrderId: "external-order-description" }), "event-description"),
    );
    expect(permissive.transactions.state.orders[0]?.lines[0]?.name).toBe("Mapped dish");
    expect(permissive.transactions.state.orders[0]?.lines[0]?.productId).toBeUndefined();
  });

  it("I. auto acceptance only occurs after mapping and channel validation", async () => {
    const controls: TestDeliveryControls = { acceptedOrders: [] };
    const f = fixture(controls);
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    const acceptance = (await f.repository.listOutbox(DEMO_TENANT_ID)).find(
      (record) => record.eventType === "ORDER_ACCEPTED",
    );
    expect(acceptance).toBeTruthy();
    await f.runtime.processOutboxRecord(DEMO_TENANT_ID, acceptance!.id);
    expect(controls.acceptedOrders).toEqual(["external-order-001"]);
    expect(f.transactions.state.orders[0]?.status).toBe("SENT_TO_KITCHEN");
    resetIntegrationMemoryForTests();
    const invalid = fixture({ acceptedOrders: [] }, { itemMapping: false });
    await invalid.ready;
    await expect(invalid.runtime.handleWebhook(webhook())).rejects.toBeTruthy();
    expect(invalid.controls.acceptedOrders).toEqual([]);
  });

  it("J. outbox sends a provider event once for a repeated idempotency key", async () => {
    const controls: TestDeliveryControls = { acceptedOrders: [] };
    const f = fixture(controls);
    await f.ready;
    const input = {
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "outbound-order",
      payload: {},
      idempotencyKey: "outbox-once",
    };
    const first = await f.runtime.enqueueOutbound(input);
    const second = await f.runtime.enqueueOutbound(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    await f.runtime.processOutboxRecord(DEMO_TENANT_ID, first.record.id);
    expect(controls.acceptedOrders).toEqual(["outbound-order"]);
  });

  it("K. transient provider failures retry and eventually succeed", async () => {
    const controls: TestDeliveryControls = {
      failuresRemaining: 2,
      failureCode: "PROVIDER_UNAVAILABLE",
      acceptedOrders: [],
    };
    const f = fixture(controls);
    await f.ready;
    const queued = await f.runtime.enqueueOutbound({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "retry-order",
      payload: {},
      idempotencyKey: "retry-transient",
    });
    const result = await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    expect(result.status).toBe("PROCESSED");
    expect(result.attemptCount).toBe(3);
    expect(controls.acceptedOrders).toEqual(["retry-order"]);
  });

  it("L. permanent provider failure is not retried endlessly", async () => {
    const controls: TestDeliveryControls = { failuresRemaining: 5, failureCode: "AUTHENTICATION" };
    const f = fixture(controls);
    await f.ready;
    const queued = await f.runtime.enqueueOutbound({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "auth-order",
      payload: {},
      idempotencyKey: "permanent",
    });
    const result = await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    expect(result.status).toBe("DEAD_LETTER");
    expect(result.attemptCount).toBe(1);
  });

  it("M. Retry-After delay is respected", async () => {
    const delays: number[] = [];
    const retry = new RetryService(
      { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 },
      async (ms) => {
        delays.push(ms);
      },
      () => 0.5,
    );
    const f = fixture(
      { failuresRemaining: 1, failureCode: "RATE_LIMITED", retryAfterMs: 2500, acceptedOrders: [] },
      { retry },
    );
    await f.ready;
    const queued = await f.runtime.enqueueOutbound({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "rate-order",
      payload: {},
      idempotencyKey: "rate-limit",
    });
    await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    expect(delays).toEqual([2500]);
  });

  it("N. retry exhaustion creates a dead-letter record", async () => {
    const f = fixture({ failuresRemaining: 9, failureCode: "PROVIDER_UNAVAILABLE" });
    await f.ready;
    const queued = await f.runtime.enqueueOutbound({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "dead-order",
      payload: { safe: true },
      idempotencyKey: "dead-letter",
    });
    await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    const letters = await f.repository.listDeadLetters(DEMO_TENANT_ID);
    expect(letters).toHaveLength(1);
    expect(letters[0]).toMatchObject({
      sourceType: "OUTBOX",
      providerId: testDeliveryDefinition.id,
      attemptCount: 3,
      status: "OPEN",
    });
  });

  it("O. manual replay creates a new attempt and keeps the original", async () => {
    const f = fixture();
    await f.ready;
    const handled = await f.runtime.handleWebhook(webhook());
    const replay = await f.runtime.replayEvent(DEMO_TENANT_ID, handled.eventId, "manager-1");
    const events = await f.repository.listEvents(DEMO_TENANT_ID);
    expect(events).toHaveLength(2);
    expect(replay.originalEventId).toBe(handled.eventId);
    expect(replay.replayEventId).not.toBe(handled.eventId);
    expect(events.find((item) => item.id === handled.eventId)?.status).toBe("PROCESSED");
  });

  it("P. connection health opens the circuit after repeated failures", async () => {
    const f = fixture({ failuresRemaining: 10 });
    await f.ready;
    await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    const health = await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    expect(health.circuitState).toBe("OPEN");
    expect(health.consecutiveFailures).toBeGreaterThanOrEqual(3);
  });

  it("Q. secrets never appear in serialized frontend configuration", async () => {
    const f = fixture();
    await f.ready;
    const current = f.configuration
      .listConnections(DEMO_TENANT_ID)
      .find((item) => item.id === connectionId)!;
    f.configuration.upsertConnection(DEMO_TENANT_ID, {
      ...current,
      configuration: {
        publicStore: "store",
        apiKey: "secret-api",
        nested: { clientSecret: "secret-client", safe: "yes" },
      },
    });
    const serialized = JSON.stringify(f.configuration.snapshot());
    expect(serialized).not.toContain("secret-api");
    expect(serialized).not.toContain("secret-client");
    expect(serialized).toContain("publicStore");
  });

  it("R. secrets are redacted from logs and errors", () => {
    const value = redactSensitive({
      authorization: "Bearer secret-token",
      nested: { password: "secret-password", safe: "visible" },
    });
    expect(JSON.stringify(value)).not.toContain("secret-token");
    expect(JSON.stringify(value)).not.toContain("secret-password");
    expect(value).toMatchObject({ authorization: "[REDACTED]", nested: { safe: "visible" } });
  });

  it("S. sandbox cannot use the production base URL", async () => {
    const client = new ProviderHttpClient(new StructuredIntegrationLogger());
    await expect(
      client.request({
        tenantId: DEMO_TENANT_ID,
        connectionId,
        providerId: testDeliveryDefinition.id,
        environment: "SANDBOX",
        operation: "isolation",
        correlationId: "corr",
        baseUrls: { SANDBOX: "https://api.example.com", PRODUCTION: "https://api.example.com" },
        path: "/orders",
      }),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_ISOLATION" });
  });

  it("T. a custom provider registers without modifying POS modules", () => {
    const custom = createTestDeliveryAdapter();
    const registry = new ProviderRegistry().register(custom);
    expect(registry.get(testDeliveryDefinition.id)).toBe(custom);
    expect(registry.list("RECEIVE_ORDERS")).toHaveLength(1);
  });

  it("U. existing Daraja and spec-gated payment adapters remain registered", () => {
    const registry = createDefaultProviderRegistry({});
    expect(registry.get("provider-daraja").definition.capabilities).toContain("PAYMENT_PROMPT");
    expect(registry.get("provider-tendepay").definition.capabilities).toEqual([]);
  });

  it("V. existing order and KDS workflow remains operational", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    const created = f.transactions.state.orders[0]!;
    const preparing = TransactionEngine.setProductionStationStatus(
      f.transactions.state,
      created.id,
      "MAIN KITCHEN",
      "PREPARING",
      "Chef",
    );
    expect(preparing.orders[0]?.status).toBe("IN_PROGRESS");
    expect(preparing.orders[0]?.lines[0]?.productionStatus).toBe("PREPARING");
  });

  it("does not activate an order connection without its branch store mapping", async () => {
    const f = fixture({}, { storeMapping: false });
    await f.ready;
    const validation = await f.runtime.validateConnection(DEMO_TENANT_ID, connectionId);
    const health = await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    const connection = f.configuration
      .listConnections(DEMO_TENANT_ID)
      .find((item) => item.id === connectionId);
    expect(validation.valid).toBe(false);
    expect(validation.issues.join(" ")).toContain("provider store");
    expect(health.status).toBe("CONFIG_REQUIRED");
    expect(connection?.status).toBe("CONFIGURED");
  });

  it("routes a confirmed payment callback through the transaction engine", async () => {
    const f = fixture();
    await f.ready;
    f.transactions.state = createInitialTransactionState();
    const intent = f.transactions.state.paymentIntents[0]!;
    const callback = webhook(order(), "provider-payment-confirmed", "PAYMENT_CONFIRMED");
    callback.rawBody = new TextEncoder().encode(
      JSON.stringify({
        eventId: "provider-payment-confirmed",
        eventType: "PAYMENT_CONFIRMED",
        resourceId: intent.id,
      }),
    );
    const handled = await f.runtime.handleWebhook(callback);
    expect(handled.result).toMatchObject({ paymentIntentId: intent.id, status: "SUCCEEDED" });
    expect(f.transactions.state.paymentIntents.find((item) => item.id === intent.id)?.status).toBe(
      "SUCCEEDED",
    );
    expect(
      (await f.repository.listMappings(DEMO_TENANT_ID, connectionId)).find(
        (mapping) => mapping.resourceType === "PAYMENT",
      ),
    ).toMatchObject({ internalId: intent.id, externalId: "provider-payment-confirmed" });
  });

  it("blocks outbound provider calls while the circuit is open", async () => {
    const controls: TestDeliveryControls = { failuresRemaining: 3, acceptedOrders: [] };
    const f = fixture(controls);
    await f.ready;
    await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    await f.runtime.testConnection(DEMO_TENANT_ID, connectionId);
    controls.failuresRemaining = 0;
    const queued = await f.runtime.enqueueOutbound({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      eventType: "ORDER_ACCEPTED",
      resourceType: "ORDER",
      resourceId: "circuit-order",
      payload: {},
      idempotencyKey: "circuit-open",
    });
    const result = await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    expect(result.status).toBe("DEAD_LETTER");
    expect(controls.acceptedOrders).toEqual([]);
  });
});

describe("Pass 2 failure injection", () => {
  async function httpFailure(status: number, headers: Record<string, string> = {}) {
    const logs: IntegrationLogEntry[] = [];
    const client = new ProviderHttpClient(
      new StructuredIntegrationLogger((entry) => logs.push(entry)),
      (async () =>
        new Response(JSON.stringify({ error: "safe" }), { status, headers })) as typeof fetch,
    );
    const request = client.request({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      providerId: testDeliveryDefinition.id,
      environment: "SANDBOX",
      operation: `http-${status}`,
      correlationId: `corr-${status}`,
      baseUrls: { SANDBOX: "https://sandbox.example.com", PRODUCTION: "https://api.example.com" },
      path: "/failure",
    });
    return { request, logs };
  }

  it.each([
    [401, "AUTHENTICATION", false],
    [403, "AUTHORIZATION", false],
    [409, "HTTP_409", false],
    [500, "PROVIDER_UNAVAILABLE", true],
  ])("classifies HTTP %s correctly", async (status, code, retryable) => {
    const { request } = await httpFailure(status as number);
    await expect(request).rejects.toMatchObject({ code, retryable });
  });

  it("classifies HTTP 429 with Retry-After", async () => {
    const { request } = await httpFailure(429, { "retry-after": "3" });
    await expect(request).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterMs: 3000,
    });
  });

  it("classifies timeout as retryable", async () => {
    const client = new ProviderHttpClient(
      new StructuredIntegrationLogger(),
      ((_: unknown, init?: RequestInit) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        )) as typeof fetch,
    );
    await expect(
      client.request({
        tenantId: DEMO_TENANT_ID,
        connectionId,
        providerId: testDeliveryDefinition.id,
        environment: "SANDBOX",
        operation: "timeout",
        correlationId: "corr-timeout",
        baseUrls: { SANDBOX: "https://sandbox.example.com", PRODUCTION: "https://api.example.com" },
        path: "/slow",
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("rejects malformed provider payload", async () => {
    const f = fixture();
    await f.ready;
    await expect(
      f.runtime.handleWebhook({ ...webhook(), rawBody: new TextEncoder().encode("not-json") }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await f.repository.listEvents(DEMO_TENANT_ID)).toHaveLength(0);
  });

  it("handles out-of-order cancellation without creating an order", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook(order(), "event-cancel-first", "ORDER_CANCELLED"));
    expect(f.transactions.state.orders).toHaveLength(0);
    expect((await f.repository.listEvents(DEMO_TENANT_ID))[0]?.status).toBe("PROCESSED");
  });

  it("does not expose credentials in structured provider call logs", async () => {
    const logs: IntegrationLogEntry[] = [];
    const client = new ProviderHttpClient(
      new StructuredIntegrationLogger((entry) => logs.push(entry)),
      (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
    );
    await client.request({
      tenantId: DEMO_TENANT_ID,
      connectionId,
      providerId: testDeliveryDefinition.id,
      environment: "SANDBOX",
      operation: "redaction",
      correlationId: "corr-log",
      baseUrls: { SANDBOX: "https://sandbox.example.com", PRODUCTION: "https://api.example.com" },
      path: "/ok",
      headers: { authorization: "Bearer should-not-log" },
    });
    expect(JSON.stringify(logs)).not.toContain("should-not-log");
  });
});

describe("Pass 3 marketplace acceptance", () => {
  it("AA. posts marketplace-paid orders to a provider receivable without cash settlement", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());

    expect(f.transactions.state.orders[0]).toMatchObject({
      total: 1000,
      paymentStatus: "PROVIDER_RECEIVABLE",
    });
    expect(f.transactions.state.bills[0]).toMatchObject({
      total: 1000,
      status: "PROVIDER_RECEIVABLE",
      paid: 0,
    });
    expect(f.transactions.state.marketplaceReceivables[0]).toMatchObject({
      grossAmount: 1000,
      outstandingAmount: 1000,
      settledAmount: 0,
      receivableAccount: "Marketplace Receivables - Test",
      status: "OPEN",
    });
    expect(f.transactions.state.payments).toHaveLength(0);
    expect(f.transactions.state.receipts).toHaveLength(0);
    expect(f.transactions.state.externalTransactions).toHaveLength(0);
    expect(f.transactions.state.paymentIntents).toHaveLength(0);
    expect(f.transactions.state.journalEntries[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: "Marketplace Receivables - Test", debit: 1000 }),
        expect.objectContaining({ account: "Restaurant Revenue", credit: 1000 }),
      ]),
    );
  });

  it("AB. records provider promotions separately without reducing gross sale", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(
      webhook(
        order({
          pricing: { subtotal: 1000, discounts: 100, taxes: 0, total: 900 },
          payment: { externallyPaid: true, amountPaid: 900 },
          charges: [
            {
              type: "PROMOTION",
              description: "Provider promotion",
              amount: 100,
              currency: "KES",
              source: "PROVIDER_ORDER",
              externalReference: "promo-1",
              metadata: {},
            },
          ],
        }),
      ),
    );
    expect(f.transactions.state.orders[0]?.total).toBe(1000);
    expect(f.transactions.state.marketplaceReceivables[0]).toMatchObject({
      grossAmount: 1000,
      externallyCollectedAmount: 900,
      outstandingAmount: 1000,
    });
    expect(f.transactions.state.marketplaceCharges[0]).toMatchObject({
      type: "PROMOTION",
      amount: 100,
    });
  });

  it("E-F. preserves mapped modifiers and special instructions for KDS and KOT", async () => {
    const f = fixture();
    await f.ready;
    const incoming = order({
      specialInstructions: "Allergy: sesame",
      items: [
        {
          externalItemId,
          name: "Mapped dish",
          quantity: 1,
          unitPrice: 1000,
          total: 1000,
          notes: "No chilli",
          modifiers: [
            {
              externalModifierId,
              name: "Extra gravy",
              quantity: 1,
              unitPrice: 0,
            },
          ],
        },
      ],
    });
    await f.runtime.handleWebhook(webhook(incoming));
    expect(f.transactions.state.orders[0]?.kitchenNote).toBe("Allergy: sesame");
    expect(f.transactions.state.orders[0]?.lines[0]?.itemNote).toContain("No chilli");
    expect(f.transactions.state.orders[0]?.lines[0]?.itemNote).toContain("Extra gravy");
  });

  it("J-K. queues READY only after every production station is ready", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    f.transactions.state.orders[0]!.lines.push({
      id: "bar-line",
      name: "Test drink",
      category: "Drinks",
      quantity: 1,
      unitPrice: 0,
      productionStation: "BAR",
      productionStatus: "NEW",
    });
    const previous = structuredClone(f.transactions.state);
    const kitchenReady = TransactionEngine.setProductionStationStatus(
      previous,
      previous.orders[0]!.id,
      "MAIN KITCHEN",
      "READY",
      "Chef",
    );
    await f.runtime.captureTransactionDomainEvents(previous, kitchenReady);
    expect(
      (await f.repository.listOutbox(DEMO_TENANT_ID)).filter(
        (record) => record.eventType === "ORDER_READY",
      ),
    ).toHaveLength(0);

    const allReady = TransactionEngine.setProductionStationStatus(
      kitchenReady,
      kitchenReady.orders[0]!.id,
      "BAR",
      "READY",
      "Bartender",
    );
    await f.runtime.captureTransactionDomainEvents(kitchenReady, allReady);
    expect(
      (await f.repository.listOutbox(DEMO_TENANT_ID)).filter(
        (record) => record.eventType === "ORDER_READY",
      ),
    ).toHaveLength(1);
  });

  it("L-N. applies provider modifications and cancellations to production", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    await f.runtime.handleWebhook(
      webhook(
        order({
          items: [
            {
              externalItemId,
              name: "Mapped dish",
              quantity: 3,
              unitPrice: 500,
              total: 1500,
              modifiers: [],
            },
          ],
          pricing: { subtotal: 1500, discounts: 0, taxes: 0, total: 1500 },
          payment: { externallyPaid: true, amountPaid: 1500 },
          providerStatus: "UPDATED",
        }),
        "event-update",
        "ORDER_UPDATED",
      ),
    );
    expect(f.transactions.state.productionAmendments).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "ADDITION" })]),
    );
    expect(f.transactions.state.marketplaceReceivables[0]?.grossAmount).toBe(1500);

    await f.runtime.handleWebhook(webhook(order(), "event-cancel", "ORDER_CANCELLED"));
    expect(f.transactions.state.orders[0]?.status).toBe("CANCELLED");
    expect(f.transactions.state.productionAmendments).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "CANCEL_ITEM" })]),
    );
    expect(f.transactions.state.marketplaceReceivables[0]?.status).toBe("CANCELLED");
  });

  it("Z. replay and delayed create events cannot duplicate or resurrect an order", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.handleWebhook(webhook());
    await f.runtime.handleWebhook(webhook(order(), "different-create-event"));
    expect(f.transactions.state.orders).toHaveLength(1);

    resetIntegrationMemoryForTests();
    const cancelled = fixture();
    await cancelled.ready;
    await cancelled.runtime.handleWebhook(
      webhook(order(), "cancel-before-create", "ORDER_CANCELLED"),
    );
    await cancelled.runtime.handleWebhook(webhook(order(), "late-create"));
    expect(cancelled.transactions.state.orders).toHaveLength(0);
  });

  it("O-Q. coalesces sold-out/restock availability within the correct tenant", async () => {
    const f = fixture();
    await f.ready;
    await f.runtime.queueAvailabilitySync({
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      internalItemId,
      available: false,
      quantityAvailable: 0,
    });
    await f.runtime.queueAvailabilitySync({
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      internalItemId,
      available: true,
      quantityAvailable: 12,
    });
    const records = (await f.repository.listOutbox(DEMO_TENANT_ID)).filter(
      (record) => record.eventType === "ITEM_AVAILABILITY",
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.payload).toMatchObject({ available: true, quantityAvailable: 12 });
    expect(await f.repository.listOutbox("tenant-b")).toHaveLength(0);
  });

  it("W-X. releases scheduled orders and capability-gates store status", async () => {
    const controls: TestDeliveryControls = { storeStatuses: [] };
    const f = fixture(controls);
    await f.ready;
    const scheduledFor = new Date(Date.now() + 60 * 60_000).toISOString();
    await f.runtime.handleWebhook(
      webhook(order({ providerOrderId: "scheduled-order", scheduledFor }), "scheduled-event"),
    );
    expect(f.transactions.state.orders[0]?.status).toBe("HELD");
    await f.runtime.releaseDueScheduledOrders(DEMO_TENANT_ID, new Date(Date.now() + 61 * 60_000));
    expect(f.transactions.state.orders[0]?.status).toBe("SENT_TO_KITCHEN");

    const queued = await f.runtime.queueStoreStatus(DEMO_TENANT_ID, connectionId, "PAUSED");
    await f.runtime.processOutboxRecord(DEMO_TENANT_ID, queued.record.id);
    expect(controls.storeStatuses).toEqual(["PAUSED"]);
  });

  it("recovers missed active orders through the same idempotent ingestion path", async () => {
    const recovered = order({ providerOrderId: "recovered-order" });
    const controls: TestDeliveryControls = {
      recoverableOrders: [
        { externalOrderId: recovered.providerOrderId, providerEventId: "recovery-event" },
      ],
      ordersById: { [recovered.providerOrderId]: recovered },
    };
    const f = fixture(controls);
    await f.ready;
    const first = await f.runtime.recoverActiveOrders(DEMO_TENANT_ID, connectionId);
    const second = await f.runtime.recoverActiveOrders(DEMO_TENANT_ID, connectionId);
    expect(first).toMatchObject({ found: 1, imported: 1, failed: 0 });
    expect(second).toMatchObject({ found: 1, duplicates: 1, failed: 0 });
    expect(f.transactions.state.orders).toHaveLength(1);
  });

  it("R. exports the configured channel price instead of a provider-name multiplier", async () => {
    const f = fixture();
    await f.ready;
    const connection = f.configuration
      .listConnections(DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID)
      .find((candidate) => candidate.id === connectionId)!;
    const product = products[0]!;
    f.configuration.upsertConnection(DEMO_TENANT_ID, {
      ...connection,
      configuration: {
        ...connection.configuration,
        priceList: {
          id: "price-list-marketplace",
          name: "Marketplace pricing",
          currency: "KES",
          active: true,
          items: [{ internalItemId: product.id, price: 1234, active: true }],
          metadata: {},
        },
      },
      updatedAt: new Date().toISOString(),
    });

    const { menu } = await f.runtime.previewMenuSync(DEMO_TENANT_ID, connectionId);
    expect(menu.items.find((item) => item.internalId === product.id)?.price).toBe(1234);
  });

  it("T-U. preserves mappings on success and marks them failed when menu delivery fails", async () => {
    const controls: TestDeliveryControls = { menuSyncs: [] };
    const f = fixture(controls);
    await f.ready;
    const product = products[0]!;
    const stamp = new Date().toISOString();
    await f.repository.upsertMapping({
      id: "mapping-menu-item",
      tenantId: DEMO_TENANT_ID,
      branchId: DEMO_WESTLANDS_BRANCH_ID,
      connectionId,
      providerId: testDeliveryDefinition.id,
      resourceType: "ITEM",
      internalId: product.id,
      externalId: "provider-product-001",
      status: "MAPPED",
      syncStatus: "NOT_SYNCED",
      metadata: {},
      createdAt: stamp,
      updatedAt: stamp,
    });

    const firstPreview = await f.runtime.previewMenuSync(DEMO_TENANT_ID, connectionId);
    await f.runtime.queueMenuSync(DEMO_TENANT_ID, connectionId, {
      confirmedMenuHash: firstPreview.preview.menuHash,
      allowDestructive: true,
    });
    await f.runtime.processDueOutbox(DEMO_TENANT_ID);
    const successful = (await f.repository.listMappings(DEMO_TENANT_ID, connectionId)).find(
      (mapping) => mapping.id === "mapping-menu-item",
    );
    expect(controls.menuSyncs).toHaveLength(1);
    expect(successful).toMatchObject({
      externalId: "provider-product-001",
      syncStatus: "SYNCED",
    });
    expect(successful?.lastSyncedHash).toBeTruthy();

    controls.failuresRemaining = 1;
    controls.failureCode = "AUTHENTICATION";
    const connection = f.configuration
      .listConnections(DEMO_TENANT_ID, DEMO_WESTLANDS_BRANCH_ID)
      .find((candidate) => candidate.id === connectionId)!;
    f.configuration.upsertConnection(DEMO_TENANT_ID, {
      ...connection,
      configuration: {
        ...connection.configuration,
        priceList: {
          id: "price-list-changed",
          name: "Changed pricing",
          currency: "KES",
          active: true,
          items: [{ internalItemId: product.id, price: product.price + 1, active: true }],
          metadata: {},
        },
      },
      updatedAt: new Date().toISOString(),
    });
    const failedPreview = await f.runtime.previewMenuSync(DEMO_TENANT_ID, connectionId);
    await f.runtime.queueMenuSync(DEMO_TENANT_ID, connectionId, {
      confirmedMenuHash: failedPreview.preview.menuHash,
      allowDestructive: true,
    });
    await f.runtime.processDueOutbox(DEMO_TENANT_ID);
    const failed = (await f.repository.listMappings(DEMO_TENANT_ID, connectionId)).find(
      (mapping) => mapping.id === "mapping-menu-item",
    );
    expect(failed).toMatchObject({
      externalId: "provider-product-001",
      syncStatus: "FAILED",
    });
    expect(failed?.lastError).toContain("AUTHENTICATION");
  });
});
