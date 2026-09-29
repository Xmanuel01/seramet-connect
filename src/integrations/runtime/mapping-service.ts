import type { IntegrationRepository } from "@/integrations/runtime/integration-repository";
import type { ExternalResourceMapping, ExternalResourceType } from "@/integrations/runtime/models";
import { MappingError } from "@/integrations/runtime/integration-errors";

export class ExternalMappingService {
  constructor(private repository: IntegrationRepository) {}

  resolveExternal(
    tenantId: string,
    connectionId: string,
    resourceType: ExternalResourceType,
    externalId: string,
  ) {
    return this.repository.getMapping(tenantId, connectionId, resourceType, externalId);
  }

  async resolveInternalItem(tenantId: string, connectionId: string, externalId: string) {
    const mapping = await this.resolveExternal(tenantId, connectionId, "ITEM", externalId);
    return mapping?.internalId;
  }

  async resolveExternalItem(tenantId: string, connectionId: string, internalId: string) {
    return (await this.repository.listMappings(tenantId, connectionId)).find(
      (row) =>
        row.resourceType === "ITEM" && row.internalId === internalId && row.status !== "DISABLED",
    )?.externalId;
  }

  async resolveInternalModifier(tenantId: string, connectionId: string, externalId: string) {
    const mapping = await this.resolveExternal(tenantId, connectionId, "MODIFIER", externalId);
    return mapping?.internalId;
  }

  async resolveStore(tenantId: string, connectionId: string, externalStoreId: string) {
    const mapping = await this.resolveExternal(tenantId, connectionId, "STORE", externalStoreId);
    if (!mapping?.branchId || !mapping.internalId)
      throw new MappingError("External store is not mapped to a Seramet branch");
    return { tenantId: mapping.tenantId, branchId: mapping.branchId, mapping };
  }

  listUnmappedItems(tenantId: string, connectionId: string) {
    return this.repository
      .listMappings(tenantId, connectionId)
      .then((rows) =>
        rows.filter(
          (row) =>
            row.resourceType === "ITEM" && (row.status === "UNMAPPED" || row.status === "CONFLICT"),
        ),
      );
  }

  async validateMenuMapping(tenantId: string, connectionId: string) {
    const rows = await this.repository.listMappings(tenantId, connectionId);
    const issues = rows.filter((row) => ["UNMAPPED", "CONFLICT"].includes(row.status));
    return {
      valid: issues.length === 0,
      mapped: rows.filter((row) => row.status === "MAPPED" || row.status === "AUTO_MATCHED").length,
      issues,
    };
  }

  upsert(mapping: ExternalResourceMapping) {
    return this.repository.upsertMapping(mapping);
  }
  unmap(tenantId: string, id: string) {
    return this.repository.deleteMapping(tenantId, id);
  }
}
