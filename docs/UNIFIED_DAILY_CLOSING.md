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

Review the engine, UI/PDF and notification changes as a stack. Do not merge an incomplete
stack. Real email delivery requires protected provider configuration and is not certified
by disposable tests. No live database mutation, migration, merge or deployment is authorized.
