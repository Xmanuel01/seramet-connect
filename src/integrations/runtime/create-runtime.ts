import {
  createDefaultProviderRegistry,
  type ProviderRegistry,
} from "@/integrations/provider-registry";
import {
  ChainedCredentialResolver,
  EnvironmentCredentialResolver,
  StaticCredentialResolver,
  type CredentialResolver,
  type SecretEnvironment,
} from "@/integrations/runtime/credential-resolver";
import { IntegrationHealthService } from "@/integrations/runtime/health-service";
import {
  createIntegrationRepository,
  type IntegrationRepository,
} from "@/integrations/runtime/integration-repository";
import { IntegrationRuntime } from "@/integrations/runtime/integration-runtime";
import { IntegrationOutboxService } from "@/integrations/runtime/outbox-service";
import { DurableIntegrationQueue, InMemoryIntegrationQueue } from "@/integrations/runtime/queue";
import {
  StructuredIntegrationLogger,
  type IntegrationLogger,
} from "@/integrations/runtime/redaction";
import { RetryService } from "@/integrations/runtime/retry-service";
import { ProviderHttpClient } from "@/integrations/runtime/provider-http-client";
import { ProviderTokenService } from "@/integrations/runtime/token-service";
import type { SerametEnv } from "@/lib/seramet-auth";
import type { TransactionRepository } from "@/lib/seramet-repository";
import {
  createMenuCatalogReader,
  type MenuCatalogReader,
} from "@/integrations/marketplace/menu-catalog-reader";
import { createTransactionRepository } from "@/server/database/create-transaction-repository";
import {
  getConfigurationRepository,
  type ConfigurationRepository,
} from "@/platform/repositories/configuration-repository";

export type RuntimeOverrides = {
  configuration?: ConfigurationRepository;
  registry?: ProviderRegistry;
  credentials?: CredentialResolver;
  repository?: IntegrationRepository;
  transactions?: TransactionRepository;
  logger?: IntegrationLogger;
  retry?: RetryService;
  catalog?: MenuCatalogReader;
};

export function createIntegrationRuntime(env: SerametEnv = {}, overrides: RuntimeOverrides = {}) {
  const configuration = overrides.configuration ?? getConfigurationRepository();
  const logger = overrides.logger ?? new StructuredIntegrationLogger();
  const registry =
    overrides.registry ??
    createDefaultProviderRegistry(
      env,
      {
        http: new ProviderHttpClient(logger),
        tokens: new ProviderTokenService(),
      },
      {
        http: new ProviderHttpClient(logger),
        tokens: new ProviderTokenService(),
      },
    );
  const credentials = overrides.credentials ?? createServerCredentialResolver(env, configuration);
  const repository = overrides.repository ?? createIntegrationRepository(env.SERAMET_DB);
  const transactions = overrides.transactions ?? createTransactionRepository(env.SERAMET_DB);
  const retry = overrides.retry ?? new RetryService();
  const queue = env.SERAMET_WORK_QUEUE
    ? new DurableIntegrationQueue(env.SERAMET_WORK_QUEUE)
    : new InMemoryIntegrationQueue();
  const outbox = new IntegrationOutboxService(repository, queue, retry);
  const health = new IntegrationHealthService(repository, credentials);
  return new IntegrationRuntime({
    configuration,
    registry,
    credentials,
    repository,
    transactions,
    outbox,
    health,
    logger,
    catalog: overrides.catalog ?? createMenuCatalogReader(env.SERAMET_DB),
  });
}

function createServerCredentialResolver(env: SerametEnv, configuration: ConfigurationRepository) {
  const secrets: Record<string, Record<string, string>> = {};
  for (const tenant of configuration.listTenants()) {
    for (const connection of configuration.listConnections(tenant.id)) {
      if (!connection.secretReference) continue;
      const provider = configuration
        .listProviders()
        .find((item) => item.id === connection.providerId);
      if (!provider) continue;
      const values =
        provider.code === "DARAJA"
          ? compact({
              consumerKey: env.SERAMET_MPESA_CONSUMER_KEY,
              consumerSecret: env.SERAMET_MPESA_CONSUMER_SECRET,
              shortcode: env.SERAMET_MPESA_SHORTCODE,
              passkey: env.SERAMET_MPESA_PASSKEY,
              webhookSecret: env.SERAMET_MPESA_WEBHOOK_SECRET,
            })
          : provider.code === "PESAPAL"
            ? compact({
                consumerKey: env.SERAMET_PESAPAL_CONSUMER_KEY,
                consumerSecret: env.SERAMET_PESAPAL_CONSUMER_SECRET,
              })
            : provider.code === "TENDEPAY"
              ? compact({
                  apiKey: env.SERAMET_TENDEPAY_API_KEY,
                  webhookSecret: env.SERAMET_TENDEPAY_WEBHOOK_SECRET,
                })
              : provider.code === "CARD_ACQUIRER"
                ? compact({ webhookSecret: env.SERAMET_CARD_WEBHOOK_SECRET })
                : provider.code === "BANK_FEED"
                  ? compact({ webhookSecret: env.SERAMET_BANK_WEBHOOK_SECRET })
                  : provider.code === "UBER_EATS"
                    ? compact({
                        clientId: env.SERAMET_UBER_CLIENT_ID,
                        clientSecret: env.SERAMET_UBER_CLIENT_SECRET,
                      })
                    : provider.code === "GLOVO"
                      ? compact({
                          clientId: env.SERAMET_GLOVO_CLIENT_ID,
                          clientSecret: env.SERAMET_GLOVO_CLIENT_SECRET,
                          webhookToken: env.SERAMET_GLOVO_WEBHOOK_TOKEN,
                        })
                      : {};
      if (Object.keys(values).length) secrets[connection.secretReference] = values;
    }
  }
  return new ChainedCredentialResolver([
    new EnvironmentCredentialResolver(env as SecretEnvironment),
    new StaticCredentialResolver(secrets),
  ]);
}

function compact(input: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
