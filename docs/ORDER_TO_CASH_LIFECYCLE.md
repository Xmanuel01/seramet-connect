# Order-to-Cash Lifecycle

## Source of truth

The server `TransactionRepository` is authoritative in staging and production. The POS holds a
replaceable read cache and permitted offline commands only. Order, production, invoice, payment,
receipt, settlement and journal records remain separate and share tenant, branch and source IDs.

## Order and production states

| Current state | Permitted operation | Result |
| --- | --- | --- |
| `HELD` | Release | `OPEN` |
| `OPEN` | Send unsent lines | `SENT_TO_KITCHEN` |
| `SENT_TO_KITCHEN` | Station starts | `IN_PROGRESS` |
| `IN_PROGRESS` | Required stations ready | `READY` |
| `READY` | Serve | `SERVED` |
| `SENT_TO_KITCHEN`, `IN_PROGRESS`, `READY`, `SERVED` | Request bill | `BILL_REQUESTED` plus one open invoice |
| `BILL_REQUESTED` | Prepare payment again | Existing payable invoice is returned |
| `BILL_REQUESTED` | Confirm partial allocation | `PARTIALLY_PAID` |
| `BILL_REQUESTED`, `PARTIALLY_PAID` | Confirm remaining allocation | `PAID` |
| Operational unpaid state | Authorized cancellation with reason | `CANCELLED`; sent lines receive a cancellation amendment |
| `PAID` | Refund workflow | Payment refund/reversal records; never ordinary cancellation |

Station status remains line-scoped. The parent order summarizes required station progress rather
than replacing independent kitchen/bar states.

## Sent-line rule

When a line is first sent, `sentAt`, `sentQuantity`, price, station, modifiers/notes and product
identity become an immutable production snapshot. The POS retains those line IDs. Increasing a
quantity creates an unsent delta line. Sending again creates one `ADDITION` production amendment
and prints only the new lines. Reductions and deletions require the authorized cancellation path.

## Invoice preparation and payment session

`prepareInvoiceForPayment` requires an explicit order ID. It never creates an order and never
selects the first record. It returns the existing `OPEN`, `PARTIAL` or `PENDING` invoice, or creates
one invoice after moving the exact order through valid kitchen/bill states.

The POS opens payment as follows:

1. Save the exact active order draft with stable sent-line IDs.
2. Prepare its invoice once.
3. Capture both order ID and invoice ID in the payment session.
4. On confirmation, reload authoritative state and resolve that exact invoice.
5. Verify tenant, active branch and payable status.
6. Apply configured payment methods through `PaymentOrchestrator` or the integration runtime.
7. Print only from the authoritative receipt after confirmed payment.

A missing or stale session stops with: `Payment session is no longer valid. Reopen payment from the invoice.`

## Split and merge

- Only open, unpaid invoices can split or merge.
- A split source becomes terminal `SPLIT`; children reference `splitFromBillId`.
- Merge requires one tenant and one branch; sources become terminal `MERGED` and the child retains
  every source and order ID.
- Source invoices cannot accept intents or allocations after either operation.
- Child totals allocate subtotal and tax deterministically, with the final child receiving the
  rounding remainder. Stock consumption remains tied to orders and is not repeated by billing.

## Cash and digital collection

Cash requires an open drawer in the invoice branch. The confirmed payment amount is the amount
applied; `cashTendered` may be higher and `changeGiven` is not revenue or drawer gain. Digital
prompts use the integration runtime. A redirect, cashier click or unverified reference cannot
create a paid receipt. Provider confirmation, settlement and bank receipt remain distinct events.

## Concurrency and retries

Mutation requests include `idempotencyKey` and `expectedRevision`. The authoritative repository
persists one writer per base revision. A stale request receives HTTP `409 CONFLICT` plus the current
branch-filtered snapshot. HTTP rejections are not converted into offline commands. Transport
failures may queue only explicitly permitted offline operations. Replays reuse their original
idempotent response and local KOT effects are not repeated.

```json
{
  "action": "prepareInvoiceForPayment",
  "payload": { "orderId": "ORD-..." },
  "idempotencyKey": "device-command-id",
  "expectedRevision": 42
}
```

## Branch and permission rules

The authenticated actor supplies tenant and active branch. Entity tenant/branch IDs are verified
server-side. All-branch reporting scope does not authorize a POS payment in another active branch.
The actor must switch through authorized branch assignment before mutating that branch.

| Action | Permission |
| --- | --- |
| Create/update/send order | `orders.create` / `orders.update` |
| Cancel order | `orders.cancel` |
| Create, split or merge invoice | `invoices.manage` |
| Collect configured payment | `payments.collect` |
| Confirm provider result | `payments.confirm` |
| Request/approve refund | `payments.refund.request` / `payments.refund.approve` |
| Open/close drawer | `cash.open` / `cash.close` |
| Reconcile payment | `payments.match` / reconciliation permissions |

## Known limitations

- The existing invoice split command supports amount-based children. Item-based allocation remains
  a future extension and must not be represented as available until implemented.
- Manual card and bank records remain pending/manual evidence until their configured reconciliation
  source verifies them.
- Live provider certification, credentials and printer hardware remain deployment dependencies.

