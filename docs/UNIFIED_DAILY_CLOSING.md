# Unified Daily Closing

## Workflow Map

| Stage              | Existing authority reused                                                 | Closing behavior                                                                |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Employee login     | Verified identity, device and branch session                              | Authentication is not a financial shift; closing does not silently revoke login |
| Cashier shift      | `paymentOperations.drawerSessions`, `cashMovements`                       | One financial session per drawer; no duplicate shift ledger                     |
| Business date      | Branch timezone and configured cutoff; persisted date preferred           | Overnight drawers retain their opening business date                            |
| Payment collection | Payment orchestrator, allocations, journals, provider confirmation        | No invoice is marked paid by closing                                            |
| Expenses/payouts   | Recorded cash movements                                                   | Snapshot retains recorded movements; unrecorded expenses are not invented       |
| Supervisor close   | `closeBusinessDay`, canonical financial projection, `dayCloses`           | Counts drawer and closes day in the same authoritative transaction              |
| Multiple shifts    | `closeCashierShift`, same drawer close implementation                     | EOD consumes finalized drawer counts without additional movements               |
| Persistence        | Existing tenant-revision CAS, mutation commits, audit and realtime events | A competing revision loses with no partial financial writes                     |
| Reports            | Revisioned day snapshot                                                   | PDF must consume stored snapshot, never current totals                          |
| Notifications      | Existing durable worker infrastructure                                    | Separate from financial close; delivery failure must not reopen day             |

## Policy

Branch policy is an authoritative payment-state collection, persisted in the existing
`authoritative_records` infrastructure. No migration is required. Absent policy uses
`SUPERVISOR_DAILY_CLOSE`. `configureDailyClosing` requires reconciliation approval in
the active assigned branch. Mode changes fail while a drawer is open or awaiting
review. Historical reports retain their original mode.

Supervisor mode accepts exactly the associated open drawer's complete currency count.
More than one open cashier requires separate shift reconciliation rather than silently
finalizing another cashier. Multiple-shift mode requires drawers to be finalized first;
EOD rejects additional counts. Every nonzero variance requires an explanation. Base
currency variances at/above the configured threshold require both reconciliation approval
and cash-adjustment permission. Any foreign-currency variance requires those permissions,
because comparing different currencies without an FX rate would be incorrect.

Unpaid invoices are nonblocking reported receivables. An open order without an issued
invoice, open/unapproved drawer, unresolved critical payment exception, pending refund,
unposted/unbalanced journal, or unposted settlement remains blocking. No blanket EOD
override is accepted by the unified command. Unresolved payment intents/evidence also
block closure. Counts and readiness are revalidated inside the server command.

Preparing a review cannot reopen a closed period. Reopening remains the existing separately
permissioned, reason-required command; old snapshots remain intact. Ordinary drawer opening
is prohibited in a closed current business period. Login sessions remain separate from
financial drawer sessions.

## Evidence And Release Boundaries

Engine tests cover default/shift modes, confirmation, permissions, branch/tenant isolation,
complete counts, variance approval, repeat closure, immutable snapshots, receivables,
overnight drawers, and rollback on failed readiness. Repository tests cover revision races,
duplicate/altered keys, schema-compatible policy persistence and injected SQL failure.
The existing two-connection PostgreSQL verifier covers combined drawer/day closure.

## Guided Review And PDF

Payment Control's EOD tab now presents one Close Business Day action. In supervisor
mode, drawer counting lives inside that review, not in a mandatory separate drawer-close
form. Multiple-shift branches expose End Shift for the assigned cashier or authorized
supervisor. Escape, outside-click and Cancel dismiss without mutation; Cancel receives
initial focus. Final confirmation is a separate step, guarded by an immediate submission
lock. Changes to the reviewed financial state invalidate confirmation.

The closing date comes from the authenticated server's branch context. PDF downloads
require reconciliation view permission and authorized branch scope and return private,
no-store responses. They render only the requested stored revision, including after
reopening. The PDF library is lazy-loaded server-side, never included in the POS client
for report generation. No public report URL or financial-data URL token is created.

New normal POS invoices capture a versioned integer-minor-unit economic breakdown.
Verified pricing overrides can carry their own breakdown, checked against invoice totals.
Gross less discounts equals net sales; net sales plus service plus tax equals the invoice
total. The legacy subtotal continues to mean net sales plus service (revenue before tax).
Split and merge conserve these amounts and tax instead of repricing original item lines.
The existing JSON payload persistence stores these optional fields; no migration is needed.

Historical and provider invoices without a verified breakdown remain explicitly not recorded.
A mixed period reports incomplete coverage, never fabricated zero discounts/service or an
unsupported whole-period gross figure. Provider gateways that cannot supply the breakdown
remain an explicit reporting limitation; voucher tender must not be relabelled as a sales
discount without changing its established accounting treatment.
The built-in PDF font renders unsupported characters as explicit Unicode codepoint
tokens; full multilingual font embedding remains unverified. These limitations must be
resolved before claiming the complete requested report specification is certified.

Review the engine, UI/PDF and notification changes as a stack. Do not merge an incomplete
stack. Real email delivery requires protected provider configuration and is not certified
by disposable tests. No live database mutation, migration, merge or deployment is authorized.

