# Pass 5 Completion Report

Validated 30 August 2026 against the merged active Seramet checkout.

## 1. Acceptance criteria

| # | Result | Evidence |
|---:|:---:|---|
| 1 | PASS | Production transaction and configuration state uses the authoritative server repository. |
| 2 | PASS | `D1AuthoritativeTransactionRepository` is wired through the server API. |
| 3 | PASS | Six ordered migrations and schema-version validation exist. |
| 4 | PASS | Server identity scopes every repository call; composite tenant foreign keys are tested. |
| 5 | PASS | Provider, document, settlement, outbox, inventory and migration uniqueness is database enforced. |
| 6 | PASS | Concurrent payment confirmation produces one immutable transaction effect. |
| 7 | PASS | Refund-capacity and correlation constraints prevent double refund. |
| 8 | PASS | Settlement transition and posted-state guards prevent double posting. |
| 9 | PASS | Inventory and goods-receipt mutation references are idempotent. |
| 10 | PASS | Development-header auth requires explicit development, explicit opt-in and localhost; production rejects it. |
| 11 | PASS | HS256 bearer JWT signature, issuer, audience, expiry and identity claims are validated. |
| 12 | PASS | Sensitive APIs enforce server-side permission codes. |
| 13 | PASS | Revoked, expired and credential-version-invalidated sessions are rejected. |
| 14 | PASS | Devices have PENDING/ACTIVE/REVOKED server state and revocation checks. |
| 15 | PASS | IndexedDB offline commands carry actor/device/sequence/idempotency and typed sync status. |
| 16 | PASS | Offline cash commands replay once after reconnect. |
| 17 | PASS | Digital confirmation is rejected by offline policy. |
| 18 | PASS | Document sequences use atomic tenant/branch/type/period upsert-returning. |
| 19 | PASS | Production worker jobs, outbox state, leases, retries and dead letters are durable. |
| 20 | PASS | Lease ownership plus provider idempotency prevents duplicate sends. |
| 21 | PASS | Scheduled-order release runs in the server scheduler, not a browser. |
| 22 | PASS | Liveness, readiness and authorized operational health endpoints exist. |
| 23 | PASS | Production readiness rejects missing DB/queue/identity/secrets/HTTPS and unsafe flags. |
| 24 | PASS | SecretStore is server-only; browser access tokens are memory-only. |
| 25 | PASS | Audit events are server-side, append-only and immutable. |
| 26 | PASS | Posted journal entries/lines are database immutable and must balance. |
| 27 | PASS | Closed business dates reject unauthorized financial mutation; reopen requires permission/reason/audit. |
| 28 | PASS | Business date is calculated server-side from branch timezone and cutoff. |
| 29 | PASS | Bounded cursor queries and server aggregate services cover high-volume operational reads. |
| 30 | PASS | Snapshot migration is explicit, previewed, mapped, checksummed, reconciled and idempotent. |
| 31 | PASS | Staging is a first-class production-like environment with sandbox-provider policy. |
| 32 | PASS | Production startup rejects test adapters, demo secrets and sandbox-as-live configuration. |
| 33 | PASS | POS exposes online/offline/reconnecting/sync-issue states without changing the approved UI. |
| 34 | PASS | Pass 1-4 tests and browser workflows remain operational. |
| 35 | PASS | Existing invoice, receipt, KOT and print layouts were not redesigned. |
| 36 | PASS | Hardcode audit found no new restaurant/branch/provider display-name business logic. |
| 37 | PASS | Database integration suite: 19/19 passed. |
| 38 | PASS | Concurrency selection: 4/4 passed. |
| 39 | PASS | Offline/reconnect selection: 2/2 passed. |
| 40 | PASS | TypeScript, lint, production build and full 153-test suite passed. |
| 41 | PASS | Original P0 authentication finding is CLOSED. |
| 42 | PASS | Original P0 persistence finding is CLOSED. |

## 2-8. Validation results

