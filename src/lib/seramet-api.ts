import { parseMajorAmount } from "@/payments/money";
import { emptyPaymentOperationsState } from "@/payments/payment-state";
import type { PaymentOperationsState } from "@/payments/types";
import {
  SerametHttpError,
  authenticateSerametRequest,
  authorizeBranchRead,
  authorizeSerametMutation,
  type SerametEnv,
  type ServerActor,
} from "@/lib/seramet-auth";
import { type TransactionRepository } from "@/lib/seramet-repository";
import { createTransactionRepository } from "@/server/database/create-transaction-repository";
import { TransactionEngine, type TransactionState } from "@/lib/transaction-engine";
import { allPermissionCodes, permissions } from "@/platform/permissions";
import { LOCAL_PILOT_TENANT_ID } from "@/platform/pilot-defaults";
import { getConfigurationRepository } from "@/platform/repositories/configuration-repository";
import { ProviderService } from "@/integrations/provider-service";
import {
  createDefaultProviderRegistry,
  getProviderRegistry,
} from "@/integrations/provider-registry";
import type { ProviderCapability } from "@/platform/types";
import {
  resolveLegacyWebhookAlias,
  resolveLegacyWebhookSecret,
} from "@/integrations/payments/legacy-routes";
import { createIntegrationRuntime } from "@/integrations/runtime/create-runtime";
import { IntegrationError } from "@/integrations/runtime/integration-errors";
import { assertDatabaseAvailable } from "@/server/database/d1";
import { hydrateAuthoritativeConfiguration } from "@/server/database/authoritative-configuration";
import {
  assertProductionReady,
  resolveRuntimeConfiguration,
  validateRuntimeConfiguration,
} from "@/server/environment";
import { ServerOperationError, publicError } from "@/server/errors";
import { handleOperationsApi } from "@/server/operations-api";
import { handleOfflineSyncApi } from "@/server/offline-sync-api";
import { DatabaseRateLimiter, sensitiveRateLimits } from "@/server/rate-limit";
import { handleInventoryApi } from "@/server/inventory-api";
import { handleManagementApi } from "@/server/management-api";
import { enqueueManagementRecalculation } from "@/server/workers";
import { handleOnboardingApi } from "@/server/onboarding-api";
import { handleIntelligenceApi } from "@/server/intelligence-api";
import { handleCrmApi } from "@/server/crm-api";
import { handleEnterpriseApi } from "@/server/enterprise-api";
import { handleGuestApi } from "@/server/guest-api";
import { CURRENT_SCHEMA_VERSION } from "@/server/database/schema-version";
import { handleRegistrationApi } from "@/server/registration-api";
import { handleSupabaseAuthApi } from "@/server/supabase-auth-api";
import { handleObjectStorageApi } from "@/server/object-storage-api";
import { handleRealtimeApi } from "@/server/realtime-api";
import { publishRealtimeEvent } from "@/server/realtime";

type MutationRequest = {
  action?: string;
  payload?: unknown;
  idempotencyKey?: string;
};

type SnapshotReplaceRequest = {
  state?: TransactionState;
  idempotencyKey?: string;
};

