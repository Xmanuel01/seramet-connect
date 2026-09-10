# Pass 8 - Commercial Productization and Onboarding

## Scope

Pass 8 makes the existing Pass 1-7 platform configurable for a new restaurant without source-code changes. It extends the authoritative database, authenticated API, provider registry, payment orchestration, print engine, inventory ledger, durable workers, audit log, and feature-entitlement boundaries. It does not create parallel order, finance, inventory, integration, or configuration systems.

Browser storage remains limited to local preferences, session selectors, print-bridge connection preferences, and offline command/cache behavior already defined by Pass 5. Setup records, imports, readiness, secrets, opening stock, sign-offs, exports, subscriptions, and go-live transitions are server authoritative.

## Setup Architecture

The Setup Centre uses 18 deterministic stages:

1. Business Profile
2. Branches
3. Users and Roles
4. Menu
5. Inventory
6. Recipes and UOM
7. Suppliers
8. Accounting
9. Taxes and Service Charges
10. Payments
11. Delivery Integrations
12. Kitchen, Stations, and KDS
13. Printers and Devices
14. Documents
15. Opening Stock
16. Testing
17. Readiness
18. Go Live

Each stage is calculated as `NOT_STARTED`, `IN_PROGRESS`, `READY`, `BLOCKED`, or `COMPLETE`. Operators do not mark stages complete manually. The server derives evidence from scoped records and persists stage snapshots and readiness results.

Setup mutations are explicit domain commands in `OnboardingService`. `onboarding-api.ts` authenticates every request, derives tenant identity from the server actor, enforces permissions, validates branch assignments, validates request schemas, and invokes the service. Sensitive commands are not exposed as arbitrary settings JSON writes.

## Organisation and Branch Configuration

Platform-authorized provisioning creates the tenant, initial brand, branch, administrator assignment, onboarding profile, and audit record atomically. Tenant setup then supports additional brands and branches with timezone, business-day cutoff, service modes, warehouses, accounting mode, inventory policy, required device roles, payment requirements, and document configuration as data.

Country, tax rate, currency, branch, provider, printer, station, and restaurant names are not product-wide constants. Country templates may supply proposed values, but finance-impacting settings require explicit persisted configuration.

## Readiness Engine

Readiness is deterministic and evidence based. Each result contains:

- section and code
- tenant or branch scope
- `READY`, `WARNING`, `BLOCKED`, or `NOT_APPLICABLE`
- severity
- message and recommended action
- evidence and source references

Section weights are tenant-configurable basis points. The displayed percentage is the weighted result, not an AI score. Blockers take precedence over percentage. Security and schema blockers are non-overridable.

Important checks include an active administrator with `setup.manage`, branch user assignment, menu data, recipe/UOM validity, opening-stock sign-off, configured and finance-approved account mappings, required payment accounts, provider credentials, trusted devices, print/KDS tests, worker/dead-letter health, database schema, and backup evidence.

## Secure Imports

Menu, inventory, supplier, and staff imports use the Pass 5 file-security boundary:

`upload -> size/type validation -> safe parse -> column mapping -> row validation -> preview -> explicit commit`

The preview persists normalized row outcomes. Duplicate behavior is explicit: `CREATE`, `UPDATE`, `SKIP`, or `ERROR`. Commits require an idempotency key. A repeated commit returns the prior result and cannot duplicate master data. Imports above 500 rows are committed by the durable worker.

Menu import never creates inventory records implicitly. Inventory imports validate integer micro-units and positive rational conversions. Staff imports reject credential/password/PIN columns and reject unknown roles or branch assignments. Supplier import creates no payable or balance.

The POS reads the authoritative menu catalog through a tenant/branch-scoped endpoint. Development fixtures are an explicitly labeled development-only fallback; production fails closed if the catalog cannot be loaded.

## Opening Stock

Opening stock is prepared as a batch with warehouse, business date, quantity micro-units, UOM, and valuation. Review exposes total inventory value and accounting readiness. Approval requires a reason and permission. Posting writes idempotent append-only `OPENING` inventory movements and audit records. It never edits an inventory balance row directly. Posted batches are protected by database immutability triggers.

## Recipe and UOM Validation

Validation reports missing recipes, components, costs, yield, invalid or unavailable conversions, effective-date problems, menu price below cost, and circular dependencies. Cost validation delegates to the Pass 6 recipe/cost service and integer money/micro-unit rules. The assistant reports evidence and does not auto-fix recipes.

## Accounting, Tax, and Service Rules

Account mapping uses existing account IDs for inventory, COGS, revenue, tax, service charge, discounts, refunds, wastage, variance, payables, fees, commission, cash, bank/clearing, and opening balances. Mappings carry requirement, status, scope, and finance sign-off. Required mappings must be both configured and approved before finance readiness.

Tax and service-charge rules are tenant/branch records with rate basis points, inclusive/exclusive treatment, effective dates, rounding mode, and account mapping. No VAT rate is globally assumed.

## Providers and Mappings

Payment and delivery setup discovers adapters through the existing provider registry. The UI renders registry metadata, declared capabilities, environment, health, masked credential metadata, callback information, and branch/account scope. Credential values are written through `ManagedSecretStore` and are never returned by setup APIs, diagnostics, exports, audit events, or logs.

