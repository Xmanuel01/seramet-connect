// Isolated interactive fixture. Never imported by the application or deployment entry point.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { createLocalDevelopmentDatabase } from "../src/server/database/local-development-database";
import { hydrateTenantConfiguration } from "../src/server/database/authoritative-configuration";
import { createTransactionRepository } from "../src/server/database/create-transaction-repository";
import { createIntegrationRepository } from "../src/integrations/runtime/integration-repository";
import { createIntegrationRuntime } from "../src/integrations/runtime/create-runtime";
import { StaticCredentialResolver } from "../src/integrations/runtime/credential-resolver";
import { ProviderRegistry } from "../src/integrations/provider-registry";
import {
  createTestDeliveryAdapter,
  type TestDeliveryControls,
} from "../src/integrations/delivery/test-delivery-provider";
import { allPermissionCodes } from "../src/platform/permissions";
import type { IntegrationConnection, OrderChannelDefinition } from "../src/platform/types";
import type { NormalizedExternalOrder } from "../src/integrations/types";
import type { ServerActor } from "../src/lib/seramet-auth";

if (process.env.SERAMET_LOCAL_MARKETPLACE_PREVIEW !== "true")
  throw new Error("Explicit local preview opt-in required");
if (
  Object.keys(process.env).some(
    (name) => /DATABASE_URL|HYPERDRIVE|UBER.*SECRET|GLOVO.*SECRET/.test(name) && process.env[name],
  )
)
  throw new Error("Remove remote database/provider settings before starting this local fixture");
const fixture = JSON.parse(readFileSync(resolve(".seramet/e2e-fixture.json"), "utf8")) as {
  tenantId: string;
  userId: string;
  firstBranchId: string;
  menuItemId: string;
};
const { tenantId, userId, firstBranchId: branchId, menuItemId } = fixture;
if (!tenantId.startsWith("e2e-") || !branchId.startsWith("e2e-"))
  throw new Error("Disposable tenant required");
