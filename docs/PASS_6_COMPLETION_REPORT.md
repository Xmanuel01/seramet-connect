# Pass 6 Completion Report

Pass 6 is complete against the implemented Seramet repository at schema version 7. The work extends the Pass 5 authoritative database, permission, business-date, document-numbering, audit, worker, and outbox architecture. It does not introduce browser-authoritative inventory or a separate accounting system.

## Validation Results

| Check                   | Result | Evidence                                                          |
| ----------------------- | ------ | ----------------------------------------------------------------- |
| Full test suite         | PASS   | 189 tests in 9 files                                              |
| Pass 6 focused tests    | PASS   | 36 tests: 35 domain/database tests and 1 load test                |
| Database integration    | PASS   | 54 tests across Pass 5 and Pass 6 database suites                 |
| Concurrency/idempotency | PASS   | 11 selected concurrent tests passed; 43 nonmatching tests skipped |
| TypeScript              | PASS   | `npm run typecheck` completed with no errors                      |
| Lint                    | PASS   | 0 errors; 10 pre-existing Fast Refresh warnings                   |
| Production build        | PASS   | Client, SSR, and Nitro Cloudflare output completed                |
| Desktop QA              | PASS   | 1440 x 900, no console errors or page-level overflow              |
| Tablet QA               | PASS   | 1024 x 768, no console errors or page-level overflow              |
| Mobile QA               | PASS   | 390 x 844, responsive cards and dialogs, no page-level overflow   |

The first production-build attempt encountered a Windows shared-cache `EPERM` condition. Re-running with normal cache access completed successfully; this was an environment lock, not a source or build failure.

## Acceptance Criteria

