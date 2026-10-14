# Phase 1: Confirmed Code Corrections

Date: 2026-10-14.
Branch: `codex/phase1-confirmed-hardening`.
Base: `13c69907e5c5ff92ad0c4564882aa128a43c8f68` (`origin/main`).

## Scope and Reused Work

The clean Seramet checkout was verified before editing. PR #119's payroll initialization fix and PR #108's financial/business-date correction were cherry-picked, not merged. Their source commits are `19d121cb3f4d1654a9f7881cd1322add1f65a29d` and `efe1aa8b4887003becd6824bc572de92ec5819cd`.

PR #108's historical failing job was traced to a prep-service ordering assertion, not a financial assertion. No prep assertion, database credential, workflow, dependency, migration or lockfile was changed here. The overlapping PRs remain open and require reconciliation before any merge.

## Implemented Corrections

| Area                                | Files                                                                                     | Behavior                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attendance / payroll initialization | `src/lib/transaction-engine.ts`, `src/lib/payroll-preview.test.ts`                        | Empty initial snapshots return empty preview rows without resolving an invented tenant/branch. Populated snapshots retain strict configured-branch validation.                                                                                                                                    |
| Payroll acknowledgement             | `src/routes/payroll.tsx`                                                                  | Editing requires the existing permission; input is retained on rejection, duplicate submission is blocked, and success requires the server-returned employee value. Late completion cannot replace the notice for another scope.                                                                  |
| Mobile order recall                 | `src/routes/pos.tsx`                                                                      | Channel/New order/Orders controls wrap instead of clipping the Orders button. No KOT, invoice, payment or printer transition was changed.                                                                                                                                                         |
| Canonical dates                     | `src/lib/business-date.ts`, server/finance wrappers, Orders, Reports and Payment Control  | Existing wall-clock timezone/cutoff semantics are shared, including DST; stored business dates retain precedence. Finance API defaults resolve the authenticated branch, with explicit dates required for ambiguous mixed calendars.                                                              |
| Dashboard measures                  | `src/lib/dashboard-financials.ts`, `src/routes/index.tsx`                                 | Today/Yesterday/Week/Month and revenue trends use the canonical projection. Ordered-by-hour/channel are explicitly distinct from settled net revenue. Projections are reused per branch/date within one calculation.                                                                              |
| Drawer / settlement compatibility   | Financial lifecycle, payment orchestrator and reconciliation engine                       | New drawers carry their opening business date. Legacy drawer variance also stays on the opening date; date-only settlement periods are not shifted as midnight timestamps. New collection/posting/reversal dates use branch accounting context. Existing records are not backfilled or rewritten. |
| Scanner delivery                    | `scanner-worker/src/index.ts`, `scanner-worker/src/failure-delivery.ts`, regression tests | A terminal failure message is acknowledged only after its authoritative report succeeds. Reporting outages retain a bounded queue retry/DLQ obligation; malformed claims do not silently count as success.                                                                                        |
| Scoped refreshes                    | `src/lib/scoped-read-guard.ts`, management and Setup Centre hooks                         | Cancel superseded reads and reject late results even if cancellation is ineffective. Management reuses the existing one-active/one-trailing event coordinator. Scope changes clear old setup data; failed scanner-capability reads remain unavailable.                                            |

No antivirus engine or new dependency enters the POS frontend or primary API Worker. Existing tenant/branch authorization, idempotency, CAS, integer-minor financial arithmetic, durable KOT handling, and immutable EOD snapshots remain in place. Payroll execution remains disabled; statutory payroll certification and operator approvals were not implemented by this phase.

## Validation Evidence

| Check                                                         | Result                                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Focused financial/date/staff/scanner/refresh tests            | 83 passed across 14 files                                                                                                            |
| TypeScript                                                    | Passed                                                                                                                               |
| Repository ESLint                                             | Passed: zero errors, 28 existing warnings                                                                                            |
| Changed-file Prettier and diff checks                         | Passed                                                                                                                               |
| Full ordinary unit suite, one execution                       | 735 passed; one development database startup test exceeded its existing 20-second deadline                                           |
| Unchanged failing startup case                                | Passed when executed alone without competing validation; no assertion or timeout was modified                                        |
| Browser scenarios                                             | All nine have passing evidence: seven passed in the initial run; the two new harness-affected cases passed after focused corrections |
| Production build                                              | Passed                                                                                                                               |
| Production bundle secret audit / compiled Queue-Cron contract | Passed                                                                                                                               |
| Pilot source and aggregate-gate contracts                     | 2 passed                                                                                                                             |

The first focused startup retry overlapped browser-server startup and exceeded its existing 10-second setup-hook deadline. The subsequent isolated retry passed. These timing failures are recorded rather than relabeled as a completely clean full-suite run. A clean candidate CI run is still required before approval.

The two new browser failures were test-harness defects: page interception skipped fixture authentication; then a locator selected a hidden mobile duplicate instead of the desktop table cell. Corrected interception preserves authentication, and the locator now targets the actual visible cell. No application assertions were relaxed. Only affected scenarios were rerun, not the comprehensive certification.

The new browser evidence covers delayed Attendance/Payroll hydration, failed/pending/confirmed pay persistence with reload, mobile Orders bounds and recall, and a delayed Setup Centre response after a branch switch. Existing two-terminal, unauthorized-branch, scanner quarantine/publication, settings, branding and logout scenarios also pass. Scanner verdicts remain simulated locally, not genuine ClamAV evidence.

Scoped helper tests cover late tenant/branch results, overlapping same-scope reads and cancellation. Existing coordinator tests cover event storms and one trailing refresh. Financial tests cover timezone/cutoff/DST, branch calendars, canonical settled revenue versus ordered activity, opening-date drawer attribution, settlement dates/reversals and immutable close snapshots.

## Scalability Boundaries

- No new dependencies, database migrations or additional services.
- Superseded setup reads are cancelled; stale results cannot update the new scope.
- Management realtime invalidations reuse bounded refresh coordination rather than launching a request for every event.
- Dashboard date projections are cached only within the current calculation, not in a shared tenant-data cache. Standard Today/Yesterday/Week/Month windows are bounded.
- Scanner failure reporting remains in the isolated, on-demand worker and retains the existing queue retry limits.

These are engineering bounds, not a capacity benchmark or a proof of restaurant-scale deployed latency. Real scanner memory, cold start, cost and detection remain external certification work.

## Remaining Release Gates

1. Review this candidate and obtain a clean CI result; do not independently merge overlapping #108/#119 without reconciliation.
2. Separately authorize the existing staging identity/TLS/recovery, Migration 27 and guarded security-lockdown sequence.
3. Resolve durable backlog through existing recovery plans; no blind replay.
4. Deploy an approved exact SHA to protected staging and verify build identity. Current old staging behavior is not corrected by local commits.
5. Disposable real-auth multi-role shift, M-Pesa sandbox callbacks and physical ESC/POS output/failure recovery.
6. Genuine scanner/EICAR, exact-file CLEAN publication, outage and DLQ recovery before spreadsheet uploads become available.

Operational readiness scores and data-dependent setup warnings require acceptance on the aligned staging release; this phase does not certify them. No production-readiness claim is made.

No staging/production connection, mutation, deployment, merge, credential change or job replay was performed. Local browser mutations affected disposable fixtures only. Database and deployment phases remain separately authorized work.
