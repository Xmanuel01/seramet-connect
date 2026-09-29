# Order Workflow Operator Guide

## Waiter

Create or resume the selected order, add items, select the configured table/channel and send to
production. The cart shows `sent / unsent` quantities. Sent quantities and their preparation notes
cannot be edited; add a new quantity or ask an authorized supervisor to cancel with a reason.

## Cashier

Open payment from the selected POS order or invoice. Wait for invoice preparation to finish. Confirm
that the branch, amount due and payment method are correct. Cash requires an open drawer. Enter
tendered cash to show change. Digital requests remain pending until provider confirmation. A paid
receipt is printed only from the authoritative receipt record.

If the screen reports that the payment session is invalid, close payment, refresh and reopen the
same invoice. Never start another order to work around the error.

## Supervisor

Use selected records for cancellation, split and merge. A cancellation reason is mandatory and the
authenticated actor is recorded by the server. Sent items remain in history and create a production
cancellation amendment. Split/merged source invoices are terminal and must never be paid.

For a `409` conflict, review the refreshed order from the server before retrying. Do not repeat a
financial action under a new invoice or alter another branch's record.

## Manager

Review production amendments, pending digital collections, print failures, drawer exceptions and
reconciliation queues. Reprints must use the existing receipt identity and audit path. Provider
failure does not reverse a valid order, and print failure does not reverse a confirmed payment.

Cross-branch visibility is for review. Operational mutation requires switching to an assigned
branch with `branches.switch`; payment and drawer actions always target the active branch.

## Recovery

| Message/state | Operator response |
| --- | --- |
| Payment session invalid | Refresh and reopen the exact invoice. |
| Order changed on another terminal | Review refreshed lines/status, then retry the intended action. |
| Offline | Cash-only operations follow branch policy; digital confirmation is unavailable. |
| Provider pending | Keep invoice open; wait for verified callback/status. |
| Provider failed/timed out | Retain the failure, verify provider state and retry through the configured flow. |
| Print failed | Retry the existing print job/receipt; do not collect payment again. |
| Sent item must be reduced | Use authorized cancellation with reason; do not edit the sent snapshot. |

