import type { CredentialResolver } from "@/integrations/runtime/credential-resolver";
import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { IntegrationHealthRecord } from "@/integrations/runtime/models";
import type { ProviderAdapter } from "@/integrations/types";
import type { IntegrationConnection } from "@/platform/types";

export class IntegrationHealthService {
  constructor(
    private repository: IntegrationRepository,
    private credentials: CredentialResolver,
    private failureThreshold = 3,
    private coolingPeriodMs = 60_000,
  ) {}

  async calculate(
    connection: IntegrationConnection,
    adapter: ProviderAdapter,
  ): Promise<IntegrationHealthRecord> {
    const now = new Date().toISOString();
    const credentialValid = Boolean(
      connection.secretReference && (await this.credentials.hasSecret(connection.secretReference)),
    );
    const events = await this.repository.listEvents(connection.tenantId, {
      connectionId: connection.id,
    });
    const mappings = await this.repository.listMappings(connection.tenantId, connection.id);
    const mappedStore = mappings.find(
      (mapping) =>
        mapping.resourceType === "STORE" &&
        mapping.status === "MAPPED" &&
        (!connection.branchId || mapping.branchId === connection.branchId),
    );
    const executionConnection = mappedStore
      ? {
          ...connection,
          configuration: { ...connection.configuration, externalStoreId: mappedStore.externalId },
        }
      : connection;
    const current = await this.repository.getHealth(connection.tenantId, connection.id);
    let status: IntegrationHealthRecord["status"] = credentialValid
      ? "DEGRADED"
      : "CONFIG_REQUIRED";
    let message = credentialValid
      ? "Connection has not completed a health check"
      : "Server credentials are required";
    if (credentialValid && connection.secretReference) {
      try {
        const result = await adapter.healthCheck(executionConnection, {
          connection: executionConnection,
          credentials: await this.credentials.getSecret(connection.secretReference),
          correlationId: crypto.randomUUID(),
        });
        status = result.status;
        message = result.message;
      } catch (error) {
        status = "OFFLINE";
        message = error instanceof Error ? error.message : "Health check failed";
      }
    }
    const consecutiveFailures =
      status === "HEALTHY"
        ? 0
        : (current?.consecutiveFailures ?? connection.consecutiveFailures) + 1;
    const record: IntegrationHealthRecord = {
      id: connection.id,
      tenantId: connection.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      status,
      message,
      credentialValid,
      mappingIssueCount: mappings.filter(
        (row) => row.status === "UNMAPPED" || row.status === "CONFLICT",
      ).length,
      pendingEventCount: events.filter((event) =>
        ["RECEIVED", "QUEUED", "PROCESSING", "RETRY_PENDING"].includes(event.status),
      ).length,
      failedEventCount: events.filter((event) =>
        ["FAILED", "DEAD_LETTER", "MAPPING_REQUIRED"].includes(event.status),
      ).length,
      consecutiveFailures,
      circuitState:
        consecutiveFailures >= this.failureThreshold
          ? "OPEN"
          : consecutiveFailures > 0
            ? "DEGRADED"
            : "HEALTHY",
      ...(consecutiveFailures >= this.failureThreshold
        ? { circuitOpenUntil: new Date(Date.now() + this.coolingPeriodMs).toISOString() }
        : {}),
      ...(status === "HEALTHY" ? { lastSuccessfulRequestAt: now } : { lastFailedRequestAt: now }),
      ...(current?.lastWebhookAt ? { lastWebhookAt: current.lastWebhookAt } : {}),
      checkedAt: now,
      metadata: {},
    };
    await this.repository.upsertHealth(record);
    return record;
  }

  async recordSuccess(connection: IntegrationConnection, webhook = false) {
    const current = await this.repository.getHealth(connection.tenantId, connection.id);
    const now = new Date().toISOString();
    await this.repository.upsertHealth({
      id: connection.id,
      tenantId: connection.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      status: "HEALTHY",
      message: "Provider request succeeded",
      credentialValid: true,
      mappingIssueCount: current?.mappingIssueCount ?? 0,
      pendingEventCount: current?.pendingEventCount ?? 0,
      failedEventCount: current?.failedEventCount ?? 0,
      consecutiveFailures: 0,
      circuitState: "HEALTHY",
      lastSuccessfulRequestAt: now,
      ...(webhook
        ? { lastWebhookAt: now }
        : current?.lastWebhookAt
          ? { lastWebhookAt: current.lastWebhookAt }
          : {}),
      checkedAt: now,
      metadata: current?.metadata ?? {},
    });
  }

  async recordFailure(
    connection: IntegrationConnection,
    message: string,
    rateLimitedUntil?: string,
  ) {
    const current = await this.repository.getHealth(connection.tenantId, connection.id);
    const failures = (current?.consecutiveFailures ?? 0) + 1;
    const now = new Date().toISOString();
    await this.repository.upsertHealth({
      id: connection.id,
      tenantId: connection.tenantId,
      ...(connection.branchId ? { branchId: connection.branchId } : {}),
      connectionId: connection.id,
      providerId: connection.providerId,
      status: rateLimitedUntil
        ? "DEGRADED"
        : failures >= this.failureThreshold
          ? "OFFLINE"
          : "DEGRADED",
      message,
      credentialValid: current?.credentialValid ?? Boolean(connection.secretReference),
      mappingIssueCount: current?.mappingIssueCount ?? 0,
      pendingEventCount: current?.pendingEventCount ?? 0,
      failedEventCount: (current?.failedEventCount ?? 0) + 1,
      consecutiveFailures: failures,
      circuitState: failures >= this.failureThreshold ? "OPEN" : "DEGRADED",
      ...(failures >= this.failureThreshold
        ? { circuitOpenUntil: new Date(Date.now() + this.coolingPeriodMs).toISOString() }
        : {}),
      ...(rateLimitedUntil ? { rateLimitedUntil } : {}),
      lastFailedRequestAt: now,
      ...(current?.lastWebhookAt ? { lastWebhookAt: current.lastWebhookAt } : {}),
      checkedAt: now,
      metadata: current?.metadata ?? {},
    });
  }

  async assertCircuitClosed(tenantId: string, connectionId: string) {
    const current = await this.repository.getHealth(tenantId, connectionId);
    if (!current?.circuitOpenUntil) return;
    const remaining = new Date(current.circuitOpenUntil).getTime() - Date.now();
    if (remaining > 0) return remaining;
    return undefined;
  }
}