const db = createLocalDevelopmentDatabase({ databasePath: resolve(".seramet/development.sqlite") });
const env = {
  SERAMET_DB: db,
  SERAMET_ENVIRONMENT: "development",
  SERAMET_ENABLE_LOCAL_DATABASE: "true",
} as const;
const actor: ServerActor = {
  id: userId,
  name: "Local preview",
  tenantId,
  role: "Account Owner",
  branchId,
  branch: "Pilot Branch A",
  branchScope: { type: "BRANCH", branchId },
  assignedBranchIds: [branchId],
  assignedBranches: [{ id: branchId, name: "Pilot Branch A" }],
  roleIds: [],
  permissions: allPermissionCodes,
  authLevel: "DEVELOPMENT",
};
const stamp = new Date().toISOString();
const connections: IntegrationConnection[] = [
  ["uber", "provider-delivery-uber-eats", "Uber Eats"],
  ["glovo", "provider-delivery-glovo", "Glovo"],
].map(([slug, providerId, name]) => ({
  id: `local-preview-${slug}`,
  tenantId,
  branchId,
  providerId: providerId!,
  environment: "SANDBOX",
  status: "SANDBOX",
  displayName: `${name} - local simulation`,
  configuration: {
    externalStoreId: `sample-store-${slug}`,
    orderChannelId: `local-channel-${slug}`,
    acceptancePolicy: "MANUAL",
    availabilitySyncEnabled: true,
    storeStatusSyncEnabled: true,
    priceSyncEnabled: true,
    allowScheduledOrders: true,
    fallbackStationId: "MAIN",
    unmappedItemPolicy: "MANAGER_REVIEW",
  },
  secretReference: "secret://local-preview",
  metadata: { localSimulation: true },
  consecutiveFailures: 0,
  createdAt: stamp,
  updatedAt: stamp,
}));
for (const connection of connections) {
  await db
    .prepare(
      "INSERT INTO provider_connections(tenant_id,id,branch_id,provider_id,environment,status,secret_reference,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,id) DO NOTHING",
    )
    .bind(
      tenantId,
      connection.id,
      branchId,
      connection.providerId,
      "SANDBOX",
      "SANDBOX",
      connection.secretReference!,
      JSON.stringify(connection),
      stamp,
      stamp,
    )
    .run();
  const channel: OrderChannelDefinition = {
    id: String(connection.configuration["orderChannelId"]),
    tenantId,
    code: connection.id,
    displayName: connection.displayName,
    channelType: "MARKETPLACE",
    enabled: true,
    deliveryProviderConnectionId: connection.id,
    requiresCustomer: false,
    requiresTable: false,
    requiresAddress: false,
    isExternallyPaid: true,
    sortOrder: 90,
    metadata: {},
  };
  await db
    .prepare(
      "INSERT INTO order_channels(tenant_id,id,code,channel_type,active,payload_json) VALUES(?,?,?,'MARKETPLACE',1,?) ON CONFLICT(tenant_id,id) DO NOTHING",
    )
    .bind(tenantId, channel.id, channel.code, JSON.stringify(channel))
    .run();
}
const configuration = await hydrateTenantConfiguration(db, env, tenantId, true);
const registry = new ProviderRegistry();
const controls: TestDeliveryControls = { ordersById: {} };
for (const connection of connections) {
  const definition = configuration
    .listProviders()
    .find((item) => item.id === connection.providerId)!;
  registry.register({ ...createTestDeliveryAdapter(controls), definition });
}
const repository = createIntegrationRepository(db);
const transactions = createTransactionRepository(db, env);
const runtime = createIntegrationRuntime(env, {
  configuration,
  registry,
  repository,
  transactions,
  credentials: new StaticCredentialResolver({
    "secret://local-preview": { webhookSecret: "local-fixture-only" },
  }),
});
for (const connection of connections) {
  for (const [resourceType, internalId, externalId] of [
    ["STORE", branchId, String(connection.configuration["externalStoreId"])],
    ["ITEM", menuItemId, "sample-dish"],
  ] as const) {
    if (!(await repository.getMapping(tenantId, connection.id, resourceType, externalId)))
      await repository.upsertMapping({
        id: `${connection.id}-${resourceType}`,
        tenantId,
        branchId,
        connectionId: connection.id,
        providerId: connection.providerId,
        resourceType,
        internalId,
        externalId,
        status: "MAPPED",
        metadata: {},
        createdAt: stamp,
        updatedAt: stamp,
      });
  }
}
for (let index = 0; index < 8; index++) {
  const connection = connections[index % 2]!;
  const externalId = `SAMPLE-${index + 1}`;
  const receivedAt = new Date(Date.now() - (index + 1) * 60_000).toISOString();
  const order: NormalizedExternalOrder = {
    providerOrderId: externalId,
    connectionId: connection.id,
    externalStoreId: String(connection.configuration["externalStoreId"]),
    orderType: "DELIVERY",
    createdAt: receivedAt,
    currency: "KES",
    customer: { name: `Sample customer ${index + 1}` },
    delivery: {
      type: "PROVIDER",
      providerManaged: true,
      address: "Local preview only",
      rider: { name: "Sample courier" },
    },
    items: [
      {
        externalItemId: "sample-dish",
        name: "Sample menu dish",
        quantity: 2,
        unitPrice: 500,
        total: 1000,
        modifiers: [],
        notes: "No chilli",
      },
    ],
    pricing: { subtotal: 1000, discounts: 0, taxes: 0, total: 1000 },
    payment: { externallyPaid: true, amountPaid: 1000 },
    ...(index === 7 ? { scheduledFor: new Date(Date.now() + 3_600_000).toISOString() } : {}),
  };
  controls.ordersById![externalId] = order;
  if (await repository.getMapping(tenantId, connection.id, "ORDER", externalId)) continue;
  await runtime.handleWebhook({
    tenantId,
    connectionId: connection.id,
    providerCode: registry.get(connection.providerId).definition.code,
    rawBody: new TextEncoder().encode(
      JSON.stringify({ eventId: externalId, eventType: "ORDER_CREATED", order }),
    ),
    headers: { "x-test-signature": "local-fixture-only" },
  });
  if (index < 2) continue;
  const state = await transactions.loadState(tenantId);
  const local = state.orders.find((item) => item.externalSource?.externalOrderId === externalId)!;
  const queued = await runtime.decideMarketplaceOrder({
    tenantId,
    branchId,
    orderId: local.id,
    actorId: userId,
    decision: index === 6 ? "REJECT" : "ACCEPT",
    prepMinutes: 25,
    reason: "Sample sold-out item",
  });
  await runtime.processOutboxRecord(tenantId, queued.record.id);
  const next = await transactions.loadState(tenantId);
  const saved = next.orders.find((item) => item.id === local.id)!;
  if (index === 2) saved.status = "IN_PROGRESS";
  if (index === 3) saved.status = "READY";
  if (index === 4) saved.externalSource!.pickedUpAt = stamp;
  if (index === 5) saved.externalSource!.completedAt = stamp;
  await transactions.saveState(next, actor, "Local marketplace demonstration");
}

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await runtime.recoverMarketplaceAvailability(tenantId);
    await runtime.recoverMarketplaceStores(tenantId);
    await runtime.recoverMarketplaceEdits(tenantId);
    await runtime.releaseDueScheduledOrders(tenantId);
    await runtime.processDueOutbox(tenantId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local worker failed");
  } finally {
    busy = false;
  }
}, 2000);

