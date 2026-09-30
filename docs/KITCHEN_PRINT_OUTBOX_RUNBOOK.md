# Transactional kitchen ticket outbox: operating and release runbook

## Guarantee and scope

Kitchen dispatch writes the exact accepted production-line snapshot and one logical ticket
obligation per production station to authoritative PostgreSQL in the **same transaction** as
the order and mutation-commit record. A database failure rolls back the whole order write.
Duplicate submission uses the existing mutation idempotency key, and the obligation has a
deterministic digest of its source order/amendment, station and production line IDs.
The outbox uses existing `authoritative_records` with
`entity_type = print:kitchen-obligation`; it is **not** part of client-editable order state.

The original and each authorized line-addition amendment are separate logical obligations.
Each contains the immutable sent-line snapshot. An unconfigured station is marked
`NEEDS_ROUTING`, never represented as a printed ticket.

## Delivery state machine

| Status | Meaning | Allowed next step |
|---|---|---|
| QUEUED | Server accepted the obligation; no successful device claim recorded | Eligible online device can claim, subject to age gate |
| NEEDS_ROUTING | Missing production station; printing not possible yet | Manager corrects underlying configuration and explicitly authorizes requeue |
| CLAIMED | One authenticated device holds the 120-second claim and may submit to bridge/KDS | Claiming device acknowledges; expired claim requires inspection |
| DELIVERED | Claimant reported bridge acceptance or KDS render, or manager verified delivery | Retain immutable audit history |
| FAILED | Claimant established a failure before any submission | Manager inspects and explicitly authorizes requeue |
| UNCERTAIN | Bridge outcome ambiguous, or claim expired; it **may** have physically printed | Manager inspects physical output/device history before retry |

Claim uses branch/tenant scoped optimistic `status + version` compare-and-swap. A
competing terminal receives a 409 and must not send the ticket. An expired claim is
shown as UNCERTAIN; expiry alone **never** authorizes another physical print.
The device reports DELIVERED only when its bridge confirms acceptance or its KDS
reports display. **Bridge acceptance cannot prove exactly-once physical output.**
An ACK timeout must never trigger physical replay.

## Operator procedure

1. Inspect the Kitchen and Printers screens and confirm the exact order, station, and
   immutable ticket ID. Do not repeatedly press Send Kitchen to fix printing.
2. If QUEUED less than 15 minutes old and no other device is handling it, use an
   authorized, configured terminal to claim and deliver.
3. For an UNCERTAIN/FAILED/NEEDS_ROUTING, expired CLAIMED, or aged QUEUED ticket,
   the manager must log in with full authentication in **Seramet Printers**.
   Inspect physical printouts, KDS and local bridge job history. Record a specific
   review reason (at least 12 characters).
4. Use **Confirm inspected delivery** only after inspection. Use
   **Approve audited retry** only after verifying prior output or knowingly
   authorizing the risk of a duplicate ticket. This requeues the **same** logical
   obligation, increments review count and permits only one new device claim.
5. Record the outcome and review the pending count. A physical printer may output
   immediately before its acknowledgement is lost, so **physical exactly-once
   output is not guaranteed**; never silently replay an ambiguous attempt.

## Security and tenant boundaries

All API actions require authentication, a recognized cashier/kitchen/printer permission,
branch authorization and tenant-scoped SQL. Claims are bound to an authenticated
device/session; only that claimant can acknowledge. Recovery and override require
`settings.hardware.manage` and full authentication. API responses and shared
screens omit claim tokens. Optimistic transitions and their audit event are committed
atomically. The terminal-origin policy remains enforced by the central Seramet API.

## Staging rollout and safe rollback

- No schema change: retain PostgreSQL schema version 26. No migrations,
  reseeding or backlog deletion are part of this PR.
- Run TypeScript, lint, Vitest, isolated real-PostgreSQL KOT/claim and existing
  CRM/finance suites; build and audit the actual Cloudflare bundle.
- Validate a new isolated staging test order, simulate crash *after* authoritative
  commit and *before* client print, refresh POS/Printers and confirm the same
  `print:kitchen-obligation` is recoverable. Repeat with a second terminal:
  exactly one server claim must succeed.
- During staging printerless accommodation, only digital kitchen acceptance is
  claimed; never claim that a physical ticket printed or drain old unscreened jobs.
  Tickets older than 15 minutes need explicit manager review to be eligible.
- Do not activate an old staging Queue/Cron backlog solely to test printing.
  Respect existing recovery, backup/restore, schema, Data API and scanner-disabled
  release gates. Any actual staging deploy requires independently verified
  existing release requirements and confirmation of the deployed commit.
- If runtime failures occur, roll back **application code** to the last approved
  Cloudflare Worker deployment, preserving the database and all outstanding
  `print:kitchen-obligation` records and audit rows. Do not replay or delete
  uncertain tickets automatically. Before reverting, reconcile any tickets
  generated under the new code because older code does not understand the outbox.

## Remaining physical acceptance evidence

A green CI build demonstrates code and database tests, not successful paper output
from the user's installed bridge or restaurant printer. A real print/ack-lost test
and two-device recovery drill are mandatory before production promotion.
