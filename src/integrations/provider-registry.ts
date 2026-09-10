import type { ProviderAdapter } from "@/integrations/types";
import type { IntegrationConnection, ProviderCapability, ProviderId } from "@/platform/types";
import { createDarajaAdapter } from "@/integrations/payments/daraja/adapter";
import { createTendePayAdapter } from "@/integrations/payments/tendepay/adapter";
import { createPesapalAdapter } from "@/integrations/payments/pesapal/adapter";
import { createUberEatsAdapter } from "@/integrations/delivery/uber-eats/adapter";
import { createGlovoAdapter } from "@/integrations/delivery/glovo/adapter";
import { createBoltFoodAdapter } from "@/integrations/delivery/spec-gated-adapters";
import type { SerametEnv } from "@/lib/seramet-auth";
import {
  createMarketplaceAdapterRuntime,
  type MarketplaceAdapterRuntime,
} from "@/integrations/delivery/adapter-runtime";
import {
  createPaymentAdapterRuntime,
  type PaymentAdapterRuntime,
} from "@/integrations/payments/adapter-runtime";

export class ProviderRegistry {
  private adapters = new Map<ProviderId, ProviderAdapter>();

  register(adapter: ProviderAdapter) {
    if (this.adapters.has(adapter.definition.id)) {
      throw new Error(`Provider ${adapter.definition.id} is already registered`);
    }
    this.adapters.set(adapter.definition.id, adapter);
    return this;
  }

  replace(adapter: ProviderAdapter) {
    this.adapters.set(adapter.definition.id, adapter);
    return this;
  }

  get(providerId: ProviderId) {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`Provider ${providerId} is not registered`);
    return adapter;
  }

  resolve(connection: IntegrationConnection, capability?: ProviderCapability) {
    const adapter = this.get(connection.providerId);
    if (capability && !adapter.definition.capabilities.includes(capability)) {
      throw new Error(`${adapter.definition.displayName} does not support ${capability}`);
    }
    return adapter;
  }

  list(capability?: ProviderCapability) {
    return Array.from(this.adapters.values()).filter(
      (adapter) => !capability || adapter.definition.capabilities.includes(capability),
    );
  }
}

let registry: ProviderRegistry | undefined;

export function getProviderRegistry() {
  registry ??= createDefaultProviderRegistry();
  return registry;
}

export function setProviderRegistryForTests(next?: ProviderRegistry) {
  registry = next;
}

export function createDefaultProviderRegistry(
  env: SerametEnv = {},
  marketplaceRuntime: MarketplaceAdapterRuntime = createMarketplaceAdapterRuntime(),
  paymentRuntime: PaymentAdapterRuntime = createPaymentAdapterRuntime(),
) {
  return new ProviderRegistry()
    .register(createDarajaAdapter(env, paymentRuntime))
    .register(createPesapalAdapter(paymentRuntime))
    .register(createTendePayAdapter())
    .register(createUberEatsAdapter(marketplaceRuntime))
    .register(createGlovoAdapter(marketplaceRuntime))
    .register(createBoltFoodAdapter());
}

export function configureDefaultProviderRegistry(env: SerametEnv = {}) {
  registry = createDefaultProviderRegistry(env);
  return registry;
}