Provider connection setup is feature-entitlement gated and does not add provider-specific business logic to POS. Availability sync is offered only when the selected adapter declares the capability. External store, product, and modifier mappings use explicit `UNMAPPED`, `MAPPED`, `CONFLICT`, or `DISABLED` records. Suggested ambiguous matches remain uncommitted until reviewed.

## Devices, Documents, and Tests

Device configuration records type, branch, station, role, local/network identifier, capabilities, fallback route, paper size, trust state, and observed health. When no device agent has reported health, the UI shows `UNKNOWN`.

Document templates retain the existing Seramet layouts while making identity, logo reference, branch fields, footer, tax ID, payment instructions, bank/till display, QR position, field visibility, KOT prices, width, and copies configuration driven. Incomplete print configuration does not crash POS, invoices, receipts, or hardware setup. Printing fails closed with a visible setup requirement.

Test prints are marked `*** TEST PRINT ***`, store a test outcome, and create no sale, invoice, payment, journal, or inventory movement. Test orders are setup test records only; they do not enter live finance, tax, settlement, or inventory facts.

## Workers and Health

Durable workers handle readiness recalculation, large import commit, support diagnostics export, tenant data export, and demo reset. Jobs retain idempotency, attempts, lease/claim state, status, errors, and correlation IDs. Worker failures flow through existing retry/dead-letter behavior and affect readiness.

Integration and device health use stored provider events, outbox/dead-letter state, connection status, device snapshots, and observed timestamps. Missing evidence is `UNKNOWN`, never fabricated success.

## Commercial Controls

Feature flags, entitlements, and subscription lifecycle events are server authoritative. Feature flags cannot grant permissions. Entitlements are enforced by setup services, including branch limits and integration access. Subscription states are `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, and `CANCELLED`; state changes append lifecycle records and never delete tenant data. Export access remains available according to authorization and retention policy.

The explicit demo tenant is isolated, visibly marked, contains no live credentials, and can only be reset in development/test through a permissioned durable command. A live tenant cannot be reset through this path.

## Diagnostics, Migration, and Export

Diagnostics expose app/schema version, environment, readiness, branch counts, worker/queue/dead-letter state, provider/device state, feature flags, and redacted recent errors. Export generation is durable, scoped, bounded, audited, and allowlisted. Provider secrets, bearer tokens, passwords, card data, and raw credentials are excluded.

Migration health reports actual database schema version 9 and required version 9. Migrations remain deployment controlled; no browser API executes SQL. Backup readiness reports configured, last success, rehearsal date, or `UNKNOWN` from infrastructure evidence.

Tenant offboarding exports are requested by authorized actors, processed as durable jobs, redacted, bounded by entity-specific limits, and retrieved only within the requesting tenant.

## Go-Live State Machine

Allowed transitions are:

- `SETUP -> READY_FOR_REVIEW` or `SUSPENDED`
- `READY_FOR_REVIEW -> SETUP`, `READY_FOR_GO_LIVE`, or `SUSPENDED`
- `READY_FOR_GO_LIVE -> READY_FOR_REVIEW`, `LIVE`, or `SUSPENDED`
- `LIVE -> SUSPENDED`
- `SUSPENDED -> READY_FOR_REVIEW`

Transition to `LIVE` reruns authoritative readiness. Eligible operational warnings may be overridden only with `setup.go_live.override`, an explicit reason, and an audit event. Authentication, tenant isolation, database, and schema integrity blockers cannot be overridden. Go-live events are append-only.

## Security

- Tenant ID comes from the authenticated actor, not request ownership claims.
- Branch reads and mutations validate actor assignments.
- Runtime schemas reject malformed or unknown sensitive fields.
- Import body size, file type, row count, and workbook structure are bounded.
- Secrets use a server-side secret-store boundary and masked metadata.
- Export tables and columns are allowlisted and tenant filtered.
- Provider/test/demo operations remain environment gated.
- Material setup actions append authoritative audit events without secrets.
- No Pass 8 P0 or P1 finding remains.

## Performance Evidence

The reproducible fixture contains 50 branches, 1,001 users, 5,000 menu items, 10,000 inventory items, 1,000 suppliers, 10,000 recipe components, and multiple devices/providers. The final parallel test run measured:

| Operation | Time |
| --- | ---: |
| Setup summary | 21.34 ms |
| Readiness check | 22.85 ms |
| Branch listing | 2.95 ms |
| Integration health | 10.06 ms |
| Menu catalog | 64.00 ms |
| Menu import preview | 209.02 ms |
| Menu import queue | 2.25 ms |
| Menu import worker commit | 654.52 ms |
| Inventory import preview | 263.92 ms |

These are local test-environment measurements, not production scale claims.

## Limitations

- Production payment and marketplace providers still require real credentials, approval, and provider certification.
- Printer/KDS success requires installed trusted device agents and physical route tests.
- Backup success and restore rehearsal depend on deployment infrastructure and remain `UNKNOWN` until evidence is supplied.
- Large commercial exports should use managed object storage in production; the current worker payload is deliberately bounded.
- Public self-service signup, billing checkout, and automated subscription charging are outside this pass. Platform-authorized tenant provisioning and lifecycle controls are implemented.
- A newly provisioned tenant is intentionally blocked from go-live until its own finance, hardware, provider, opening-stock, and operations evidence is complete.
