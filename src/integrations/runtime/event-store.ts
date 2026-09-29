import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { IntegrationEvent, IntegrationReplay } from "@/integrations/runtime/models";

export class IntegrationEventStore {
  constructor(private repository: IntegrationRepository) {}
  append(event: IntegrationEvent) {
    return this.repository.appendEvent(event);
  }
  get(tenantId: string, eventId: string) {
    return this.repository.getEvent(tenantId, eventId);
  }
  list(tenantId: string, filters?: Parameters<IntegrationRepository["listEvents"]>[1]) {
    return this.repository.listEvents(tenantId, filters);
  }
  updateStatus(
    tenantId: string,
    eventId: string,
    update: Parameters<IntegrationRepository["updateEvent"]>[2],
  ) {
    return this.repository.updateEvent(tenantId, eventId, update);
  }
  recordReplay(replay: IntegrationReplay) {
    return this.repository.appendReplay(replay);
  }
}
