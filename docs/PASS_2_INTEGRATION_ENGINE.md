# Pass 2 Integration Engine

Completed on 29 August 2026. Pass 2 extends the Pass 1 provider registry and tenant configuration model; it does not replace them or redesign Seramet.

## Architecture

The execution boundary is:

`external provider -> provider adapter -> integration runtime -> normalized event/command -> existing Seramet domain service`

Outbound work follows:

`Seramet action -> persistent integration outbox -> queue abstraction -> integration runtime -> provider adapter`

Normal POS, invoice, order, KDS, inventory and report screens do not parse provider payloads. Provider-specific registration remains confined to `src/integrations/provider-registry.ts`.

## Runtime components

- `runtime/integration-runtime.ts`: connection resolution, webhook orchestration, normalized order processing, replay, outbound dispatch and diagnostics.
- `runtime/integration-repository.ts`: tenant-scoped memory and D1 persistence for events, idempotency, mappings, outbox records, dead letters, health and replay history.
- `runtime/credential-resolver.ts`: replaceable server-side secret resolution using `secretReference`.
- `runtime/token-service.ts`: short-lived token reuse, refresh de-duplication and invalidation.
- `runtime/provider-http-client.ts`: environment-aware base URLs, timeouts, correlation IDs, response parsing, rate-limit metadata and typed failures.
- `runtime/retry-service.ts`: bounded exponential backoff with jitter and `Retry-After` support.
- `runtime/health-service.ts`: credential, request, webhook, failure, mapping and circuit-state health calculation.
- `runtime/outbox-service.ts`: idempotent outbound scheduling, retry and dead-letter promotion.
- `runtime/mapping-service.ts`: store, item, category and modifier mapping resolution.
- `runtime/redaction.ts`: recursive secret redaction and structured integration logs.

## Webhook pipeline

The generic gateway is:

`POST /api/seramet/integrations/webhooks/:providerCode/:connectionId`

It resolves the tenant from the connection, verifies the provider/connection relationship, preserves the raw request bytes, enforces the body limit, calls adapter-owned verification, parses a normalized event, claims durable idempotency and appends an immutable event before domain processing. Duplicate provider event IDs return the stored result and do not create another order or event.

Inbound order processing explicitly resolves the external store to a tenant branch, resolves menu item mappings, applies the configured unmapped-item and acceptance policies, then calls the existing transaction engine. Automatically accepted orders enter the existing station/KDS flow through `sendToKitchen`.

Normalized payment confirmations resolve the existing payment intent and call `TransactionEngine.confirmPaymentIntent`; failures mark the matching intent failed. Both outcomes retain an external payment mapping and use the same tenant/branch audit boundary as manual settlement.

## Adapter model

Adapters declare capabilities. Runtime calls are capability gated, so unsupported optional methods are never assumed. The contract supports verified webhooks, event parsing, order normalization, order retrieval and lifecycle operations, store status, menu synchronization, availability, pricing, payment prompts and payment callbacks.

Uber Eats includes its documented HMAC-SHA256 webhook verification, event translation and normalized-order boundary. Live order requests remain credential and approved-scope gated. Glovo and Bolt Food expose metadata, configuration and mapping boundaries but intentionally return `SPEC_REQUIRED` for undocumented Partner API operations.

## Credentials and tokens

Connections store only `secretReference`. `EnvironmentCredentialResolver` reads `SERAMET_SECRET_STORE` or an explicit `env://` server variable. Existing Daraja/TendePay server environment values are bridged into the same resolver for compatible configured connections.

Raw credentials and access tokens are never serialized into frontend connection configuration. `ProviderTokenService` reuses valid tokens, avoids concurrent refreshes and supports authorization invalidation. A future vault can implement the same `CredentialResolver` interface.

## Idempotency and event store

Provider event ID plus connection ID is preferred. If a provider supplies no event ID, the runtime derives a SHA-256 key from immutable event fields and the raw-body hash. Claims are persisted under a tenant and connection key.

Inbound event payloads are immutable. Processing updates status, attempts, errors and response metadata while preserving the original redacted payload and creation time.

## Outbox, retry and dead letters

Outbound records have unique idempotency keys. The queue interface can be replaced by Cloudflare Queues, BullMQ or SQS; the local implementation is a finite in-memory queue and never runs a browser worker.

Retryable failures are network errors, timeouts, HTTP 429 and HTTP 5xx. Authentication, authorization, validation, unsupported capability and mapping errors are permanent. Exponential backoff is bounded and honors provider `Retry-After`. Exhausted records become dead letters with the original payload, error, attempts, connection and correlation ID.

Manual replay creates a new event and replay record. It never rewrites the original event. Existing resource mappings make replays idempotently ignored rather than duplicating orders or payments.

## Mappings

`ExternalResourceMapping` supports stores, orders, menus, categories, items, modifier groups, modifiers, taxes, availability, customers, payments, riders and refunds. Store mappings include the authoritative tenant and branch IDs; branch names are never parsed. Menu matching is explicit and never creates inventory recipes from an external product name.

Unmapped-item policies are `AUTO_REJECT` (default), `MANAGER_REVIEW` and `USE_EXTERNAL_DESCRIPTION`. Acceptance policies are `MANUAL`, `AUTO_ACCEPT_VALID` (default) and `AUTO_ACCEPT_ALL_MAPPED`.

## Health and observability

Health combines credential resolution, provider health checks, recent success/failure, webhook activity, mapping issues, rate limits and consecutive failures. Repeated failures open a cooling-period circuit while local POS operations continue.

Connection testing also validates the server secret reference, assigned branch, active order channel and branch-specific store mapping. A healthy provider response cannot promote an incomplete order connection to `SANDBOX` or `ACTIVE`. Outbound workers check the circuit before every adapter operation.

Every provider call carries a correlation ID. Structured logs identify tenant, branch, connection, provider, operation, result and duration. Authorization, token, password, key and secret fields are recursively redacted.

## Tenant isolation

Every integration record includes `tenantId`. Repository reads and mutations require both tenant and record ID. Webhook tenant scope is resolved from the provider connection and an asserted tenant header must match it. Cross-tenant repository behavior is covered by automated tests.

## UI changes

The existing Integrations page now includes connection health, environment, last sync, pending/failure counts, tests, enable/disable, event filters, redacted event details, replay, store/menu mapping, unmap and dead-letter visibility. Existing Seramet panels, tables, buttons, statuses and dialogs are reused. Serious health, mapping and dead-letter issues feed the existing manager notification dropdown.

## Tests

`src/integrations/pass-2-integration-engine.test.ts` contains the required A-V acceptance groups and injected timeout, 401, 403, 409, 429, 500, malformed payload, duplicate, out-of-order, unmapped branch and unmapped item scenarios. Existing payment, print, order, KDS and inventory tests remain in the complete suite.

## Limitations and Pass 3 readiness

- Production provider credentials, account approval and scopes are not included.
- Glovo and Bolt Food network operations remain `SPEC_REQUIRED` until the official merchant specifications are supplied; no endpoints or authentication formats are fabricated.
- Uber network operations remain disabled until an approved Marketplace application and scopes are configured. Its verified webhook and normalization boundaries are ready.
- The local queue is a prototype implementation of a production queue interface. D1 persists runtime records; a deployed worker/queue should claim due outbox records.
- `SERAMET_SECRET_STORE` is an environment-backed prototype. A managed secret store can replace it without changing adapters or feature screens.

These limitations are deliberate provider-access boundaries, not simulated success states. Connections become `SANDBOX` or `ACTIVE` only after a real adapter health result reports healthy.