export async function handleSerametApiRequest(request: Request, env: SerametEnv) {
  env = env ?? {};
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/seramet/health/live" && request.method === "GET") {
      return json({ ok: true, service: "seramet", timestamp: new Date().toISOString() });
    }

    const runtime = resolveRuntimeConfiguration(env);
    if (url.pathname === "/api/seramet/health/ready" && request.method === "GET") {
      const issues = validateRuntimeConfiguration(env);
      if (env.SERAMET_DB) {
        try {
          await assertDatabaseAvailable(env.SERAMET_DB);
          if (runtime.productionLike) await assertCurrentSchema(env.SERAMET_DB);
          else await createTransactionRepository(env.SERAMET_DB).migrate();
        } catch (error) {
          issues.push({
            code: "DATABASE_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Authoritative database failed",
          });
        }
      }
      return json(
        {
          ok: issues.length === 0,
          environment: runtime.environment,
          database: env.SERAMET_DB ? "authoritative" : "unavailable",
          queue: runtime.durableQueue ? "available" : "unavailable",
          issues,
        },
        issues.length === 0 ? 200 : 503,
      );
    }

    const identityResponse = await handleSupabaseAuthApi(request, env);
    if (identityResponse) return identityResponse;

    if (runtime.productionLike) assertProductionReady(env);
    const repo = createTransactionRepository(env.SERAMET_DB);
    if (runtime.productionLike) await assertCurrentSchema(env.SERAMET_DB!);
    else await repo.migrate();
    if (env.SERAMET_DB) await hydrateAuthoritativeConfiguration(env.SERAMET_DB, env);

    const registrationResponse = await handleRegistrationApi(request, env);
    if (registrationResponse) return registrationResponse;

    const objectStorageResponse = await handleObjectStorageApi(request, env);
    if (objectStorageResponse) return objectStorageResponse;

    const realtimeResponse = await handleRealtimeApi(request, env);
    if (realtimeResponse) return realtimeResponse;

    const inventoryResponse = await handleInventoryApi(request, env);
    if (inventoryResponse) return inventoryResponse;
    const managementResponse = await handleManagementApi(request, env);
    if (managementResponse) return managementResponse;
    const onboardingResponse = await handleOnboardingApi(request, env);
    if (onboardingResponse) return onboardingResponse;
    const intelligenceResponse = await handleIntelligenceApi(request, env);
    if (intelligenceResponse) return intelligenceResponse;
    const crmResponse = await handleCrmApi(request, env);
    if (crmResponse) return crmResponse;
    const guestResponse = await handleGuestApi(request, env, repo);
    if (guestResponse) return guestResponse;
    const enterpriseResponse = await handleEnterpriseApi(request, env);
    if (enterpriseResponse) return enterpriseResponse;
    const operationsResponse = await handleOperationsApi(request, env);
    if (operationsResponse) return operationsResponse;
    const offlineResponse = await handleOfflineSyncApi(request, env, repo);
    if (offlineResponse) return offlineResponse;

    if (url.pathname === "/api/seramet/health" && request.method === "GET") {
      return json({
        ok: true,
        environment: runtime.environment,
        database: repo.authoritative ? "authoritative" : "development-memory",
        persistence: repo.authoritative ? "server-records" : "development-only",
        schemaVersion: repo.authoritative ? CURRENT_SCHEMA_VERSION : null,
        providerMode: providerMode(),
      });
    }

    if (url.pathname === "/api/seramet/menu/catalog" && request.method === "GET") {
      return await getOperationalMenuCatalog(request, env);
    }

    if (url.pathname === "/api/seramet/transactions" && request.method === "GET") {
      return await getTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/transactions" && request.method === "PUT") {
      if (repo.authoritative) {
        throw new SerametHttpError(
          405,
          "Authoritative deployments accept typed server commands, not browser snapshots",
        );
      }
      return await replaceTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/transactions/mutate" && request.method === "POST") {
      return await mutateTransactions(request, env, repo);
    }

    if (url.pathname === "/api/seramet/payments/mpesa/stk" && request.method === "POST") {
      return await createMpesaStk(request, env, repo);
    }

    if (url.pathname === "/api/seramet/payments/mpesa/qr" && request.method === "POST") {
      return await createMpesaQr(request, env, repo);
    }

    const providerPaymentRoute = /^\/api\/seramet\/payments\/([^/]+)\/(prompt|qr)$/.exec(
      url.pathname,
    );
    if (providerPaymentRoute && request.method === "POST") {
      return await createConfiguredProviderPayment(
        request,
        env,
        repo,
        decodeURIComponent(providerPaymentRoute[1]!),
        providerPaymentRoute[2] === "prompt" ? "PAYMENT_PROMPT" : "QR_PAYMENT",
      );
    }

    const genericWebhookRoute = /^\/api\/seramet\/webhooks\/connections\/([^/]+)$/.exec(
      url.pathname,
    );
    if (genericWebhookRoute && request.method === "POST") {
      await consumeRateLimit(env, `webhook:${genericWebhookRoute[1]}`, sensitiveRateLimits.webhook);
      return await receiveConfiguredWebhook(
        request,
        env,
        repo,
        decodeURIComponent(genericWebhookRoute[1]!),
      );
    }

    const integrationWebhookRoute =
      /^\/api\/seramet\/integrations\/webhooks\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (integrationWebhookRoute && request.method === "POST") {
      await consumeRateLimit(
        env,
        `webhook:${integrationWebhookRoute[1]}:${integrationWebhookRoute[2]}`,
        sensitiveRateLimits.webhook,
      );
      return await receiveIntegrationWebhook(
        request,
        env,
        decodeURIComponent(integrationWebhookRoute[1]!),
        decodeURIComponent(integrationWebhookRoute[2]!),
      );
    }

    if (url.pathname === "/api/seramet/integrations/diagnostics" && request.method === "GET") {
      const actor = await requireAnyPermission(request, env, [
        permissions.integrationsOrdersView,
        permissions.settingsIntegrationManage,
        permissions.auditView,
      ]);
      return json({
        ok: true,
        ...(await createIntegrationRuntime(env).diagnostics(actor.tenantId)),
      });
    }

    if (
      url.pathname === "/api/seramet/integrations/marketplace/menu-preview" &&
      request.method === "GET"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsMenuSync);
      const connectionId = url.searchParams.get("connectionId");
      if (!connectionId) throw new SerametHttpError(400, "connectionId is required");
      return json({
        ok: true,
        ...(await createIntegrationRuntime(env).previewMenuSync(actor.tenantId, connectionId)),
      });
    }

    if (
      url.pathname === "/api/seramet/integrations/marketplace/menu-sync" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsMenuSync);
      const input = await readJson<{
        connectionId?: string;
        confirmedMenuHash?: string;
        allowDestructive?: boolean;
      }>(request);
      if (!input.connectionId || !input.confirmedMenuHash)
        throw new SerametHttpError(400, "connectionId and confirmedMenuHash are required");
      const result = await createIntegrationRuntime(env).queueMenuSync(
        actor.tenantId,
        input.connectionId,
        {
          confirmedMenuHash: input.confirmedMenuHash,
          allowDestructive: input.allowDestructive ?? false,
        },
      );
      return json({ ok: true, ...result }, 202);
    }

    if (
      url.pathname === "/api/seramet/integrations/marketplace/availability" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsMenuSync);
      const input = await readJson<{
        branchId?: string;
        internalItemId?: string;
        available?: boolean;
        quantityAvailable?: number;
      }>(request);
      if (!input.branchId || !input.internalItemId || typeof input.available !== "boolean")
        throw new SerametHttpError(400, "branchId, internalItemId and available are required");
      authorizeBranchRead(actor, actor.tenantId, input.branchId);
      const queued = await createIntegrationRuntime(env).queueAvailabilitySync({
        tenantId: actor.tenantId,
        branchId: input.branchId,
        internalItemId: input.internalItemId,
        available: input.available,
        ...(input.quantityAvailable === undefined
          ? {}
          : { quantityAvailable: input.quantityAvailable }),
      });
      return json({ ok: true, queued }, 202);
    }

    if (
      url.pathname === "/api/seramet/integrations/marketplace/price" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsMenuSync);
      const input = await readJson<{
        connectionId?: string;
        internalItemId?: string;
        price?: number;
        currency?: string;
      }>(request);
      if (
        !input.connectionId ||
        !input.internalItemId ||
        !Number.isFinite(input.price) ||
        !input.currency
      )
        throw new SerametHttpError(
          400,
          "connectionId, internalItemId, price and currency are required",
        );
      const queued = await createIntegrationRuntime(env).queuePriceSync({
        tenantId: actor.tenantId,
        connectionId: input.connectionId,
        internalItemId: input.internalItemId,
        price: input.price!,
        currency: input.currency,
      });
      return json({ ok: true, queued }, 202);
    }

    if (
      url.pathname === "/api/seramet/integrations/marketplace/store-status" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsStoreManage);
      const input = await readJson<{ connectionId?: string; status?: string }>(request);
      if (
        !input.connectionId ||
        !input.status ||
        !["OPEN", "PAUSED", "CLOSED_TEMPORARILY"].includes(input.status)
      )
        throw new SerametHttpError(400, "A supported connectionId and status are required");
      const queued = await createIntegrationRuntime(env).queueStoreStatus(
        actor.tenantId,
        input.connectionId,
        input.status as import("@/integrations/marketplace/types").MarketplaceStoreStatus,
      );
      return json({ ok: true, queued }, 202);
    }

    if (url.pathname === "/api/seramet/integrations/workers/outbox" && request.method === "POST") {
      const actor = await requirePermission(request, env, permissions.integrationsConnectionManage);
      const input = await readJson<{ limit?: number }>(request);
      return json({
        ok: true,
        ...(await createIntegrationRuntime(env).processDueOutbox(actor.tenantId, input.limit)),
      });
    }

    if (
      url.pathname === "/api/seramet/integrations/workers/scheduled-orders" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsOrdersManage);
      return json({
        ok: true,
        ...(await createIntegrationRuntime(env).releaseDueScheduledOrders(actor.tenantId)),
      });
    }

    if (
      url.pathname === "/api/seramet/integrations/workers/recover-marketplace-orders" &&
      request.method === "POST"
    ) {
      const actor = await requirePermission(request, env, permissions.integrationsOrdersManage);
      const input = await readJson<{ connectionId?: string }>(request);
      if (!input.connectionId) throw new SerametHttpError(400, "connectionId is required");
      return json({
        ok: true,
        ...(await createIntegrationRuntime(env).recoverActiveOrders(
          actor.tenantId,
          input.connectionId,
        )),
      });
    }

    const connectionTestRoute = /^\/api\/seramet\/integrations\/connections\/([^/]+)\/test$/.exec(
      url.pathname,
    );
    if (connectionTestRoute && request.method === "POST") {
      const actor = await requireIntegrationManager(request, env);
      const health = await createIntegrationRuntime(env).testConnection(
        actor.tenantId,
        decodeURIComponent(connectionTestRoute[1]!),
      );
      return json({ ok: true, health });
    }

    const replayRoute = /^\/api\/seramet\/integrations\/events\/([^/]+)\/replay$/.exec(
      url.pathname,
    );
    if (replayRoute && request.method === "POST") {
      const actor = await requireIntegrationManager(request, env);
      const replay = await createIntegrationRuntime(env).replayEvent(
        actor.tenantId,
        decodeURIComponent(replayRoute[1]!),
        actor.id,
      );
      return json({ ok: true, replay }, 202);
    }

    if (url.pathname === "/api/seramet/integrations/mappings" && request.method === "POST") {
      const actor = await requireIntegrationManager(request, env);
      const input = await readJson<{
        id?: string;
        branchId?: string;
        connectionId?: string;
        resourceType?: import("@/integrations/runtime/models").ExternalResourceType;
        internalId?: string;
        externalId?: string;
        externalParentId?: string;
        status?: import("@/integrations/runtime/models").ExternalMappingStatus;
        metadata?: Record<string, unknown>;
      }>(request);
      if (!input.connectionId || !input.resourceType || !input.internalId || !input.externalId)
        throw new SerametHttpError(
          400,
          "connectionId, resourceType, internalId and externalId are required",
        );
      const mapping = await createIntegrationRuntime(env).upsertMapping(actor.tenantId, {
        ...input,
        connectionId: input.connectionId,
        resourceType: input.resourceType,
        internalId: input.internalId,
        externalId: input.externalId,
        status: input.status ?? "MAPPED",
        metadata: input.metadata ?? {},
      });
      return json({ ok: true, mapping });
    }

    const mappingRoute = /^\/api\/seramet\/integrations\/mappings\/([^/]+)$/.exec(url.pathname);
    if (mappingRoute && request.method === "DELETE") {
      const actor = await requireIntegrationManager(request, env);
      await createIntegrationRuntime(env).unmap(
        actor.tenantId,
        decodeURIComponent(mappingRoute[1]!),
      );
      return json({ ok: true });
    }

    const legacyWebhook = resolveLegacyWebhookAlias(url.pathname);
    if (legacyWebhook && request.method === "POST") {
      return legacyWebhook.mode === "ADAPTER"
        ? await receiveConfiguredWebhook(request, env, repo, legacyWebhook.providerCode)
        : await receiveExternalPaymentWebhook(
            request,
            resolveLegacyWebhookSecret(legacyWebhook, env),
            legacyWebhook.providerCode,
            repo,
          );
    }

    return json({ ok: false, message: "Seramet API route not found" }, 404);
  } catch (error) {
    if (error instanceof SerametHttpError)
      return json({ ok: false, message: error.message }, error.status);
    if (error instanceof IntegrationError)
      return json(
        { ok: false, code: error.code, message: error.message, retryable: error.retryable },
        error.statusCode,
      );
    if (error instanceof ServerOperationError) {
      const result = publicError(
        error,
        request.headers.get("x-correlation-id") ?? error.correlationId ?? crypto.randomUUID(),
      );
      return json(result.body, result.status);
    }
    console.error(error);
    return json({ ok: false, message: "Seramet API failure" }, 500);
  }
}

