# Marketplace operations implementation

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
