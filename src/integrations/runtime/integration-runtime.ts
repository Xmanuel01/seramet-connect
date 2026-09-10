import type { ProviderRegistry } from "@/integrations/provider-registry";
import type { CredentialResolver } from "@/integrations/runtime/credential-resolver";
import { IntegrationEventStore } from "@/integrations/runtime/event-store";
import {
  CircuitOpenError,
  IntegrationError,
  IntegrationValidationError,
  MappingError,
  UnsupportedCapabilityError,
  WebhookVerificationError,
  normalizeIntegrationError,
} from "@/integrations/runtime/integration-errors";
import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";
import { IdempotencyService, stableHash } from "@/integrations/runtime/idempotency-service";
import { ExternalMappingService } from "@/integrations/runtime/mapping-service";
import type {
  IntegrationDeadLetter,
  IntegrationEvent,
  IntegrationReplay,
  OrderAcceptancePolicy,
  UnmappedItemPolicy,
} from "@/integrations/runtime/models";
import type { IntegrationOutboxService } from "@/integrations/runtime/outbox-service";
import { redactSensitive, type IntegrationLogger } from "@/integrations/runtime/redaction";
import type {
  NormalizedExternalOrder,
  ParsedProviderEvent,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderOperationResult,
} from "@/integrations/types";
import {
  buildMarketplaceMenu,
  itemSyncHash,
  previewMarketplaceMenuSync,
  snapshot as marketplaceItemSnapshot,
} from "@/integrations/marketplace/marketplace-service";
import {
  parseMarketplaceConnectionConfig,
  type MarketplaceStoreStatus,
} from "@/integrations/marketplace/types";
import type { ConfigurationRepository } from "@/platform/repositories/configuration-repository";
import type { IntegrationConnection, ProviderCapability } from "@/platform/types";
import type { TransactionRepository } from "@/lib/seramet-repository";
import { TransactionEngine, type TransactionLine } from "@/lib/transaction-engine";
import type { TransactionState } from "@/lib/transaction-engine";
import { allPermissionCodes } from "@/platform/permissions";
import type { IntegrationHealthService } from "@/integrations/runtime/health-service";
import type { MenuCatalogReader } from "@/integrations/marketplace/menu-catalog-reader";
import { invoiceBalanceMinor, PaymentOrchestrator } from "@/payments/payment-orchestrator";
import { parseMajorAmount } from "@/payments/money";

export type WebhookEnvelope = {
  tenantId: string;
  providerCode: string;
  connectionId: string;
  rawBody: Uint8Array;
  headers: Record<string, string>;
};

export type IntegrationRuntimeDependencies = {
  configuration: ConfigurationRepository;
  registry: ProviderRegistry;
  credentials: CredentialResolver;
  repository: IntegrationRepository;
  transactions: TransactionRepository;
  outbox: IntegrationOutboxService;
  health: IntegrationHealthService;
  logger: IntegrationLogger;
  catalog: MenuCatalogReader;
};

export class IntegrationRuntime {
  private events: IntegrationEventStore;
  private idempotency: IdempotencyService;
  private mappings: ExternalMappingService;

  constructor(private dependencies: IntegrationRuntimeDependencies) {
    this.events = new IntegrationEventStore(dependencies.repository);
    this.idempotency = new IdempotencyService(dependencies.repository);
    this.mappings = new ExternalMappingService(dependencies.repository);
  }