async function receiveIntegrationWebhook(
  request: Request,
  env: SerametEnv,
  providerCode: string,
  connectionId: string,
) {
  const configuration = getConfigurationRepository();
  const candidates = configuration.listTenants().flatMap((tenant) =>
    configuration
      .listConnections(tenant.id)
      .filter((connection) => connection.id === connectionId)
      .map((connection) => ({ tenant, connection })),
  );
  if (candidates.length !== 1)
    throw new SerametHttpError(404, "Integration connection was not found");
  const tenantId = candidates[0]!.tenant.id;
  const assertedTenant = request.headers.get("x-seramet-tenant-id")?.trim();
  if (assertedTenant && assertedTenant !== tenantId)
    throw new SerametHttpError(403, "Webhook tenant does not match its connection");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) throw new SerametHttpError(413, "Webhook body is too large");
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const result = await createIntegrationRuntime(env).handleWebhook({
    tenantId,
    providerCode,
    connectionId,
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
  });
  return json({ ok: true, ...result }, 200);
}

async function requireIntegrationManager(request: Request, env: SerametEnv) {
  const actor = await authenticateSerametRequest(request, env);
  if (
    !actor.permissions.includes(permissions.settingsIntegrationManage) &&
    !actor.permissions.includes(permissions.auditView)
  ) {
    throw new SerametHttpError(403, "Integration management permission is required");
  }
  return actor;
}

async function requirePermission(
  request: Request,
  env: SerametEnv,
  permission: import("@/platform/types").PermissionCode,
) {
  const actor = await authenticateSerametRequest(request, env);
  if (!actor.permissions.includes(permission)) {
    throw new SerametHttpError(403, `${permission} permission is required`);
  }
  return actor;
}

