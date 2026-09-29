import type { DurableQueue } from "@/server/environment";

export type IntegrationQueueTask = {
  kind: "integration-outbox";
  tenantId: string;
  recordId: string;
  correlationId: string;
};

export interface IntegrationQueue {
  enqueue(task: IntegrationQueueTask): Promise<void>;
  dequeue(): Promise<IntegrationQueueTask | undefined>;
}

export class InMemoryIntegrationQueue implements IntegrationQueue {
  private tasks: IntegrationQueueTask[] = [];
  async enqueue(task: IntegrationQueueTask) {
    if (!this.tasks.some((candidate) => candidate.recordId === task.recordId))
      this.tasks.push(task);
  }
  async dequeue() {
    return this.tasks.shift();
  }
}

export class DurableIntegrationQueue implements IntegrationQueue {
  constructor(private readonly queue: DurableQueue<IntegrationQueueTask>) {}

  enqueue(task: IntegrationQueueTask) {
    return this.queue.send(task, { contentType: "json" });
  }

  async dequeue() {
    return undefined;
  }
}
