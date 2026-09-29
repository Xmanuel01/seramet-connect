# Pass 8 Completion Report

## Result

**PASS 8 COMPLETE**

All 80 acceptance criteria passed. The product implementation is commercially configurable; an individual restaurant remains blocked from `LIVE` until its own provider credentials, physical hardware tests, finance/operations sign-offs, opening stock, and infrastructure evidence are complete.

## Acceptance Matrix

| # | Criterion | Result | Evidence |
| ---: | --- | :---: | --- |
| 1 | Existing Pass 1-7 regression suite passes | PASS | Full 13-file suite: 246/246 |
| 2 | Historical authoritative DB suites remain included/documented | PASS | Pass 5: 19; Pass 6: 35 plus Pass 5 19 = prior 54; Pass 7: 20 |
| 3 | Organisation creation is server-authoritative | PASS | Permissioned atomic `provisionOrganisation` command |
| 4 | Brand/branch creation is configuration-driven | PASS | Persisted brand/branch commands and operating profiles |
| 5 | No hardcoded restaurant assumptions introduced | PASS | Production hardcode scan clean; demo data isolated in seeds/fixtures |
| 6 | Setup wizard persists authoritative state | PASS | Schema-9 setup tables and authenticated API |
| 7 | Readiness is derived from real configuration | PASS | Server evidence queries and persisted snapshots |
| 8 | Critical blockers prevent unsafe go-live | PASS | Transition reruns readiness and rejects blockers |
| 9 | Go-live override requires permission and reason | PASS | `setup.go_live.override`, non-empty reason, audit |
| 10 | Security/schema blockers cannot be overridden | PASS | Non-overridable blocker classification |
| 11 | Menu import uses preview before commit | PASS | Persisted preview required by commit command |
| 12 | Menu import validates malformed rows | PASS | Runtime/file/row validation tests |
| 13 | Duplicate menu import commit is idempotent | PASS | Import ID and idempotency-key uniqueness |
| 14 | Inventory import uses rational UOM validation | PASS | Integer numerator/denominator validation |
| 15 | Invalid conversion is rejected | PASS | Dimension/factor/cycle checks |
| 16 | Supplier import is tenant scoped | PASS | Actor tenant applied server-side |
| 17 | Staff import does not accept plaintext passwords | PASS | Credential/PIN/password columns rejected |
| 18 | Invalid role/branch assignment is rejected | PASS | Authoritative role and branch resolution |
| 19 | Opening stock uses append-only movements | PASS | Pass 6 `OPENING` movement posting |
| 20 | Duplicate opening stock submission is idempotent | PASS | Batch/post keys and movement uniqueness |
| 21 | Opening stock reconciliation is visible | PASS | Quantity/value/account readiness summary |
| 22 | Recipe validation identifies missing recipe | PASS | Validation issue output and tests |
| 23 | Recipe validation identifies invalid conversions | PASS | UOM evidence checks |
| 24 | Recipe validation identifies cycles | PASS | Graph cycle detection |
| 25 | Accounting mapping readiness is accurate | PASS | Required/configured/approved/invalid states |
| 26 | Missing required account prevents finance-ready state | PASS | Accounting blocker calculation |
| 27 | Tax/service rules are configuration-driven | PASS | Scoped basis-point/effective-date records |
| 28 | Payment provider setup uses provider registry | PASS | Registry definitions and capability metadata |
| 29 | Payment credentials stay server-side | PASS | Managed secret-store write boundary |
| 30 | Payment secret is never returned after storage | PASS | Masked metadata only; leakage tests |
| 31 | Marketplace setup uses integration registry | PASS | Generic provider connection command |
| 32 | Store mapping is explicit | PASS | Persisted external mapping records |
| 33 | Ambiguous product mapping is not silently committed | PASS | Conflict/unmapped state requires review |
| 34 | Availability sync comes from provider capability | PASS | Capability-gated mapping/setup behavior |
| 35 | Printer/device config is data-driven | PASS | Hardware/device and route records |
| 36 | Test print creates no financial transaction | PASS | Setup test record only |
| 37 | Test print is visibly marked TEST | PASS | Payload contains `*** TEST PRINT ***` |
| 38 | Document branding contains no hardcoded restaurant | PASS | Identity/template records drive rendering |
| 39 | Test order does not affect live financial facts | PASS | Isolated setup test run |
| 40 | Integration health reports real state or UNKNOWN | PASS | Provider/outbox/event evidence; no invented heartbeat |
| 41 | Device health reports real state or UNKNOWN | PASS | Device snapshots and observed timestamps |
| 42 | Demo tenant is isolated | PASS | Explicit development seed and demo flag |
| 43 | Demo reset cannot affect live tenants | PASS | Environment, permission, and demo-mode guards |
| 44 | Feature entitlements are server enforced | PASS | Service assertions and branch/provider gates |
| 45 | Subscription state does not destroy tenant data | PASS | Append-only lifecycle events only |
| 46 | Feature flags are server authoritative | PASS | Server persistence and commands |
| 47 | Feature flags cannot bypass permission checks | PASS | Permission checks execute independently |
| 48 | Support diagnostics contain no secrets | PASS | Redacted allowlisted payload and tests |
| 49 | Diagnostics export is tenant scoped | PASS | Durable tenant-bound export job |
| 50 | Migration health reports actual schema version | PASS | Actual `schema_migrations`, version 9 required 9 |
| 51 | Browser cannot execute arbitrary migrations | PASS | No migration mutation/API SQL endpoint |
| 52 | Tenant data export is authorized and scoped | PASS | `setup.export`, actor tenant, allowlisted tables |
| 53 | Export is auditable | PASS | Request/completion audit and job records |
| 54 | Go-live state transition is audited | PASS | Append-only go-live/audit events |
| 55 | Payment/delivery connection changes are audited | PASS | Generic provider setup audit |
| 56 | Configuration changes are tenant scoped | PASS | Actor tenant is service scope |
| 57 | Cross-tenant setup access fails | PASS | Direct service/API isolation tests |
| 58 | Cross-branch setup access fails | PASS | Assignment validation tests |
| 59 | Secret leakage tests pass | PASS | No readback/diagnostic/export/audit secret |
| 60 | Import file validation/security tests pass | PASS | Size, type, rows, structure, malformed input |
| 61 | Durable setup jobs are idempotent | PASS | Durable key and persisted job state |
| 62 | Durable setup jobs retry/dead-letter correctly | PASS | Existing worker retry/dead-letter plus Pass 8 cases |
| 63 | Desktop QA passes | PASS | 1440x900 Setup/POS/import/go-live/devices/docs |
| 64 | Tablet QA passes | PASS | 1024x768 Setup/printers/invoices/receipts |
| 65 | Mobile QA passes | PASS | 390x844 Setup/import/POS |
| 66 | No page-level overflow | PASS | Browser client/scroll widths equal at required sizes |
| 67 | Browser console clean | PASS | No warning/error entries in final QA |
| 68 | TypeScript passes | PASS | `tsc --noEmit` exit 0 |
| 69 | Lint passes | PASS | ESLint exit 0, 0 errors; 15 existing Fast Refresh warnings |
| 70 | Production build passes | PASS | Vite client build exit 0 |
| 71 | SSR build passes | PASS | Vite SSR build exit 0 |
| 72 | Nitro/Cloudflare build passes | PASS | Nitro cloudflare-module output exit 0 |
| 73 | Database tests pass | PASS | Pass 5 authoritative DB: 19/19; full DB coverage included |
| 74 | Concurrency/idempotency tests pass | PASS | Concurrent filter 4/4; import/opening/provider tests in full suite |
| 75 | Performance fixture runs/reports timings | PASS | Realistic fixture and measured table below |
| 76 | No new P0/P1 security issue exists | PASS | TypeScript server security review clean |
| 77 | Production hardcode audit is clean | PASS | No restaurant/provider display-name business decisions in Pass 8 core |
| 78 | Setup documentation exists | PASS | `PASS_8_COMMERCIAL_PRODUCTIZATION_ONBOARDING.md` |
| 79 | Go-live checklist exists | PASS | `PASS_8_GO_LIVE_CHECKLIST.md` |
| 80 | Completion report is honest about limitations/blockers | PASS | Limitations and pilot blockers below |

