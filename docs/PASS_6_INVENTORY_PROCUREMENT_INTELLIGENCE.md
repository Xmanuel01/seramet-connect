# Pass 6 - Inventory, Procurement, Production and Food-Cost Intelligence

Pass 6 extends the authoritative Pass 5 database, worker and audit architecture. It does not create a second inventory or accounting system.

## Production execution path

```text
POS / receiving / production / stock count
  -> authenticated server command
  -> tenant, branch and permission validation
  -> append-only inventory movement or controlled document state transition
  -> derived inventory balance and weighted-average value
  -> configured journal posting where accounting mode is PERPETUAL
  -> durable recalculation event
  -> forecast, PAR, recipe cost, variance, prep and 86 read models
  -> Pass 3 availability outbox when sellability changes
```

The browser is not authoritative. Internal PO, goods-receipt, requisition, transfer and supplier-return numbers are allocated by the Pass 5 document sequence. Routine operational dates are calculated from the branch timezone and business-day cutoff on the server.

## Inventory domain

Quantities are integers in micro-units: one base unit is `1,000,000`. Money is integer currency minor units. Rational UOM factors use integer numerators and denominators. The movement ledger is append-only and idempotent; balances are a transactional read model derived from accepted movements.

The implemented movement types cover opening, purchase receipt, sale consumption, production input/output, transfer in/out, wastage, breakage, count adjustment, supplier return, customer return, manual adjustment and expiry. Manual adjustments require a reason. Negative inventory follows the configured `ALLOW_WITH_ALERT`, `BLOCK` or `MANAGER_OVERRIDE` policy.

Weighted average is the implemented valuation method. A strategy boundary exists for FIFO, but FIFO intentionally fails configuration because no cost-layer depletion implementation is claimed.

## Procurement and receiving

The authoritative workflow supports suppliers, supplier-item purchasing data, price history, requisitions, quote comparison, purchase orders, permission-based approval, partial receiving, over-receipt policy, accepted/rejected quantities, lots/expiry, purchase-price variance, supplier invoices, three-way match and supplier returns.

A supplier invoice posts a payable; it does not create a cash or bank payment. A supplier return removes inventory and stays `PENDING_CREDIT` until the supplier credit note is confirmed. The credit posting is idempotent and immutable.

## Recipes and production

Recipes have effective, immutable versions. Components can reference an inventory item or a sub-recipe; cycles are rejected. Recipe costing resolves unit conversions, waste factors, sub-recipe yield, packaging cost and configured production overhead.

Production completion creates input and output movements once. Expected and actual yield remain separate. Raw ingredients are not consumed again when a prepared inventory item is sold.

## Food-cost intelligence

Theoretical consumption is derived independently from dated invoice sales, the recipe version effective on the sale date and configured modifier recipes. Actual consumption comes from inventory movements and count evidence. If normalized sales are unavailable, legacy movement-derived theoretical usage is a LOW-quality compatibility fallback.

Stored variance periods retain actual quantity, theoretical quantity, explained quantity, unexplained quantity, value and quality. The system never assigns a driver unless a stored event supports it. Missing recipes, missing costs, invalid conversions and other configuration gaps become data-quality issues instead of fabricated precision.

## Forecast, PAR and purchasing

The durable inventory worker uses a deterministic 28-day weighted moving average. It stores inputs, sample count and quality. Recommended purchasing uses forecast demand over lead time, safety stock, target closing stock, on-hand stock, confirmed incoming PO quantity and the item-specific purchase-unit conversion. Recommendations never place supplier orders automatically.

## Availability and 86

Sellable portions are recalculated from authoritative ingredient, sub-recipe and prepared-item balances. Reaching zero creates one pending availability change. The worker queues that change through the existing Pass 3 integration runtime. A receipt or production output can restore availability and queue the reverse change. Inventory code never calls a marketplace adapter directly.

## UI

The existing Inventory, Procurement and Cost Control routes retain the Seramet shell, panels, tables, filters, dialogs, status chips and responsive behavior. Production data comes from paginated/limited server queries. Development snapshots remain an explicitly non-authoritative compatibility view only.

## Security and controls

- Every record and query is tenant scoped; branch access comes from the authenticated server actor.
- Sensitive mutations enforce permission codes in the domain service.
- Inventory movements, posted counts, supplier-return credits and posted journals have database immutability/concurrency guards.
- Closed business dates reject inventory mutations unless the actor has reopen permission and provides a reason.
- File import remains behind the Pass 5 validated preview/security boundary; arbitrary browser storage is never imported automatically.
- Audit records capture actor, branch, action, entity and correlation identifiers without secrets.

## Validation scope

Pass 6 tests execute all seven migrations against SQLite and cover quantity/UOM arithmetic, conversion versioning, weighted average, movement immutability, negative policy, procurement, receiving, price variance, recipes, production, counts, transfers, wastage, supplier invoices/returns, journals, theoretical usage, forecast, recommendations, 86 outbox behavior, tenant/branch access, concurrent consumption and duplicate submission. A separate load fixture measures 10,000 movements, 1,000 items, 500 recipes, 100 suppliers and 1,000 POs.

## Honest limitations

- FIFO is a prepared strategy boundary, not implemented.
- Forecasting is deterministic statistics, not AI or machine learning.
- A modifier affects theoretical usage only when its identifier resolves to a configured recipe.
- Variance attribution is limited to persisted evidence. The remainder is explicitly unexplained.
- Live supplier ordering, autonomous purchasing and supplier payment are outside this pass.
- Barcode columns are present as a foundation; scanner-specific integrations are not implemented.