async function requireAnyPermission(
  request: Request,
  env: SerametEnv,
  allowed: import("@/platform/types").PermissionCode[],
) {
  const actor = await authenticateSerametRequest(request, env);
  if (!allowed.some((permission) => actor.permissions.includes(permission))) {
    throw new SerametHttpError(403, "The required integration permission is missing");
  }
  return actor;
}

async function getOperationalMenuCatalog(request: Request, env: SerametEnv) {
  const actor = await requirePermission(request, env, permissions.ordersCreate);
  if (!env.SERAMET_DB) {
    throw new SerametHttpError(503, "Authoritative menu database unavailable");
  }
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId")?.trim() || actor.branchId;
  authorizeBranchRead(actor, actor.tenantId, branchId);
  const rows = await env.SERAMET_DB.prepare(
    `SELECT m.id,m.code,m.sku,m.name,m.category_code,m.description,m.selling_price_minor,
            m.currency,m.tax_rule_id,m.service_charge_applicable,m.station_id,
            s.code AS station_code,m.sellable,
            COALESCE(bs.selling_price_minor,m.selling_price_minor) AS effective_price_minor,
            COALESCE(bs.available,m.sellable) AS available
     FROM menu_catalog_items m
     LEFT JOIN stations s ON s.tenant_id=m.tenant_id AND s.id=m.station_id
     LEFT JOIN menu_item_branch_settings bs ON bs.tenant_id=m.tenant_id
       AND bs.menu_item_id=m.id AND bs.branch_id=?
     WHERE m.tenant_id=? AND m.active=1 AND m.sellable=1
     ORDER BY m.category_code,m.name LIMIT 5000`,
  )
    .bind(branchId, actor.tenantId)
    .all();
  const rules = await env.SERAMET_DB.prepare(
    `SELECT id,code,rule_type,rate_bps,calculation_mode
     FROM tax_service_rules
     WHERE tenant_id=? AND active=1 AND (branch_id=? OR branch_id IS NULL)
       AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)
     ORDER BY CASE WHEN branch_id=? THEN 0 ELSE 1 END,id`,
  )
    .bind(actor.tenantId, branchId, new Date().toISOString(), new Date().toISOString(), branchId)
    .all();
  return json({ ok: true, branchId, items: rows.results ?? [], pricingRules: rules.results ?? [] });
}

async function getTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = await authenticateSerametRequest(request, env);
  const state = await repo.loadState(actor.tenantId);
  const branchId = new URL(request.url).searchParams.get("branchId") ?? actor.branchId;
  authorizeBranchRead(actor, actor.tenantId, branchId);
  return json({
    ok: true,
    state: filterStateForActor(state, actor),
    revision: await repo.revision(actor.tenantId),
  });
}

async function replaceTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = await authenticateSerametRequest(request, env);
  const body = await readJson<SnapshotReplaceRequest>(request);
  assertKnownFields(body, ["state", "idempotencyKey"]);
  if (!body.state) throw new SerametHttpError(400, "Missing transaction state");
  authorizeSerametMutation(actor, "replaceState");
  const current = await repo.loadState(actor.tenantId);
  if (body.state.tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant snapshot replace denied");
  }
  assertBranchSafeSnapshotReplace(current, body.state, actor);
  const stateToSave = mergeSnapshotForActor(current, body.state, actor);

  const requestHash = await hashJson(body.state);
  const idempotencyKey = body.idempotencyKey ?? request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const cached = await loadCachedIdempotency(repo, actor.tenantId, idempotencyKey, requestHash);
    if (cached) return cached;
  }

  await repo.saveState(stateToSave, actor, "Snapshot replace through Seramet API");
  await createIntegrationRuntime(env).captureTransactionDomainEvents(current, stateToSave);
  const response = { ok: true, state: filterStateForActor(stateToSave, actor) };
  if (idempotencyKey)
    await saveIdempotency(repo, idempotencyKey, actor, "replaceState", requestHash, response);
  return json(response);
}

async function mutateTransactions(request: Request, env: SerametEnv, repo: TransactionRepository) {
  const actor = await authenticateSerametRequest(request, env);
  const body = await readJson<MutationRequest>(request);
  assertKnownFields(body, ["action", "payload", "idempotencyKey"]);
  if (!body.action) throw new SerametHttpError(400, "Missing transaction action");
  if (!body.idempotencyKey)
    throw new SerametHttpError(400, "Production mutations require an idempotencyKey");
  if (["requestRefund", "approveRefund"].includes(body.action)) {
    await consumeRateLimit(env, `${actor.tenantId}:${actor.id}`, sensitiveRateLimits.refund);
  }
  const current = await repo.loadState(actor.tenantId);
  const branches = branchesForAction(current, body.action, body.payload);
  branches.forEach((branchId) =>
    authorizeSerametMutation(actor, body.action!, actor.tenantId, branchId),
  );
  if (branches.length === 0) authorizeSerametMutation(actor, body.action);

  const requestHash = await hashJson({ action: body.action, payload: body.payload });
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const result = await repo.commitMutation({
    actor,
    action: body.action,
    payload: body.payload,
    idempotencyKey: body.idempotencyKey,
    requestHash,
    correlationId,
    ...(actor.deviceId ? { deviceId: actor.deviceId } : {}),
  });
  assertBranchSafeSnapshotReplace(current, result.state, actor);
  if (!result.duplicate) {
    await createIntegrationRuntime(env).captureTransactionDomainEvents(current, result.state);
    if (env.SERAMET_DB && env.SERAMET_WORK_QUEUE) {
      await Promise.all(
        (branches.length ? branches : [actor.branchId]).map((branchId) =>
          enqueueManagementRecalculation(env, {
            tenantId: actor.tenantId,
            branchId,
            idempotencyKey: `transaction-management:${body.idempotencyKey}:${branchId}`,
            correlationId,
          }),
        ),
      );
    }
    if (env.SERAMET_DB) {
      await Promise.all(
        (branches.length ? branches : [actor.branchId]).map((branchId) =>
          publishRealtimeEvent(env.SERAMET_DB!, {
            tenantId: actor.tenantId,
            branchId,
            topic: "transactions",
            entityType: "TRANSACTION_COMMAND",
            entityId: body.idempotencyKey!,
            eventType: body.action!,
            correlationId,
          }).catch((error) => console.error("Real-time event publication failed", error)),
        ),
      );
    }
  }
  return json(
    {
      ok: true,
      state: filterStateForActor(result.state, actor),
      revision: result.revision,
      duplicate: result.duplicate,
    },
    200,
    result.duplicate ? { "x-seramet-idempotent-replay": "true" } : undefined,
  );
}