| #   | Criterion                                         | Result | Implementation evidence                                                                        |
| --- | ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| 1   | Inventory is movement-ledger based                | PASS   | Append-only `inventory_movements` is the quantity and value ledger.                            |
| 2   | Balance is not manually authoritative             | PASS   | `inventory_balances` is updated transactionally from accepted movements.                       |
| 3   | UOM system works                                  | PASS   | Dimensioned tenant/global unit definitions and exact integer conversion services.              |
| 4   | Item-specific conversions work                    | PASS   | Effective-dated rational `item_unit_conversions`.                                              |
| 5   | Purchase unit conversion works                    | PASS   | Receiving normalizes purchase packaging into base quantities.                                  |
| 6   | Weighted-average valuation works                  | PASS   | Integer/BigInt weighted-average valuation with centralized rounding.                           |
| 7   | Supplier master works                             | PASS   | Tenant-scoped suppliers with branch-independent commercial data.                               |
| 8   | Supplier price history works                      | PASS   | Receipt-derived normalized price history is append-only.                                       |
| 9   | Purchase requisitions work                        | PASS   | Draft, submit, approve, reject, and ordering states are authoritative.                         |
| 10  | PO approval works                                 | PASS   | Permission and configured threshold checks, with audited reasons.                              |
| 11  | Partial receiving works                           | PASS   | Cumulative receipt quantities drive partial and complete PO states.                            |
| 12  | Over/under receiving policy works                 | PASS   | Reject, tolerance, and approval policies are enforced.                                         |
| 13  | Purchase price variance works                     | PASS   | Expected and actual price/value remain separately stored.                                      |
| 14  | Three-way matching works                          | PASS   | PO, goods receipt, and supplier invoice yield explicit match statuses.                         |
| 15  | Supplier invoices/payables integrate with finance | PASS   | Configured inventory/tax/AP accounts generate balanced posted journals.                        |
| 16  | Transfers work                                    | PASS   | Source and destination movements remain paired and idempotent.                                 |
| 17  | Inter-branch variance is traceable                | PASS   | Sent, received, shortage quantity, value, and approval remain stored.                          |
| 18  | Recipe versioning works                           | PASS   | Immutable effective versions preserve historical costing.                                      |
| 19  | Sub-recipes work                                  | PASS   | Recursive costing/usage with circular dependency rejection.                                    |
| 20  | Production batches work                           | PASS   | Planned, in-progress, complete, and cancelled production state.                                |
| 21  | Yield variance works                              | PASS   | Expected and actual output are retained and compared in basis points.                          |
| 22  | Stock counting works                              | PASS   | Blind and normal count sessions with review/approval controls.                                 |
| 23  | Count posting creates movements                   | PASS   | Posting creates `STOCK_COUNT_ADJUSTMENT`; balances are never rewritten.                        |
| 24  | Wastage works                                     | PASS   | Configurable reasons, approval, cost, station, actor, and audit.                               |
| 25  | Expiry/lot tracking works where configured        | PASS   | Receipt lots retain expiry and remaining quantity; worker emits alerts.                        |
| 26  | PAR configuration works                           | PASS   | Branch, warehouse, item, lead-time, safety, target, and policy data.                           |
| 27  | Deterministic PAR recommendations work            | PASS   | Reproducible weighted-moving-average inputs and explained output.                              |
| 28  | Deterministic demand forecast works               | PASS   | Same inputs produce the same forecast and quality state.                                       |
| 29  | Purchase recommendations work                     | PASS   | Forecast, lead time, safety, stock, incoming PO, and packaging conversion.                     |
| 30  | Current recipe cost works                         | PASS   | Active effective version resolves normalized ingredient/sub-recipe cost.                       |
| 31  | Cost per portion works                            | PASS   | Theoretical and actual-yield cost per portion remain separate.                                 |
| 32  | Theoretical consumption works                     | PASS   | Invoice sales, effective recipes, and configured modifiers are independent inputs.             |
| 33  | Actual consumption works                          | PASS   | Opening, receipts, closing/count, transfers, and movements determine actual use.               |
| 34  | Actual vs theoretical variance works              | PASS   | Quantity and value variance are persisted per item and period.                                 |
| 35  | Food-cost variance is value-aware                 | PASS   | Quantity variance uses authoritative weighted unit value.                                      |
| 36  | Unsupported variance remains unexplained          | PASS   | Only stored evidence is attributed; residual is `UNEXPLAINED`.                                 |
| 37  | Menu profitability works                          | PASS   | Net revenue, theoretical cost, contribution, cost percentage, popularity, and quality.         |
| 38  | Production planning/prep recommendations work     | PASS   | Forecast demand and prepared stock create deterministic prep rows.                             |
| 39  | 86 uses authoritative inventory/production state  | PASS   | Available portions derive from inventory, sub-recipes, and prepared items.                     |
| 40  | Marketplace availability uses Pass 3 outbox       | PASS   | Inventory queues availability transitions through the existing integration runtime.            |
| 41  | Accounting postings are configuration driven      | PASS   | Account mapping IDs drive journals; no display-name comparisons.                               |
| 42  | Tenant isolation remains intact                   | PASS   | Tenant predicates, composite keys, and cross-tenant tests.                                     |
| 43  | Branch authorization remains intact               | PASS   | Authenticated branch assignments are enforced by server APIs/services.                         |
| 44  | Closed-period controls remain intact              | PASS   | Server business date and DayClose lock require permission and reason.                          |
| 45  | Durable workers perform heavy recalculation       | PASS   | Forecast, cost, PAR, quality, prep, expiry, and availability jobs use Pass 5 workers.          |
| 46  | Data-quality diagnostics exist                    | PASS   | Missing recipe/cost, invalid conversions, negative stock, and stale counts are explicit.       |
| 47  | Analytics expose quality/confidence state         | PASS   | HIGH, MEDIUM, LOW, and INSUFFICIENT_DATA are stored and rendered.                              |
| 48  | Existing flows remain intact                      | PASS   | Full Pass 1-5 suite, POS bridge, printing identity, KDS, payments, and marketplace tests pass. |
| 49  | No new hardcoding introduced                      | PASS   | Tenant data, permissions, accounts, units, policies, and document sequences remain configured. |
| 50  | Database tests pass                               | PASS   | 54 database integration tests passed.                                                          |
| 51  | Concurrency tests pass                            | PASS   | Concurrent receiving, production, transfer, count, and stock consumption preserve invariants.  |
| 52  | TypeScript passes                                 | PASS   | No TypeScript errors.                                                                          |
| 53  | Lint passes                                       | PASS   | No lint errors.                                                                                |
| 54  | Production build passes                           | PASS   | Client, SSR, and Nitro production artifacts generated.                                         |
| 55  | Full test suite passes                            | PASS   | 189/189 tests passed.                                                                          |
| 56  | Desktop/tablet/mobile QA passes                   | PASS   | Inventory, Procurement, and Cost Control passed responsive browser QA.                         |

## Schema and Entities

Migration `0007_inventory_procurement_intelligence.sql` adds 35 tables, 21 indexes, and 12 integrity/immutability triggers. The new tables cover:

