# Marketplace operations implementation

## Verification update: 2026-11-14

Still not release-certified. All work remains on `codex/marketplace-operations`.
No production changes, migrations, live orders, activation or printing changes.

New implementation:
- Permission-gated accept/reject with persistent mutually exclusive decisions and provider read-back recovery.
- Manual orders enter accounting and kitchen only after provider confirmation; scheduled release uses durable order metadata.
- Persistent versioned availability overrides, bulk controls, per-connection results and optional restoration timers.
- Catalog write serialization and stale-version guards. Timer recovery runs without scheduled orders and rechecks item availability.
- Marketplace closing snapshots and exports: order counts, charges, receivables and outstanding carry-forward by currency.
- Manual acceptance fallback; existing explicitly configured automatic policies remain unchanged.

Verification:
- 137 targeted tests passed across integrations, provider contracts, progress, payments, daily closing and scheduler.
- Four embedded PostgreSQL worker tests passed, including mapping compare-and-swap and concurrent outbox deduplication.
- TypeScript and full ESLint passed (25 existing warnings, zero errors).
- Production build, compiled Queue/Cron registration and production audit passed (zero vulnerabilities).
- Playwright daily-closing test passed: combined close, PDF download and mobile layout. Evidence under `.seramet/daily-closing/`.
- Full validation was interrupted during tests due to memory pressure. The single-worker rerun passed: 1,664 tests across 169 suites in 1,143 seconds. Results are recorded in `.seramet/marketplace-tests.log`; build and Worker verification passed separately.

Still required: exact-commit CI/review, authenticated browser acceptance of the new marketplace controls,
real provider sandbox certification, multi-session PostgreSQL contention beyond the embedded harness,
legacy automatic-order review, large-history pagination and complete existing-provider-menu modifier preservation.
Snapshots freeze balances at report preparation/closing time; they do not reconstruct historical provider balances.

Provider requirements rechecked against [Uber sandbox](https://developer.uber.com/docs/eats/guides/sandbox),
[Uber orders](https://developer.uber.com/docs/eats/guides/order-integration) and
[Glovo Partner API](https://qcommerce.developer.glovoapp.com/en/documentation/api-partner-api-overview).
Mock contract tests are not live provider certification. No credentials are recorded here.

## Previous implementation record (superseded where updated above)

Status: PARTIAL, not a release candidate. Production has not been changed.

Branch: `codex/marketplace-operations`, based on main
`267d58414cb0fa87936df5aafe2bcb844f938dd6`.

## Implemented slice

- Marketplace screen separates kitchen/handover progress from provider acknowledgement.
- Paid or served statuses alone no longer imply fulfilled marketplace orders.
- Search and all-history controls; unfinished orders remain visible across local midnight.
- Branch marketplace balance overview links to existing finance screens.
- Manual availability requests no longer require automatic stock disabling to be enabled.
- Explicit connection selection is branch-validated; invalid quantities are rejected.
- Selected-connection availability synchronization no longer fans out to other connections.
- Scheduled kitchen release requires a processed acceptance operation.
- Full menu publishing blocks removal of known mapped modifiers, even with destructive confirmation.

## Verification

- Dependency installation: `npm ci --ignore-scripts` succeeded. Install scripts were not run.
- Production audit: `npm audit --omit=dev --audit-level=high` passed, zero vulnerabilities.
- TypeScript passed after the final modifier safeguard. Focused ESLint passed before that safeguard.
- Production build passed before the final modifier safeguard.
- Latest targeted run: 94 tests passed across marketplace progress, integration engine,
  provider contracts and payment reconciliation.
- No provider credentials, live requests, production orders, database changes or deployments.
- Local browser navigation reached the app shell only; authenticated marketplace UI and responsive
  acceptance are not verified. Preview server: `http://127.0.0.1:4197/marketplace`.

## Required before completion

1. Atomic order decision command, provider confirmation/recovery and exactly-once kitchen
   release. Keep receiving, accepting, local recording and financial posting distinct.
2. Verify all outbox execution paths share the durable worker claim: the durable consumer
   has a claim in `workers.ts`; direct runtime execution and status writes need further review.
3. Actionable inbox including failed/pre-POS events, order details, permissions and notifications.
4. Persisted per-channel availability overrides, per-provider results, bulk controls,
   version-safe timed restoration and protection against stale/coalesced requests.
5. Complete menu modifier preservation. The current safeguard covers known mappings only;
   it is not certification that an unknown existing provider menu is safe to replace.
6. Complete date-range history, server-side pagination and daily-close totals. The new balance
   overview uses loaded transaction records; it is not a replacement for the closing report.
7. Browser verification on phone/tablet, PostgreSQL concurrency/failure recovery, full CI,
   and provider test-environment certification before a protected release.
8. Replace scheduled-release confirmation lookup with durable per-order confirmation evidence.
   The current safeguard reads the bounded outbox history and safely holds orders when evidence
   is absent, but retained/paginated history must not prevent legitimately accepted future orders.

## Agreed product defaults

Manual acceptance first. Unavailable affects all selected-branch marketplaces, not POS.
Reuse the existing item editor and reviewed publishing. Manual stock controls with warnings;
no new automatic stock changes. Manual restoration unless explicitly scheduled. No printing changes.