  async initiatePayment(input: {
    tenantId: string;
    branchId: string;
    invoiceId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    actor: string;
    idempotencyKey: string;
    operation: "PAYMENT_PROMPT" | "QR_PAYMENT";
    customerPhone?: string;
    customer?: Record<string, string>;
    deviceId?: string;
  }) {
    const method = this.dependencies.configuration
      .listPaymentMethods(input.tenantId, true)
      .find(
        (candidate) =>
          candidate.id === input.paymentMethodId || candidate.code === input.paymentMethodId,
      );
    if (!method?.providerConnectionId) {
      throw new IntegrationValidationError("Configured provider payment method is required");
    }
    const connection = this.requireTenantConnection(input.tenantId, method.providerConnectionId);
    if (connection.branchId && connection.branchId !== input.branchId) {
      throw new IntegrationValidationError("Provider connection is not assigned to this branch");
    }
    const adapter = this.dependencies.registry.resolve(connection, input.operation);
    const operation =
      input.operation === "PAYMENT_PROMPT" ? adapter.createPaymentPrompt : adapter.createPaymentQr;
    if (!operation) {
      throw new UnsupportedCapabilityError(
        `${adapter.definition.displayName} does not implement ${input.operation}`,
      );
    }
    const credentials = await this.resolveCredentials(connection);
    const context: ProviderExecutionContext = {
      connection,
      credentials,
      correlationId: crypto.randomUUID(),
    };
    const orchestrator = new PaymentOrchestrator(this.dependencies.configuration);
    const current = await this.dependencies.transactions.loadState(input.tenantId);
    const invoice = current.bills.find(
      (candidate) =>
        candidate.id === input.invoiceId &&
        candidate.tenantId === input.tenantId &&
        candidate.branchId === input.branchId,
    );
    if (!invoice) throw new MappingError("Tenant-scoped invoice was not found");
    const created = orchestrator.createIntent(current, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      ...(invoice.orderIds[0] ? { orderId: invoice.orderIds[0] } : {}),
      invoiceIds: [invoice.id],
      paymentMethodId: method.id,
      amountRequestedMinor: input.amountMinor,
      currency: input.currency,
      createdBy: input.actor,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      idempotencyKey: input.idempotencyKey,
      metadata: { operation: input.operation },
    });
    await this.dependencies.transactions.saveState(
      created.state,
      systemActor(input.tenantId, input.branchId, invoice.branch),
      `Created ${method.displayName} payment intent`,
    );
    if (created.replayed && created.intent.providerReference) {
      return { intent: created.intent, replayed: true };
    }
    const result = await operation(
      {
        intent: created.intent,
        customerPhone: input.customerPhone,
        customer: input.customer,
      },
      connection,
      context,
    );
    const next = result.ok
      ? orchestrator.markIntentInitiated(created.state, {
          tenantId: input.tenantId,
          intentId: created.intent.id,
          providerReference: result.providerReference ?? created.intent.id,
          status: input.operation === "PAYMENT_PROMPT" ? "AWAITING_CUSTOMER" : "PROCESSING",
          actor: input.actor,
        })
      : orchestrator.failIntent(created.state, {
          tenantId: input.tenantId,
          intentId: created.intent.id,
          actor: input.actor,
          reason: result.message,
        });
    await this.dependencies.transactions.saveState(
      next,
      systemActor(input.tenantId, input.branchId, invoice.branch),
      result.ok
        ? `Initiated ${method.displayName} payment`
        : `Failed ${method.displayName} payment`,
    );
    return {
      intent: next.paymentOperations?.intents.find((item) => item.id === created.intent.id),
      provider: result,
      replayed: false,
    };
  }

  async initiateUnallocatedPayment(input: {
    tenantId: string;
    branchId: string;
    paymentMethodId: string;
    amountMinor: number;
    currency: string;
    actor: string;
    idempotencyKey: string;
    merchantReference: string;
    collectionCreditAccountId: string;
    collectionPurpose: string;
    operation: "PAYMENT_PROMPT" | "QR_PAYMENT";
    customerPhone?: string;
    customer?: Record<string, string>;
    expiresAt?: string;
  }) {
    const method = this.dependencies.configuration
      .listPaymentMethods(input.tenantId, true)
      .find(
        (candidate) =>
          candidate.id === input.paymentMethodId || candidate.code === input.paymentMethodId,
      );
    if (!method?.providerConnectionId) {
      throw new IntegrationValidationError("Configured provider payment method is required");
    }
    const connection = this.requireTenantConnection(input.tenantId, method.providerConnectionId);
    if (connection.branchId && connection.branchId !== input.branchId) {
      throw new IntegrationValidationError("Provider connection is not assigned to this branch");
    }
    const adapter = this.dependencies.registry.resolve(connection, input.operation);
    const operation =
      input.operation === "PAYMENT_PROMPT" ? adapter.createPaymentPrompt : adapter.createPaymentQr;
    if (!operation) {
      throw new UnsupportedCapabilityError(
        `${adapter.definition.displayName} does not implement ${input.operation}`,
      );
    }
    const credentials = await this.resolveCredentials(connection);
    const context: ProviderExecutionContext = {
      connection,
      credentials,
      correlationId: crypto.randomUUID(),
    };
    const orchestrator = new PaymentOrchestrator(this.dependencies.configuration);
    const current = await this.dependencies.transactions.loadState(input.tenantId);
    const branch = this.dependencies.configuration.getBranch(input.tenantId, input.branchId);
    const created = orchestrator.createIntent(current, {
      tenantId: input.tenantId,
      branchId: input.branchId,
      invoiceIds: [],
      paymentMethodId: method.id,
      amountRequestedMinor: input.amountMinor,
      currency: input.currency,
      createdBy: input.actor,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      idempotencyKey: input.idempotencyKey,
      metadata: {
        operation: input.operation,
        merchantReference: input.merchantReference,
        collectionCreditAccountId: input.collectionCreditAccountId,
        collectionPurpose: input.collectionPurpose,
      },
    });
    await this.dependencies.transactions.saveState(
      created.state,
      systemActor(input.tenantId, input.branchId, branch.name),
      `Created ${input.collectionPurpose.toLowerCase()} payment intent`,
    );
    if (created.replayed && created.intent.providerReference) {
      return { intent: created.intent, replayed: true };
    }
    const result = await operation(
      {
        intent: created.intent,
        customerPhone: input.customerPhone,
        customer: input.customer,
      },
      connection,
      context,
    );
    const next = result.ok
      ? orchestrator.markIntentInitiated(created.state, {
          tenantId: input.tenantId,
          intentId: created.intent.id,
          providerReference: result.providerReference ?? created.intent.id,
          status: input.operation === "PAYMENT_PROMPT" ? "AWAITING_CUSTOMER" : "PROCESSING",
          actor: input.actor,
        })
      : orchestrator.failIntent(created.state, {
          tenantId: input.tenantId,
          intentId: created.intent.id,
          actor: input.actor,
          reason: result.message,
        });
    await this.dependencies.transactions.saveState(
      next,
      systemActor(input.tenantId, input.branchId, branch.name),
      result.ok
        ? `Initiated ${input.collectionPurpose.toLowerCase()} payment`
        : `Failed ${input.collectionPurpose.toLowerCase()} payment`,
    );
    return {
      intent: next.paymentOperations?.intents.find((item) => item.id === created.intent.id),
      provider: result,
      replayed: false,
    };
  }

  async handleWebhook(envelope: WebhookEnvelope) {
    const { connection, adapter } = this.resolveConnection(envelope);
    const bodyLimit = adapter.definition.adapterMetadata?.webhookBodyLimitBytes ?? 1_048_576;
    if (envelope.rawBody.byteLength > bodyLimit)
      throw new IntegrationValidationError("Webhook body exceeds the configured limit");
    if (!adapter.verifyWebhook || !adapter.parseWebhook)
      throw new UnsupportedCapabilityError("Provider has no verified webhook adapter");
    const credentials = await this.resolveCredentials(connection);
    const request = {
      rawBody: envelope.rawBody,
      headers: lowerCaseHeaders(envelope.headers),
      connection,
      credentials,
    };
    if (!(await adapter.verifyWebhook(request))) throw new WebhookVerificationError();
    const parsedResult = await adapter.parseWebhook(request);
    if (!parsedResult.ok) throw resultToError(parsedResult);
    const parsed = parsedResult.value;
    const payloadHash = await stableHash(envelope.rawBody);
    const idempotencyKey =
      parsed.providerEventId ?? `${parsed.eventType}:${parsed.externalResourceId ?? payloadHash}`;
    const eventId = crypto.randomUUID();
    const claimed = await this.idempotency.claim(
      envelope.tenantId,
      connection.id,
      idempotencyKey,
      eventId,
    );
    if (!claimed.claimed) {
      return {
        accepted: true,
        duplicate: true,
        eventId: claimed.record.eventId,
        result: claimed.record.result,
      };
    }

    const now = new Date().toISOString();
    const event: IntegrationEvent = {
      id: eventId,
      tenantId: envelope.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      direction: "INBOUND",
      eventType: parsed.eventType,
      ...(parsed.providerEventId ? { providerEventId: parsed.providerEventId } : {}),
      ...(parsed.externalResourceId ? { externalResourceId: parsed.externalResourceId } : {}),
      correlationId: envelope.headers["x-correlation-id"] ?? crypto.randomUUID(),
      idempotencyKey,
      payload: redactSensitive(parsed.payload),
      payloadHash,
      receivedAt: now,
      status: "RECEIVED",
      attemptCount: 0,
      createdAt: now,
    };
    await this.events.append(event);
    try {
      const result = await this.processEvent(event, parsed, connection, adapter, credentials);
      await this.idempotency.complete(envelope.tenantId, connection.id, idempotencyKey, result);
      await this.dependencies.health.recordSuccess(connection, true);
      return { accepted: true, duplicate: false, eventId, result };
    } catch (error) {
      const normalized = normalizeIntegrationError(error);
      const status =
        normalized instanceof MappingError
          ? "MAPPING_REQUIRED"
          : normalized.retryable
            ? "RETRY_PENDING"
            : "FAILED";
      await this.events.updateStatus(event.tenantId, event.id, {
        status,
        lastError: normalized.message,
        attemptCount: 1,
      });
      await this.dependencies.health.recordFailure(
        connection,
        normalized.message,
        normalized.retryAfterMs
          ? new Date(Date.now() + normalized.retryAfterMs).toISOString()
          : undefined,
      );
      if (!normalized.retryable) await this.deadLetterEvent(event, normalized.message, 1);
      throw normalized;
    }
  }

  async enqueueOutbound(input: {
    tenantId: string;
    branchId?: string;
    connectionId: string;
    eventType: string;
    resourceType: string;
    resourceId: string;
    payload: unknown;
    idempotencyKey: string;
    coalescingKey?: string;
  }) {
    const connection = this.requireTenantConnection(input.tenantId, input.connectionId);
    const record = {
      ...input,
      providerId: connection.providerId,
      correlationId: crypto.randomUUID(),
      payload: redactSensitive(input.payload),
      maxAttempts: Number(connection.configuration["maxRetryAttempts"] ?? 4),
    };
    return input.coalescingKey
      ? this.dependencies.outbox.enqueueCoalesced({ ...record, coalescingKey: input.coalescingKey })
      : this.dependencies.outbox.enqueue(record);
  }

  async recoverActiveOrders(tenantId: string, connectionId: string) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const adapter = this.dependencies.registry.resolve(connection, "RECOVER_ACTIVE_ORDERS");
    if (!adapter.recoverActiveOrders)
      throw new UnsupportedCapabilityError("Provider does not implement active-order recovery");
    const marketplace = await this.marketplaceContext(tenantId, connection);
    const credentials = await this.resolveCredentials(connection);
    const context: ProviderExecutionContext = {
      connection: {
        ...connection,
        configuration: {
          ...connection.configuration,
          externalStoreId: marketplace.externalStoreId,
        },
      },
      credentials,
      correlationId: crypto.randomUUID(),
    };
    const recovered = await adapter.recoverActiveOrders(marketplace.externalStoreId, context);
    if (!recovered.ok) throw resultToError(recovered);
    const results: Array<{
      externalOrderId: string;
      orderId?: string;
      duplicate: boolean;
      error?: string;
    }> = [];
    for (const candidate of recovered.value) {
      try {
        const result = await this.ingestRecoveredOrder(
          tenantId,
          connection,
          adapter,
          credentials,
          candidate,
        );
        results.push({ externalOrderId: candidate.externalOrderId, ...result });
      } catch (error) {
        const normalized = normalizeIntegrationError(error);
        results.push({
          externalOrderId: candidate.externalOrderId,
          duplicate: false,
          error: normalized.message,
        });
      }
    }
    return {
      found: recovered.value.length,
      imported: results.filter((result) => result.orderId && !result.duplicate).length,
      duplicates: results.filter((result) => result.duplicate).length,
      failed: results.filter((result) => result.error).length,
      results,
    };
  }

  async previewMenuSync(tenantId: string, connectionId: string) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const adapter = this.dependencies.registry.resolve(connection, "SYNC_MENU");
    if (!adapter.syncMenu)
      throw new UnsupportedCapabilityError("Provider does not implement menu synchronization");
    const context = await this.marketplaceContext(tenantId, connection);
    const menu = await buildMarketplaceMenu(context);
    const preview = await previewMarketplaceMenuSync(connection, menu, context.mappings);
    return { menu, preview };
  }

  async queueMenuSync(
    tenantId: string,
    connectionId: string,
    input: { confirmedMenuHash: string; allowDestructive?: boolean },
  ) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const config = parseMarketplaceConnectionConfig(connection.configuration);
    if (config.menuSyncMode === "PROVIDER_TO_SERAMET")
      throw new IntegrationValidationError("This connection is configured provider-to-Seramet");
    if (config.menuSyncMode === "BIDIRECTIONAL")
      throw new IntegrationValidationError(
        "Bidirectional synchronization is not enabled without provider conflict guarantees",
      );
    const { menu, preview } = await this.previewMenuSync(tenantId, connectionId);
    if (preview.menuHash !== input.confirmedMenuHash)
      throw new IntegrationValidationError("Menu changed after preview; preview it again");
    if (preview.counts.conflicts)
      throw new IntegrationValidationError("Resolve menu conflicts before synchronizing");
    if (preview.destructive && !input.allowDestructive)
      throw new IntegrationValidationError("Removed items require explicit confirmation");
    const branchId = connection.branchId;
    if (!branchId) throw new MappingError("Connection has no branch assignment");
    const queued = await this.enqueueOutbound({
      tenantId,
      branchId,
      connectionId,
      eventType: "MENU_SYNC",
      resourceType: "MENU",
      resourceId: menu.storeId,
      payload: { menu, preview },
      idempotencyKey: `menu:${connectionId}:${preview.menuHash}`,
      coalescingKey: `menu:${connectionId}`,
    });
    const stamp = new Date().toISOString();
    const currentMappings = await this.dependencies.repository.listMappings(tenantId, connectionId);
    for (const item of menu.items) {
      const existing = contextMapping(preview, item.internalId);
      const current = currentMappings.find(
        (mapping) => mapping.resourceType === "ITEM" && mapping.internalId === item.internalId,
      );
      const internalHash = await itemSyncHash(item);
      if (!current) {
        await this.dependencies.repository.upsertMapping({
          id: crypto.randomUUID(),
          tenantId,
          ...(connection.branchId ? { branchId: connection.branchId } : {}),
          connectionId,
          providerId: connection.providerId,
          resourceType: "ITEM",
          internalId: item.internalId,
          externalId: item.externalId ?? item.sku ?? item.internalId,
          status: "AUTO_MATCHED",
          syncStatus: "PENDING",
          lastInternalHash: internalHash,
          metadata: {
            displayName: item.name,
            pendingSnapshot: marketplaceItemSnapshot(item),
          },
          createdAt: stamp,
          updatedAt: stamp,
        });
        continue;
      }
      await this.dependencies.repository.upsertMapping({
        ...current,
        syncStatus: existing?.operation === "CONFLICT" ? "CONFLICT" : "PENDING",
        lastInternalHash: internalHash,
        metadata: { ...current.metadata, pendingSnapshot: marketplaceItemSnapshot(item) },
        updatedAt: stamp,
      });
    }
    for (const category of menu.categories) {
      if (
        currentMappings.some(
          (mapping) =>
            mapping.resourceType === "CATEGORY" && mapping.internalId === category.internalId,
        )
      )
        continue;
      await this.dependencies.repository.upsertMapping({
        id: crypto.randomUUID(),
        tenantId,
        ...(connection.branchId ? { branchId: connection.branchId } : {}),
        connectionId,
        providerId: connection.providerId,
        resourceType: "CATEGORY",
        internalId: category.internalId,
        externalId: category.externalId ?? category.internalId,
        status: "AUTO_MATCHED",
        syncStatus: "PENDING",
        metadata: { displayName: category.name },
        createdAt: stamp,
        updatedAt: stamp,
      });
    }
    return { queued, preview };
  }

  async queueAvailabilitySync(input: {
    tenantId: string;
    branchId: string;
    internalItemId: string;
    available: boolean;
    quantityAvailable?: number;
  }) {
    const connections = this.marketplaceConnections(input.tenantId, input.branchId).filter(
      (connection) => {
        const config = parseMarketplaceConnectionConfig(connection.configuration);
        return (
          config.availabilitySyncEnabled &&
          config.auto86Enabled &&
          this.dependencies.registry
            .resolve(connection)
            .definition.capabilities.includes("SYNC_AVAILABILITY")
        );
      },
    );
    const results = [];
    for (const connection of connections) {
      const mapping = (
        await this.dependencies.repository.listMappings(input.tenantId, connection.id)
      ).find(
        (candidate) =>
          candidate.resourceType === "ITEM" &&
          candidate.internalId === input.internalItemId &&
          candidate.status !== "DISABLED",
      );
      if (!mapping) continue;
      results.push(
        await this.enqueueOutbound({
          tenantId: input.tenantId,
          branchId: input.branchId,
          connectionId: connection.id,
          eventType: "ITEM_AVAILABILITY",
          resourceType: "ITEM",
          resourceId: mapping.externalId,
          payload: {
            externalItemId: mapping.externalId,
            internalItemId: input.internalItemId,
            available: input.available,
            ...(input.quantityAvailable === undefined
              ? {}
              : { quantityAvailable: input.quantityAvailable }),
          },
          idempotencyKey: `availability:${connection.id}:${input.internalItemId}:${input.available}:${input.quantityAvailable ?? "unknown"}`,
          coalescingKey: `availability:${connection.id}:${input.internalItemId}`,
        }),
      );
    }
    return results;
  }

  async queuePriceSync(input: {
    tenantId: string;
    connectionId: string;
    internalItemId: string;
    price: number;
    currency: string;
  }) {
    const connection = this.requireTenantConnection(input.tenantId, input.connectionId);
    const config = parseMarketplaceConnectionConfig(connection.configuration);
    if (!config.priceSyncEnabled)
      throw new IntegrationValidationError("Price synchronization is disabled");
    this.dependencies.registry.resolve(connection, "SYNC_PRICES");
    const externalItemId = await this.mappings.resolveExternalItem(
      input.tenantId,
      input.connectionId,
      input.internalItemId,
    );
    if (!externalItemId) throw new MappingError("Item is not mapped for this provider");
    return this.enqueueOutbound({
      tenantId: input.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: input.connectionId,
      eventType: "ITEM_PRICE",
      resourceType: "ITEM",
      resourceId: externalItemId,
      payload: {
        externalItemId,
        internalItemId: input.internalItemId,
        price: input.price,
        currency: input.currency,
      },
      idempotencyKey: `price:${input.connectionId}:${input.internalItemId}:${input.price}`,
      coalescingKey: `price:${input.connectionId}:${input.internalItemId}`,
    });
  }

  async queueStoreStatus(tenantId: string, connectionId: string, status: MarketplaceStoreStatus) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const config = parseMarketplaceConnectionConfig(connection.configuration);
    if (!config.storeStatusSyncEnabled)
      throw new IntegrationValidationError("Store status synchronization is disabled");
    this.dependencies.registry.resolve(connection, "UPDATE_STORE_STATUS");
    const context = await this.marketplaceContext(tenantId, connection);
    return this.enqueueOutbound({
      tenantId,
      branchId: context.branch.id,
      connectionId,
      eventType: "STORE_STATUS",
      resourceType: "STORE",
      resourceId: context.externalStoreId,
      payload: { status },
      idempotencyKey: `store:${connectionId}:${status}:${Date.now()}`,
      coalescingKey: `store:${connectionId}`,
    });
  }

  async processOutboxRecord(tenantId: string, recordId: string) {
    const record = await this.dependencies.repository.getOutbox(tenantId, recordId);
    if (!record) throw new IntegrationValidationError("Outbox record was not found");
    const connection = this.requireTenantConnection(tenantId, record.connectionId);
    const adapter = this.dependencies.registry.resolve(connection);
    const credentials = await this.resolveCredentials(connection);
    const storeMapping = (
      await this.dependencies.repository.listMappings(tenantId, connection.id)
    ).find(
      (mapping) =>
        mapping.resourceType === "STORE" &&
        mapping.status === "MAPPED" &&
        (!record.branchId || mapping.branchId === record.branchId),
    );
    const executionConnection = storeMapping
      ? {
          ...connection,
          configuration: {
            ...connection.configuration,
            externalStoreId: storeMapping.externalId,
          },
        }
      : connection;
    const context: ProviderExecutionContext = {
      connection: executionConnection,
      credentials,
      correlationId: record.correlationId,
    };
    const processed = await this.dependencies.outbox.process(record, async () => {
      const circuitOpenFor = await this.dependencies.health.assertCircuitClosed(
        tenantId,
        connection.id,
      );
      if (circuitOpenFor) throw new CircuitOpenError(circuitOpenFor);
      const result = await this.dispatchOutbound(
        adapter,
        context,
        record.eventType,
        record.resourceId,
        record.payload,
      );
      await this.recordOutboundSuccess(record);
      return result;
    });
    if (
      processed?.status === "DEAD_LETTER" &&
      ["MENU_SYNC", "ITEM_AVAILABILITY", "ITEM_PRICE"].includes(record.eventType)
    ) {
      await this.recordOutboundFailure(
        record,
        processed.lastError ?? "Provider synchronization failed",
      );
    }
    return processed;
  }

  async processDueOutbox(tenantId: string, limit = 100) {
    const now = Date.now();
    const due = (await this.dependencies.repository.listOutbox(tenantId))
      .filter(
        (record) =>
          ["PENDING", "RETRY_PENDING"].includes(record.status) &&
          (!record.nextAttemptAt || new Date(record.nextAttemptAt).getTime() <= now),
      )
      .slice(0, Math.max(1, Math.min(500, limit)));
    const results = [];
    for (const record of due) {
      results.push(await this.processOutboxRecord(tenantId, record.id));
    }
    return { processed: results.length, records: results };
  }

  async replayEvent(tenantId: string, eventId: string, actorId: string) {
    const original = await this.events.get(tenantId, eventId);
    if (!original) throw new IntegrationValidationError("Integration event was not found");
    const connection = this.requireTenantConnection(tenantId, original.connectionId);
    const adapter = this.dependencies.registry.resolve(connection);
    const replayId = crypto.randomUUID();
    const now = new Date().toISOString();
    const replayEvent: IntegrationEvent = {
      ...original,
      id: replayId,
      correlationId: crypto.randomUUID(),
      status: "QUEUED",
      attemptCount: 0,
      receivedAt: now,
      createdAt: now,
      processedAt: undefined,
      lastError: undefined,
      responseMetadata: { replayOf: original.id, actorId },
    };
    await this.events.append(replayEvent);
    let resultStatus: IntegrationEvent["status"] = "IGNORED";
    const existingMapping = original.externalResourceId
      ? await this.mappings.resolveExternal(
          tenantId,
          connection.id,
          original.eventType.startsWith("ORDER") ? "ORDER" : "PAYMENT",
          original.externalResourceId,
        )
      : null;
    if (!existingMapping) {
      const parsed: ParsedProviderEvent = {
        eventType: original.eventType as ParsedProviderEvent["eventType"],
        ...(original.providerEventId ? { providerEventId: original.providerEventId } : {}),
        ...(original.externalResourceId ? { externalResourceId: original.externalResourceId } : {}),
        payload: original.payload,
      };
      try {
        await this.processEvent(
          replayEvent,
          parsed,
          connection,
          adapter,
          await this.resolveCredentials(connection),
        );
        resultStatus = "PROCESSED";
      } catch (error) {
        resultStatus = normalizeIntegrationError(error).retryable ? "RETRY_PENDING" : "FAILED";
        await this.events.updateStatus(tenantId, replayId, {
          status: resultStatus,
          lastError: normalizeIntegrationError(error).message,
        });
      }
    } else {
      await this.events.updateStatus(tenantId, replayId, {
        status: "IGNORED",
        processedAt: now,
        responseMetadata: { replayOf: original.id, reason: "Resource was already processed" },
      });
    }
    const replay: IntegrationReplay = {
      id: crypto.randomUUID(),
      tenantId,
      originalEventId: original.id,
      replayEventId: replayId,
      actorId,
      createdAt: now,
      resultStatus,
    };
    await this.events.recordReplay(replay);
    return replay;
  }

  async diagnostics(tenantId: string) {
    const [events, mappings, outbox, deadLetters, health] = await Promise.all([
      this.dependencies.repository.listEvents(tenantId),
      this.dependencies.repository.listMappings(tenantId),
      this.dependencies.repository.listOutbox(tenantId),
      this.dependencies.repository.listDeadLetters(tenantId),
      this.dependencies.repository.listHealth(tenantId),
    ]);
    return { events, mappings, outbox, deadLetters, health };
  }

  async testConnection(tenantId: string, connectionId: string) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const providerHealth = await this.dependencies.health.calculate(
      connection,
      this.dependencies.registry.resolve(connection),
    );
    const validation = await this.validateConnection(tenantId, connectionId);
    const health = validation.valid
      ? providerHealth
      : {
          ...providerHealth,
          status: "CONFIG_REQUIRED" as const,
          message: validation.issues.join("; "),
          mappingIssueCount: Math.max(providerHealth.mappingIssueCount, validation.issues.length),
          metadata: { ...providerHealth.metadata, validationIssues: validation.issues },
        };
    if (!validation.valid) await this.dependencies.repository.upsertHealth(health);
    const nextStatus =
      health.status === "HEALTHY"
        ? connection.environment === "SANDBOX"
          ? ("SANDBOX" as const)
          : ("ACTIVE" as const)
        : health.status === "AUTH_ERROR"
          ? ("AUTH_ERROR" as const)
          : health.status === "CONFIG_REQUIRED"
            ? health.credentialValid
              ? ("CONFIGURED" as const)
              : ("CREDENTIALS_REQUIRED" as const)
            : health.status === "OFFLINE"
              ? ("ERROR" as const)
              : ("DEGRADED" as const);
    this.dependencies.configuration.upsertConnection(tenantId, {
      ...connection,
      status: nextStatus,
      statusMessage: health.message,
      consecutiveFailures: health.consecutiveFailures,
      lastHealthCheckAt: health.checkedAt,
      ...(health.lastSuccessfulRequestAt
        ? { lastSuccessfulRequestAt: health.lastSuccessfulRequestAt }
        : {}),
      ...(health.lastFailedRequestAt ? { lastFailedRequestAt: health.lastFailedRequestAt } : {}),
      updatedAt: new Date().toISOString(),
    });
    return health;
  }

  async validateConnection(tenantId: string, connectionId: string) {
    const connection = this.requireTenantConnection(tenantId, connectionId);
    const adapter = this.dependencies.registry.resolve(connection);
    const issues: string[] = [];
    if (!connection.secretReference) issues.push("Secure credential reference is required");
    else if (!(await this.dependencies.credentials.hasSecret(connection.secretReference)))
      issues.push("Referenced server credentials were not found");
    if (!connection.branchId) issues.push("A branch must be assigned to the connection");
    else if (!this.dependencies.configuration.getBranch(tenantId, connection.branchId))
      issues.push("The assigned branch does not exist");
    if (adapter.definition.capabilities.includes("RECEIVE_ORDERS")) {
      const channelId = String(connection.configuration["channelId"] ?? "");
      const channel = this.dependencies.configuration
        .listOrderChannels(tenantId)
        .find(
          (item) =>
            item.enabled &&
            (item.id === channelId || item.deliveryProviderConnectionId === connection.id),
        );
      if (!channel) issues.push("An active order channel must be assigned");
      const mappings = await this.dependencies.repository.listMappings(tenantId, connection.id);
      const storeMapping = mappings.find(
        (mapping) =>
          mapping.resourceType === "STORE" &&
          mapping.status === "MAPPED" &&
          mapping.branchId === connection.branchId,
      );
      if (!storeMapping) issues.push("A mapped provider store is required for the assigned branch");
    }
    return { valid: issues.length === 0, issues };
  }

  async upsertMapping(
    tenantId: string,
    input: Omit<
      import("@/integrations/runtime/models").ExternalResourceMapping,
      "id" | "tenantId" | "providerId" | "createdAt" | "updatedAt"
    > & { id?: string },
  ) {
    const connection = this.requireTenantConnection(tenantId, input.connectionId);
    const now = new Date().toISOString();
    const mapping = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      tenantId,
      providerId: connection.providerId,
      createdAt: now,
      updatedAt: now,
    };
    await this.mappings.upsert(mapping);
    return mapping;
  }

  unmap(tenantId: string, mappingId: string) {
    return this.mappings.unmap(tenantId, mappingId);
  }

  resolveDeadLetter(
    tenantId: string,
    id: string,
    actorId: string,
    status: "RESOLVED" | "IGNORED",
    reason: string,
  ) {
    return this.dependencies.repository.updateDeadLetter(tenantId, id, {
      status,
      resolvedAt: new Date().toISOString(),
      resolvedBy: actorId,
      resolutionReason: reason,
    });
  }

  async captureTransactionDomainEvents(previous: TransactionState, next: TransactionState) {
    const tenantId = next.tenantId ?? previous.tenantId;
    if (!tenantId) return { readyQueued: 0, availabilityQueued: 0, cancellationsQueued: 0 };
    let readyQueued = 0;
    let availabilityQueued = 0;
    let cancellationsQueued = 0;
    for (const order of next.orders) {
      const before = previous.orders.find((candidate) => candidate.id === order.id);
      const source = order.externalSource;
      if (!source || !order.branchId) continue;
      if (order.status === "READY" && before?.status !== "READY") {
        const adapter = this.dependencies.registry.resolve(
          this.requireTenantConnection(tenantId, source.connectionId),
        );
        if (adapter.definition.capabilities.includes("MARK_ORDER_READY")) {
          const orderMapping = await this.mappings.resolveExternal(
            tenantId,
            source.connectionId,
            "ORDER",
            source.externalOrderId,
          );
          await this.enqueueOutbound({
            tenantId,
            branchId: order.branchId,
            connectionId: source.connectionId,
            eventType: "ORDER_READY",
            resourceType: "ORDER",
            resourceId: source.externalOrderId,
            payload: {
              readyAt: source.readyAt ?? order.updatedAt,
              items: Array.isArray(orderMapping?.metadata["externalItems"])
                ? orderMapping.metadata["externalItems"]
                : [],
            },
            idempotencyKey: `ready:${source.connectionId}:${source.externalOrderId}`,
          });
          readyQueued += 1;
        }
      }
      if (order.status === "CANCELLED" && before?.status !== "CANCELLED") {
        const connection = this.requireTenantConnection(tenantId, source.connectionId);
        const adapter = this.dependencies.registry.resolve(connection);
        if (adapter.definition.capabilities.includes("CANCEL_ORDER")) {
          await this.enqueueOutbound({
            tenantId,
            branchId: order.branchId,
            connectionId: source.connectionId,
            eventType: "ORDER_CANCELLED",
            resourceType: "ORDER",
            resourceId: source.externalOrderId,
            payload: { reason: order.cancellation?.reason ?? "Restaurant cancellation" },
            idempotencyKey: `cancel:${source.connectionId}:${source.externalOrderId}:${order.updatedAt}`,
          });
          cancellationsQueued += 1;
        }
      }
    }
    const recipeProductIds = [...new Set(next.recipes.map((recipe) => recipe.productId))];
    for (const branch of this.dependencies.configuration.listBranches(tenantId)) {
      for (const productId of recipeProductIds) {
        const before = TransactionEngine.getProductAvailability(previous, branch.name, productId);
        const after = TransactionEngine.getProductAvailability(next, branch.name, productId);
        if (before.available === after.available && before.portions === after.portions) continue;
        const queued = await this.queueAvailabilitySync({
          tenantId,
          branchId: branch.id,
          internalItemId: productId,
          available: after.available,
          ...(after.portions === undefined
            ? {}
            : { quantityAvailable: Math.max(0, Math.floor(after.portions)) }),
        });
        availabilityQueued += queued.length;
      }
    }
    return { readyQueued, availabilityQueued, cancellationsQueued };
  }

  async releaseDueScheduledOrders(tenantId: string, at = new Date()) {
    const state = await this.dependencies.transactions.loadState(tenantId);
    let next = state;
    const released: string[] = [];
    for (const order of state.orders) {
      if (
        order.status !== "HELD" ||
        !order.externalSource?.scheduledReleaseAt ||
        new Date(order.externalSource.scheduledReleaseAt).getTime() > at.getTime()
      )
        continue;
      next = TransactionEngine.releaseHeldOrder(next, order.id, "Scheduled Order Release");
      next = TransactionEngine.sendToKitchen(next, order.id, "Scheduled Order Release");
      released.push(order.id);
    }
    if (released.length) {
      const first = next.orders.find((order) => released.includes(order.id));
      await this.dependencies.transactions.saveState(
        next,
        systemActor(
          tenantId,
          first?.branchId ?? this.dependencies.configuration.listBranches(tenantId)[0]!.id,
          first?.branch ?? "Scheduled Orders",
        ),
        `Released ${released.length} scheduled marketplace order(s)`,
      );
    }
    return { released };
  }

  private marketplaceConnections(tenantId: string, branchId: string) {
    const registeredProviders = new Set(
      this.dependencies.registry.list().map((adapter) => adapter.definition.id),
    );
    return this.dependencies.configuration
      .listConnections(tenantId, branchId)
      .filter((connection) => {
        const provider = this.dependencies.configuration
          .listProviders()
          .find((candidate) => candidate.id === connection.providerId);
        return (
          provider?.category === "DELIVERY" &&
          registeredProviders.has(connection.providerId) &&
          connection.branchId === branchId &&
          !["DISABLED", "UNCONFIGURED", "CREDENTIALS_REQUIRED"].includes(connection.status)
        );
      });
  }

  private async marketplaceContext(tenantId: string, connection: IntegrationConnection) {
    if (!connection.branchId) throw new MappingError("Connection has no branch assignment");
    const mappings = await this.dependencies.repository.listMappings(tenantId, connection.id);
    const store = mappings.find(
      (mapping) =>
        mapping.resourceType === "STORE" &&
        mapping.branchId === connection.branchId &&
        mapping.status === "MAPPED",
    );
    if (!store) throw new MappingError("Connection has no mapped external store");
    return {
      tenant: this.dependencies.configuration.getTenant(tenantId),
      branch: this.dependencies.configuration.getBranch(tenantId, connection.branchId),
      connection,
      state: await this.dependencies.transactions.loadState(tenantId),
      mappings,
      externalStoreId: store.externalId,
      catalog: await this.dependencies.catalog(tenantId, connection.branchId),
    };
  }

  private resolveConnection(envelope: WebhookEnvelope) {
    const definition = this.dependencies.configuration
      .listProviders()
      .find((provider) => provider.code.toLowerCase() === envelope.providerCode.toLowerCase());
    if (!definition) throw new IntegrationValidationError("Unknown provider");
    const connection = this.requireTenantConnection(envelope.tenantId, envelope.connectionId);
    if (connection.providerId !== definition.id)
      throw new IntegrationValidationError("Provider and connection do not match");
    if (connection.status === "DISABLED")
      throw new IntegrationValidationError("Provider connection is disabled");
    if (connection.status === "CREDENTIALS_REQUIRED" || connection.status === "UNCONFIGURED")
      throw new IntegrationValidationError("Provider connection is not configured");
    return {
      connection,
      adapter: this.dependencies.registry.resolve(connection, "WEBHOOK_CONFIRMATION"),
    };
  }

  private requireTenantConnection(tenantId: string, connectionId: string) {
    const connection = this.dependencies.configuration
      .listConnections(tenantId)
      .find((item) => item.id === connectionId);
    if (!connection) throw new IntegrationValidationError("Unknown integration connection");
    return connection;
  }

  private async resolveCredentials(connection: IntegrationConnection) {
    if (!connection.secretReference)
      throw new IntegrationValidationError("Provider secret reference is required");
    return this.dependencies.credentials.getSecret(connection.secretReference);
  }

  private async processEvent(
    event: IntegrationEvent,
    parsed: ParsedProviderEvent,
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
  ) {
    await this.events.updateStatus(event.tenantId, event.id, {
      status: "PROCESSING",
      attemptCount: event.attemptCount + 1,
    });
    const startedAt = Date.now();
    let result: unknown = { ignored: true };
    if (parsed.eventType === "ORDER_CREATED") {
      result = await this.processIncomingOrder(event, parsed, connection, adapter, credentials);
    } else if (parsed.eventType === "ORDER_UPDATED") {
      result = await this.processIncomingOrderUpdate(
        event,
        parsed,
        connection,
        adapter,
        credentials,
      );
    } else if (parsed.eventType === "ORDER_CANCELLED") {
      result = await this.processIncomingOrderCancellation(event, parsed, connection);
    } else if (parsed.eventType === "PAYMENT_CONFIRMED" || parsed.eventType === "PAYMENT_FAILED") {
      result = await this.processPaymentEvent(event, parsed, connection, adapter, credentials);
    }
    await this.events.updateStatus(event.tenantId, event.id, {
      status: "PROCESSED",
      processedAt: new Date().toISOString(),
      responseMetadata: redactSensitive({ result }) as Record<string, unknown>,
    });
    this.dependencies.logger.write({
      tenantId: event.tenantId,
      ...(event.branchId ? { branchId: event.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      operation: `webhook:${parsed.eventType}`,
      correlationId: event.correlationId,
      status: "PROCESSED",
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  private async processPaymentEvent(
    event: IntegrationEvent,
    parsed: ParsedProviderEvent,
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
  ) {
    if (!parsed.externalResourceId)
      throw new IntegrationValidationError("Payment callback is missing its intent reference");
    const state = await this.dependencies.transactions.loadState(event.tenantId);
    const operationIntent = state.paymentOperations?.intents.find(
      (item) =>
        item.tenantId === event.tenantId &&
        (item.id === parsed.externalResourceId ||
          item.providerReference === parsed.externalResourceId ||
          item.externalReference === parsed.externalResourceId),
    );
    const legacyIntent = state.paymentIntents.find(
      (item) =>
        item.id === parsed.externalResourceId ||
        item.externalReference === parsed.externalResourceId,
    );
    if (!operationIntent && !legacyIntent) {
      throw new MappingError("Payment callback does not match a Seramet payment intent");
    }
    const branchId = operationIntent?.branchId ?? legacyIntent?.branchId ?? connection.branchId;
    if (!branchId) throw new MappingError("Payment intent has no branch assignment");
    const branch = this.dependencies.configuration.getBranch(event.tenantId, branchId);
    let providerStatus = parsed.eventType === "PAYMENT_CONFIRMED" ? "CONFIRMED" : "FAILED";
    let providerReference =
      parsed.providerTransactionId ?? parsed.providerEventId ?? parsed.externalResourceId;
    let amountMinor = parsed.amountMinor;
    let currency = parsed.currency;
    let merchantReference = parsed.merchantReference;
    if (parsed.requiresPaymentFetch) {
      if (!adapter.queryPayment) {
        throw new UnsupportedCapabilityError(
          "Provider IPN requires authoritative transaction status resolution",
        );
      }
      const queried = await adapter.queryPayment(parsed.externalResourceId, {
        connection,
        credentials,
        correlationId: event.correlationId,
      });
      if (!queried.ok) throw resultToError(queried);
      providerStatus = queried.value.status;
      providerReference = queried.value.providerTransactionId;
      amountMinor = queried.value.amountMinor;
      currency = queried.value.currency;
      merchantReference = queried.value.merchantReference;
    }
    const reference = providerReference;
    let next = state;
    if (operationIntent && providerStatus === "CONFIRMED") {
      if (amountMinor === undefined || !currency) {
        throw new IntegrationValidationError(
          "Confirmed provider payment is missing amount or currency",
        );
      }
      const allocations: Array<{ invoiceId: string; amountMinor: number }> = [];
      let remaining = amountMinor;
      for (const invoiceId of operationIntent.invoiceIds) {
        const invoice = state.bills.find(
          (candidate) =>
            candidate.id === invoiceId &&
            candidate.tenantId === event.tenantId &&
            candidate.branchId === branchId,
        );
        if (!invoice) throw new MappingError(`Payment invoice ${invoiceId} was not found`);
        const due = invoiceBalanceMinor(invoice, currency);
        const allocated = Math.min(remaining, due);
        if (allocated > 0) allocations.push({ invoiceId, amountMinor: allocated });
        remaining -= allocated;
      }
      const intentMerchantReference = operationIntent.metadata["merchantReference"];
      next = new PaymentOrchestrator(this.dependencies.configuration).confirmProviderCollection(
        state,
        {
          tenantId: event.tenantId,
          branchId,
          intentId: operationIntent.id,
          paymentMethodId: operationIntent.paymentMethodId,
          providerConnectionId: connection.id,
          providerTransactionId: reference,
          merchantReference:
            merchantReference ??
            (typeof intentMerchantReference === "string" && intentMerchantReference
              ? intentMerchantReference
              : (operationIntent.invoiceIds[0] ?? operationIntent.id)),
          amountMinor,
          currency,
          allocations,
          actor: `${connection.displayName} callback`,
          ...(parsed.occurredAt ? { occurredAt: parsed.occurredAt } : {}),
          metadata: { ...operationIntent.metadata, integrationEventId: event.id },
        },
      );
    } else if (legacyIntent && providerStatus === "CONFIRMED") {
      next = TransactionEngine.confirmPaymentIntent(state, legacyIntent.id, reference);
    } else {
      if (operationIntent) {
        next = new PaymentOrchestrator(this.dependencies.configuration).failIntent(state, {
          tenantId: event.tenantId,
          intentId: operationIntent.id,
          actor: `${connection.displayName} callback`,
          reason: `Provider status ${providerStatus}`,
        });
      }
      const failedIntent = legacyIntent
        ? next.paymentIntents.find((item) => item.id === legacyIntent.id)
        : undefined;
      if (failedIntent && failedIntent.status !== "SUCCEEDED") {
        failedIntent.status = "FAILED";
        failedIntent.externalReference = reference;
      }
    }
    await this.dependencies.transactions.saveState(
      next,
      systemActor(event.tenantId, branch.id, branch.name),
      `${connection.displayName} ${providerStatus.toLowerCase()} for ${operationIntent?.id ?? legacyIntent!.id}`,
    );
    const now = new Date().toISOString();
    await this.mappings.upsert({
      id: crypto.randomUUID(),
      tenantId: event.tenantId,
      branchId: branch.id,
      connectionId: connection.id,
      providerId: connection.providerId,
      resourceType: "PAYMENT",
      internalId: operationIntent?.id ?? legacyIntent!.id,
      externalId: reference,
      status: "MAPPED",
      metadata: { eventType: parsed.eventType },
      createdAt: now,
      updatedAt: now,
    });
    return {
      paymentIntentId: operationIntent?.id ?? legacyIntent!.id,
      status:
        legacyIntent && !operationIntent && providerStatus === "CONFIRMED"
          ? "SUCCEEDED"
          : providerStatus,
      providerReference: reference,
    };
  }

  private async processIncomingOrder(
    event: IntegrationEvent,
    parsed: ParsedProviderEvent,
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
  ) {
    if (!adapter.normalizeIncomingOrder)
      throw new UnsupportedCapabilityError("Provider cannot normalize incoming orders");
    let rawOrder = parsed.payload;
    const context: ProviderExecutionContext = {
      connection,
      credentials,
      correlationId: event.correlationId,
    };
    if (parsed.requiresOrderFetch) {
      if (!adapter.getOrder || !parsed.externalResourceId)
        throw new UnsupportedCapabilityError("Provider order retrieval is unavailable");
      const fetched = await adapter.getOrder(parsed.externalResourceId, context);
      if (!fetched.ok) throw resultToError(fetched);
      rawOrder = fetched.value;
    }
    const normalized = await adapter.normalizeIncomingOrder(rawOrder, connection, context);
    if (!normalized.ok) throw resultToError(normalized);
    const order = normalized.value;
    const existingOrder = await this.mappings.resolveExternal(
      event.tenantId,
      connection.id,
      "ORDER",
      order.providerOrderId,
    );
    if (existingOrder) {
      const cancelledBeforeCreate =
        existingOrder.metadata["providerStatus"] === "CANCELLED" &&
        existingOrder.metadata["outOfOrder"] === true;
      return {
        ...(cancelledBeforeCreate ? {} : { orderId: existingOrder.internalId }),
        accepted: !cancelledBeforeCreate,
        duplicate: true,
        ...(cancelledBeforeCreate ? { cancelled: true } : {}),
        branchId: existingOrder.branchId,
      };
    }
    const store = await this.mappings.resolveStore(
      event.tenantId,
      connection.id,
      order.externalStoreId,
    );
    if (connection.branchId && connection.branchId !== store.branchId)
      throw new MappingError("Store mapping does not belong to this connection branch");
    order.branchId = store.branchId;
    const marketplaceConfig = parseMarketplaceConnectionConfig(connection.configuration);
    const unmappedPolicy = asUnmappedPolicy(marketplaceConfig.unmappedItemPolicy);
    const mappedItems = await this.mapItems(event.tenantId, connection.id, order);
    const acceptancePolicy = asAcceptancePolicy(marketplaceConfig.acceptancePolicy);
    const channel = this.resolveChannel(event.tenantId, connection, order.channelId);
    const branch = this.dependencies.configuration.getBranch(event.tenantId, store.branchId);
    const tenant = this.dependencies.configuration.getTenant(event.tenantId);
    if (order.currency.toUpperCase() !== tenant.defaultCurrency.toUpperCase()) {
      await this.queueRejection(event, connection, order.providerOrderId, "INVALID_ORDER");
      throw new IntegrationValidationError(
        `Order currency ${order.currency} does not match ${tenant.defaultCurrency}`,
      );
    }
    validateOrderTotals(order);
    const missingRequired = mappedItems.some(
      (item) =>
        !item.internalItemId || item.modifiers.some((modifier) => !modifier.internalModifierId),
    );
    if (missingRequired && unmappedPolicy === "AUTO_REJECT") {
      await this.queueRejection(event, connection, order.providerOrderId, "ITEM_MAPPING_ERROR");
      throw new MappingError("Order contains unmapped items or modifiers and was rejected");
    }
    const validForAcceptance =
      (!missingRequired || unmappedPolicy === "USE_EXTERNAL_DESCRIPTION") &&
      branch.active &&
      connection.status !== "DEGRADED" &&
      connection.status !== "RATE_LIMITED";
    if (acceptancePolicy !== "MANUAL" && !validForAcceptance)
      throw new MappingError("Order is not eligible for automatic acceptance");
    const state = await this.dependencies.transactions.loadState(event.tenantId);
    const lines: TransactionLine[] = mappedItems.map((item, index) => {
      const itemNote = [
        item.notes,
        ...item.modifiers.map((modifier) =>
          modifier.internalModifierId ? modifier.name : `[UNMAPPED MODIFIER] ${modifier.name}`,
        ),
      ]
        .filter(Boolean)
        .join("; ");
      return {
        id: `EXT-${event.id}-${index + 1}`,
        ...(item.internalItemId ? { productId: item.internalItemId } : {}),
        name: item.name,
        category: "External order",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productionStation: String(marketplaceConfig.fallbackStationId ?? "MAIN KITCHEN"),
        ...(itemNote ? { itemNote } : {}),
      };
    });
    const estimatedPrepMinutes = estimatePrepMinutes(
      lines,
      marketplaceConfig,
      mappedItems.map((item) => ({
        ...(item.internalItemId ? { internalItemId: item.internalItemId } : {}),
        quantity: item.quantity,
      })),
    );
    const estimatedReadyAt = new Date(Date.now() + estimatedPrepMinutes * 60_000).toISOString();
    const scheduledReleaseAt = order.scheduledFor
      ? new Date(
          new Date(order.scheduledFor).getTime() -
            (estimatedPrepMinutes + marketplaceConfig.scheduledOrderBufferMinutes) * 60_000,
        ).toISOString()
      : undefined;
    if (order.scheduledFor && !marketplaceConfig.allowScheduledOrders) {
      await this.queueRejection(event, connection, order.providerOrderId, "INVALID_ORDER");
      throw new IntegrationValidationError("Scheduled marketplace orders are disabled");
    }
    const requiresReview = missingRequired && unmappedPolicy === "MANAGER_REVIEW";
    const shouldAutoAccept = acceptancePolicy !== "MANUAL" && !requiresReview;
    const holdForSchedule = Boolean(
      scheduledReleaseAt && new Date(scheduledReleaseAt).getTime() > Date.now(),
    );
    let next = TransactionEngine.createOrder(
      state,
      {
        tenantId: event.tenantId,
        branchId: branch.id,
        branch: branch.name,
        customer: order.customer.name ?? "External customer",
        channel: channel.displayName,
        cashier: adapter.definition.displayName,
        ...(order.specialInstructions ? { kitchenNote: order.specialInstructions } : {}),
        financialOverride: marketplaceFinancials(order),
        lines,
        externalSource: {
          connectionId: connection.id,
          providerId: connection.providerId,
          externalStoreId: order.externalStoreId,
          externalOrderId: order.providerOrderId,
          ...(order.rawExternalReference
            ? { providerDisplayReference: order.rawExternalReference }
            : {}),
          ...(order.providerStatus ? { providerStatus: order.providerStatus } : {}),
          externallyPaid: order.payment.externallyPaid,
          ...(order.payment.amountPaid === undefined
            ? {}
            : { externallyCollectedAmount: order.payment.amountPaid }),
          fulfilmentType:
            order.delivery.type === "RESTAURANT"
              ? "OWN_DELIVERY"
              : order.delivery.type === "PICKUP"
                ? "PICKUP"
                : "PROVIDER_DELIVERY",
          isScheduled: Boolean(order.scheduledFor),
          ...(order.scheduledFor ? { scheduledFor: order.scheduledFor } : {}),
          ...(scheduledReleaseAt ? { scheduledReleaseAt } : {}),
          estimatedReadyAt,
          receivedAt: order.createdAt,
          metadata: {
            ...(order.fulfilmentMetadata ?? {}),
            externalCustomerId: order.customer.externalCustomerId,
            deliveryAddress: order.delivery.address,
            deliveryInstructions: order.delivery.instructions,
            rider: order.delivery.rider,
          },
        },
        delivery: {
          status: "UNASSIGNED",
          ...(order.delivery.rider?.name ? { rider: order.delivery.rider.name } : {}),
        },
      },
      shouldAutoAccept && !holdForSchedule ? "OPEN" : "HELD",
    );
    const created = next.orders[0]!;
    if (shouldAutoAccept && !holdForSchedule)
      next = TransactionEngine.sendToKitchen(next, created.id, adapter.definition.displayName);
    if (shouldAutoAccept && created.externalSource) {
      created.externalSource.acceptedAt = new Date().toISOString();
    }
    if (order.payment.externallyPaid) {
      next = TransactionEngine.recordMarketplaceReceivable(next, created.id, {
        connectionId: connection.id,
        providerId: connection.providerId,
        externalOrderId: order.providerOrderId,
        ...(order.rawExternalReference
          ? { providerDisplayReference: order.rawExternalReference }
          : {}),
        currency: order.currency,
        externallyCollectedAmount: order.payment.amountPaid ?? order.pricing.total,
        receivableAccount: marketplaceConfig.settlementAccountId ?? "Marketplace Receivables",
        metadata: { externalPaymentReference: order.payment.providerPaymentReference },
      });
    }
    if (order.charges?.length) {
      next = TransactionEngine.recordMarketplaceCharges(
        next,
        created.id,
        order.charges.map((charge) => ({ ...charge, connectionId: connection.id })),
      );
    }
    await this.dependencies.transactions.saveState(
      next,
      systemActor(event.tenantId, branch.id, branch.name),
      `Imported ${adapter.definition.displayName} order ${order.providerOrderId}`,
    );
    const now = new Date().toISOString();
    await this.mappings.upsert({
      id: crypto.randomUUID(),
      tenantId: event.tenantId,
      branchId: branch.id,
      connectionId: connection.id,
      providerId: connection.providerId,
      resourceType: "ORDER",
      internalId: created.id,
      externalId: order.providerOrderId,
      status: "MAPPED",
      metadata: {
        externalItems: order.items.map((item) => ({
          externalItemId: item.externalItemId,
          quantity: item.quantity,
        })),
        providerStatus: order.providerStatus ?? "RECEIVED",
      },
      createdAt: now,
      updatedAt: now,
    });
    if (shouldAutoAccept && adapter.definition.capabilities.includes("ACCEPT_ORDER")) {
      await this.enqueueOutbound({
        tenantId: event.tenantId,
        branchId: branch.id,
        connectionId: connection.id,
        eventType: "ORDER_ACCEPTED",
        resourceType: "ORDER",
        resourceId: order.providerOrderId,
        payload: {
          estimatedReadyAt,
          estimatedPrepMinutes,
          items: order.items.map((item) => ({
            externalItemId: item.externalItemId,
            quantity: item.quantity,
          })),
        },
        idempotencyKey: `accept:${connection.id}:${order.providerOrderId}`,
      });
    }
    return {
      orderId: created.id,
      accepted: shouldAutoAccept,
      branchId: branch.id,
      scheduled: holdForSchedule,
      paymentStatus: order.payment.externallyPaid ? "PROVIDER_RECEIVABLE" : "UNPAID",
    };
  }

  private async mapItems(tenantId: string, connectionId: string, order: NormalizedExternalOrder) {
    return Promise.all(
      order.items.map(async (item) => ({
        ...item,
        internalItemId:
          item.internalItemId ??
          (await this.mappings.resolveInternalItem(tenantId, connectionId, item.externalItemId)),
        modifiers: await Promise.all(
          item.modifiers.map(async (modifier) => ({
            ...modifier,
            internalModifierId:
              modifier.internalModifierId ??
              (await this.mappings.resolveInternalModifier(
                tenantId,
                connectionId,
                modifier.externalModifierId,
              )),
          })),
        ),
      })),
    );
  }

  private async processIncomingOrderUpdate(
    event: IntegrationEvent,
    parsed: ParsedProviderEvent,
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
  ) {
    if (!adapter.definition.capabilities.includes("ORDER_MODIFICATIONS"))
      throw new UnsupportedCapabilityError(
        `${adapter.definition.displayName} order modifications are not enabled by its official adapter`,
      );
    if (!adapter.normalizeIncomingOrder)
      throw new UnsupportedCapabilityError("Provider cannot normalize order updates");
    let payload = parsed.payload;
    const context: ProviderExecutionContext = {
      connection,
      credentials,
      correlationId: event.correlationId,
    };
    if (parsed.requiresOrderFetch) {
      if (!adapter.getOrder || !parsed.externalResourceId)
        throw new UnsupportedCapabilityError("Provider order retrieval is unavailable");
      const response = await adapter.getOrder(parsed.externalResourceId, context);
      if (!response.ok) throw resultToError(response);
      payload = response.value;
    }
    const normalized = await adapter.normalizeIncomingOrder(payload, connection, context);
    if (!normalized.ok) throw resultToError(normalized);
    const mapping = await this.mappings.resolveExternal(
      event.tenantId,
      connection.id,
      "ORDER",
      normalized.value.providerOrderId,
    );
    if (!mapping) throw new MappingError("Updated provider order is not mapped to Seramet");
    const mappedItems = await this.mapItems(event.tenantId, connection.id, normalized.value);
    if (
      mappedItems.some(
        (item) =>
          !item.internalItemId || item.modifiers.some((modifier) => !modifier.internalModifierId),
      )
    ) {
      throw new MappingError("Updated order contains unmapped items or modifiers");
    }
    validateOrderTotals(normalized.value);
    const state = await this.dependencies.transactions.loadState(event.tenantId);
    const lines: TransactionLine[] = mappedItems.map((item, index) => {
      const existing = state.orders
        .find((order) => order.id === mapping.internalId)
        ?.lines.find((line) => line.productId === item.internalItemId && line.name === item.name);
      return {
        id: existing?.id ?? `EXT-${event.id}-${index + 1}`,
        productId: item.internalItemId!,
        name: item.name,
        category: existing?.category ?? "External order",
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productionStation: existing?.productionStation ?? "MAIN KITCHEN",
        ...(existing?.productionStatus ? { productionStatus: existing.productionStatus } : {}),
        ...([item.notes, ...item.modifiers.map((modifier) => modifier.name)].filter(Boolean).length
          ? {
              itemNote: [item.notes, ...item.modifiers.map((modifier) => modifier.name)]
                .filter(Boolean)
                .join("; "),
            }
          : {}),
      };
    });
    const next = TransactionEngine.applyMarketplaceOrderModification(state, mapping.internalId, {
      lines,
      reason: "Provider order update",
      requestedBy: adapter.definition.displayName,
      financialOverride: marketplaceFinancials(normalized.value),
      ...(normalized.value.providerStatus
        ? { providerStatus: normalized.value.providerStatus }
        : {}),
    });
    const branchId = mapping.branchId ?? connection.branchId;
    if (!branchId) throw new MappingError("Mapped provider order has no branch assignment");
    await this.dependencies.transactions.saveState(
      next,
      systemActor(event.tenantId, branchId, adapter.definition.displayName),
      `Applied ${adapter.definition.displayName} order update ${normalized.value.providerOrderId}`,
    );
    return {
      orderId: mapping.internalId,
      additions: next.productionAmendments.filter(
        (amendment) => amendment.orderId === mapping.internalId && amendment.type === "ADDITION",
      ).length,
      cancellations: next.productionAmendments.filter(
        (amendment) => amendment.orderId === mapping.internalId && amendment.type === "CANCEL_ITEM",
      ).length,
    };
  }

  private async ingestRecoveredOrder(
    tenantId: string,
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
    candidate: import("@/integrations/types").RecoverableExternalOrder,
  ) {
    const eventId = crypto.randomUUID();
    const idempotencyKey = `recovery:${connection.id}:${candidate.externalOrderId}`;
    const claimed = await this.idempotency.claim(tenantId, connection.id, idempotencyKey, eventId);
    if (!claimed.claimed) {
      const previous = claimed.record.result as { orderId?: string } | undefined;
      return { ...(previous?.orderId ? { orderId: previous.orderId } : {}), duplicate: true };
    }
    const payload = candidate.payload ?? {
      id: candidate.externalOrderId,
      current_state: "CREATED",
      ...(candidate.placedAt ? { placed_at: candidate.placedAt } : {}),
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const now = new Date().toISOString();
    const event: IntegrationEvent = {
      id: eventId,
      tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      direction: "INBOUND",
      eventType: "ORDER_CREATED",
      providerEventId: candidate.providerEventId ?? idempotencyKey,
      externalResourceId: candidate.externalOrderId,
      correlationId: crypto.randomUUID(),
      idempotencyKey,
      payload: redactSensitive(payload),
      payloadHash: await stableHash(payloadBytes),
      receivedAt: now,
      status: "RECEIVED",
      attemptCount: 0,
      createdAt: now,
    };
    await this.events.append(event);
    const parsed: ParsedProviderEvent = {
      providerEventId: event.providerEventId,
      eventType: "ORDER_CREATED",
      externalResourceId: candidate.externalOrderId,
      ...(candidate.placedAt ? { occurredAt: candidate.placedAt } : {}),
      payload,
      requiresOrderFetch: true,
    };
    try {
      const result = (await this.processEvent(event, parsed, connection, adapter, credentials)) as {
        orderId?: string;
        duplicate?: boolean;
      };
      await this.idempotency.complete(tenantId, connection.id, idempotencyKey, result);
      await this.dependencies.health.recordSuccess(connection, true);
      return {
        ...(result.orderId ? { orderId: result.orderId } : {}),
        duplicate: result.duplicate ?? false,
      };
    } catch (error) {
      const normalized = normalizeIntegrationError(error);
      await this.events.updateStatus(tenantId, event.id, {
        status: normalized.retryable ? "RETRY_PENDING" : "FAILED",
        lastError: normalized.message,
        attemptCount: 1,
      });
      await this.dependencies.health.recordFailure(connection, normalized.message);
      if (!normalized.retryable) await this.deadLetterEvent(event, normalized.message, 1);
      throw normalized;
    }
  }

  private async processIncomingOrderCancellation(
    event: IntegrationEvent,
    parsed: ParsedProviderEvent,
    connection: IntegrationConnection,
  ) {
    const externalOrderId = parsed.externalResourceId;
    if (!externalOrderId)
      throw new IntegrationValidationError("Provider cancellation has no order identifier");
    const mapping = await this.mappings.resolveExternal(
      event.tenantId,
      connection.id,
      "ORDER",
      externalOrderId,
    );
    if (!mapping) {
      const reason = extractCancellationReason(parsed.payload);
      const now = new Date().toISOString();
      await this.dependencies.repository.upsertMapping({
        id: crypto.randomUUID(),
        tenantId: event.tenantId,
        ...(connection.branchId ? { branchId: connection.branchId } : {}),
        connectionId: connection.id,
        providerId: connection.providerId,
        resourceType: "ORDER",
        internalId: `CANCELLED:${externalOrderId}`,
        externalId: externalOrderId,
        status: "CONFLICT",
        metadata: { providerStatus: "CANCELLED", cancellationReason: reason, outOfOrder: true },
        createdAt: now,
        updatedAt: now,
      });
      return { orderId: null, status: "CANCELLED", outOfOrder: true, cancellationTicket: false };
    }
    const state = await this.dependencies.transactions.loadState(event.tenantId);
    const reason = extractCancellationReason(parsed.payload);
    const next = TransactionEngine.cancelOrder(state, mapping.internalId, {
      user: connection.displayName,
      reason,
      affectedItems:
        state.orders
          .find((order) => order.id === mapping.internalId)
          ?.lines.map((line) => line.id) ?? [],
    });
    const branchId = mapping.branchId ?? connection.branchId;
    if (!branchId) throw new MappingError("Mapped provider order has no branch assignment");
    await this.dependencies.transactions.saveState(
      next,
      systemActor(event.tenantId, branchId, connection.displayName),
      `Applied provider cancellation ${externalOrderId}`,
    );
    await this.dependencies.repository.upsertMapping({
      ...mapping,
      metadata: { ...mapping.metadata, providerStatus: "CANCELLED", cancellationReason: reason },
      updatedAt: new Date().toISOString(),
    });
    return { orderId: mapping.internalId, status: "CANCELLED", cancellationTicket: true };
  }

  private async queueRejection(
    event: IntegrationEvent,
    connection: IntegrationConnection,
    externalOrderId: string,
    reason: import("@/integrations/marketplace/types").MarketplaceRejectionReason,
  ) {
    const adapter = this.dependencies.registry.resolve(connection);
    if (!adapter.definition.capabilities.includes("REJECT_ORDER")) return null;
    return this.enqueueOutbound({
      tenantId: event.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      eventType: "ORDER_REJECTED",
      resourceType: "ORDER",
      resourceId: externalOrderId,
      payload: { reason },
      idempotencyKey: `reject:${connection.id}:${externalOrderId}:${reason}`,
    });
  }

  private resolveChannel(tenantId: string, connection: IntegrationConnection, requested?: string) {
    const channels = this.dependencies.configuration.listOrderChannels(tenantId);
    const configured = String(connection.configuration["channelId"] ?? requested ?? "");
    const channel = channels.find(
      (item) =>
        item.id === configured ||
        item.code === configured ||
        item.deliveryProviderConnectionId === connection.id,
    );
    if (!channel) throw new MappingError("Connection has no active Seramet order channel");
    return channel;
  }

  private async dispatchOutbound(
    adapter: ProviderAdapter,
    context: ProviderExecutionContext,
    eventType: string,
    resourceId: string,
    payload: unknown,
  ) {
    const capabilityMap: Record<
      string,
      { capability: ProviderCapability; run: (() => Promise<ProviderOperationResult>) | undefined }
    > = {
      ORDER_ACCEPTED: {
        capability: "ACCEPT_ORDER",
        run: adapter.acceptOrder
          ? () => {
              const input = payload as Record<string, unknown>;
              const estimatedReadyAt =
                typeof input["estimatedReadyAt"] === "string"
                  ? input["estimatedReadyAt"]
                  : undefined;
              const estimatedPrepMinutes = Number(input["estimatedPrepMinutes"]);
              const items = asExternalOrderItems(input["items"]);
              return adapter.acceptOrder!(resourceId, context.connection, context, {
                ...(estimatedReadyAt ? { estimatedReadyAt } : {}),
                ...(Number.isFinite(estimatedPrepMinutes) ? { estimatedPrepMinutes } : {}),
                ...(items.length ? { items } : {}),
                acceptedBy: "Seramet Integration Runtime",
              });
            }
          : undefined,
      },
      ORDER_REJECTED: {
        capability: "REJECT_ORDER",
        run: adapter.rejectOrder
          ? () =>
              adapter.rejectOrder!(
                resourceId,
                asRejectionReason((payload as Record<string, unknown>)?.["reason"]),
                context.connection,
                context,
              )
          : undefined,
      },
      ORDER_READY: {
        capability: "MARK_ORDER_READY",
        run: adapter.markOrderReady
          ? () => {
              const items = asExternalOrderItems((payload as Record<string, unknown>)?.["items"]);
              return adapter.markOrderReady!(resourceId, context, items.length ? { items } : {});
            }
          : undefined,
      },
      ORDER_CANCELLED: {
        capability: "CANCEL_ORDER",
        run: adapter.cancelOrder
          ? () =>
              adapter.cancelOrder!(
                resourceId,
                String((payload as Record<string, unknown>)?.["reason"] ?? "Cancelled"),
                context,
              )
          : undefined,
      },
      ITEM_AVAILABILITY: {
        capability: "SYNC_AVAILABILITY",
        run: adapter.syncAvailability
          ? () =>
              adapter.syncAvailability!(
                payload as Parameters<NonNullable<ProviderAdapter["syncAvailability"]>>[0],
                context.connection,
                context,
              )
          : undefined,
      },
      ITEM_PRICE: {
        capability: "SYNC_PRICES",
        run: adapter.updateItemPrice
          ? () =>
              adapter.updateItemPrice!(
                payload as Parameters<NonNullable<ProviderAdapter["updateItemPrice"]>>[0],
                context,
              )
          : undefined,
      },
      MENU_SYNC: {
        capability: "SYNC_MENU",
        run: adapter.syncMenu
          ? () =>
              adapter.syncMenu!(
                (payload as { menu: Parameters<NonNullable<ProviderAdapter["syncMenu"]>>[0] }).menu,
                context.connection,
                context,
              )
          : undefined,
      },
      STORE_STATUS: {
        capability: "UPDATE_STORE_STATUS",
        run: adapter.setStoreStatus
          ? () =>
              adapter.setStoreStatus!(
                resourceId,
                (payload as { status: MarketplaceStoreStatus }).status,
                context,
              )
          : undefined,
      },
    };
    const operation = capabilityMap[eventType];
    if (
      !operation ||
      !adapter.definition.capabilities.includes(operation.capability) ||
      !operation.run
    )
      throw new UnsupportedCapabilityError(`Provider does not support outbound ${eventType}`);
    const result = await operation.run();
    if (!result.ok) throw resultToError(result);
    return result.value;
  }

  private async recordOutboundSuccess(
    record: import("@/integrations/runtime/models").IntegrationOutbox,
  ) {
    const stamp = new Date().toISOString();
    if (record.eventType === "MENU_SYNC") {
      const menu = (
        record.payload as {
          menu?: import("@/integrations/marketplace/types").NormalizedMarketplaceMenu;
        }
      ).menu;
      if (!menu) return;
      const mappings = await this.dependencies.repository.listMappings(
        record.tenantId,
        record.connectionId,
      );
      for (const item of menu.items) {
        const mapping = mappings.find(
          (candidate) =>
            candidate.resourceType === "ITEM" && candidate.internalId === item.internalId,
        );
        if (!mapping) continue;
        const hash = await itemSyncHash(item);
        const { lastError: _lastError, ...mappingWithoutError } = mapping;
        await this.dependencies.repository.upsertMapping({
          ...mappingWithoutError,
          syncStatus: "SYNCED",
          lastSyncedAt: stamp,
          lastInternalHash: hash,
          lastExternalHash: hash,
          lastSyncedHash: hash,
          metadata: {
            ...mapping.metadata,
            lastSyncedSnapshot: marketplaceItemSnapshot(item),
            pendingSnapshot: undefined,
          },
          updatedAt: stamp,
        });
      }
      return;
    }
    if (record.eventType === "ITEM_AVAILABILITY" || record.eventType === "ITEM_PRICE") {
      const mapping = (
        await this.dependencies.repository.listMappings(record.tenantId, record.connectionId)
      ).find(
        (candidate) =>
          candidate.resourceType === "ITEM" && candidate.externalId === record.resourceId,
      );
      if (!mapping) return;
      const { lastError: _lastError, ...mappingWithoutError } = mapping;
      await this.dependencies.repository.upsertMapping({
        ...mappingWithoutError,
        syncStatus: "SYNCED",
        lastSyncedAt: stamp,
        metadata: { ...mapping.metadata, lastIncrementalSync: record.payload },
        updatedAt: stamp,
      });
    }
  }

  private async recordOutboundFailure(
    record: import("@/integrations/runtime/models").IntegrationOutbox,
    error: string,
  ) {
    const mappings = await this.dependencies.repository.listMappings(
      record.tenantId,
      record.connectionId,
    );
    const affected =
      record.eventType === "MENU_SYNC"
        ? mappings.filter((mapping) => mapping.resourceType === "ITEM")
        : mappings.filter(
            (mapping) =>
              mapping.resourceType === "ITEM" && mapping.externalId === record.resourceId,
          );
    for (const mapping of affected) {
      await this.dependencies.repository.upsertMapping({
        ...mapping,
        syncStatus: "FAILED",
        lastError: error,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  private async deadLetterEvent(event: IntegrationEvent, error: string, attemptCount: number) {
    await this.events.updateStatus(event.tenantId, event.id, {
      status: "DEAD_LETTER",
      lastError: error,
      attemptCount,
    });
    const letter: IntegrationDeadLetter = {
      id: crypto.randomUUID(),
      tenantId: event.tenantId,
      ...(event.branchId ? { branchId: event.branchId } : {}),
      connectionId: event.connectionId,
      providerId: event.providerId,
      sourceType: "EVENT",
      sourceId: event.id,
      originalPayload: event.payload,
      error,
      attemptCount,
      correlationId: event.correlationId,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };
    await this.dependencies.repository.appendDeadLetter(letter);
  }
}

function resultToError(result: Exclude<ProviderOperationResult, { ok: true }>) {
  return new IntegrationError(
    result.message,
    result.code,
    result.retryable ?? ["RATE_LIMITED", "TIMEOUT", "PROVIDER_UNAVAILABLE"].includes(result.code),
    result.code === "RATE_LIMITED"
      ? 429
      : result.code === "AUTHENTICATION"
        ? 401
        : result.code === "AUTHORIZATION"
          ? 403
          : 424,
    result.retryAfterMs,
  );
}
function lowerCaseHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}
function asUnmappedPolicy(value: unknown): UnmappedItemPolicy {
  return value === "MANAGER_REVIEW" || value === "USE_EXTERNAL_DESCRIPTION" ? value : "AUTO_REJECT";
}
function asAcceptancePolicy(value: unknown): OrderAcceptancePolicy {
  return value === "MANUAL" || value === "AUTO_ACCEPT_ALL_MAPPED" ? value : "AUTO_ACCEPT_VALID";
}
function asRejectionReason(value: unknown) {
  const allowed = [
    "ITEM_UNAVAILABLE",
    "STORE_CLOSED",
    "ITEM_MAPPING_ERROR",
    "PRICE_MISMATCH",
    "INVALID_ORDER",
    "CAPACITY",
    "TECHNICAL_FAILURE",
    "OTHER",
  ] as const;
  return typeof value === "string" && allowed.includes(value as (typeof allowed)[number])
    ? (value as (typeof allowed)[number])
    : ("OTHER" as const);
}
function validateOrderTotals(order: NormalizedExternalOrder) {
  if (!order.items.length) throw new IntegrationValidationError("Order contains no items");
  if (
    order.items.some(
      (item) =>
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice < 0 ||
        !Number.isFinite(item.total),
    )
  )
    throw new IntegrationValidationError("Order contains invalid quantities or prices");
  const itemTotal = order.items.reduce((sum, item) => sum + item.total, 0);
  if (Math.abs(itemTotal - order.pricing.subtotal) > 1)
    throw new IntegrationValidationError("Provider order subtotal does not match its items");
  const expectedTotal =
    order.pricing.subtotal -
    order.pricing.discounts +
    order.pricing.taxes +
    (order.pricing.deliveryFee ?? 0) +
    (order.pricing.serviceFee ?? 0) +
    (order.pricing.tip ?? 0);
  if (Math.abs(expectedTotal - order.pricing.total) > 1)
    throw new IntegrationValidationError("Provider order total is inconsistent");
}
function marketplaceFinancials(order: NormalizedExternalOrder) {
  const nonTaxRevenue =
    order.pricing.subtotal +
    (order.pricing.deliveryFee ?? 0) +
    (order.pricing.serviceFee ?? 0) +
    (order.pricing.tip ?? 0);
  return {
    subtotal: nonTaxRevenue,
    tax: order.pricing.taxes,
    total: nonTaxRevenue + order.pricing.taxes,
  };
}
function estimatePrepMinutes(
  lines: TransactionLine[],
  config: ReturnType<typeof parseMarketplaceConnectionConfig>,
  mappedItems: Array<{ internalItemId?: string; quantity: number }>,
) {
  const configuredItemMinutes = mappedItems.map(
    (item) => config.defaultPrepMinutes + Math.max(0, item.quantity - 1) * 2,
  );
  const stationCount = new Set(lines.map((line) => line.productionStation).filter(Boolean)).size;
  return Math.min(
    config.maximumPrepMinutes,
    Math.max(config.defaultPrepMinutes, ...configuredItemMinutes) +
      Math.max(0, stationCount - 1) * 2,
  );
}
function extractCancellationReason(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Provider cancellation";
  const record = payload as Record<string, unknown>;
  const direct = record["reason"] ?? record["cancellation_reason"] ?? record["message"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (direct && typeof direct === "object") {
    const info = (direct as Record<string, unknown>)["info"];
    if (typeof info === "string" && info.trim()) return info.trim();
  }
  return "Provider cancellation";
}
function contextMapping(
  preview: import("@/integrations/marketplace/types").MarketplaceSyncPreview,
  internalId: string,
) {
  return preview.operations.find((operation) => operation.internalId === internalId);
}
function asExternalOrderItems(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const externalItemId = row["externalItemId"];
    const quantity = Number(row["quantity"]);
    return typeof externalItemId === "string" && Number.isFinite(quantity) && quantity > 0
      ? [{ externalItemId, quantity }]
      : [];
  });
}
function systemActor(tenantId: string, branchId: string, branch: string) {
  return {
    id: "integration-runtime",
    name: "Integration Runtime",
    tenantId,
    roleIds: ["system-integration"],
    permissions: allPermissionCodes,
    assignedBranchIds: [branchId],
    assignedBranches: [{ id: branchId, name: branch }],
    branchScope: { type: "BRANCH" as const, branchId },
    branchId,
    role: "Integration Runtime",
    branch,
  };
}
