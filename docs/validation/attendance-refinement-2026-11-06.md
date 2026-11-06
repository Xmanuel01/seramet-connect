# Attendance design refinement - 2026-11-06

Branch: `codex/attendance-design-refinement`
Base: `1f22af69918a6a8da1bb66b7e01d0d5e299c71dd`
Scope: attendance only. No production requests, records, migrations, deployments,
printing changes, dependency changes, or changes to the separate financial PR.

## Implementation

| Requirement | Result |
| --- | --- |
| Employee clock | Existing authenticated session, one clock action, employee/branch identity, server-aligned live clock and active-shift timer |
| Hours | Current business-date and Monday-to-Sunday week totals; actual UTC elapsed time; overnight hours attributed to the shift's original business date |
| Clock-out | Recorded timestamps and total duration, including a shift completed after its starting business date |
| Location | Existing server geofence checks, configured radius, registered-till policy, and supervisor exceptions preserved; no claim of GPS verification before a punch |
| Management | Workday, Timecards, Reports, Settings under People / Time Tracking (existing `/schedule` route retained) |
| Filters | Existing authorized branch selector; employee, period, custom historical dates, status and verification filters |
| Timecards | Localized timestamps, actual worked hours, attendance timelines, lateness and overdue/missing punches |
| Reports | Whole-filter summaries up to 5,000 sessions, audited CSV and PDF exports; no silent truncated totals |
| Corrections | Existing permission/version checks, meaningful reason, exact session selection, idempotency and immutable history retained |
| Exclusions | No break, job switching, project tracking or additional PIN controls |

## Verification

- 69 distinct targeted Vitest tests passed across nine attendance files. Initial
  nine-file run passed 67 tests; the final API suite passed 27 tests, including
  two further tests for missing punches and multi-session overtime. Changed
  API/clock tests were rerun after the overnight completion fix.
- `npm run typecheck`: PASS.
- ESLint on all changed TypeScript/TSX files: PASS, no warnings.
- `npm run build`: PASS (local Cloudflare-compatible build, not a deployment).
- `npm run audit:bundle`: PASS, no secret/demo identifiers in the production bundle.
- Compiled Cloudflare Queue/Cron hook verification: PASS.
- `git diff --check`: PASS.
- Five distinct local Playwright scenarios passed:
  1. Temporary PIN replacement remains required only during initial credential setup.
  2. Existing staff PIN login, no second attendance PIN, punch/reload persistence,
     clock-out summary, unauthorized employee-register rejection, phone/desktop layout.
  3. GPS rejection and success, supervisor location settings, immutable server punch
     time, safe recovery after a committed response is lost.
  4. Authorized employee registration and restricted employee attendance access.
  5. Management tabs, live timer movement, correction submission/history, CSV/PDF
     download and layout checks at 390, 768 and 1440 pixels.
- The first four scenarios use the existing disposable local SQLite fixture.
  The fifth uses mocked attendance data for deterministic layout/correction UI
  checks, with exports exercised against the disposable local backend. Backend
  mutation, concurrency, permission and audit behavior is also covered by Vitest.
- Screenshots are in the ignored local `test-results` folder. No fixture identities,
  tokens, local databases or browser traces are included in the commit.

## Defects Found During Verification

- The first phone layout placed the main action below the viewport. Fixed by
  placing the action before summaries on phones; the existing viewport assertion
  subsequently passed.
- An absolutely positioned hidden table heading escaped its horizontal scroll
  container. Replaced with a visible Actions heading; document-width assertions
  now pass across all four management views.
- Overnight clock-out could lose the completion summary on the next business
  date. The read API now returns the latest shift completed on the current
  business date when no newer session exists.
- Daily overtime could be understated if each session separately consumed the
  daily schedule. Summaries and CSV day totals group by employee/business date
  and apply one comparable schedule. Conflicting/unknown schedules are unassessed.
- Late GPS callbacks could populate a newly selected branch's settings. Scope
  generation checks now discard those callbacks.

## Boundaries

- Overtime here means actual worked minutes above the recorded daily schedule,
  not statutory overtime entitlement or a payroll payment. No pay deductions or
  payroll mutations were introduced. Open shifts remain provisional.
- Scheduled comparisons across a daylight-saving offset transition remain
  unassessed, preserving the existing policy. Actual worked UTC duration remains
  available.
- Existing history safeguards remain: at most 31 business dates per request and
  5,000 sessions per export. Historical dates are not restricted by age.
- The existing PDF library's standard font cannot represent every script. Such
  reports fail explicitly with a CSV alternative rather than dropping names.
- Live deployment, physical-device GPS accuracy, and owner acceptance are NOT
  certified by these local tests. Required remote CI/release approval remains
  separate.

## Release Follow-Up

- Owner subsequently requested main merge and deployment. PR #205 contains only
  this attendance change; the separate financial PR is not part of this release.
- Initial exact-head CI run `42185014719` passed dependency audits, TypeScript,
  lint, PostgreSQL schema/RLS checks and the isolated recovery fixture. The full
  unit suite passed 1,518 tests and exposed one initial attendance render failure:
  an absent employee name was used directly for avatar initials.
- The clock now tolerates an absent/blank display name while keeping punch
  controls disabled until attendance loads. Two focused regression cases retain
  the original failing route-render fixture instead of changing or hiding it.
- Revised-commit CI and exact owner approval are required before release. No
  production records, schema, settings, printing or scanner changes are included.
- Follow-up CI `42185774909` passed all core checks, including the full unit
  suite and build. Browser run `42185774921` passed 64 scenarios and exposed an
  outdated delayed-hydration assertion for the former Attendance roster. That
  test now checks Clock In/Out, disabled controls during loading and the signed-in
  employee's clock after loading, retaining all payroll acknowledgement checks.
  The new management layout/export scenario is also included in the default CI
  browser suite rather than remaining a local-only focused test.
- Local follow-up: both render suites passed all 14 tests; TypeScript passed.
  The selected browser run passed 24 cases and identified a test-fixture lookup
  error (names belong to employee records, not schedule records). After selecting
  the signed-in employee by ID, that one loading/payroll case passed separately,
  completing all 25 distinct selected cases. No assertion was removed or skipped.
- Read-only production preflight: operational health was healthy in production,
  schema 31, build `1f22af69918a6a8da1bb66b7e01d0d5e299c71dd`, with an authoritative
  database and available queue. Cloudflare version
  `e946787e-dedc-4d7d-a38f-bcbd5b6ea259` at 100% was verified to carry that build ID
  and is the recorded application rollback target. No production write was made.