async function createMpesaStk(request: Request, env: SerametEnv, repo: TransactionRepository) {
  return createConfiguredProviderPayment(request, env, repo, "MPESA_PROMPT", "PAYMENT_PROMPT");
}

async function createMpesaQr(request: Request, env: SerametEnv, repo: TransactionRepository) {
  return createConfiguredProviderPayment(request, env, repo, "MPESA_QR", "QR_PAYMENT");
}

async function createConfiguredProviderPayment(
  request: Request,
  env: SerametEnv,
  repo: TransactionRepository,
  paymentMethodIdOrCode: string,
  capability: Extract<ProviderCapability, "PAYMENT_PROMPT" | "QR_PAYMENT">,
) {
  const actor = await authenticateSerametRequest(request, env);
  await consumeRateLimit(
    env,
    `${actor.tenantId}:${actor.id}`,
    sensitiveRateLimits.paymentInitiation,
  );
  const body = await readJson<{
    invoiceId?: string;
    amount?: number;
    customerPhone?: string;
    idempotencyKey?: string;
  }>(request);
  if (!body.invoiceId || !body.amount || !body.idempotencyKey) {
    throw new SerametHttpError(400, "invoiceId, amount and idempotencyKey are required");
  }
  if (capability === "PAYMENT_PROMPT" && !body.customerPhone) {
    throw new SerametHttpError(400, "customerPhone is required for a payment prompt");
  }
  const current = await repo.loadState(actor.tenantId);
  const bill = current.bills.find((item) => item.id === body.invoiceId);
  if (!bill) throw new SerametHttpError(404, "Invoice not found");
  authorizeSerametMutation(
    actor,
    "createPaymentIntent",
    bill.tenantId ?? actor.tenantId,
    bill.branchId ?? actor.branchId,
  );
  const requestHash = await hashJson(body);
  const cached = await loadCachedIdempotency(
    repo,
    actor.tenantId,
    body.idempotencyKey,
    requestHash,
  );
  if (cached) return cached;

  const tenant = getConfigurationRepository().getTenant(actor.tenantId);
  const result = await createIntegrationRuntime(env, { transactions: repo }).initiatePayment({
    tenantId: actor.tenantId,
    branchId: bill.branchId ?? actor.branchId,
    invoiceId: bill.id,
    paymentMethodId: paymentMethodIdOrCode,
    amountMinor: parseMajorAmount(body.amount, tenant.defaultCurrency),
    currency: tenant.defaultCurrency,
    actor: actor.name,
    idempotencyKey: body.idempotencyKey,
    operation: capability,
    ...(body.customerPhone ? { customerPhone: body.customerPhone } : {}),
  });
  const next = await repo.loadState(actor.tenantId);
  const response = {
    ok: !result.provider || result.provider.ok,
    provider: result.provider,
    intent: result.intent,
    state: filterStateForActor(next, actor),
  };
  await saveIdempotency(
    repo,
    body.idempotencyKey,
    actor,
    `provider-${capability.toLowerCase()}`,
    requestHash,
    response,
  );
  return json(response, response.ok ? 200 : 424);
}

async function receiveConfiguredWebhook(
  request: Request,
  env: SerametEnv,
  repo: TransactionRepository,
  connectionIdOrProviderCode: string,
) {
  const tenantId = webhookTenantId(request);
  const configuration = getConfigurationRepository();
  const providerDefinition = configuration
    .listProviders()
    .find((provider) => provider.code === connectionIdOrProviderCode);
  const connection = configuration
    .listConnections(tenantId)
    .find(
      (candidate) =>
        candidate.id === connectionIdOrProviderCode ||
        candidate.providerId === providerDefinition?.id,
    );
  if (!connection) throw new SerametHttpError(409, "Provider connection incomplete");
  const definition = configuration
    .listProviders()
    .find((provider) => provider.id === connection.providerId);
  if (!definition) throw new SerametHttpError(409, "Provider definition was not found");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_048_576) throw new SerametHttpError(413, "Webhook body is too large");
  const rawBody = new Uint8Array(await request.arrayBuffer());
  const result = await createIntegrationRuntime(env, { transactions: repo }).handleWebhook({
    tenantId,
    providerCode: definition.code,
    connectionId: connection.id,
    rawBody,
    headers: Object.fromEntries(request.headers.entries()),
  });
  return json({ ok: true, ...result });
}

async function receiveExternalPaymentWebhook(
  request: Request,
  secret: string | undefined,
  providerCode: string,
  repo: TransactionRepository,
) {
  assertSharedSecret(request, secret, "Configured provider");
  const tenantId = webhookTenantId(request);
  const configuration = getConfigurationRepository();
  const definition = configuration
    .listProviders()
    .find((provider) => provider.code === providerCode);
  const connection = definition
    ? configuration
        .listConnections(tenantId)
        .find(
          (candidate) =>
            candidate.providerId === definition.id &&
            (candidate.status === "ACTIVE" || candidate.status === "SANDBOX"),
        )
    : undefined;
  if (!definition || !connection) {
    throw new SerametHttpError(409, "Provider connection incomplete");
  }
  const provider = connection.displayName;
  const payload = await readJson<{
    reference?: string;
    amount?: number;
    branch?: string;
    account?: string;
    status?: string;
    description?: string;
    metadata?: Record<string, string>;
  }>(request);
  if (!payload.reference || !payload.amount)
    throw new SerametHttpError(400, "reference and amount are required");
  await repo.appendProviderEvent({
    id: `${connection.id}-${payload.reference}`,
    tenantId,
    provider,
    eventType: "TRANSACTION",
    externalReference: payload.reference,
    payloadJson: JSON.stringify(payload),
    receivedAt: new Date().toISOString(),
    processed: payload.status === "success" || payload.status === "settled",
  });
  const current = await repo.loadState(tenantId);
  const branch = payload.branch ? configuration.resolveBranch(tenantId, payload.branch) : undefined;
  const next = TransactionEngine.importExternalTransaction(current, {
    tenantId,
    ...(branch ? { branchId: branch.id, branch: branch.name } : {}),
    provider,
    sourceAccount: payload.account ?? provider,
    destination: String(connection.configuration["destinationAccount"] ?? "Operating account"),
    amount: payload.amount,
    direction: "INBOUND",
    currency: configuration.getTenant(tenantId).defaultCurrency,
    reference: payload.reference,
    timestamp: new Date().toISOString(),
    description: payload.description ?? `${provider} transaction`,
    providerMetadata: payload.metadata ?? {},
  });
  await repo.saveState(
    next,
    systemActorForTenant(tenantId),
    `Imported ${provider} webhook transaction`,
  );
  return json({ ok: true, state: next });
}

