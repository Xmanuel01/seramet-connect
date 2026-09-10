# Pass 3 Two-Way Delivery and Marketplace Integration

Completed on 29 August 2026. Pass 3 extends the Pass 2 runtime. It does not create a second order system and it does not implement Pass 4 settlement reconciliation.

## Architecture

Inbound:

`provider webhook/recovery -> provider adapter -> integration runtime -> normalized marketplace order -> transaction engine -> KDS/KOT/inventory`

Outbound:

`Seramet domain change -> tenant-scoped outbox -> retry/circuit worker -> provider adapter`

Provider HTTP is confined to adapters. POS, KDS, inventory and React routes never call marketplace APIs directly. Store, item, category and modifier relationships use explicit external mappings; branch names are never inferred.

## Order ingestion and lifecycle

Verified webhooks are durably claimed before processing. A provider event creates one normal `TransactionOrder`, resolves its branch from a store mapping, maps items and modifiers, preserves customer notes, computes prep time and routes accepted orders through the existing station workflow. Acceptance is an outbox command, not an inline provider call.

The runtime supports manual and automatic acceptance policies, configurable unmapped-item behavior, scheduled release, provider cancellations and supported order edits. Changes after production starts create addition/cancel-item amendments for the normal printing pipeline. READY is queued only when every production station is ready.

Missed Uber notifications can be recovered with the documented active-created-orders operation. Recovery creates normal durable integration events and reuses the same ingestion/idempotency path. An out-of-order cancellation creates a tombstone so a later create notification cannot resurrect the order.

## Marketplace receivables

An externally collected marketplace order is not recorded as cash, bank, card, clearing or a completed payment. It creates:

- a gross restaurant sale;
- an open marketplace receivable assigned to the provider connection;
- an invoice in `PROVIDER_RECEIVABLE` state;
- a balanced journal debit to the configured marketplace receivable account and credits to revenue/tax.

It does not create a `PaymentRecord`, receipt, payment intent, bank feed entry or reconciliation match. Provider promotions, commissions and adjustments are stored as separate marketplace charges when present in a documented payload. Customer-facing delivery and service fees remain part of the gross provider receivable. None of these values silently creates a bank receipt. Pass 4 will match settlement statements and post deductions and the actual bank receipt.

## Menu, price and availability

The normalized menu DTO contains menus, categories, items, modifier groups, images, prices, availability and branch metadata. A deterministic preview shows creates, updates, price changes, availability changes, removals and conflicts before a full sync is queued.

Price lists are connection configuration, not provider-name multipliers. Availability is derived from branch product state, recipes and channel overrides. Sold-out and restock changes use coalesced outbox records so rapid changes resolve to the latest value. Provider-supported catalog writes remain background work.

## Store operations

Store open/pause/temporary close is capability gated and branch scoped. Provider-specific status values remain inside adapters. A failed provider call changes outbox/health state and never blocks local POS order entry.

## Provider status

### Uber Eats

Implemented from official Eats references: OAuth client credentials and approved scopes, HMAC-SHA256 webhook verification, v2 order retrieval, current Order Fulfillment accept/deny/cancel/ready/ready-time operations, active-created-order recovery, v2 menu read/upload/item updates, and current Store status read/write operations. Production remains `CONFIGURED` until real credentials, scopes, store access and health checks succeed.

### Glovo

Implemented from the public Partner API v2.0.2 specification: OAuth token lifecycle, documented order read/update statuses, ISO `accepted_for` timestamps, decimal-major-unit payment normalization, catalog product read and price/active/quantity updates, and vendor status. `READY_FOR_PICKUP` is sent only for Glovo courier orders; vendor-delivery dispatch uses `DISPATCHED`. The beta product-creation endpoint is deliberately excluded from production menu upload. Webhook authentication requires the account-configured static-token header name because the public specification does not define one universal header name.

### Bolt Food

The public developer portal does not expose a sufficiently precise merchant order/catalog contract in this environment. The adapter declares no network capabilities and returns `SPEC_REQUIRED`; it never simulates success.

## Security and isolation

- Credentials resolve server-side from `secretReference` and are redacted from logs/UI.
- Webhook verification uses raw bytes before JSON parsing.
- Every event, mapping, outbox record, receivable and charge carries tenant scope.
- Provider base URLs are environment separated.
- Retries are bounded, honor rate limits and feed dead letters/circuit health.
- A health check must authenticate and access the mapped store before activation.

## API and operations UI

The Marketplace page provides order/SLA/receivable visibility, menu preview and sync, incremental price/availability operations, store control, active-order recovery, queue processing and exception diagnostics. Integrations retains connection health, mappings, replay and dead-letter operations. Mobile uses cards rather than a compressed desktop table.

Worker endpoints:

- `POST /api/seramet/integrations/workers/outbox`
- `POST /api/seramet/integrations/workers/scheduled-orders`
- `POST /api/seramet/integrations/workers/recover-marketplace-orders`

## Tests

- `pass-2-integration-engine.test.ts` now includes Pass 3 runtime/accounting acceptance coverage.
- `pass-3-provider-contracts.test.ts` validates captured mock HTTP paths/payloads, signatures, tokens, normalization, menu serialization and explicit Bolt spec gating.
- Existing POS, payment, print, inventory, recipe and Pass 2 tests remain in the full suite.

## Deliberate limitations

- No production credentials, provider approval or whitelisting are bundled.
- No settlement matching, commission posting, promotion deduction posting or bank receipt posting is implemented; those belong to Pass 4.
- Glovo operations not present in the public v2.0.2 Partner specification are not exposed.
- Bolt remains `SPEC_REQUIRED` until an official merchant contract is available.
- The queue/repository interfaces are production-replaceable; local development uses their existing finite local implementations.
