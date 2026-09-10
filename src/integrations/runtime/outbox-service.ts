import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { IntegrationDeadLetter, IntegrationOutbox } from "@/integrations/runtime/models";
import type { IntegrationQueue } from "@/integrations/runtime/queue";
import { normalizeIntegrationError } from "@/integrations/runtime/integration-errors";
import type { RetryService } from "@/integrations/runtime/retry-service";

export type OutboxDispatcher = (record: IntegrationOutbox) => Promise<unknown>;

export class IntegrationOutboxService {
  constructor(
    private repository: IntegrationRepository,
    private queue: IntegrationQueue,
    private retry: RetryService,
  ) {}

  async enqueue(
    input: Omit<
      IntegrationOutbox,
      "id" | "status" | "attemptCount" | "maxAttempts" | "createdAt"
    > & { maxAttempts?: number },
  ) {
    const record: IntegrationOutbox = {
      ...input,
      id: crypto.randomUUID(),
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? this.retry.maxAttempts,
      createdAt: new Date().toISOString(),
    };
    const result = await this.repository.enqueueOutbox(record);
    if (result.created)
      await this.queue.enqueue({
        kind: "integration-outbox",
        tenantId: result.record.tenantId,
        recordId: result.record.id,
        correlationId: result.record.correlationId,
      });
    return result;
  }

  async enqueueCoalesced(
    input: Omit<
      IntegrationOutbox,
      "id" | "status" | "attemptCount" | "maxAttempts" | "createdAt"
    > & { coalescingKey: string; maxAttempts?: number },
  ) {
    const record: IntegrationOutbox = {
      ...input,
      id: crypto.randomUUID(),
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? this.retry.maxAttempts,
      createdAt: new Date().toISOString(),
    };
    const result = await this.repository.coalesceOutbox(record);
    if (result.created || result.replaced)
      await this.queue.enqueue({
        kind: "integration-outbox",
        tenantId: result.record.tenantId,
        recordId: result.record.id,
        correlationId: result.record.correlationId,
      });
    return result;
  }

  async processNext(tenantId: string, dispatcher: OutboxDispatcher) {
    const task = await this.queue.dequeue();
    if (!task) return null;
    if (task.tenantId !== tenantId) return null;
    const record = await this.repository.getOutbox(tenantId, task.recordId);
    if (!record || record.status === "PROCESSED") return record;
    return this.process(record, dispatcher);
  }

  async process(record: IntegrationOutbox, dispatcher: OutboxDispatcher) {
    let lastAttempt = record.attemptCount;
    try {
      const result = await this.retry.execute(
        async (attempt) => {
          lastAttempt = record.attemptCount + attempt;
          await this.repository.updateOutbox(record.tenantId, record.id, {
            status: "PROCESSING",
            attemptCount: lastAttempt,
          });
          return dispatcher(record);
        },
        async (error, _attempt, nextDelayMs) => {
          await this.repository.updateOutbox(record.tenantId, record.id, {
            status: nextDelayMs ? "RETRY_PENDING" : "PROCESSING",
            attemptCount: lastAttempt,
            lastError: error.message,
            ...(nextDelayMs
              ? { nextAttemptAt: new Date(Date.now() + nextDelayMs).toISOString() }
              : {}),
          });
        },
      );
      return await this.repository.updateOutbox(record.tenantId, record.id, {
        status: "PROCESSED",
        attemptCount: lastAttempt,
        processedAt: new Date().toISOString(),
        lastError: undefined,
        nextAttemptAt: undefined,
      });
    } catch (error) {
      const normalized = normalizeIntegrationError(error);
      const failed = await this.repository.updateOutbox(record.tenantId, record.id, {
        status: "DEAD_LETTER",
        attemptCount: lastAttempt,
        lastError: normalized.message,
        nextAttemptAt: undefined,
      });
      const deadLetter: IntegrationDeadLetter = {
        id: crypto.randomUUID(),
        tenantId: record.tenantId,
        ...(record.branchId ? { branchId: record.branchId } : {}),
        connectionId: record.connectionId,
        providerId: record.providerId,
        sourceType: "OUTBOX",
        sourceId: record.id,
        originalPayload: record.payload,
        error: normalized.message,
        attemptCount: lastAttempt,
        correlationId: record.correlationId,
        status: "OPEN",
        createdAt: new Date().toISOString(),
      };
      await this.repository.appendDeadLetter(deadLetter);
      return failed;
    }
  }
}
