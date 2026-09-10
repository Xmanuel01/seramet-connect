# Pass 1 Platform Foundation

Completed on 29 August 2026. This pass changes Seramet's configuration and domain boundaries without redesigning the existing application.

## Architecture implemented

Seramet now has a tenant-scoped platform model for organisations, optional brands, branches, warehouses, departments, stations, service areas, tables, users, roles, provider connections, payment methods, order channels, hardware devices, print routes, document identities and document templates.

`BranchScope` is represented as either `{ type: "ALL" }` or `{ type: "BRANCH", branchId }`. The phrase "All branches" remains only as display text and is not stored as a branch record.

The main implementation boundaries are:

- `src/platform/types.ts`: stable IDs and configuration domain types.
- `src/platform/schemas.ts`: runtime validation for persisted configuration.
- `src/platform/repositories/configuration-repository.ts`: tenant-filtered configuration queries and mutations.
- `src/platform/permissions.ts`: stable permission codes and mutation requirements.
- `src/platform/migrations/legacy-platform-migration.ts`: schema-versioned migration from arbitrary legacy names to ID-based records.
- `src/integrations/provider-registry.ts`: adapter registration and capability resolution.
- `src/integrations/provider-service.ts`: tenant connection resolution and health checks.
- `src/payments/payment-method-service.ts`: enabled method discovery and provider dispatch.
- `src/payments/settlement-service.ts`: generic invoice settlement validation.
- `src/orders/order-channel-service.ts`: enabled channel discovery.
- `src/platform/adapters/print-profile-adapter.ts`: conversion between platform hardware configuration and the existing print renderer.

## Configuration repositories

Routes no longer own branch, warehouse, payment, channel, integration, role or hardware configuration arrays. The branch, warehouse, settings, integrations, POS, online orders, invoice, pending, table, printer and setup screens read from the active tenant through `ConfigurationRepository`.

Repository mutations validate tenant ownership. Cross-tenant IDs are rejected, and list/get operations always filter by `tenantId`. Browser persistence stores non-sensitive platform configuration under schema version 2. Provider credentials are represented only by opaque `secretReference` values; provider secret fields are removed from frontend configuration before persistence.

## Provider registry

Provider definitions declare category, version, capabilities, configuration schema and secret field names. Feature screens resolve a connection by provider ID and capability; they do not compare provider display names.

Existing Daraja and TendePay behavior was retained behind adapters in `src/integrations/payments`. Unsupported network operations are omitted instead of being simulated. Generic payment and webhook routes resolve tenant connections through `ProviderService`; legacy URL aliases are isolated in `legacy-routes.ts`.

The adapter contract supports payment prompts, QR payments, webhook confirmation, health checks, normalized incoming orders, order acceptance/rejection, status updates, menu and availability synchronization. This is the contract Pass 2 can extend for live delivery providers.

## Payments and order channels

Payment methods are records with a stable code, display name, generic category, enablement, order, reference/customer requirements, refund/split behavior, optional provider connection and settlement account.

Order channels are records with a stable code, generic channel type, customer/table/address requirements, external-payment behavior and optional delivery connection. POS buttons, invoice settlement options and online-order cards are rendered from those records.

## Hardware and documents

Hardware devices use tenant and branch IDs, arbitrary OS device names, connection types and health status. Print routes resolve a document type and optional station to a primary device and optional fallback device. The local bridge discovers installed printers and does not require customer-specific printer names.

The existing KOT, bar ticket, bill, receipt, invoice, addition, cancellation and reprint layouts remain in place. Their content now resolves through:

`tenant -> branch -> document identity -> template -> print route -> device`

Business name, logo, address, phone, email, tax number, currency, payment instructions and footer are configuration records. The hardware setup screen persists capabilities, devices, templates, primary routes and fallback routes.

## Authorization and session scope

Users reference `tenantId`, assigned branch IDs and role IDs. Roles contain stable permission codes. Navigation visibility and protected mutations check permissions rather than role-name allowlists. The selected branch is constrained to the user's assigned branches unless the session has the all-branch permission.

The app context exposes tenant ID, branch scope, current user, permissions, theme and repository-backed configuration. Branch names remain presentational values only.

## Transaction isolation

The transaction repository loads and saves snapshots by tenant ID in memory or D1. Operational records are normalized with tenant and branch IDs, cross-tenant snapshots are rejected, provider events are tenant scoped, and API branch access is authorized against the current actor.

The browser transaction hook starts with a deterministic empty state, then hydrates persisted/backend state after mount. This prevents SSR/client order-number mismatches while preserving the existing offline snapshot behavior.

## Legacy migration

The version 2 migration discovers arbitrary legacy branch, provider, payment, channel and warehouse names; generates stable records; associates operational data with generated IDs; preserves legacy values for display compatibility; and validates the resulting platform state. It does not contain a mapping table for the demo restaurant's branch names.

Legacy analytical fixtures remain available through `src/platform/demo` wrappers so existing screens keep their current content while configuration data comes from repositories.

## UI wiring

The supplied implementation ZIP was merged first, then its platform-facing screens and services were corrected to use the new foundation. Existing sidebar structure, top bar, cards, tables, spacing, colors, typography, dialogs, POS layout and print visuals were retained.

Repository-backed management is available for organisation identity, branches, warehouses, roles and permissions, payment methods, order channels, provider definitions and connections, hardware devices, print routes and document identities/templates.

## Validation

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit` passed.
- Tests: `npm test` passed, 2 files and 55 tests.
- Lint: `npm run lint` passed with 0 errors. Ten existing Fast Refresh warnings remain in shared component/context modules.
- Production build: `npm run build` passed for client, SSR and Nitro output.
- Browser QA: POS, branches, warehouses, settings, integrations, hardware setup, printer health, invoices, online orders and tables rendered successfully.
- Responsive QA: POS at 390 x 844 and invoices at 768 x 1024 had no page-level horizontal overflow. Existing wide tables retain contained horizontal scrolling.
- Browser console: a POS hydration mismatch was found, fixed and rechecked in a clean tab with no errors or warnings.

## Known limitations

- The default local application bootstraps an isolated demo tenant when no authenticated tenant session has been supplied. Production tenant selection must come from the server-side login/session flow in a later pass.
- Platform configuration currently uses a browser persistence adapter for the prototype UI. Its repository contract is ready for a server-backed implementation; secrets are already excluded and must remain in a server-side secret store.
- Analytical sample rows that do not represent platform configuration remain under `src/platform/demo` to preserve the approved UI and current demonstrations.
- Live delivery APIs and undocumented provider operations are not fabricated. They require real provider credentials and specifications in Pass 2.

## Pass 2 readiness

Pass 2 can add adapters through `registry.register(adapter)`, create tenant/branch connections with secret references, normalize external orders, process capability-gated webhooks and record immutable provider events without changing normal POS, order, invoice or settlement screens.
