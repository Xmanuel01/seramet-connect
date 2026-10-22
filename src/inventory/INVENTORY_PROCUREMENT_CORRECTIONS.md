# Inventory and Procurement Corrections

## Scope and Evidence

Local investigation on 2026-10-18. Existing dirty changes were preserved. No live
database, shared pilot fixture, browser, dev server, full test suite, deployment,
merge, or migration was used. No application shell, navigation registry, shared
transaction engine, refund API, or rider API was edited.

All reproductions used new in-memory SQLite and PGlite PostgreSQL databases with
the existing migrations. PostgreSQL queries execute through the production
PostgresD1Database adapter, with an in-memory executor instead of a network pool.
HTTP tests stub authentication only; actual schemas, permissions, branch checks,
handlers, services and database operations run. This is not live authentication
or production deployment certification.

## Confirmed Root Causes

1. `listParPolicies` values new/uncosted stock at zero, but `quantityCostMinor`
   passed zero unit cost to a strictly positive conversion multiplier. Both
   SQLite and PostgreSQL threw `Conversion factors must be positive`. Zero cost
   now returns zero after integer and nonnegative-cost validation. Conversion
   validation and positive-adjustment cost requirements remain unchanged.
2. `summary` used SQLite-only `date('now','+3 day')`. PostgreSQL threw
   `function date(unknown, unknown) does not exist`. The same UTC calendar horizon
   is now calculated server-side and bound as a date string.
3. `procurementOverview` combined PostgreSQL JSON text with integer zero in
   `COALESCE`, causing `COALESCE types text and integer cannot be matched`.
   The numeric tolerance is now explicitly cast before coalescing.
4. Supplier aggregation grouped only by supplier ID despite a composite
   tenant/ID primary key. PostgreSQL reported `column "s.code" must appear in
   the GROUP BY clause`. Receipt aggregation had the same incomplete key and
   ungrouped joined fields. Both queries now group by the correct keys/fields.
5. Procurement route links wrapped `Btn` without `onClick`. The existing shared
   component deliberately disables missing-action buttons. A local inventory
   action-link component now renders a real router anchor, not a disabled nested
   button. Shared button behavior was not changed.

The common inventory loader requires summary, catalogue, categories, warehouses,
units, procurement and cost-control reads to succeed. The failures therefore
disabled add forms across several screens. Its readiness gate was retained, not
bypassed. Errors now identify the failed resource and preserve the server message.

## Existing Controls and Real Prerequisites

| Control | Existing authoritative handler | Remaining prerequisites |
| --- | --- | --- |
| Add item/category/location | POST inventory/items, categories, warehouses | inventory.adjust; valid tenant master data, base unit and branch location |
| Count | POST inventory/stock-counts/start and existing save/submit/approve lifecycle | Single selected branch, countable warehouse items, inventory.count; separate approval permission and fresh snapshot |
| Transfer | Existing request/approve/dispatch/receive transfer handlers | inventory.transfer, access to both branches, different source/destination locations, sufficient dispatch stock |
| Adjustment | Existing adjustment request/approve/reject handlers | inventory.adjust; positive adjustments need a real unit cost; stock changes only after authorized approval |
| Waste/breakage | Existing request/approve/reject handlers | inventory.wastage.record and separate approval permission; waste stock rules and accounting configuration still apply |
| PAR | POST inventory/par-policies | costcontrol.manage; valid item/location and policy bounds |
| Requisition | Existing procurement requisition create/approve handlers | procurement.requisition.create and separate approval permission; valid items, quantities and units |
| Receiving | Existing procurement/goods-receipts handler | procurement.po.receive, approved or partially received PO, valid traceability/quantities and configured posting accounts |

These forms and handlers already existed. No replacement workflow, fabricated
stock, accounting defaults, fake success, permission grant or dead-control
enablement was added. Tests exercise pending requests without premature stock
movements, then actual configured procurement receiving and retry deduplication.

The shared loader still requires `inventory.view` and `costcontrol.view`; missing
grants remain a real authorization blocker, now named in errors. Recalculation
still needs the durable inventory worker queue. Configuration, stock shortages,
closed periods and stale counts are not bypassed.

## Imports

No file import control or new bulk inventory importer was enabled. The existing
setup file-import capability remains unavailable without scan/work queues,
quarantine object storage and an evidence secret; processing requires valid
authenticated CLEAN evidence. No scanner bindings, secrets, verdicts, uploaded
files or live scanner availability were changed or certified. Unit regressions
verify missing pipeline configuration and incomplete CLEAN evidence fail closed.
The separate existing recipe JSON import is not newly enabled or certified as a
scanner-backed file ingestion path by this change.

## Files

- `src/inventory/inventory-intelligence-service.ts`: reproduced SQL failures.
- `src/inventory/quantity.ts`: validated zero-cost valuation.
- `src/inventory/use-inventory-control-centre.ts` and `inventory-response.ts`:
  resource-specific error diagnostics without relaxing readiness.
- `src/inventory/inventory-action-link.tsx`: real local route actions.
- `src/routes/procurement.tsx`, `purchase-orders.tsx`, `receiving.tsx`,
  `requisitions.tsx`, `suppliers.tsx`: replace disabled link-wrapped buttons.
- `src/inventory/inventory-controls.test.ts` and
  `inventory-procurement-regression.test.ts`: focused regression coverage.

## Focused Verification

- New regression files: 21 passing tests across SQLite, PostgreSQL, HTTP handlers,
  route-link semantics, zero-cost validation, diagnostics and scanner boundaries.
- Existing `pass-6-inventory-intelligence.test.ts`: 14 selected lifecycle,
  authorization, retry, receiving, count and closed-period tests pass; 46 unrelated
  cases skipped. No full-suite claim.
- Focused ESLint: zero errors; five existing hook-dependency warnings on unchanged
  lines in procurement route components. No unrelated hook refactor was made.
- Browser rendering and production behavior deliberately remain unverified.
- A combined TypeScript check initially found a test assertion accessing an
  inferred property not exposed by the service return type; the assertion now
  declares the database row type and normalizes its numeric value. The user's coordinating run owns final combined
  TypeScript verification; no concurrent full check was repeated.
