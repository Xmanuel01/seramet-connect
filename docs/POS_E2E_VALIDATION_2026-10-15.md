# Local End-to-End Workflow Validation

Date: 2026-10-15 (Africa/Nairobi).
Base: `b40c8ab388c9554c28c54775199bc9cf93bc4ea0`.
Candidate branch: `codex/pos-shift-acceptance-evidence`.

## Outcome

All 12 selected browser scenarios now have passing evidence, across the initial
run and focused follow-ups. This is **not** a claim that one unchanged candidate
passed all 12 together. The first full execution had 10 passes and two failures.
Only failing scenarios were rerun after diagnosing their actual causes.

The new disposable cash shift passes Hold -> Kitchen -> Invoice -> Cash -> Receipt
-> Drawer reconciliation -> Financial EOD, including authoritative reload checks.
One application defect was corrected; test configuration was completed separately.

## Confirmed Application Correction

`TransactionEngine.addRider` created the employee without tenant/branch identifiers.
The existing API's post-commit scope comparison could classify the new unscoped
record as outside the actor's branch and return HTTP 403 after repository commit.
The browser reproduced `Actor cannot change records outside Pilot Branch A`.

The correction resolves the configured branch through the existing scope resolver
before constructing the employee. Duplicate detection uses the resolved branch ID,
so using a branch ID or branch name does not create duplicate active riders.
No scope guard, permission, authorization rule or database schema was weakened.
This fixes the demonstrated rider path, not every possible post-commit failure.

Regression evidence: the existing Attendance/Payroll browser scenario passes;
three payroll unit tests pass, including a new test for scope, duplicate prevention,
unknown-branch rejection and unchanged input state.

## Test-Harness Corrections

The existing seed linked Branch B's meal to Branch A's station. The authoritative
Branch B menu returned station `NONE`, so dispatch correctly had no kitchen
obligation for that non-production line. Each disposable branch now has its own
meal linked to its own station; the one-obligation assertion was preserved.

The cash method also lacked required receivable and settlement account mappings.
The seed now creates disposable tenant-scoped cash/receivable accounts and links
all required cash, settlement and receivable configuration. No application payment
fallback or default account was introduced. Production payment validation remained
fail-closed throughout these failures.

Assertions now include rejected API response details for these local fixture
operations, rather than hiding the cause behind an eventual dialog timeout.

## PR Review Correction: Nonvacuous Branch Isolation

The original cash-shift assertion compared Branch A orders inside Branch B's
filtered API responses. Both arrays were empty, so that earlier assertion did
not establish cross-branch preservation. The review finding was valid.

The corrected scenario creates a real Branch A sentinel order through an
independently authorized local UI context. Before Branch B's shift, it opens the
local SQLite store read-only and captures all authoritative Branch A records for
the disposable fixture tenant. It requires a persisted sentinel with a positive
record version, then compares complete, deterministically ordered rows after the
shift and after reload: tenant/branch IDs, entity types and IDs, versions, business
dates, status, full persisted payloads and creation/update timestamps.

The observer does not use the branch-filtered API. It rejects remote E2E targets
and requires the local E2E/CI flags and generated fixture tenant format before any
sentinel creation. It never writes to the database directly or changes production
authorization. The legitimately advancing tenant-wide revision is not confused
with the per-record revisions that must remain unchanged.

One focused execution passed both the corrected cash shift (41.9 seconds) and
unauthorized branch selector (27.7 seconds): 2 passed, zero failures or skips.
Typecheck, changed-file ESLint, formatting and diff checks also passed. The full
suite was not manually rerun for this review correction; updated PR CI is separate.

## Browser Coverage