function normalizedWebhookResult(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new SerametHttpError(400, "Provider returned an invalid webhook result");
  }
  const record = value as Record<string, unknown>;
  const reference = typeof record["reference"] === "string" ? record["reference"] : "";
  const eventType = typeof record["eventType"] === "string" ? record["eventType"] : "PAYMENT";
  const status = typeof record["status"] === "string" ? record["status"] : "PENDING";
  if (!reference) throw new SerametHttpError(400, "Provider webhook reference is missing");
  const intentReference =
    typeof record["intentReference"] === "string" ? record["intentReference"] : undefined;
  return {
    reference,
    eventType,
    status,
    ...(intentReference ? { intentReference } : {}),
  };
}

function branchesForAction(state: TransactionState, action: string, payload: unknown) {
  const input = payload as Record<string, unknown> | undefined;
  const branches = new Set<string>();
  if (!input) return [];
  const draft = input["draft"] as { branch?: string } | undefined;
  const nestedInput = input["input"] as
    { branch?: string; invoiceId?: string; orderId?: string } | undefined;
  if (draft?.branch) branches.add(draft.branch);
  if (nestedInput?.branch) branches.add(nestedInput.branch);
  const invoiceId = String(input["invoiceId"] ?? "");
  const orderId = String(input["orderId"] ?? "");
  const billId = String(input["billId"] ?? "");
  const refundId = String(input["refundId"] ?? "");
  const drawerId = String(input["drawerId"] ?? "");
  const externalTransactionId = String(input["externalTransactionId"] ?? "");
  const paymentId = String(input["paymentId"] ?? "");
  const purchaseOrderId = String(input["purchaseOrderId"] ?? "");
  const wastageId = String(input["wastageId"] ?? "");
  const breakageId = String(input["breakageId"] ?? "");
  const employeeId = String(input["employeeId"] ?? "");
  if (typeof input["branch"] === "string") branches.add(input["branch"]);
  if (invoiceId) addBranch(branches, state.bills.find((item) => item.id === invoiceId)?.branch);
  if (billId) addBranch(branches, state.bills.find((item) => item.id === billId)?.branch);
  if (orderId) addBranch(branches, state.orders.find((item) => item.id === orderId)?.branch);
  if (refundId) addBranch(branches, state.refunds.find((item) => item.id === refundId)?.branch);
  if (drawerId) addBranch(branches, state.cashDrawers.find((item) => item.id === drawerId)?.branch);
  if (externalTransactionId)
    addBranch(
      branches,
      state.externalTransactions.find((item) => item.id === externalTransactionId)?.branch,
    );
  if (paymentId) addBranch(branches, state.payments.find((item) => item.id === paymentId)?.branch);
  if (purchaseOrderId)
    addBranch(branches, state.purchaseOrders.find((item) => item.id === purchaseOrderId)?.branch);
  if (wastageId)
    addBranch(branches, state.wastageRecords.find((item) => item.id === wastageId)?.branch);
  if (breakageId)
    addBranch(branches, state.breakageRecords.find((item) => item.id === breakageId)?.branch);
  if (employeeId)
    addBranch(branches, state.employees.find((item) => item.id === employeeId)?.branch);
  if (nestedInput?.invoiceId)
    addBranch(branches, state.bills.find((item) => item.id === nestedInput.invoiceId)?.branch);
  if (nestedInput?.orderId)
    addBranch(branches, state.orders.find((item) => item.id === nestedInput.orderId)?.branch);
  (input["billIds"] as string[] | undefined)?.forEach((id) =>
    addBranch(branches, state.bills.find((item) => item.id === id)?.branch),
  );
  if (action === "replaceState") return [];
  const tenantId = state.tenantId;
  if (!tenantId) throw new SerametHttpError(409, "Transaction state has no tenant scope");
  return [...branches].map(
    (branchReference) => getConfigurationRepository().resolveBranch(tenantId, branchReference).id,
  );
}

function addBranch(branches: Set<string>, branch?: string) {
  if (branch) branches.add(branch);
}

function assertBranchSafeSnapshotReplace(
  current: TransactionState,
  next: TransactionState,
  actor: ServerActor,
) {
  if (next.tenantId !== actor.tenantId || current.tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant snapshot access denied");
  }
  if (
    actor.branchScope.type === "ALL" &&
    actor.permissions.includes(permissions.tenantScopeAllBranches)
  )
    return;
  const touchedOutsideBranch = (
    rows: { tenantId?: string; branchId?: string; branch?: string }[],
  ) =>
    rows.some(
      (row) =>
        row.tenantId !== undefined &&
        (row.tenantId !== actor.tenantId ||
          (row.branchId !== undefined && row.branchId !== actor.branchId)),
    );
  const directRows = [
    ...next.orders,
    ...next.bills,
    ...next.paymentIntents,
    ...next.payments,
    ...next.receipts,
    ...next.externalTransactions,
    ...next.journalEntries,
    ...next.cashDrawers,
    ...next.refunds,
    ...next.marketplaceReceivables,
    ...next.marketplaceCharges,
    ...next.productionAmendments,
    ...next.auditEvents,
    ...next.inventory,
    ...next.stockMovements,
    ...next.purchaseOrders,
    ...next.wastageRecords,
    ...next.breakageRecords,
    ...next.employees,
    ...next.attendanceRecords,
    ...paymentOperationRows(next.paymentOperations),
  ];
  if (directRows.length > 0 && touchedOutsideBranch(directRows)) {
    const before = JSON.stringify(branchRestrictedSnapshot(current, actor, false));
    const after = JSON.stringify(branchRestrictedSnapshot(next, actor, false));
    if (before !== after)
      throw new SerametHttpError(403, `Actor cannot change records outside ${actor.branch}`);
  }
}