- Total tests: **153 passed**, 7 test files.
- TypeScript: **PASS**, `tsc --noEmit`.
- Lint: **PASS**, `eslint .`, zero errors.
- Production build: **PASS**, Vite client + SSR + Nitro Cloudflare module output.
- Database integration: **PASS**, 19/19.
- Concurrency: **PASS**, 4 selected tests passed, 15 unrelated tests skipped by filter.
- Offline/reconnect: **PASS**, 2 selected tests passed, 17 unrelated tests skipped by filter.
- Load foundation: **PASS**, 1/1.
- Browser QA: **PASS** at 1280x720, 768x1024 and 390x844 for POS, payment controls, KDS and System Health; no page-level horizontal overflow and no post-fix console errors. Development System Health correctly reports degraded readiness without a DB/queue binding.

## 9. Files created

- Environment/docs: `.env.example`, `docs/AUTH_AND_DEVICE_SECURITY.md`, `docs/DATABASE_MIGRATION_RUNBOOK.md`, `docs/OFFLINE_SYNC_ARCHITECTURE.md`, `docs/PASS_5_COMPLETION_REPORT.md`, `docs/PASS_5_PRODUCTION_FOUNDATION.md`, `docs/PASS_5_SECURITY_REVIEW.md`, `docs/PRODUCTION_DATA_ARCHITECTURE.md`, `docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md`, `docs/WORKER_AND_QUEUE_ARCHITECTURE.md`.
- Migrations/seeds: `migrations/0001_production_schema.sql` through `0006_concurrency_guards.sql`, `migrations/seed/development.sql`, `migrations/seed/demo.sql`.
- Client/offline: `src/cost-control/types.ts`, `src/lib/access-token.ts`, `src/offline/offline-store.ts`, `src/offline/types.ts`, `src/routes/system-health.tsx`.
- Server/database: `src/server/business-date.ts`, `configuration-api.ts`, `environment.ts`, `errors.ts`, `file-import-security.ts`, `logging.ts`, `offline-sync-api.ts`, `operations-api.ts`, `rate-limit.ts`, `secrets.ts`, `workers.ts`, `migrations/snapshot-import.ts`, and every file under `src/server/database/`.
- Tests: `src/server/pass-5-production-foundation.test.ts`, `src/server/pass-5-load.test.ts`.

## 10. Files modified

- Foundation/runtime: `.gitignore`, `package.json`, `local-print-bridge/server.mjs`, `src/server.ts`, `src/routeTree.gen.ts`, `src/styles.css`, `docs/HARDCODE_AUDIT.md`.
- App/domain: `src/components/app/nav.ts`, `src/hooks/use-transaction-engine.ts`, `src/lib/app-context.tsx`, `seramet-api.ts`, `seramet-auth.ts`, `seramet-repository.ts`, `transaction-engine.ts`, `seramet-flows.test.ts`.
- Integration/payment/platform: `src/integrations/pass-2-integration-engine.test.ts`, runtime `create-runtime.ts`, `integration-repository.ts`, `integration-runtime.ts`, `outbox-service.ts`, `queue.ts`; `src/payments/pass-4-payments.test.ts`, `reconciliation-engine.ts`; `src/platform/permissions.ts`, `platform-foundation.test.ts`, `types.ts`, `repositories/configuration-repository.ts`.
- Routes: `attendance.tsx`, `bar.tsx`, `breakages.tsx`, `cost-control.tsx`, `delivery.tsx`, `inventory.tsx`, `invoices.tsx`, `kitchen.tsx`, `orders.tsx`, `par.tsx`, `payment-control.tsx`, `payroll.tsx`, `pending.tsx`, `period-close.tsx`, `pos.tsx`, `purchase-orders.tsx`, `receipts.tsx`, `receiving.tsx`, `reconciliation.tsx`, `refunds.tsx`, `riders.tsx`, `wastage.tsx`.

## 11. Database tables and migrations

Six migrations create **84 tables**, **26 non-unique indexes**, **7 explicit unique indexes** and **31 triggers**.