| Scenario                                                                                                 | Evidence                                                |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Authenticated import staging, recovery, publish, POS visibility and unauthorized approval                | Initial PASS; scanner simulated                         |
| Scanner unavailable, timeout, infected, malformed, wrong hash, expired, replay and failed authentication | Initial PASS; eight fixture cases                       |
| Two terminal drafts, exact held-order recall, revision conflict and logout                               | Initial PASS                                            |
| Branch-local clock across midnight/focus                                                                 | Initial PASS                                            |
| Unauthorized branch selector rejection                                                                   | Initial PASS                                            |
| Employee-default entry and explicit administrator opt-in                                                 | Initial PASS                                            |
| Settings pending/rejected/confirmed persistence and visible setup failure                                | Initial PASS                                            |
| Employee branding                                                                                        | Initial PASS                                            |
| Attendance/Payroll hydration and rejected/pending/acknowledged pay changes                               | PASS after rider scope correction                       |
| Mobile POS recall-control bounds                                                                         | Initial PASS                                            |
| Stale Setup Centre response after branch switch                                                          | Initial PASS                                            |
| New disposable cash shift                                                                                | Final focused PASS (46.1 seconds including preparation) |

The cash shift creates/holds the order through POS UI; opens the drawer, dispatches,
invoices and closes through real browser-originated API calls; and settles through
the invoice UI. It is a browser/API/authoritative-store test, not a demonstration
that every cashier action was performed by clicking its UI control.

It verifies one durable KOT obligation after duplicate dispatch, one invoice after
repeated preparation, one receipt/allocation, exact minor-unit drawer totals,
open-drawer financial-close readiness, zero variance after counting, one financial
close snapshot after repeated close, reload durability and unchanged other-branch
orders. No provider callback or printer acknowledgement is fabricated.

The fixture KOT remains `PENDING`: financial close is not physical kitchen-delivery
certification. This test neither marks it printed nor clears the printer release
gate. It uses the broad-permission fixture manager, not four real business roles.

## Execution Record

1. `npm run test:e2e`: 12 scenarios, 10 passed, 2 failed (3.3 minutes).
2. Two-scenario diagnostic follow-up after routing correction: both failed;
   identified missing receivable configuration and the exact payroll 403 message.
3. Two-scenario follow-up after scope/receivable fixes: payroll passed; cash failed
   because the legacy journal also required the settlement mapping (1.6 minutes).
4. Cash-only follow-up after completing fixture accounts: 1 passed (46.1 seconds).

No successful comprehensive suite was restarted. The previous 78 targeted POS,
financial, recovery and date test results were reused. Focused payroll/POS tests
passed 18 tests during correction, and the final payroll regression selection
passed all three tests after canonical duplicate handling was finalized.

Local ignored JSON evidence and SHA-256:

- `.seramet/e2e-initial-results.json`:
  `ae206f231663d4c48f391f57bc9af379a5db3f339038fd21e7eff93d60c11cb6`.
- `.seramet/e2e-payroll-fixed-results.json`:
  `2040380bec78818fbe226ea991e33d031a8de1a55debfe6332f1a811a8e502da`.
- `.seramet/e2e-final-shift-results.json`:
  `c0601f6c8475e54e92d6739a6e4a27a27123f3b2fbdd7d63c0dfca4b4b085e75`.

These bind local artifacts, not signed CI attestations. Failure traces are retained
under `.seramet/` and must not be published: they contain disposable auth fixtures.

Final typecheck, changed-code ESLint, formatting and `git diff --check` passed.

## Remaining Release Gates

- Database remediation stays on hold: no migration, lockdown, diagnostic dispatch,
  credential change or live database mutation was performed.
- Protected staging must match an approved release and meet existing security,
  schema, recovery and backlog safeguards before live shift certification.
- Real Supabase/device/PIN sessions, separate cashier/kitchen/manager roles and a
  complete UI-only shift remain operational acceptance work.
- M-Pesa sandbox, genuine authenticated malware/EICAR scanning and physical ESC/POS
  output/failure recovery remain unverified. Simulated local tests do not clear them.
- No production deployment or production-readiness claim is made. Imports remain
  subject to the unchanged genuine-scanner requirement outside the loopback harness.

No infrastructure, dependency, migration, RLS policy, grant or production setting
was changed. Existing untracked acceptance documents and `supabase/` were preserved.
