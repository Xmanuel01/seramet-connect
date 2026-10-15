# Printing Operational Acceptance

Date: 15 October 2026 (Africa/Nairobi). Local disposable environment only.
Baseline: `8607afc935471a75b175684d21a878bae2f67e5c` (merged #125-#127).
Code candidate: `9c7e76a2e1054ee547e63c379d7f0bd70680dc1d`.
Subsequent documentation/evidence commits do not change that application/test source.
No merge or deployment.

## Decision

Operational emulator journey: **PASS**. The two critical transaction/receipt
defects found by that journey are corrected. Ready for review and supervised
physical validation after required CI passes, not a production release claim.
Physical paper delivery is **NOT VERIFIED** by this exercise.

| Gate                                                                     | Result                                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Real employee order -> station KOTs -> invoice -> cash -> receipt -> TCP | PASS                                                              |
| Genuine gateway, reservation, durable recovery and interrupted delivery  | PASS                                                              |
| Eight document renders / 32-column narrow encoding                       | PASS with presentation observations below                         |
| Admin controls and visible real bridge queue                             | PASS; summary counters remain misleading (FAIL observation below) |
| Twelve core browser scenarios on one unchanged candidate                 | PASS                                                              |
| Full local engineering validation                                        | PASS                                                              |
| Disposable PostgreSQL                                                    | Required final-head PR CI check; BLOCKED unless green             |
| Physical Epson/spooler/USB/model-specific acceptance                     | BLOCKED: no physical printer used                                 |
| Production readiness                                                     | NOT CERTIFIED                                                     |

## Environment and Reproduction

- Windows; isolated Node 24.22.0 runtime, process-only PATH change.
- Real local Seramet Vite server on `127.0.0.1:4173`, authoritative local SQLite
  repository and randomly generated disposable tenant, users, device and branches.
  No reset of unrelated local data.
- Dedicated upstream `maseylan/escpos-virtual-printer` checkout, clean at pinned
  revision `1b1d31f71bf6ea87ac87ead979b78a4b5b48e63d`.
- Four independent upstream TCP listeners and parser histories. No printer driver,
  Windows port/default-printer change, staging connection or production secret.
- Scoped enrollment downloaded from the real authenticated gateway; separate
  random local bearer token and temporary private bridge SQLite ledger.
- Explicit `SERAMET_BRIDGE_MODE=local-test` plus server-signed development evidence;
  genuine gateway consumption before TCP contact. No fixture-only issuer in the
  operational test. The older six-document encoder verifier is supplementary.
- Emulator/tool dependencies remain under ignored `.seramet`; no application
  dependency or lockfile changes. See `PRINTING_IMPLEMENTATION_EVIDENCE.md` for
  pinned emulator setup, then run the optional operational spec:

```powershell
node scripts/run-pilot-e2e.mjs tests/e2e/printing-operational.spec.ts
```

The optional spec refuses non-local E2E, external BASE_URL and non-Node-24 runs.
It is not silently substituted for the existing twelve core browser scenarios.
Private enrollment, tokens, auth traces, raw logs and ledgers are not published.
Reviewable captures and sanitized results live in `printing-operational-evidence/`.

| Document    | Wide capture                                                    | Narrow capture                                                                                 |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Kitchen KOT | [80mm](printing-operational-evidence/kitchen-80mm.png)          | [58mm encoded / 50mm preview, audited reprint](printing-operational-evidence/kitchen-58mm.png) |
| Grill KOT   | [80mm](printing-operational-evidence/grill-80mm.png)            | Not requested                                                                                  |
| Bar ticket  | [80mm](printing-operational-evidence/bar-80mm.png)              | Not requested                                                                                  |
| Bill        | [80mm original](printing-operational-evidence/bill-80mm.png)    | [58mm marked copy](printing-operational-evidence/bill-58mm.png)                                |
| Receipt     | [80mm original](printing-operational-evidence/receipt-80mm.png) | [58mm marked copy](printing-operational-evidence/receipt-58mm.png)                             |

[Desktop admin](printing-operational-evidence/admin-desktop.png),
[mobile admin](printing-operational-evidence/admin-mobile.png),
[POS handoff](printing-operational-evidence/pos-sent.png),
[actual offline queue](printing-operational-evidence/offline-queue.png),
[sanitized run](printing-operational-evidence/result.json),
[interrupted TCP evidence](printing-operational-evidence/interrupted-transmission.json).

## Persistent Routing

| Device          | Server-authorized role/station | Independent TCP listener | Profiles       |
| --------------- | ------------------------------ | ------------------------ | -------------- |
| Kitchen Printer | KITCHEN / MAIN                 | 127.0.0.1:9100           | 80, then 58 mm |
| Grill Printer   | KITCHEN / GRILL                | 127.0.0.1:9101           | 80 mm          |
| Bar Printer     | BAR / BAR                      | 127.0.0.1:9102           | 80 mm          |
| Cashier Printer | CASHIER                        | 127.0.0.1:9103           | 80 and 58 mm   |

Kitchen add, paper/cutter selection, later edit, queue inspection, diagnostic and
disable use the actual admin UI. Other devices and exact station routes are
persisted through authenticated admin APIs, not browser-only profiles. Desktop
and 390px mobile admin captures include an overflow assertion.

## Operational Journey and Money

1. Authenticated admin APIs create an employee, register and activate a device.
   The employee then signs in through the real code/PIN keypad UI and server
   cookie flow. A real drawer is opened using the authenticated mutation API.
2. Employee POS UI adds kitchen, grill and bar products; kitchen quantity two,
   item preparation note and order preparation note; Hold, exact order recall,
   Send kitchen. Server creates three station-specific KOT obligations.
3. Real signed jobs, durable bridge acceptance and TCP reach the three distinct
   emulator parsers. Bridge acceptance never marks a KOT physically PRINTED.
4. Dispatch intentionally clears the POS entry workspace. Employee opens the
   exact dispatched order in Invoices, creates its bill and settles Cash there.
   This is the application's intended POS-to-Invoices handoff, not payment of a
   replacement/new order. Manager UI previews/prints the bill; employee UI
   prints the actual payment receipt after settlement.
5. Narrow bill/receipt copies use authenticated explicit reprint APIs with unique
   copy identities and operator reasons. Narrow kitchen output uses a separate
   audited KOT reprint obligation, claim and authorization. Receipt register
   reprint history is checked. API-driven recovery/reprint steps are not claimed
   as UI-entered manager review.

All assertions parse authoritative amounts as integer KES minor units:

| Measure                                         | Minor units |
| ----------------------------------------------- | ----------: |
| Kitchen: 2 x 12345                              |       24690 |
| Grill                                           |       27890 |
| Bar                                             |        8825 |
| Subtotal                                        |       61405 |
| Tax (no tax rule in this disposable tenant)     |           0 |
| Total, Cash collection and actual receipt total |       61405 |

No discount is applied. Nonzero tax formatting is additionally exercised by the
existing six-document fixture verifier; that is not a real taxed-sale claim.
There is no structured POS modifier picker in this journey: the no-onion/sauce
request is an actual persisted preparation note, not an invented modifier UI.

## Confirmed Application Defects Corrected

1. `TransactionEngine.applyPayment` rounded paid major units to a whole shilling.
   A genuine 614.05 payment left paid=614, status PARTIAL and no receipt. Receipt
   paid totals used the same rounding. Both boundaries now sum existing integer
   minor units using configured currency precision. No global money/refund/tax
   refactor or persisted record rewrite.
2. Invoices derived a receipt identifier from the bill instead of selecting the
   actual authoritative receipt. Preview and submission now share the existing
   receipt adapter via a scoped resolver; absent/foreign receipts fail closed.

Focused regression covers fractional partial/full payments, real receipt number,
payment breakdown, ordinary bill printing and missing/cross-tenant/cross-branch
receipt rejection. Existing authorization and immutable financial history remain.
This does not retroactively repair any previously persisted fractional-payment
inconsistency; no claim is made about live historical data, which was not accessed.

Exploratory harness failures were not counted as passes: missing real-registration
security policy/account mappings in the lightweight seed, paper-control selector,
legitimate long-name wrapping, and attempting Pay after POS intentionally clears
the entry workspace. Only disposable fixture/test logic was corrected for those.
POS PIN ignores a foreign scope header and stays session-scoped; an explicit
foreign branch query must return 403, and actual returned record scope is checked.

## Failure and Recovery Matrix

All rows below passed in the complete operational scenario. See sanitized
`result.json` and regression results below.

| Scenario                      | Required evidence                                                          |
| ----------------------------- | -------------------------------------------------------------------------- |
| Three stations                | Three real obligations and distinct TCP histories; no wrong items          |
| Duplicate HTTP                | Twelve concurrent identical submissions; no extra TCP output               |
| Fresh bridge / deleted ledger | Genuine server reservation rejects replay; UNCERTAIN, no TCP               |
| Offline grill                 | Stop actual listener; NOT_SENT and visible queue state                     |
| Reconnect                     | Restart actual listener; no replay until manager review/new claim          |
| Recovery                      | Same logical job, new authorization; consumed old claim rejected           |
| Process crash                 | Kill owned Node bridge after genuine reservation; restart same ledger      |
| TCP interruption              | Forward only prefix to real emulator; no completed cut/no physical success |
| Staff/branch denial           | PIN cannot administer printers; foreign branch cannot be selected          |
| Disable                       | UI disables printer; fresh signing request returns 403                     |

The deterministic crash proxy delays a genuine server response, not a fabricated
authorization. TCP truncation is network fault injection, not physical paper-out.
The bridge can legitimately return BYTES_SUBMITTED after kernel acceptance even
when downstream output is truncated: that state is explicitly not physical success.
Endpoint-alias serialization, bounded retries, auth tampering, fallback safety and
atomic transitions are additionally covered by existing bridge/API/PostgreSQL tests.

## Visual Evidence and Limitations

Inspect all eight document PNGs plus desktop/mobile admin, POS handoff and failed
queue captures. Feed/cut and no unknown commands are asserted against actual
upstream parser history, not inferred from screenshots. Narrow encoded lines
must be <=32 columns; upstream preview is approximately 50mm, not physical 58mm.

All eight document PNGs were opened and reviewed: readable quantities, long-name
and note wrapping, no observed clipping, correct CASH/614.05/RC-00001, visible
duplicate/reprint marks, correct branch on customer documents and local Nairobi
date/time. Feed/cut and narrow 32-column checks passed independently of appearance.

Presentation observations, deliberately not template redesigns:

- Original KOTs show restaurant, station and order but omit branch display name;
  narrow KOT reprints also omit station and original dispatch-ticket reference.
  Consider adding explicit branch/station/original-ticket lines before multi-site
  physical rollout. The copy still has the correct order and separate audited
  obligation; no duplicate original obligation is created.
- The KOT reprint label uses the order cashier, not necessarily the approving
  manager. Operator/reason are authoritative in the audit; do not infer reviewer
  identity from that printed label.
- Unconfigured test address/telephone/payment instructions are visibly blank or
  marked unconfigured; no real restaurant data was invented.
- Admin summary metrics can remain zero for this browser session while the actual
  inspected bridge queue contains jobs, including NOT_SENT. Use the real queue,
  not those session metrics, for recovery; a future focused correction should
  source/label these counts consistently. Queue state itself was visible/tested.
- Mobile layout fits 390px without document horizontal overflow, but the large
  administration page requires considerable vertical scrolling. No mobile POS
  transaction or mobile manager-recovery claim is made.

Manager recovery was exercised with authenticated server APIs and an independently
observed queue, not the UI reason-entry controls. The complete browser scenario
does not certify every admin recovery interaction.

Physical printer model, exact geometry, paper-out/cover-open, Windows spooler/USB,
cutter hardware and physical acknowledgement remain hardware-only acceptance.
No exactly-once physical-printing guarantee is made. Lost-ledger recovery still
requires reconciliation; no automatic replay of ambiguous output is permitted.

## Validation

Completed on the unchanged application/test source:

- Operational browser/emulator lifecycle: 1/1 passed; final committed-source
  capture refresh and the remaining gates are recorded below when finished.
- `node --test local-print-bridge/printing.test.mjs`: 14/14 passed, zero skipped.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run validate`: passed, 77 files / 760 tests, zero skipped. Includes
  typecheck, lint (zero errors, 28 pre-existing warnings), production build and
  compiled Queue/Cron handler verification.
- Focused `seramet-flows.test.ts`: 49/49 passed.
- `node scripts/run-pilot-e2e.mjs`: all **12/12** core scenarios passed together
  in one run on `9c7e76a2e1054ee547e63c379d7f0bd70680dc1d` (3.8 minutes), not
  assembled from successes on different candidates. No application/test source
  changes followed that run.
- `node scripts/run-pilot-e2e.mjs tests/e2e/printing-admin.spec.ts`: 1/1 passed
  (40.6 seconds).
- `node scripts/run-pilot-e2e.mjs tests/e2e/printing-operational.spec.ts`: final
  committed-candidate run 1/1 passed (1.5 minutes); captured evidence records
  exact candidate SHA, emulator revision, source hashes, routing and minor units.
- `node scripts/verify-print-emulator.mjs`: 6/6 supplementary fixture documents,
  actual pinned emulator TCP, physical output NOT_VERIFIED.
- `npm.cmd run test:concurrency`: 20 passed; 78 intentionally excluded by its
  existing name filter. `npm.cmd run test:offline`: 3 passed; 24 intentionally
  excluded by its name filter. These exclusions are not skipped mandatory tests:
  the full unfiltered run passed all 760 with zero skipped.
- `npm.cmd run audit:bundle`: passed.
- Focused ESLint, repository Prettier and `git diff --check`: passed.

The existing Verify POS PostgreSQL PR workflow supplies disposable PostgreSQL 16,
official migrations and `npm run test:pilot`, including POS and menu-import
PostgreSQL verifiers. It includes independent-connection print-reservation races,
attempt bounds, stale/tampered authorization and branch protection. Its final-head
run/conclusion must be checked in the PR; no live database is substituted. CI
links and the final candidate SHA are reported in the PR validation comment.

All test-created listeners/bridge processes are closed; private temporary ledgers
are removed. Generated evidence contains disposable names/record IDs only, masked
bridge-token controls and no signed capabilities or authentication traces.

Next authorized step is owner review of the focused correction/evidence PR.
No merge, deployment, live credential provisioning or live database mutation was
performed. Physical validation must separately verify paper/cutter/status/failure
behavior; uncertain output must never auto-reprint.
