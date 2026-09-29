import { getProviderRegistry, type ProviderRegistry } from "@/integrations/provider-registry";
import {
  getConfigurationRepository,
  PlatformConfigurationError,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";
import type { ProviderCapability } from "@/platform/types";

export class ProviderService {
  constructor(
    private repository: ConfigurationRepository = getConfigurationRepository(),
    private registry: ProviderRegistry = getProviderRegistry(),
  ) {}

  resolveConnection(tenantId: string, connectionId: string, capability?: ProviderCapability) {
    const connection = this.repository
      .listConnections(tenantId)
      .find((item) => item.id === connectionId);
    if (
      !connection ||
      connection.status === "UNCONFIGURED" ||
      connection.status === "CREDENTIALS_REQUIRED"
    ) {
      throw new PlatformConfigurationError("Provider connection incomplete");
    }
    if (connection.status === "DISABLED") {
      throw new PlatformConfigurationError("Provider connection is disabled");
    }
    if (connection.status === "AUTH_ERROR" || connection.status === "ERROR") {
      throw new PlatformConfigurationError(connection.statusMessage ?? "Provider connection error");
    }
    return {
      connection,
      adapter: this.registry.resolve(connection, capability),
    };
  }

  resolvePaymentMethod(
    tenantId: string,
    paymentMethodIdOrCode: string,
    capability?: ProviderCapability,
  ) {
    const method = this.repository
      .listPaymentMethods(tenantId)
      .find((item) => item.id === paymentMethodIdOrCode || item.code === paymentMethodIdOrCode);
    if (!method) throw new PlatformConfigurationError("No active payment methods");
    if (!method.providerConnectionId) {
      throw new PlatformConfigurationError("Provider connection incomplete");
    }
    return { method, ...this.resolveConnection(tenantId, method.providerConnectionId, capability) };
  }
}