function mergeSnapshotForActor(
  current: TransactionState,
  next: TransactionState,
  actor: ServerActor,
): TransactionState {
  if (next.tenantId !== actor.tenantId || current.tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant snapshot access denied");
  }
  if (
    actor.branchScope.type === "ALL" &&
    actor.permissions.includes(permissions.tenantScopeAllBranches)
  )
    return next;
  const merge = <T extends { branchId?: string }>(currentRows: T[], nextRows: T[]) => [
    ...nextRows.filter((row) => row.branchId === actor.branchId || row.branchId === undefined),
    ...currentRows.filter((row) => row.branchId !== actor.branchId && row.branchId !== undefined),
  ];
  return {
    ...next,
    orders: merge(current.orders, next.orders),
    bills: merge(current.bills, next.bills),
    paymentIntents: merge(current.paymentIntents, next.paymentIntents),
    payments: merge(current.payments, next.payments),
    receipts: merge(current.receipts, next.receipts),
    externalTransactions: merge(current.externalTransactions, next.externalTransactions),
    reconciliationMatches: current.reconciliationMatches,
    journalEntries: merge(current.journalEntries, next.journalEntries),
    cashDrawers: merge(current.cashDrawers, next.cashDrawers),
    refunds: merge(current.refunds, next.refunds),
    marketplaceReceivables: merge(current.marketplaceReceivables, next.marketplaceReceivables),
    marketplaceCharges: merge(current.marketplaceCharges, next.marketplaceCharges),
    productionAmendments: merge(current.productionAmendments, next.productionAmendments),
    auditEvents: merge(current.auditEvents, next.auditEvents),
    inventory: merge(current.inventory, next.inventory),
    recipes: next.recipes,
    stockMovements: merge(current.stockMovements, next.stockMovements),
    purchaseOrders: merge(current.purchaseOrders, next.purchaseOrders),
    wastageRecords: merge(current.wastageRecords, next.wastageRecords),
    breakageRecords: merge(current.breakageRecords, next.breakageRecords),
    employees: merge(current.employees, next.employees),
    attendanceRecords: merge(current.attendanceRecords, next.attendanceRecords),
    paymentOperations: mergePaymentOperations(
      current.paymentOperations,
      next.paymentOperations,
      actor,
    ),
  };
}

function branchRestrictedSnapshot(
  state: TransactionState,
  actor: ServerActor,
  includeBranch: boolean,
): TransactionState {
  const keep = <T extends { tenantId?: string; branchId?: string }>(rows: T[]) =>
    rows.filter((row) =>
      includeBranch
        ? row.tenantId === actor.tenantId &&
          (row.branchId === actor.branchId || row.branchId === undefined)
        : row.tenantId !== actor.tenantId ||
          (row.branchId !== actor.branchId && row.branchId !== undefined),
    );
  return {
    ...state,
    orders: keep(state.orders),
    bills: keep(state.bills),
    paymentIntents: keep(state.paymentIntents),
    payments: keep(state.payments),
    receipts: keep(state.receipts),
    externalTransactions: keep(state.externalTransactions),
    reconciliationMatches: state.reconciliationMatches,
    journalEntries: keep(state.journalEntries),
    cashDrawers: keep(state.cashDrawers),
    refunds: keep(state.refunds),
    marketplaceReceivables: keep(state.marketplaceReceivables),
    marketplaceCharges: keep(state.marketplaceCharges),
    productionAmendments: keep(state.productionAmendments),
    auditEvents: keep(state.auditEvents),
    inventory: keep(state.inventory),
    recipes: state.recipes,
    stockMovements: keep(state.stockMovements),
    purchaseOrders: keep(state.purchaseOrders),
    wastageRecords: keep(state.wastageRecords),
    breakageRecords: keep(state.breakageRecords),
    employees: keep(state.employees),
    attendanceRecords: keep(state.attendanceRecords),
    paymentOperations: filterPaymentOperations(state.paymentOperations, actor, includeBranch),
  };
}

function paymentOperationRows(operations?: PaymentOperationsState) {
  if (!operations) return [];
  return Object.values(operations).flatMap((value) =>
    Array.isArray(value) ? (value as Array<{ tenantId?: string; branchId?: string }>) : [],
  );
}

function filterPaymentOperations(
  operations: PaymentOperationsState | undefined,
  actor: ServerActor,
  includeBranch: boolean,
) {
  if (!operations) return emptyPaymentOperationsState();
  const keep = <T extends { tenantId: string; branchId?: string }>(rows: T[]) =>
    rows.filter((row) =>
      includeBranch
        ? row.tenantId === actor.tenantId &&
          (row.branchId === actor.branchId || row.branchId === undefined)
        : row.tenantId !== actor.tenantId ||
          (row.branchId !== actor.branchId && row.branchId !== undefined),
    );
  const settlementBatches = keep(operations.settlementBatches);
  const settlementIds = new Set(settlementBatches.map((batch) => batch.id));
  return {
    ...operations,
    accounts: keep(operations.accounts),
    intents: keep(operations.intents),
    transactions: keep(operations.transactions),
    allocations: keep(operations.allocations),
    collections: keep(operations.collections),
    drawerSessions: keep(operations.drawerSessions),
    cashMovements: keep(operations.cashMovements),
    bankTransactions: keep(operations.bankTransactions),
    settlementBatches,
    settlementLines: operations.settlementLines.filter(
      (line) => line.tenantId === actor.tenantId && settlementIds.has(line.settlementBatchId),
    ),
    reconciliationSessions: keep(operations.reconciliationSessions),
    matches: keep(operations.matches),
    exceptions: keep(operations.exceptions),
    refunds: keep(operations.refunds),
    disputes: keep(operations.disputes),
    journals: keep(operations.journals),
    dayCloses: keep(operations.dayCloses),
    storedValueAccounts: operations.storedValueAccounts.filter(
      (account) => account.tenantId === actor.tenantId,
    ),
    customerAccounts: operations.customerAccounts.filter(
      (account) => account.tenantId === actor.tenantId,
    ),
    customerAccountEntries: keep(operations.customerAccountEntries),
    auditEvents: keep(operations.auditEvents),
    fraudFlags: keep(operations.fraudFlags),
  };
}

