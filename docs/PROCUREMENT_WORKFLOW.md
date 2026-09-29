# Procurement Workflow

## Document flow

```text
low stock / manual request / forecast
  -> purchase requisition
  -> permission-based approval
  -> supplier quote comparison
  -> purchase order
  -> approval
  -> partial or full goods receipt
  -> inventory movement and price history
  -> supplier invoice
  -> three-way match
  -> accounts payable journal
```

Internal document numbers are allocated atomically by tenant, branch, document type and year. Supplier invoice numbers remain external supplier references.

## Requisitions and quotes

Requisitions move through submitted, approved, partially ordered, ordered, rejected or cancelled states. Quote comparison retains total, delivery/other cost, lead time and validity. It sorts evidence for review but does not automatically choose the lowest quote.

## Purchase orders

POs retain supplier, branch, warehouse, currency, expected date, purchase unit, conversion, unit price, tax, discount, total, actor and approval history. Approval and cancellation are explicit state transitions. Cancellation requires a reason.

Approval thresholds remain tenant policy. The implementation enforces permission codes and does not compare role names.

## Receiving

A goods receipt captures ordered, previously received, received now, accepted and rejected quantities, price, lot, expiry, quality and notes. Accepted purchase quantity is converted to base quantity using the effective item conversion.

Partial receipt leaves the PO `PARTIALLY_RECEIVED`; the final accepted quantity changes it to `RECEIVED`. Duplicate submission is idempotent. Database guards prevent total accepted receipt from exceeding policy/tolerance and prevent a supplier return from exceeding accepted receipt quantity.

Receiving writes:

- one authoritative goods receipt and receipt lines;
- `PURCHASE_RECEIPT` inventory movements;
- weighted-average valuation updates;
- lot records when configured;
- supplier item price history;
- purchase and receiving variance evidence;
- recalculation and audit events.

## Over/under receipt

- `REJECT_OVER_RECEIPT`: reject overage.
- `ALLOW_WITH_APPROVAL`: require configured approval evidence.
- `ALLOW_WITH_TOLERANCE`: accept only within configured basis-point tolerance.

The original ordered quantity is never silently changed.

## Three-way match and payable

The supplier invoice compares PO total/quantity, accepted receipt value/quantity and invoice total. Results are `MATCHED`, `QUANTITY_VARIANCE`, `PRICE_VARIANCE` or `MISSING_DOCUMENT`.

Posting creates the configured payable journal. It does not create a cash or bank payment.

## Supplier return

A return references the supplier, goods receipt and receipt lines. It appends `RETURN_TO_SUPPLIER` movements and waits for credit. Confirming a credit note posts the configured accounts payable/inventory reversal. The credit cannot be posted twice or edited after posting.

## Traceability

Every PO can be traced to requisition/quotes, receipt lines, inventory movements, supplier invoice, match, payable journal, audit events and any supplier return/credit.
