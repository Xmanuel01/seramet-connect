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
- `npm run test:pilot`: full engineering gate. It runs `test:pilot:local`, the POS PostgreSQL
  verifier, and the menu-import PostgreSQL verifier. CI supplies its disposable PostgreSQL 16
  database; a developer workstation must supply the verifier's isolated
  `SERAMET_POSTGRES_URL` contract.
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

## Protected staging acceptance checklist

Use a disposable tenant and non-production accounts. Record the staging release SHA, tester,
timestamp, branch, device, evidence link, and result for every item. Never place credentials,
tokens, PINs, customer data, or full provider payloads in the evidence.

### Authenticated shift

- [ ] Owner signup, real email verification, first login, onboarding recovery, and business profile
      persistence pass.
- [ ] Separate owner, manager, cashier, kitchen, and finance users receive only their assigned
      tenant, branches, and actions; cross-tenant and cross-branch requests are rejected.
- [ ] Device activation and branch-bound staff email/PIN login pass; blocked, revoked, wrong-PIN,
      rate-limit, and expired-session paths fail without account enumeration.
- [ ] Cashier creates, holds, recalls, sends, invoices, and settles the exact selected order while a
      second terminal receives bounded realtime refreshes without overwriting local work.
- [ ] Kitchen acknowledges the correct branch/station KOT; void, refund, receipt, explicit drawer
      count, reconciliation, EOD close, and canonical financial reports agree.
- [ ] Offline hold/replay, duplicate replay, server failure, reconnect, and two-terminal conflict
      recovery preserve idempotency and leave no orphan financial or KOT effects.
- [ ] Logout revokes the server session, clears tenant-bound browser state, and reload/back/protected
      navigation require authentication again.

### M-Pesa sandbox

- [ ] Rotated sandbox consumer credentials, passkey, shortcode, and callback authentication are
      installed only as protected staging secrets; restaurant UI shows no secret values.
- [ ] STK initiation creates a pending server-side payment intent and never marks an invoice paid
      from a browser prompt or client claim.
- [ ] Authenticated success callback settles once and produces one allocation, journal effect,
      reconciliation record, and receipt; duplicate delivery is idempotent.
- [ ] Altered, unauthenticated, cross-tenant, and unknown-reference callbacks are rejected and
      audited without financial effects.
- [ ] Customer cancel, provider failure, timeout, lost response, delayed callback, and status query
      preserve authoritative pending/failed state and support safe recovery.

### Physical ESC/POS printing

- [ ] A supported USB or LAN thermal printer is installed through the Windows spooler and the local
      bridge is enrolled for the disposable staging branch.
- [ ] Kitchen KOT, bar ticket, bill, and receipt print on physical paper with correct branch,
      business date/time, order, totals, and station routing.
- [ ] Single-printer fallback emits each required document once; multi-printer routing sends each
      document only to its configured destination.
- [ ] Paper-out, printer offline, bridge restart, and uncertain acknowledgement remain visible and
      never trigger an automatic duplicate print.
- [ ] Authorized reprint is explicit and audited; bridge acceptance and human-confirmed paper output
      are recorded as separate evidence.

Spreadsheet import remains a failed release gate until a genuine scanner returns authenticated
CLEAN evidence bound to the exact quarantined object and fingerprint. No staging checklist item may
be used to authorize a scanner bypass.
