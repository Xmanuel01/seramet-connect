# Financial and Daily-View Stabilization

Base: main 1f22af69918a6a8da1bb66b7e01d0d5e299c71dd.
Scope: existing application only; no printing changes, production writes,
test sales, migrations, environment changes or deployments.

## Implemented

- Orders (terminal and phone), invoices and receipts default to Today in the
  selected branch timezone. Midnight, focus and wake refresh the relative date.
  Presets: Today, Yesterday, Last 7 Days, Last 30 Days, Custom Range, All Time.
  Calendar creation/issue time is separate from accounting cutoff/business date.
- Server-backed order history; invoice/receipt range and all-time queries.
  Tenant/branch/permission checks remain enforced. Bounded batches expose Load
  more and identify partial totals instead of permanently truncating history.
  No transaction records are deleted, archived or rewritten.
- Existing database-configured payment methods and partial/mixed settlement
  retained. Separate cash tender/change from partial invoice allocation.
  Reject nonfinite amounts, non-cash overpayments and payment of superseded,
  void, draft or fully settled invoices. Minor-unit balance checks.
- Provider request identity includes prior paid balance, allowing a subsequent
  equal-sized installment while retries at the same balance retain the same key.
- Merging split children deduplicates their common order reference without
  changing source links or total. Shared order references across split children
  themselves are expected, not duplicate sales.
- Dashboard excludes completed production and includes paid unfinished work;
  age starts at dispatch rather than order creation. Kitchen age refreshes every
  30 seconds and on focus. No historical orders are cancelled.

## Verification

102 distinct targeted tests passed across 12 test files, including:
payment domain, settlement configuration, invoice split/components, document
API/query cache, calendar windows/DST, order financial totals, kitchen lifecycle,
dashboard branch isolation and identity/device/branch security.
Runs: 99 tests together; subsequently 18 document/query tests (including two new
cases), and six financial-summary tests (including one new case).
All use local fixtures/mocks/disposable SQLite; no production transactions.

Changed-file lint: zero errors, one Fast Refresh warning for the shared
component/hook export. Formatting applied.
Full TypeScript: not passed locally. The initial run found two stale identifiers,
which were corrected. Subsequent attempts exhausted machine/Node memory.
Disk free was approximately 223 MB. CI must verify TypeScript, build and broader
regressions before release. Browser interaction/real-device verification is pending.

## Read-only Production Security and Recovery Findings

Verified project seramet-production (qnhqylslyhxjcksuhgyq), ACTIVE_HEALTHY.
Orders, invoices, receipts, payment_transactions, payment_allocations, branches
and employees have RLS enabled and deny SELECT to anon/authenticated roles.
seramet_runtime is not superuser but has BYPASSRLS. Isolation therefore also
depends on authenticated application queries; this is not per-tenant database RLS.
No permissive policy was added and no production permission was changed.

Security advisor reports RLS-without-policy informational notices (consistent
with deny-direct-access), mutable function search-path warnings and leaked-
password protection disabled. No exploit or unauthorized data access was
demonstrated. These findings are not a complete security certification.

backup_records contains no entries. This does not prove provider backups are
absent. Latest visible production encrypted-recovery workflow passed on
2026-10-22: https://github.com/Xmanuel01/seramet-connect/actions/runs/39834190431
Current provider backup availability, retention/PITR and a fresh isolated restore
remain UNVERIFIED. No database change is proposed before those checks.

## Remaining Release Work

- Fresh CI TypeScript/build and browser acceptance of filters and settlement.
- Dashboard's existing 18-minute warning threshold remains different from KDS
  menu-specific preparation targets; full health/SLA alignment remains open.
- Verify current provider backup/retention and recovery evidence.
- Large-history performance and complete-period server aggregates remain to be
  measured; UI totals are explicitly totals of loaded matching records.
- Production deployment requires owner approval of the exact CI-passed commit.
  No production migration is included. This is not production certification.