- Units and item conversions.
- Suppliers, supplier items, and price history.
- Requisitions, quotes, receipt lines, supplier invoices, returns, and three-way matches.
- Transfers and transfer lines.
- Recipe versions/components, production batches, prep recommendations, and portion controls.
- Stock counts, lots, PAR, forecasts, purchase recommendations, consumption periods, menu profitability, data quality, 86 state, account mappings, and recalculation events.

Existing inventory items, balances, movements, purchase orders, goods receipts, recipes, journals, workers, audit records, business-date locks, and integration outbox records are extended rather than duplicated.

## Valuation and Units

Quantities use integer micro-units (`1 base unit = 1,000,000`). Money uses integer currency minor units. Conversions use exact integer numerator/denominator factors and effective dates. Item-specific packaging therefore works without binary floating-point arithmetic.

`WEIGHTED_AVERAGE` is implemented. For 10 kg at KSh 550/kg and 10 kg at KSh 600/kg, the value is KSh 11,500 over 20 kg and the new average is KSh 575/kg. Intermediate arithmetic uses BigInt and rounds once at the controlled boundary.

FIFO is not implemented. The valuation strategy boundary exists, but selecting FIFO fails explicitly rather than pretending cost-layer depletion exists.

## Operational Traces

### Purchase to Payable

1. A PO orders one box of 24 bottles for KSh 2,400 using the configured box-to-piece conversion.
2. Goods receiving accepts one box, creates a 24-piece `PURCHASE_RECEIPT`, and updates weighted value once.
3. The receipt stores purchase price history, lot/expiry data when required, and a durable recalculation event.
4. A supplier invoice for KSh 2,500 produces a KSh 100 price variance and a review result.
5. On approval, configured accounts post: Dr Inventory KSh 2,500; Cr Accounts Payable KSh 2,500.
6. No cash or bank payment is fabricated.

### Customer Order to COGS

1. An invoice line identifies the menu item and configured modifiers.
2. The sale date selects the effective recipe version.
3. Ten portions at 250 g plus a configured 50 g modifier produce exactly 3.0 kg theoretical usage.
4. The existing POS transaction repository writes the idempotent `SALE_CONSUMPTION` movement once.
5. Under PERPETUAL accounting, configured accounts post Dr COGS and Cr Inventory for the movement value.
6. Under PERIODIC accounting, the movement remains in the subledger and movement-time COGS posting is intentionally suppressed.

### Production Batch

1. The configured batch expects 10 prepared portions from 2.5 kg of beef.
2. Completion writes `PRODUCTION_INPUT -2.5 kg` and `PRODUCTION_OUTPUT +9 portions` once.
3. Actual output is 9 against expected 10, so yield variance is -10% (`-1,000` basis points).
4. The retry returns duplicate and creates no second input or output movement.
5. Starting beef of 10 kg closes at 7.5 kg; prepared output closes at 9 portions.

### Physical Stock Count

1. Expected beef is 10.0 kg at KSh 582/kg.
2. Blind count records 8.5 kg.
3. Variance is -1.5 kg, valued at KSh 873.
4. Approval records the reason `Independent recount confirmed`.
5. Posting creates one `STOCK_COUNT_ADJUSTMENT -1.5 kg`; it does not rewrite movement history.

### Actual Versus Theoretical

The tested period has actual usage of 6.0 kg and theoretical usage of 4.5 kg. The +1.5 kg variance is worth KSh 873 at KSh 582/kg. A stored 1.5 kg wastage movement supports that driver, so explained usage is 1.5 kg and unexplained usage is zero. If the wastage evidence were absent, the same 1.5 kg would remain unexplained.

### Purchase Recommendation

The tested recommendation uses forecast demand of 20 units, safety stock of 5, target closing stock of 3, on-hand stock of 6, and confirmed incoming PO stock of 2:

```text
20 + 5 + 3 - 6 - 2 = 20 base units
```

With 24 base units per box, Seramet rounds up to one purchase box. A two-day lead time and requirement date of 2026-08-31 produce a recommended order date of 2026-08-29. The system recommends; it does not place an order.

### Auto-86 and Restock

1. The final ingredient portion is consumed.
2. Recalculation stores zero sellable portions and one pending unavailable transition.
3. The Pass 3 outbox receives `{ available: false, quantityAvailable: 0 }` once.
4. A two-unit purchase receipt restores stock.
5. Recalculation queues `{ available: true, quantityAvailable: 2 }` once.
6. Inventory code never calls a marketplace provider adapter directly.

## Food Cost and Profitability

The tested food-cost bridge moves from KSh 31,200 to KSh 36,300, an increase of KSh 5,100:

