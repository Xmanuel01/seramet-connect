# Seramet Pilot Workflow Contract

This contract defines the pilot release boundary. The server is authoritative at every mutation;
browser state is a cache and may never establish identity, tenant membership, branch access,
payment success, printer delivery, or file-scan status.

## Cross-cutting invariants

- Identity comes from a verified account or device/PIN session. Tenant and branch headers are
  selectors checked against server-side membership, never authorization evidence.
- Every mutation is tenant scoped, branch checked, schema validated, audited, and protected by an
  idempotency key plus authoritative revision. Reusing a key with a different request is `409`.
- Monetary persistence uses integer minor units. Display conversion happens only at the UI edge.
- Restaurant reporting uses the record's server-assigned business date and the branch timezone and
  cutoff. UTC timestamps remain immutable event evidence, not accounting dates.
- Realtime messages are invalidation hints. Refreshes are bounded and cannot replace unsaved or
  offline cashier work.
- Print bridge acceptance is not physical delivery. Uncertain output is reviewed and never
  automatically reprinted.
- Spreadsheet imports remain fail-closed until a genuine scanner returns CLEAN evidence bound to
  the exact file and preview. Manual menu entry remains available.
- Budgeting, cost-centre allocation, credit/debit notes and depreciation remain hidden from pilot
  navigation until authoritative write models exist.

## Pilot lifecycle

| Workflow | Actors and pages | Authoritative API and records | State transition and recovery |
| --- | --- | --- | --- |
| Owner registration | Owner; `/signup`, verification, `/onboarding` | Public auth API, registration/onboarding services; identities, tenants, memberships, roles | Unverified accounts cannot create an authenticated restaurant session. Step saves are versioned and idempotent; a conflict reloads current state. |
| Setup | Owner/manager; `/seramet-setup` | `/api/seramet/setup/*`; tenant, branch, role, station, device, payment method, provider connection | Each accepted command is persisted and audited. Failed saves keep user input and cannot appear successful. |
| Staff login | Staff; `/login`, device activation, email/PIN | Public device and employee auth APIs; device, PIN credential, session, user-branch membership | Rate limited and anti-enumeration protected. Logout revokes account and employee sessions and clears tenant caches. |
| Menu | Owner/manager; manual item dialog and menu catalogue | Server manual-menu endpoint; tenant catalogue and branch activation | Server assigns identity/code, validates category/station/tax, and confirms persistence before POS visibility. File import is unavailable without scanner evidence. |
| Order and KOT | Cashier and kitchen; `/pos`, `/kitchen` | Transaction command API; order, durable KOT obligation, mutation commit, audit and realtime event | Draft -> held/open -> sent to kitchen. Multi-station obligations are claimed atomically. Offline commands remain pending until server acknowledgement. |
| Invoice | Cashier; `/invoices`, `/pending` | Transaction command API; invoice and order allocation | Repeated creation is idempotent. The selected order identity is preserved; concurrent revision losers have no side effects. |
| Payment | Cashier; invoice settlement | Cash or M-Pesa sandbox adapter; payment intent, transaction, allocation, collection, drawer movement | Each payment leg has stable identity. Cash is server recorded once. M-Pesa remains pending until an authenticated provider callback confirms it. |
| Receipt | Cashier; `/receipts` | Transaction command API; immutable receipt and reprint audit | Issued only from authoritative settlement. Reprints are audited; print uncertainty does not create another receipt. |
| Reconciliation | Manager/finance; `/payment-control` | Payment operations and reconciliation engine | Provider, bank, allocation and drawer evidence are matched without fabricating success. Physical cash count is explicit and retained on failure. |
| End of day | Manager/finance; Payment Control EOD | Reconciliation engine; readiness checks and immutable revisioned close snapshot | Close consumes canonical readiness. A rejected or concurrent close has no journal, snapshot, audit, or realtime side effect. |
| Reporting | Owner/finance; Dashboard, Accounting, Finance, Reports | Canonical financial lifecycle projection and posted journals | Ordered, invoiced, settled, collected, tax, tender, refund and net values share one business-date scope. |

## Pilot integrations

Only cash and M-Pesa sandbox may be active. Restaurant users configure branch mapping and public
merchant identifiers. Consumer keys, secrets, passkeys, webhook credentials and tokens are
protected deployment secrets and are never returned to the browser. Other provider adapters remain
disabled until separately certified.

## Certification evidence

- `npm run test:pos-postgres`: two independent PostgreSQL connections and atomic losing-race proof.
- `npm run test:e2e`: two isolated browser contexts, draft/realtime/offline/auth workflow checks.
- `npm run test:pilot:local`: workstation-safe source policy, typecheck, lint, unit, concurrency,
  offline, build, bundle audit and two-terminal Playwright gate.
- `npm run test:pilot`: full engineering gate. It runs `test:pilot:local` and then the real
  PostgreSQL verifier. CI supplies its disposable PostgreSQL 16 database; a developer workstation
  must supply the verifier's isolated `SERAMET_POSTGRES_URL` contract.
- `Pilot Staging Acceptance`: protected, manually dispatched workflow covering public signup,
  verification-state enforcement, verified owner login, authenticated reload, device activation,
  branch-bound staff PIN login, logout, reload and back-button behavior. Missing protected inputs
  fail the workflow instead of producing skipped green tests. Supabase administrator confirmation
  is used only by the test process to exercise the verified/unverified boundary; receiving and
  clicking the actual email remains a human staging sign-off because CI has no mailbox access.
- M-Pesa sandbox and physical printing are recorded separately because they require protected
  provider credentials, external callbacks and restaurant hardware.
- Physical printer sign-off must record KOT, bar, bill, receipt, fallback, paper-out/offline,
  uncertain acknowledgement, audited reprint, and restart recovery on actual paper.