## Validation

- Full suite: 13 files, 246/246 tests passed.
- Pass 8 setup/import/security: 35/35 passed.
- Pass 8 load: 1/1 passed.
- Pass 5 authoritative database: 19/19 passed.
- Concurrency selection: 4 passed, 15 unrelated tests skipped by filter.
- Offline/reconnect selection: 2 passed, 17 unrelated tests skipped by filter.
- Historical coverage: Pass 6's prior 54 total is the 35 Pass 6 database tests plus the 19 Pass 5 production-foundation tests. Both still run. Pass 7 now has 20 database-backed tests; none were removed.
- TypeScript: passed.
- Lint: passed with 0 errors and 15 pre-existing Fast Refresh warnings.
- Build: client, SSR, and Nitro Cloudflare-module passed.
- Browser: required desktop/tablet/mobile sizes passed with no console errors or page-level overflow.

## Migration

Migration `0009_commercial_productization_onboarding.sql` records schema version 9 and adds the canonical permission catalog, 22 tables, 17 indexes, and 6 immutability triggers.

Tables:

`tenant_onboarding_profiles`, `branch_operating_profiles`, `setup_section_weights`, `setup_stage_snapshots`, `setup_readiness_results`, `setup_imports`, `setup_import_rows`, `menu_catalog_items`, `menu_item_branch_settings`, `opening_stock_batches`, `opening_stock_lines`, `setup_account_mappings`, `tax_service_rules`, `setup_signoffs`, `setup_test_runs`, `device_health_snapshots`, `provider_secret_metadata`, `subscription_lifecycle_events`, `support_diagnostic_exports`, `tenant_data_export_jobs`, `go_live_events`, and `setup_recalculation_events`.