| Supported driver      |    Amount |
| --------------------- | --------: |
| Supplier price        | KSh 1,800 |
| Recorded wastage      |   KSh 900 |
| Yield variance        |   KSh 700 |
| Unexplained remainder | KSh 1,700 |

The unexplained KSh 1,700 is retained rather than assigned to a fabricated cause.

Menu profitability stores quantity sold, net revenue, theoretical recipe cost, contribution, food-cost percentage, classification, and data quality. For example, 20 portions with KSh 20,000 net revenue and KSh 6,000 theoretical cost produce KSh 14,000 contribution and 30% food cost. `STAR`, `PLOWHORSE`, `PUZZLE`, and `DOG` are determined relative to the period's sufficient-data popularity and contribution averages; missing recipes produce `INSUFFICIENT_DATA`, not a classification.

## Data Quality

The diagnostics identify missing menu recipes, recipe components without cost, invalid/missing item conversions, negative stock, stale/never-counted items, circular recipe attempts, and insufficient forecast history. Analytics quality is HIGH, MEDIUM, LOW, or INSUFFICIENT_DATA based on stored inputs. No precision or causal attribution is fabricated.

## Performance Measurements

Measured locally against the authoritative SQLite test equivalent:

| Fixture                                                                   | Measurement |
| ------------------------------------------------------------------------- | ----------: |
| Seed 10,000 movements, 1,000 items, 500 recipes, 100 suppliers, 1,000 POs |    343.0 ms |
| Aggregate summary                                                         |     14.0 ms |
| Paginated inventory query                                                 |      1.6 ms |
| Procurement aggregate/query                                               |     58.7 ms |

These are local test measurements, not production scale claims.

## Security Findings

- No new P0 finding was identified.
- Inventory and procurement mutations use server-authenticated tenant/branch identity and permission codes.
- Internal document numbers and operational business dates are server authoritative.
- Cross-tenant and unauthorized branch access are rejected and tested.
- Movement, posted count, supplier credit, and posted journal history has database immutability/idempotency protection.
- Negative stock overrides, manual adjustments, count approval, PO approval, over-receipt, and closed-period changes are permission/policy controlled and audited.
- Browser snapshots remain non-authoritative and cannot post inventory or finance directly.
- Imports remain behind the Pass 5 file validation and preview boundary.
- No provider secrets, card data, or new secret-handling paths were added.

## Remaining Limitations and Pilot Blockers

The following do not invalidate Pass 6, but must be configured or exercised before a real restaurant pilot:

- Load and reconcile opening stock, recipe versions, supplier pack conversions, PAR levels, and account mappings using restaurant-approved source data.
- Complete an observed physical stock take and verify weighted values against the general ledger.
- Configure approval thresholds, negative-stock policy, periodic/perpetual accounting, wastage reasons, and branch access.
- Validate supplier invoice tax treatment and three-way match tolerances with the restaurant accountant.
- Exercise backup/restore, printer/KDS routing, offline cash sync, marketplace availability, and full EOD in staging using pilot devices.
- Forecasts remain low quality until sufficient sales/consumption history exists.
- FIFO, scanner-specific barcode integration, autonomous purchasing, live supplier ordering, and supplier payment are not implemented.
- Recipe/import preview is supported through the secured import boundary; production master-data mapping still requires tenant review before apply.

There is no remaining code-level P0 blocker identified for a controlled pilot. Operational configuration, data migration, accounting sign-off, and staged restaurant acceptance remain required.

## File Inventory

Created:

- `migrations/0007_inventory_procurement_intelligence.sql`
- `src/inventory/forecasting.ts`
- `src/inventory/inventory-intelligence-service.ts`
- `src/inventory/pass-6-inventory-intelligence.test.ts`
- `src/inventory/pass-6-load.test.ts`
- `src/inventory/quantity.ts`
- `src/inventory/schemas.ts`
- `src/inventory/types.ts`
- `src/inventory/use-inventory-control-centre.ts`
- `src/inventory/valuation.ts`
- `src/server/inventory-api.ts`
- Eight Pass 6 architecture and operating documents plus this report.

Modified:

- `docs/HARDCODE_AUDIT.md`
- `package.json`
- `src/lib/seramet-api.ts`
- `src/platform/permissions.ts`
- `src/routes/cost-control.tsx`
- `src/routes/inventory.tsx`
- `src/routes/procurement.tsx`
- `src/server/database/authoritative-transaction-repository.ts`
- `src/server/database/sqlite-test-adapter.ts`
- `src/server/pass-5-production-foundation.test.ts`
- `src/server/workers.ts`
