# Phase 3 database and financial validation

This is a validation scope record, not production certification. Current deployed
environment findings and security incident evidence belong in the owner's
restricted authoritative validation record, not this public repository.

## Verified corrections

- `inspect-staging-backlog.mjs` now counts expired and missing CLAIMED/RUNNING
  leases inside its existing read-only transaction. Either condition blocks the
  staging release CLI. Active leases and terminal jobs are excluded; missing or
  malformed evidence fails closed. No job is retried, deleted, or updated.
- `verify-certification-schema-postgres.mjs` no longer expects an obsolete
  27-version database after the runner applies all migrations. It compares every
  version, name and checksum marker to the current migrations executed in an
  isolated in-memory SQLite schema. It checks the 18 final menu/workforce tables
  and their RLS flags on disposable real PostgreSQL. These ledger markers are
  not cryptographic hashes of PostgreSQL object definitions.
- Regular CI runs the schema checker and its negative tests, rather than relying
  on the manually dispatched comprehensive workflow. The comprehensive evidence
  identifier is `schema-current-rls`.
- The existing disposable PostgreSQL lockdown verifier also exercises expired,
  missing, active and terminal leases with temporary tables. It checks that the
  inspector leaves all fixture rows unchanged and rolls back a malformed lease
  query. No deployed database is accepted by this verifier.

## Existing Evidence To Reuse

The complete candidate at `15ee9f9ebaee1031aac610d6f57d296235d394ba`
passed the following checks. Later corrections need their own affected-check
results; these earlier passes do not certify an untested revision.

| Requirement | Existing executable evidence | Limit |
| --- | --- | --- |
| Tenant/branch access and database invariants | `pass-5-production-foundation.test.ts`, `verify-crm-postgres.mjs`, `verify-pos-postgres.ts` | Application actor scope is separate from the deployed database role and Data API grants |
| Source-linked invoices, balanced journals, immutability and approval rollback | `pos-invoice-ledger.test.ts`, `verify-finance-postgres.ts` (PostgreSQL 16/17) | Does not certify historical/live records or provider settlement |
| Partial/split payments, refunds, cash reconciliation, marketplace deductions | `pass-4-payments.test.ts`, `daily-closing-repository.test.ts`, `financial-ledger-service.test.ts` | Test-provider callbacks are not real M-Pesa acceptance |
| Inventory movements, receiving and procurement | `inventory-procurement-regression.test.ts` (SQLite/PGlite), foundation concurrency checks | Does not alone establish a deployed order-to-stock/GL oracle |
| Concurrent mutation/refund/close, idempotency and print reservation | `verify-pos-postgres.ts`, foundation tests | Disposable PostgreSQL only; not physical printing |
| M-Pesa protocol, duplicate callback/reference behavior | `pass-4-payments.test.ts` | Mocked official-protocol responses; no real money or live integration claim |
| Worker retries, attempt limits and immutable closing obligations | Foundation, document-email and daily-closing repository tests | An empty backlog is not an executing-consumer proof; uncertain external sends must not auto-replay |
| Encrypted restore | `verify-production-recovery-fixture.mjs` and historical approved recovery evidence | Public application schema only; Auth/Storage/roles/grants and current operational recovery require separate acceptance |

## Remaining Acceptance Requirements

1. Obtain explicit approval before live security changes. Inventory every shared
   REST/GraphQL client, verify an isolated restore, test its actual runtime roles,
   and follow the existing controlled staging recovery/lockdown runbooks.
2. Reconcile deployed migration/object drift against the reviewed candidate.
   Do not replace migration history or run historical one-off migration workflows
   against an unidentified project.
3. Review old worker obligations by type and external side effect before any
   recovery. A release gate is not backlog remediation or a replay authorization.
4. Complete deployed financial source-link, stock, reconciliation and recovery
   acceptance with isolated records and no unexplained discrepancies.
5. Obtain independent review, preserve required checks, and retain live provider
   testing behind Phase 3 acceptance. No unresolved P0/P1 may be waived as a GO.
