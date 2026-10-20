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

Do not merge a known-failing or unresolved-critical candidate just because GitHub reports
it mergeable. Older overlapping and stacked PRs must not be merged independently into
main after their consolidated integration. Temporary work marked DO NOT MERGE is not a
release candidate. Passing engineering checks do not certify live Brevo delivery, malware
scanning, physical paper output, M-Pesa or complete revenue accounting.
