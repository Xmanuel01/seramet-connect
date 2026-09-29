import type { PlatformState } from "@/platform/types";

export function createEmptyPlatformState(): PlatformState {
  return {
    schemaVersion: 2,
    tenants: [],
    brands: [],
    branches: [],
    warehouses: [],
    departments: [],
    stations: [],
    serviceAreas: [],
    tables: [],
    paymentMethods: [],
    orderChannels: [],
    providers: [],
    connections: [],
    devices: [],
    printRoutes: [],
    documentIdentities: [],
    documentTemplates: [],
    roles: [],
    users: [],
    updatedAt: new Date(0).toISOString(),
  };
}
