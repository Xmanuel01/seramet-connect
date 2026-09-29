# Pass 6 Go-Live Checklist

## Master data

- [ ] Every inventory item has a unique code, base unit and warehouse assignment.
- [ ] Purchase/storage/issue units and item-specific conversions are reviewed.
- [ ] Expiry tracking is enabled only for applicable items.
- [ ] Suppliers, supplier items, lead times, minimum quantities and preferred flags are verified.
- [ ] Opening stock has been posted through the controlled workflow and reconciled.

## Recipes and production

- [ ] Every material menu item has an active dated recipe version.
- [ ] Recipe yields, waste factors, modifiers and sub-recipes are reviewed by operations.
- [ ] Circular-dependency and missing-cost diagnostics are clear.
- [ ] Prepared items use production input/output and are not double-consumed at sale.
- [ ] Stations and portion standards are configured where required.

## Procurement and receiving

- [ ] Requisition, PO, approval, receiving and invoice permissions are assigned.
- [ ] Approval and over-receipt thresholds are configured.
- [ ] Purchase document sequences are configured/tested per branch.
- [ ] Partial receipt, rejection, lot/expiry and supplier-return workflows are rehearsed.
- [ ] Supplier invoice three-way match and credit-note handling are verified.

## Inventory controls

- [ ] Negative-stock policy is configured per branch/item class.
- [ ] PAR, safety stock and target quantities are approved.
- [ ] Blind/multi-counter stock-count policy and variance thresholds are configured.
- [ ] Wastage reasons and approval thresholds are configured.
- [ ] Day-close/backdate behavior is tested.

## Accounting

- [ ] Accounting mode is explicitly `PERPETUAL` or `PERIODIC`.
- [ ] Inventory, opening, payable, COGS, wastage, variance and recoverable-tax account IDs are configured.
- [ ] Supplier invoice and supplier-return journals are reviewed with finance.
- [ ] Inventory subledger versus GL reconciliation is zero or explained.
- [ ] Tax/service-charge/discount definitions match finance policy.

## Workers and integrations

- [ ] Durable inventory recalculation and expiry jobs are healthy.
- [ ] Forecast/PAR inputs and quality states are reviewed after sufficient history.
- [ ] 86 changes reach the Pass 3 availability outbox exactly once.
- [ ] Restock/production re-enables channel availability.
- [ ] Manager actions surface stockout, variance, expiry, price and yield exceptions.

## Security and operations

- [ ] Production bearer authentication, branch assignments and device trust are active.
- [ ] Tenant/branch isolation tests pass against the production-equivalent database.
- [ ] Import file size/type/row validation and preview are enabled.
- [ ] No browser snapshot is authoritative.
- [ ] Backups, restore rehearsal, migration rollback plan and support diagnostics are current.

## Validation gate

- [ ] TypeScript, lint, full tests and production build pass.
- [ ] Database, concurrency and Pass 6 load tests pass.
- [ ] Inventory, Procurement and Cost Control pass desktop/tablet/mobile QA.
- [ ] No production console errors or page-level overflow remain.
- [ ] Pilot opening balances, recipes, suppliers and account mappings are signed off by the restaurant.
