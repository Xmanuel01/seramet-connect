# Release integration validation

This update includes the pending receipt/invoice preview, server-side Brevo PDF email
and closing-report delivery work, plus its focused evidence and accounting findings.
It does not repair the separately confirmed missing invoice-to-general-ledger posting.

## Confirmed CI contract corrections

- POS clock checks the current `Restaurant time (Africa/Nairobi)` tooltip while retaining
  every branch-time, ticking and focus/visibility assertion.
- Dispatch recovery intercepts the transaction pathname including query strings. The
  previous exact glob did not hold the initial `?branchId=...` read, so the test incorrectly
  expected the order to remain unhydrated after it had already loaded. The disabled-before-
  hydration and no-duplicate/uncertain-delivery assertions remain unchanged.
- Printer acceptance selects the expected transport-outcome status instead of assuming
  that the page contains only one status region. The actual TCP receipt bytes and branch
  authorization assertions remain in place.
- Coverage inventory explicitly lists the document-email API as not deployed-verified and
  not PostgreSQL-certified. No financial/provider acceptance is inferred from local mocks.

The existing six-scenario audit has two conditional inventory checks: the whole-site page
inventory runs in scenario 1 and the Sales subview inventory runs in scenario 2. The
contract now records both existing skip call sites explicitly. This does not add a skipped
test, permit skipping sales workflows, or alter the standard browser release suite.
The comment filter also no longer interprets route-glob strings as block comments, which
previously hid one of those existing directives. In-script regression assertions preserve
both directives around globs and still reject focused/TODO tests.

## Merge constraints

PR #129 merged as `eb758bca209b645cdf125dc3b41068bfcdd14b2a`; PR #124 merged
as `522ff343fa8f7e511d83de4de913901a2ca9da2a`. Post-merge main CI passed in
[run 39464300368](https://github.com/Xmanuel01/seramet-connect/actions/runs/39464300368).
Main was merged back into the integration branch without rewriting either history.
The package manifests and lockfile needed no manual changes. The three conflicts
retained branch-specific menu items and station settings, canonical rider branch
identity plus input validation, and the complete disposable API error diagnostic.

The restored cash-shift test needed the current invoice display label and explicit
drawer/day-close confirmation. Its old requests correctly failed closed with 409;
the server safeguards were not changed. Ten other affected browser scenarios passed;
the corrected full cash-shift scenario then passed independently. Seven affected
rider/payroll tests, typecheck, scoped lint, formatting and the source contract pass.
These focused integration results do not replace fresh CI on the final merge commit.

The preceding integration head `8e28ff4133e8934fd70357daa36ef4507ee7acf6` passed
all nine applicable CI checks, 1,095 local unit tests and 35 standard CI browser cases.
Those counts are evidence for that revision, not a claim about a later commit.

The main-integrated head `132af44a658f19e4fb512ea55bb400590790acb5` passed all
1,096 unit tests, build/security and independent database checks. Its browser run
[39466885903](https://github.com/Xmanuel01/seramet-connect/actions/runs/39466885903)
found two shared-fixture interactions, with 34 scenarios passing and two failing:

- The cash-shift fixture now seeds genuine cash and receivable accounts. Accounting
  must not falsely display an absent chart; missing cash classification, missing
  journals, Setup Centre guidance and invalid-filter recovery remain asserted.
- The earlier daily-closing scenario performs an authorized reopen for fixture
  cleanup. The later cash shift must retain that earlier immutable report, append
  exactly one new snapshot, and leave the entire closed record unchanged on a
  repeated confirmation, rather than assuming the branch has no closing history.

After those test-only corrections, the six affected accounting, closing and
two-terminal scenarios pass together in one local run. No application guard,
financial calculation, timeout, authorization or production setting was changed.
Final-head CI remains the authoritative combined gate, not the earlier failed run.

Do not merge a known-failing or unresolved-critical candidate just because GitHub reports
it mergeable. Older overlapping and stacked PRs must not be merged independently into
main after their consolidated integration. Temporary work marked DO NOT MERGE is not a
release candidate. Passing engineering checks do not certify live Brevo delivery, malware
scanning, physical paper output, M-Pesa or complete revenue accounting.