createServer(async (request, response) => {
  const send = (status: number, payload: unknown) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(payload));
  };
  if (
    request.headers.host !== "127.0.0.1:4199" ||
    request.headers["sec-fetch-site"] === "cross-site" ||
    (request.headers.origin && request.headers.origin !== "http://127.0.0.1:4197")
  )
    return send(403, { ok: false });
  try {
    const path = new URL(request.url!, "http://127.0.0.1:4199").pathname;
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64_000) throw new Error("Request too large");
      chunks.push(chunk);
    }
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    if (input.connectionId && !connections.some((item) => item.id === input.connectionId))
      throw new Error("Local connection only");
    if (input.connectionIds?.some((id: string) => !connections.some((item) => item.id === id)))
      throw new Error("Local connection only");
    let result: object = {};
    if (path.endsWith("/diagnostics")) result = await runtime.diagnostics(tenantId);
    else if (path.endsWith("/alerts")) result = await runtime.alertSummary(tenantId);
    else if (path.endsWith("/attention")) {
      const state = await transactions.loadState(tenantId);
      result = {
        orders: state.orders
          .filter(
            (item) =>
              item.branchId === branchId &&
              item.status === "HELD" &&
              item.externalSource &&
              !item.externalSource.metadata["acceptanceConfirmedAt"],
          )
          .map((item) => ({ id: item.id, reference: item.externalSource!.externalOrderId })),
      };
    } else if (path.endsWith("/menu-preview")) {
      const id = new URL(request.url!, "http://127.0.0.1").searchParams.get("connectionId")!;
      if (!connections.some((item) => item.id === id)) throw new Error("Local connection only");
      result = await runtime.previewMenuSync(tenantId, id);
    } else if (request.method !== "POST") return send(404, { ok: false });
    else if (path.endsWith("/preview-order")) {
      const source = controls.ordersById!["SAMPLE-1"]!;
      const reference = `CHECK-${crypto.randomUUID().slice(0, 8)}`;
      const sample = {
        ...structuredClone(source),
        providerOrderId: reference,
        createdAt: new Date().toISOString(),
        customer: { name: "Sample walkthrough" },
      };
      controls.ordersById![reference] = sample;
      await runtime.handleWebhook({
        tenantId,
        connectionId: connections[0]!.id,
        providerCode: registry.get(connections[0]!.providerId).definition.code,
        headers: { "x-test-signature": "local-fixture-only" },
        rawBody: new TextEncoder().encode(
          JSON.stringify({ eventId: reference, eventType: "ORDER_CREATED", order: sample }),
        ),
      });
      result = { reference };
    } else if (path.endsWith("/decision"))
      result = {
        queued: await runtime.decideMarketplaceOrder({
          ...input,
          tenantId,
          branchId,
          actorId: userId,
        }),
      };
    else if (path.endsWith("/availability"))
      result = {
        queued: await runtime.queueAvailabilitySync({
          ...input,
          tenantId,
          branchId,
          manual: true,
          actorId: userId,
        }),
      };
    else if (path.endsWith("/price"))
      result = { queued: await runtime.queuePriceSync({ ...input, tenantId, actorId: userId }) };
    else if (path.endsWith("/store-status"))
      result = {
        queued: await runtime.queueStoreStatus(tenantId, input.connectionId, input.status, {
          startsAt: input.startsAt,
          resumeAt: input.resumeAt,
          actorId: userId,
        }),
      };
    else if (path.endsWith("/ready-time"))
      result = {
        queued: await runtime.queueReadyTime({ ...input, tenantId, branchId, actorId: userId }),
      };
    else if (path.endsWith("/menu-sync"))
      result = await runtime.queueMenuSync(tenantId, input.connectionId, input);
    else if (path.endsWith("/test")) {
      const id = path.split("/").at(-2)!;
      if (!connections.some((item) => item.id === id)) throw new Error("Local connection only");
      result = { health: await runtime.testConnection(tenantId, id) };
    } else return send(404, { ok: false, message: "Not available in local preview" });
    send(200, { ok: true, ...result });
  } catch (error) {
    send(400, {
      ok: false,
      message: error instanceof Error ? error.message : "Local preview failed",
    });
  }
}).listen(4199, "127.0.0.1", () =>
  console.log("Isolated marketplace simulation listening on 127.0.0.1:4199"),
);