- Core/configuration: tenants, brands, branches, warehouses, departments, stations, service areas, restaurant tables, permissions, roles, role permissions, users, user roles/branches, sessions, devices, providers, payment methods, order channels, accounts and document sequences.
- Operations/finance: orders/items/modifiers/events/station status, invoices/lines, receipts, payment intents/transactions/allocations/collections/refunds/disputes, cash drawers/movements, bank transactions, marketplace receivables/charges, settlements/lines, reconciliation sessions/matches/exceptions, journals/lines and day closes.
- Inventory/people/printing: inventory items/balances/movements, recipes/components, wastage, breakages, purchase orders/lines, goods receipts, employees, attendance, print routes, document identities/templates and audit events.
- Reliability: authoritative records/read models/mutation commits, provider events/mappings, integration outbox/dead letters/runtime records, worker jobs, offline commands, rate-limit buckets, secret versions, feature flags, plans/subscriptions/entitlements, retention policies, backup records and migration runs.
- `schema_migrations` records versions 1-6. Development and demo seeds are separate; neither is part of production migration.

## 12. Database constraints

- Composite tenant foreign keys prevent cross-tenant relationships.
- Unique provider event/reference/order/settlement/document/movement/outbox/idempotency keys reject duplicate effects.
- Allocation and refund-capacity triggers prevent over-allocation and over-refund under concurrency.
- Confirmed payments, allocations, audit events, posted journals/lines, posted settlements/lines and inventory movements cannot be rewritten/deleted.
- Journals must begin DRAFT and balance before POSTED; settlement transitions and cash close are one-way.
- Closed-day, open-drawer, document-identity and invoice-allocation guards execute in the database.

## 13. Authentication architecture

The replaceable server identity boundary validates HS256 JWT signature, issuer, audience, expiry, `sub`, tenant and session. The authoritative session then resolves user, credential version, roles, permissions, branch assignments and optional device. Request tenant/branch/role headers never establish production authority. Production/staging fail startup if bearer identity configuration is incomplete or development authentication is enabled.

## 14. Session and device architecture

Sessions record tenant, user, issued/expiry/revoked/last-seen and credential version. Logout/revoke, expiry and credential invalidation are enforced. Devices are server-registered as POS/KDS/printer/manager/self-service/other, assigned to a tenant/branch, and move through PENDING, ACTIVE or REVOKED. A revoked device cannot authenticate or synchronize.

## 15. Durable workers

The existing queue abstraction now has a production durable implementation backed by queue delivery plus database job/outbox rows. Jobs store lease owner/expiry, attempts, due time, status, duration, error and correlation. Workers cover integration outbox, marketplace recovery/scheduled release, menu/availability sync, payment verification, settlement/reconciliation, EOD aggregation and notifications. Retry exhaustion creates dead letters.

## 16. Offline synchronization

POS writes typed `OfflineCommand` records with device sequence and idempotency key. Allowed cash/order commands update the local read cache and can print one local KOT. Reconnect submits commands to the server, which rebinds tenant/branch/actor/device from authenticated identity and returns accepted/duplicate/conflict/rejected. Financial conflicts never use last-write-wins. Digital confirmation, settlement, reconciliation and permissions remain server-only.

## 17. Browser/local persistence that remains

- IndexedDB: replaceable offline read cache, pending command queue, client sequence and local print-once marker.
- localStorage: non-sensitive UI preferences such as theme/sidebar/branch scope and local print-bridge/device preferences.
- Explicit development only: local configuration and transaction snapshots for developer/demo startup.
- Memory only: bearer access token.
- Forbidden as browser authority: orders, payments, allocations, journals, refunds, settlements, inventory movements, drawers, EOD, provider events and audits.

## 18. Concurrency trace: duplicate M-Pesa callback

Two callbacks with the same provider connection/event/reference enter the Integration Runtime concurrently. Adapter verification and event idempotency run first. Both reach the authoritative mutation boundary, but provider-event/reference uniqueness, mutation idempotency and revision checks allow one commit. That single atomic commit creates one confirmed payment transaction, allocation, invoice status effect, receipt event, journal effect and reconciliation expectation. The loser resolves as duplicate/conflict and creates no second effect.

