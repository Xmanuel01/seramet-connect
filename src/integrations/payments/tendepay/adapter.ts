import type { ProviderAdapter, ProviderOperationResult } from "@/integrations/types";
import type { ProviderDefinition } from "@/platform/types";

export const tendePayDefinition: ProviderDefinition = {
  id: "provider-tendepay",
  code: "TENDEPAY",
  displayName: "TendePay",
  category: "PAYMENT",
  version: "merchant-spec-required",
  supportedCountries: ["KE"],
  capabilities: [],
  configurationSchema: {
    baseUrl: { type: "string" },
    collectionAccountId: { type: "string" },
    clearingAccountId: { type: "string" },
    settlementImportFormat: { type: "string" },
  },
  secretFields: ["apiKey", "webhookSecret"],
  enabled: true,
};

const specRequired = <T = unknown>(operation: string): Promise<ProviderOperationResult<T>> =>
  Promise.resolve({
    ok: false,
    code: "SPEC_REQUIRED",
    message: `TendePay ${operation} requires an official merchant API specification`,
    retryable: false,
  });

export function createTendePayAdapter(): ProviderAdapter {
  return {
    definition: tendePayDefinition,
    healthCheck: async (connection) => ({
      status: "CONFIG_REQUIRED",
      checkedAt: new Date().toISOString(),
      message: connection.secretReference
        ? "Credentials are referenced, but official merchant API contracts are still required"
        : "Official merchant API contracts and a server-side secret reference are required",
      metadata: { boundary: "SPEC_REQUIRED" },
    }),
    verifyWebhook: () => false,
    parseWebhook: () =>
      specRequired<import("@/integrations/types").ParsedProviderEvent>("webhook parsing"),
    createPaymentPrompt: () => specRequired("payment prompt"),
    createPaymentQr: () => specRequired("QR payment"),
    queryPayment: () =>
      specRequired<import("@/integrations/types").NormalizedPaymentProviderStatus>(
        "transaction query",
      ),
    requestPaymentRefund: () => specRequired("refund"),
    requestPaymentReversal: () => specRequired("reversal"),
    fetchSettlements: () => specRequired("settlement retrieval"),
    importSettlement: () => specRequired("provider-specific settlement import"),
  };
}
