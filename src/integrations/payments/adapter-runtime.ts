import { ProviderHttpClient } from "@/integrations/runtime/provider-http-client";
import { StructuredIntegrationLogger } from "@/integrations/runtime/redaction";
import { ProviderTokenService } from "@/integrations/runtime/token-service";

export type PaymentAdapterRuntime = {
  http: ProviderHttpClient;
  tokens: ProviderTokenService;
};

export function createPaymentAdapterRuntime(): PaymentAdapterRuntime {
  const logger = new StructuredIntegrationLogger();
  return {
    http: new ProviderHttpClient(logger),
    tokens: new ProviderTokenService(),
  };
}