## 19. Offline trace: cash order to reconnect

Cashier creates order offline -> POS writes one command ID/device sequence -> local read cache updates -> KOT prints once with local print marker -> reconnect submits the command -> server authenticates actor/device and scopes tenant/branch -> atomic command creates authoritative order, cash payment, drawer movement, journal/outbox and KDS state -> server returns accepted -> local command becomes SYNCED -> replay returns duplicate and does not print/consume/pay again.

## 20. Failure trace: provider succeeds, worker crashes

Worker leases an outbox row and calls the provider with the stable provider idempotency key -> provider succeeds -> worker crashes before marking success -> lease expires -> replacement worker claims the same row -> retry uses the same idempotency key -> provider returns the original operation/result -> database uniqueness preserves one external effect -> outbox/job becomes succeeded. If retries exhaust, the job is dead-lettered for operator action instead of silently disappearing.

## 21. Tenant-isolation trace

Tenant A bearer token resolves Tenant A on the server -> repository calls require Tenant A -> a payload naming Tenant B is ignored/rejected -> Tenant B branch assignment fails authorization and composite foreign keys -> direct cross-tenant insert fails in database tests -> no read, mutation, refund, match, reconcile or post operation crosses the tenant boundary.

## 22. Snapshot migration result

The database test migrated an explicit legacy fixture containing one mapped order. Preview and apply succeeded, the target branch mapping was enforced, a second apply reused the same source checksum, and `data_migration_runs` remained one row. The report model records read/migrated/skipped counts, duplicates, invalid references, financial totals and inventory totals. No real user browser snapshot was automatically read or imported during this pass.

## 23. Performance/load baseline

Measured with the Node SQLite D1-compatible test adapter; these are engineering baselines, not production marketing claims:

| Operation | Time |
|---|---:|
| Create 50 POS orders | 3.05 ms |
| Load active orders | 2.11 ms |
| Cash payment | 0.46 ms |
| Payment confirmation | 0.18 ms |
| KDS update | 0.09 ms |
| Inventory lookup | 0.62 ms |
| Marketplace webhook burst | 7.33 ms |
| Payment callback burst | 6.77 ms |
| 200 availability updates | 23.14 ms |
| EOD aggregate query | 1.42 ms |

## 24. Security review

Verified controls include fail-closed production auth/readiness, tenant/branch/permission enforcement, append-only audit, immutable finance records, concurrency constraints, server-only secrets, trusted HTTPS callback configuration, redacted structured logs, bounded request/import sizes, file signature/row validation and rate limiting. Open deployment findings are: P1 edge CSP integration compatible with SSR nonces/hashes; P1 external IdP/MFA policy; P1 managed backup/restore and malware scanning; P1 provider certification; P2 managed-device controls for cached offline data. See `docs/PASS_5_SECURITY_REVIEW.md`.

## 25-26. Original P0 status

- Authentication development-header fallback in production: **CLOSED**.
- Browser/snapshot authoritative financial persistence: **CLOSED**.

## 27. Remaining blockers before the first restaurant pilot

1. Provision production D1, durable queue/scheduler, HTTPS callback host and managed secrets.
2. Integrate the selected production IdP, MFA/recovery and managed device enrollment/revocation procedures.
3. Configure and test edge CSP, centralized logs/alerts, rate policies and support diagnostics.
4. Run backup automation plus a documented restore drill; connect malware scanning for file imports.
5. Complete Daraja/Pesapal merchant certification and callback/IPN verification; keep undocumented TendePay operations `SPEC_REQUIRED`.
6. Run staging soak/load/failure tests against production-like DB/queue bindings and real printer/KDS devices.
7. Execute a controlled legacy-data migration preview and reconcile financial/inventory totals before any apply.

Pass 5 is complete at the application-foundation level because both original P0 findings are closed. The listed blockers are deployment and certification work required before handling live restaurant money.
