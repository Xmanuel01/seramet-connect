# Durable kitchen print outbox and operator recovery

## Guarantee

Each NEW kitchen dispatch, direct kitchen ADDITION and authorized VOID produces an
immutable, station-specific `kotObligations` snapshot **inside the authoritative
order payload**. The existing transaction repository commits the modified order
and its audit/revision/idempotency record in one database batch. No new schema
or migration is introduced. The server record remains after browser failure,
printer failure, network loss or navigation. An unsent offline POS mutation
does not authorize physical output before server replay/confirmation.

The outbox is a *logical* ticket obligation. It cannot guarantee exactly-once
physical output: a printer may produce paper while its acknowledgement is
lost. Never automatically print again because a status is old.

## States

- `PENDING`: server committed the KOT but it has not been claimed.
- `CLAIMED`: one authenticated POS session/device claimed it using the
  authoritative revision gate. A crash now requires reconciliation.
- `QUEUED`: job persisted in this device queue; physical output is unconfirmed.
- `BRIDGE_ACKNOWLEDGED`: this device's installed bridge or KDS reported
  success. Paper output is still not independently guaranteed.
- `DIGITAL_DISPLAYED`: specifically permitted printerless staging uses
  digital Kitchen, not a claim of physical paper.
- `UNCERTAIN`: dispatch/storage failed or its outcome cannot be established.

KOT IDs survive retries and separate NEW, ADDITION and VOID waves. A duplicate
claim fails; the operation ID and server revision prevent racing terminals
from claiming the same KOT.

## Recover a stalled KOT

1. Open **Seramet Printers → Durable kitchen print outbox** on the correct
   active branch.
2. Check the physical printer, KDS and **every other cashier terminal** for
   the same order/station and ticket identity. Do not infer that missing local
   history means no ticket printed elsewhere.
3. For a server-`PENDING` obligation with no local ticket and configured
   hardware, use **Review and queue missing KOT** after the explicit check.
   The system claims it on the server before persisting and dispatching.
4. For `CLAIMED`, `QUEUED` or `UNCERTAIN`, an authorized manager must
   investigate actual output, provide an audit reason and explicitly release
   the obligation for a new attempt. No automatic retry is permitted.
5. On a browser/device restart, the local queue keeps the ticket but flags
   any previously in-flight job as **UNCONFIRMED AFTER RESTART**. Reconcile
   the server outbox and physical printer before retrying.
6. Historic kitchen orders created before the durable-outbox release cannot
   reliably prove their original paper state; reconcile them manually,
   without manufacturing a fictitious original ticket.

## Staging acceptance checklist

- Verify the exact deployed SHA and existing scanner-disabled/staging release
  gates; do not reset customer records or replay old import/management jobs.
- Test a new Kitchen+Bar order and check TWO independent server obligations
  with immutable item/quantity snapshots.
- Kill the browser immediately after server acceptance and before local
  print registration. Open Printers on another authorized device: the
  unclaimed obligation must still exist.
- Claim on two cashier sessions concurrently. Only one must win; the loser
  must receive a conflict rather than enqueue a second ticket.
- Kill the browser after claim or after handing a ticket to a physical
  printer. Recovery must display uncertainty and require human review.
- Verify the combined KDS+paper configuration reuses ONE logical obligation
  while tracking both deliveries; bridge ACK does not mean independently
  verified physical paper.
- Verify addition and cancellation produce independent ticket IDs with
  only changed/voided lines. Repeat attempts must not regenerate originals.
- Simulate browser storage quota failure. The cashier must receive a warning
  and the authoritative server obligation must remain available.
- Check server tenant/branch authorization, manager reset permission and
  audit trail. Confirm no production environment or scanner changes.

## Rollback

If the candidate fails staging acceptance, roll back the **Worker application
version only** to its previously recorded staging version and suspend newly
generated KOT retries until printing has been reconciled. No migration
rollback is needed. Orders created with `kotObligations` retain those
additional JSON fields in PostgreSQL; do not delete or rewrite them as part
of application rollback. Do not deploy directly to production on green CI
alone.
