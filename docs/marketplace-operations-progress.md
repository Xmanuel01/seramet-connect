# Marketplace operations implementation

## Experience expansion: 2026-11-14

Implemented locally on `codex/marketplace-operations`; not production-certified or deployed.
No main merge, production database changes, real orders, live marketplace calls, credentials,
printing changes or paid resources were used.

- Unified order stages, detailed accept/reject controls, preparation deadlines and next actions.
- Provider acceptance remains separate from receipt, local posting, kitchen release and payout.
  Automatic orders are held until acceptance is confirmed, just like manually accepted orders.
- Versioned item/modifier availability, timed restoration, per-channel prices and reviewed publishing.
- Store pauses now support immediate or future starts and timed reopening, retained across reloads.
  Superseded schedules cannot subsequently pause a reopened store.
- Notification-bell order alerts and opt-in audio, scoped to the authorized user and branch.
- Recoverable interrupted imports and edits, disabled-connection guards, and catalog-write ownership.
  An older menu upload cannot falsely confirm newer price or availability edits.
- Connection readiness checklist and provider-confirmed test-order evidence.
- Shared closing date, frozen closed-day balances, outstanding carry-forward and payout comparisons.
  Different currencies are never added into one overview amount.

Local browser preview: `http://127.0.0.1:4197/preview-access`.
This uses disposable local data and fake provider adapters. Its loopback-only access bypass remains
outside production; remove it when the owner finishes reviewing and requests removal.

Verification evidence is in ignored `.seramet/marketplace-*` logs and screenshots. TypeScript,
production build, compiled Queue/Cron registration, bundle audit and dependency audit passed.
The production dependency audit reported zero vulnerabilities. ESLint passed with 25 existing warnings.
The combined daily-closing browser test passed, including PDF download and mobile rendering.

The broad test run began before the last edits and finished with 1,672 passes and three failures
in newly added runtime regression tests. Fresh focused execution passed those tests; this is not
a claim of a clean, fresh full-suite/CI run on the final candidate.

Final focused run: **121 tests passed across six suites**, including integration-engine regressions,
provider contracts, embedded PostgreSQL workers, daily closing and timezone-aware staff controls
(`.seramet/marketplace-final-focused.log`). The permission/branch-scope API regression also passed.
The browser walkthrough passed fresh order acceptance and rejection with reload, notification-bell
alerts, availability changes, immediate/scheduled pauses with reload, reopening, connection/closing
views and 390/768px overflow checks. Screenshots are in `.seramet/marketplace-walkthrough/`.
Desktop and mobile screenshots were visually inspected. Audio playback on a physical device and
real provider response timing are not certified by this headless walkthrough.

Release boundaries remain: exact-commit full CI/review, real provider sandbox certification,
multi-session PostgreSQL contention beyond the embedded harness, large-history pagination,
and complete preservation of unknown existing provider-menu modifiers. Do not use full-menu
replacement against a live store until that preservation is verified.

The owner confirmed Uber Test Store 01 is **not configured**. Protected Testing credentials and
the isolated QA store link are required before a real Uber order can be certified. Mock provider
tests do not establish Uber or Glovo live readiness. Never enter provider secrets in this document.

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