## Durable Notification Boundary

The existing authoritative transaction batch inserts one `DAILY_CLOSING_EMAIL` worker
job per configured recipient and immutable report revision. The existing Queue/Cron
scheduler dispatches those job references, including expired email leases after a crash.
No second notification scheduler or accounting ledger is introduced. A queue/provider
outage after commit cannot reopen the day or cause the client to report an optional
management refresh failure as a failed financial close.

The worker rechecks the active recipient, assigned branch and reconciliation-view permission
directly in PostgreSQL. It prepares a stable request and PDF SHA-256 before contacting
Brevo. Only small request metadata and the PDF fingerprint are retained in PostgreSQL;
PDF attachments are regenerated from the immutable snapshot and must match that fingerprint
on retry. No per-recipient PDF copies are stored in the database. Requests have a 15-second
deadline and at most eight attempts with the existing backoff for confirmed rate limiting
or unavailable configuration. An in-flight marker is persisted before the external send.
Timeouts, crashes after that marker, malformed success and uncertain provider errors require
operator/provider reconciliation and never automatically resend. Prepared legacy Resend
requests also require reconciliation; the provider is not silently substituted for them.
An accepted response is recorded durably with an audit event. It is never called confirmed
inbox delivery. A reopened/superseded close does not send a stale pending report.

Notification status is a permissioned, branch-scoped read endpoint. It never returns the
provider request, email addresses, API key or attachment data. Ordinary POS state responses
also redact management snapshots and configured recipient identities unless the actor has
reconciliation-view permission. New closing responses are ignored by the frontend if the
selected tenant/branch changed while the request was in flight.

### Protected Configuration Required Before Live Acceptance

An authorized administrator must use a verified Brevo sender and configure the protected
Worker secret `SERAMET_TRANSACTIONAL_EMAIL_CONFIG`, a tenant-ID-keyed JSON object whose
values contain `apiKey` and `from`. Legacy Resend secrets are not reused. Supabase Auth SMTP
remains unchanged and does not supply this API credential. Configure recipients in
the branch closing settings; each must have a valid profile email, branch assignment and
reconciliation-view permission. No credentials were provisioned by this implementation.

Missing configuration results in a durable failed/retrying notification, not a reopened
day or fabricated success. Review a terminal failed job before using existing operational
recovery mechanisms. Never change its idempotency identity to bypass an uncertain send.
For an expired uncertain attempt, reconcile with the provider before any separately
authorized replacement notification. Existing finance/worker retention policies apply;
there is no new public storage bucket or paid infrastructure.

### Acceptance Boundaries

- Engine/persistence tests cover both modes, exact currency counts, variance reasons and
  permissions, tenant/branch ownership, concurrent closes, duplicate/altered keys,
  financial rollback, historical snapshots, unpaid receivables, overnight cutoff and DST.
- Existing PostgreSQL 16 certification now checks combined drawer/day closure, one durable
  email obligation, and a transaction racing a close through two independent connections.
  The legacy refund fixture is reopened with permission before requesting its refund;
  the still-pending refund is then correctly proved to block another close.
- Browser acceptance performs actual cancellation, final confirmation, authoritative
  drawer/day verification, secure PDF download and a 390px layout check using disposable
  loopback data. Desktop/mobile captures and a disposable report are written under
  `.seramet/daily-closing/`, never against staging.
- Email tests use disposable transport fixtures for provider acceptance, uncertain response
  replay, concurrency, crash recovery, revoked recipients, expired evidence, malformed
  provider responses, outages, bounded retries and terminal failure. They do not prove
  real-world sender configuration or inbox delivery.
- The five critical dependency entries for GHSA-qx66-fv34-fjm8 are addressed by the
  minimum patched TanStack release in the prerequisite stack. See
  PILOT_CERTIFICATION_PREREQUISITES.md for the original tree and compatibility change.

The stack remains draft pending final CI, protected live-email acceptance and final
candidate certification. Historical/provider component coverage is explicitly reported.
The first PDF page was
rendered and visually inspected for alignment and legibility. Product sections rank invoiced
units, not profit or unavailable/unsold menu items. No production-readiness claim is made.

An acceptance regression also identified that `addRider` created employee records without
explicit tenant/branch IDs. Once another branch had closing records, the unchanged branch
isolation assertion correctly rejected that response. The record now receives its canonical
scope at creation; the isolation guard is not weakened. Its payroll browser regression is
part of the final acceptance suite.

## Final Stabilization Scope

The POS PostgreSQL job runs the repository verifier independently before the aggregate
pilot gate, so a browser failure cannot conceal missing database certification. A disposable
PostgreSQL trigger injects a failure during day-close persistence; state, drawer, mutation,
audit, realtime and notification counts must remain unchanged through a second connection.
The trigger is test-only and removed in finally; it is not a migration or live operation.
Browser failure traces are retained privately for seven days for this disposable fixture.

Closing performs no global invalidation or browser reload. Delivery status refresh is manual.
The observed authentication/connectivity remount problem predates this stack and has a
separate candidate in PR #134; daily-closing certification does not certify that unmerged
candidate or claim the underlying POS operational blocker has disappeared.