function mergePaymentOperations(
  current: PaymentOperationsState | undefined,
  next: PaymentOperationsState | undefined,
  actor: ServerActor,
) {
  if (!current) return next ?? emptyPaymentOperationsState();
  if (!next) return current;
  const merge = <T extends { branchId?: string }>(currentRows: T[], nextRows: T[]) => [
    ...nextRows.filter((row) => row.branchId === actor.branchId || row.branchId === undefined),
    ...currentRows.filter((row) => row.branchId !== actor.branchId && row.branchId !== undefined),
  ];
  const settlementBatches = merge(current.settlementBatches, next.settlementBatches);
  const currentProtectedSettlementIds = new Set(
    current.settlementBatches
      .filter((batch) => batch.branchId && batch.branchId !== actor.branchId)
      .map((batch) => batch.id),
  );
  return {
    ...next,
    accounts: merge(current.accounts, next.accounts),
    intents: merge(current.intents, next.intents),
    transactions: merge(current.transactions, next.transactions),
    allocations: merge(current.allocations, next.allocations),
    collections: merge(current.collections, next.collections),
    drawerSessions: merge(current.drawerSessions, next.drawerSessions),
    cashMovements: merge(current.cashMovements, next.cashMovements),
    bankTransactions: merge(current.bankTransactions, next.bankTransactions),
    settlementBatches,
    settlementLines: [
      ...next.settlementLines.filter(
        (line) => !currentProtectedSettlementIds.has(line.settlementBatchId),
      ),
      ...current.settlementLines.filter((line) =>
        currentProtectedSettlementIds.has(line.settlementBatchId),
      ),
    ],
    reconciliationSessions: merge(current.reconciliationSessions, next.reconciliationSessions),
    matches: merge(current.matches, next.matches),
    exceptions: merge(current.exceptions, next.exceptions),
    refunds: merge(current.refunds, next.refunds),
    disputes: merge(current.disputes, next.disputes),
    journals: merge(current.journals, next.journals),
    dayCloses: merge(current.dayCloses, next.dayCloses),
    storedValueAccounts: next.storedValueAccounts,
    customerAccounts: next.customerAccounts,
    customerAccountEntries: merge(current.customerAccountEntries, next.customerAccountEntries),
    auditEvents: merge(current.auditEvents, next.auditEvents),
    fraudFlags: merge(current.fraudFlags, next.fraudFlags),
  };
}

function filterStateForActor(state: TransactionState, actor: ServerActor): TransactionState {
  if (state.tenantId !== actor.tenantId) {
    throw new SerametHttpError(403, "Cross-tenant read denied");
  }
  if (
    actor.branchScope.type === "ALL" &&
    actor.permissions.includes(permissions.tenantScopeAllBranches)
  )
    return state;
  return branchRestrictedSnapshot(state, actor, true);
}

async function loadCachedIdempotency(
  repo: TransactionRepository,
  tenantId: string,
  key: string,
  requestHash: string,
) {
  const cached = await repo.getIdempotency(tenantId, key);
  if (!cached) return null;
  if (cached.requestHash !== requestHash)
    throw new SerametHttpError(409, "Idempotency key reused with a different request");
  return json(JSON.parse(cached.responseJson), 200, { "x-seramet-idempotent-replay": "true" });
}

async function saveIdempotency(
  repo: TransactionRepository,
  key: string,
  actor: ServerActor,
  action: string,
  requestHash: string,
  response: unknown,
) {
  await repo.saveIdempotency({
    tenantId: actor.tenantId,
    key,
    actorId: actor.id,
    action,
    requestHash,
    responseJson: JSON.stringify(response),
    createdAt: new Date().toISOString(),
  });
}

function webhookTenantId(request: Request) {
  const tenantId = request.headers.get("x-seramet-tenant-id")?.trim();
  if (!tenantId && request.headers.get("x-seramet-dev-auth") === "enabled") {
    return getConfigurationRepository().listTenants()[0]?.id ?? LOCAL_PILOT_TENANT_ID;
  }
  if (!tenantId) throw new SerametHttpError(400, "x-seramet-tenant-id is required");
  getConfigurationRepository().getTenant(tenantId);
  return tenantId;
}

function systemActorForTenant(tenantId: string): ServerActor {
  const repository = getConfigurationRepository();
  const assignedBranches = repository
    .listBranches(tenantId)
    .map((branch) => ({ id: branch.id, name: branch.name }));
  const branchIds = assignedBranches.map((branch) => branch.id);
  const branchId = branchIds[0];
  if (!branchId) throw new SerametHttpError(409, "No active branch is configured");
  return {
    id: "provider-webhook",
    name: "Provider Webhook",
    tenantId,
    roleIds: ["system-provider-webhook"],
    permissions: [...allPermissionCodes, permissions.tenantScopeAllBranches],
    assignedBranchIds: branchIds,
    assignedBranches,
    branchScope: { type: "ALL" },
    branchId,
    role: "System integration",
    branch: repository.getBranch(tenantId, branchId).name,
  };
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (declaredLength > 1_048_576) throw new SerametHttpError(413, "Request body is too large");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 1_048_576) {
      throw new SerametHttpError(413, "Request body is too large");
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SerametHttpError) throw error;
    throw new SerametHttpError(400, "Request body must be valid JSON");
  }
}

function assertKnownFields(body: unknown, allowed: string[]) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SerametHttpError(400, "Request body must be an object");
  }
  const record = body as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new SerametHttpError(400, `Unknown fields: ${unknown.join(", ")}`);
}

async function hashJson(value: unknown) {
  const text = JSON.stringify(value);
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeRateLimit(
  env: SerametEnv,
  scope: string,
  policy: (typeof sensitiveRateLimits)[keyof typeof sensitiveRateLimits],
) {
  if (!env.SERAMET_DB) return;
  await new DatabaseRateLimiter(env.SERAMET_DB).consume(scope, policy);
}

function assertSharedSecret(request: Request, secret: string | undefined, provider: string) {
  if (!secret) return;
  if (request.headers.get("x-seramet-webhook-secret") !== secret) {
    throw new SerametHttpError(401, `Invalid ${provider} webhook secret`);
  }
}

function providerMode() {
  return getProviderRegistry()
    .list()
    .map((adapter) => ({
      id: adapter.definition.id,
      name: adapter.definition.displayName,
      capabilities: adapter.definition.capabilities,
    }));
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

async function assertCurrentSchema(database: NonNullable<SerametEnv["SERAMET_DB"]>) {
  const row = await database
    .prepare("SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations")
    .first<{ version: number }>();
  if (Number(row?.version ?? 0) !== CURRENT_SCHEMA_VERSION) {
    throw new ServerOperationError(
      "DATABASE_UNAVAILABLE",
      503,
      `Database schema ${Number(row?.version ?? 0)} does not match required schema ${CURRENT_SCHEMA_VERSION}`,
    );
  }
}
