import type { ProviderAdapter } from "@/integrations/types";
import type { ProviderDefinition } from "@/platform/types";

export const boltFoodDefinition: ProviderDefinition = {
  id: "provider-delivery-bolt-food",
  code: "BOLT_FOOD",
  displayName: "Bolt Food",
  category: "DELIVERY",
  version: "partner-spec-required",
  capabilities: [],
  configurationSchema: { channelId: { type: "string" } },
  secretFields: ["apiKey", "webhookSecret"],
  adapterMetadata: { documentationUrl: "https://bolt.eu/en/food/merchant/" },
  enabled: true,
};

export function createBoltFoodAdapter() {
  return createSpecGatedAdapter(boltFoodDefinition);
}

function createSpecGatedAdapter(definition: ProviderDefinition): ProviderAdapter {
  const unsupported = async () => ({
    ok: false as const,
    code: "SPEC_REQUIRED" as const,
    message: `${definition.displayName} Partner API operation requires the official merchant specification`,
    retryable: false,
  });
  return {
    definition,
    healthCheck: async () => ({
      status: "CONFIG_REQUIRED",
      checkedAt: new Date().toISOString(),
      message: `${definition.displayName} remains disabled until official Partner API credentials and specification are configured`,
    }),
    verifyWebhook: async () => false,
    parseWebhook: unsupported,
    getOrder: unsupported,
    normalizeIncomingOrder: unsupported,
    acceptOrder: unsupported,
    rejectOrder: unsupported,
    updateStatus: unsupported,
    syncMenu: unsupported,
    syncAvailability: unsupported,
    updateItemPrice: unsupported,
    getStoreStatus: unsupported,
    setStoreStatus: unsupported,
  };
}
