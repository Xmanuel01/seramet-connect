# Integration Adapter Guide

This guide adds a provider without modifying POS, orders, invoices, KDS, reports or inventory.

## 1. Define provider metadata

Create a provider folder under the matching category and export a stable `ProviderDefinition`:

```ts
export const exampleDefinition: ProviderDefinition = {
  id: "provider-example-delivery",
  code: "EXAMPLE_DELIVERY",
  displayName: "Example Delivery",
  category: "DELIVERY",
  version: "partner-v1",
  capabilities: ["RECEIVE_ORDERS", "WEBHOOK_CONFIRMATION"],
  configurationSchema: { channelId: { type: "string" } },
  secretFields: ["clientSecret", "webhookSecret"],
  adapterMetadata: {
    baseUrls: {
      SANDBOX: "https://sandbox.provider.example",
      PRODUCTION: "https://api.provider.example",
    },
  },
  enabled: true,
};
```

Declare only capabilities supported by official provider documentation. Omit unknown operations or return `SPEC_REQUIRED`; do not infer endpoint shapes.

## 2. Implement the adapter

Implement `ProviderAdapter` from `src/integrations/types.ts`. Webhook adapters must verify the exact raw body before parsing it:

```ts
export function createExampleAdapter(): ProviderAdapter {
  return {
    definition: exampleDefinition,
    healthCheck: async (connection, context) => ({
      status: context?.credentials.apiKey ? "HEALTHY" : "CONFIG_REQUIRED",
      checkedAt: new Date().toISOString(),
      message: context?.credentials.apiKey ? "Authenticated" : "API key required",
    }),
    verifyWebhook: ({ rawBody, headers, credentials }) =>
      verifyExactlyAsDocumented(rawBody, headers, credentials),
    parseWebhook: async (request) => ({
      ok: true,
      value: translateProviderEvent(request.rawBody),
    }),
    normalizeIncomingOrder: async (payload, connection) => ({
      ok: true,
      value: normalizeOrder(payload, connection.id),
    }),
  };
}
```

Do not pass provider payloads into `TransactionEngine`. Return `NormalizedExternalOrder` and let `IntegrationRuntime` perform branch/channel/item validation and domain dispatch.

## 3. Use the provider HTTP client

All network calls use `ProviderHttpClient`. Supply adapter metadata base URLs and the connection environment. Never choose the environment from credentials or a payload. The client applies timeouts, correlation IDs, typed HTTP failures, rate-limit metadata and redacted structured logs.

Access tokens belong in `ProviderTokenService`, not connection configuration. Use its `getValidToken` callback to prevent simultaneous refreshes.

## 4. Register once

Register the adapter in `createDefaultProviderRegistry`:

```ts
return new ProviderRegistry().register(createDarajaAdapter(env)).register(createExampleAdapter());
```

That registration plus provider configuration is the only normal application composition change. Feature screens resolve generic capabilities and connections.

## 5. Configure server credentials

Create an `IntegrationConnection` with explicit `SANDBOX` or `PRODUCTION`, a branch where appropriate, `CONFIGURED` state and an opaque `secretReference`. Put the credential object in `SERAMET_SECRET_STORE` or provide another `CredentialResolver` implementation.

Never store credentials in `configuration`; the configuration repository removes sensitive keys before frontend persistence.

## 6. Add mappings

Before live order ingestion, configure:

- external store ID to tenant/branch;
- external item ID to internal product ID;
- category and modifier mappings when required;
- an active order channel linked to the connection.

Names are labels, not mapping keys. Do not auto-create products, recipes or inventory relationships.

## 7. Validate

Add adapter tests using the generic test provider patterns. Required cases include valid and invalid signatures, duplicate event IDs, sandbox/production isolation, transient and permanent failures, rate limits, mapping failures, tenant isolation, health and redaction.

Run:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
npm test
npm run lint
npm run build
```

The connection must not be presented as `ACTIVE` until its real production health/authentication test succeeds and runtime validation confirms its credential reference, branch, active channel and store mapping.