Immutability triggers protect posted opening stock, go-live events, and subscription lifecycle records from update/delete.

## Files Created

- `migrations/0009_commercial_productization_onboarding.sql`
- `migrations/seed/pass8-demo.sql`
- `src/hooks/use-operational-menu.ts`
- `src/onboarding/onboarding-service.ts`
- `src/onboarding/pass-8-commercial-productization.test.ts`
- `src/onboarding/pass-8-load.test.ts`
- `src/onboarding/schemas.ts`
- `src/onboarding/types.ts`
- `src/onboarding/ui.tsx`
- `src/onboarding/use-setup-centre.ts`
- `src/server/onboarding-api.ts`
- `docs/PASS_8_COMMERCIAL_PRODUCTIZATION_ONBOARDING.md`
- `docs/PASS_8_GO_LIVE_CHECKLIST.md`
- `docs/PASS_8_COMPLETION_REPORT.md`

## Files Modified

`.gitignore`, `eslint.config.js`, `migrations/seed/pass7-demo.sql`, `package.json`, `src/components/app/ui.tsx`, `src/hooks/use-seramet-print-queue.ts`, historical Pass 5-7 test schema expectations, `src/lib/seramet-api.ts`, `src/lib/seramet-print-service.ts`, `src/platform/demo/legacy-ui-fixtures.ts`, `src/platform/permissions.ts`, `src/platform/schemas.ts`, `src/routes/invoices.tsx`, `src/routes/menu-import.tsx`, `src/routes/pos.tsx`, `src/routes/receipts.tsx`, `src/routes/seramet-printers.tsx`, `src/routes/seramet-setup.tsx`, `src/server/database/authoritative-configuration.ts`, `src/server/database/local-development-database.ts`, `src/server/database/sqlite-test-adapter.ts`, `src/server/file-import-security.ts`, `src/server/secrets.ts`, `src/server/workers.ts`, and `vite.config.ts`.

## Product Areas

- Setup Centre: authoritative 18-stage guided setup with transparent progress and evidence.
- Imports: secure menu, inventory, supplier, and staff preview/commit with idempotency and durable bulk processing.
- Opening stock: controlled review, approval, posting, reconciliation, and append-only movement trace.
- Finance: account mappings, finance sign-off, tax/service rules, and blockers.
- Integrations: provider-registry setup, capability display, masked credential metadata, explicit store/menu mappings, and real/unknown health.
- Hardware/documents: trusted devices, routes, templates, test output, and graceful incomplete setup states.
- Commercial controls: entitlements, flags, lifecycle events, isolated demo reset, diagnostics, export, and go-live state machine.

## Performance

Final parallel local fixture measurements:

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

## Security Review

No Pass 8 P0/P1 issue remains. Authentication and permission enforcement are server-side. Tenant/branch scope is actor derived. Credential values stay in the managed secret boundary. Setup imports and exports are bounded, validated, allowlisted, audited, and tenant scoped. Go-live cannot override authentication/schema integrity failures. Demo/test provider activity is environment restricted. No card or payment secret storage was introduced.

## Known Limitations

- Live provider certifications and credentials are external operational work.
- Physical printer/KDS/device validation cannot be completed without installed hardware agents.
- Backup success and restore rehearsal are infrastructure evidence and deliberately remain `UNKNOWN` until configured.
- Large exports require managed object storage for production scale; current worker payloads are bounded.
- Self-service public signup, subscription billing checkout, and automated charging are not included.
- The development demo tenant intentionally remains in `SETUP`; product completeness is not a claim that this demo configuration is safe for live service.

## Pilot Blockers

Before the first restaurant pilot:

1. Deploy production JWT identity, HTTPS, managed database, durable queue, and managed secret store.
2. Apply schema 9 and verify backup plus restore rehearsal.
3. Provision the pilot tenant and complete finance/operations sign-offs.
4. Configure certified live payment and delivery credentials/store mappings.
5. Register trusted POS/KDS/printer devices and pass physical routing/fallback tests.
6. Import and approve the restaurant's real menu, inventory, recipes, suppliers, staff, opening stock, and account/tax mappings.
7. Run payment, refund, settlement, offline/reconnect, EOD, KDS/KOT, availability, and rollback rehearsals.
8. Resolve all readiness blockers before the authorized transition to `LIVE`.
