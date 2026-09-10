# Food-Cost Methodology

Seramet separates recipe/theoretical cost, movement/actual consumption, recorded loss and unexplained variance. It never assigns an unsupported cause.

## Cost definitions

### Recipe cost

Recipe cost is the sum of normalized component quantities multiplied by their selected inventory cost, plus configured packaging and direct production overhead. Component UOM conversion and sub-recipe yield are applied before costing.

### Theoretical cost

Theoretical cost uses actual sold menu mix and the recipe version effective on each sale date:

```text
theoretical ingredient usage
  = sold quantity x effective recipe component quantity / recipe yield

theoretical cost
  = theoretical ingredient usage x applicable inventory cost
```

Configured modifier recipes add their own theoretical ingredients. A sale with no valid recipe is reported as a data-quality gap.

### Actual consumption

For a period, actual physical consumption is explained from inventory evidence:

```text
opening stock
+ accepted purchases
+ transfers in
+ production output
+ adjustments in
- closing/count stock
- transfers out
- production inputs
- recorded wastage/breakage/expiry
- returns/adjustments out
= physical consumption basis
```

The normalized read model uses append-only movements and posted count adjustments; it does not rewrite opening or closing balances.

### Actual food cost

Periodic actual food cost follows the tenant's configured accounting definition. The default analytical denominator is net food sales excluding tax and separately tracked service charge. Discounts and refunds follow the invoice/accounting values already recorded; payment-provider fees are not food cost.

### Cost per portion

```text
theoretical portion cost = recipe batch cost / expected yield
actual production portion cost = actual input cost / actual output yield
```

Both values are retained. A yield shortfall therefore increases actual production cost per portion without changing the historical recipe definition.

## Actual versus theoretical variance

```text
quantity variance = actual usage - theoretical usage
value variance = quantity variance x weighted-average unit cost
```

A positive usage variance means more stock was consumed than the recipe/sales evidence supports. A negative variance means less was consumed. The sign is displayed, not converted into an accusation.

## Evidence-backed drivers

Supported drivers may include:

- recorded wastage, breakage or expiry;
- purchase price variance from PO versus receipt;
- production yield variance from completed batches;
- receiving shortage from accepted versus expected quantity;
- transfer shortage from sent versus received quantity;
- menu mix based on actual sold mix and recipe cost.

The food-cost bridge is additive:

```text
current cost change
- sum(stored supported drivers)
= unexplained remainder
```

No balancing plug is assigned to a named operational cause. Unsupported remainder is stored and shown as `UNEXPLAINED`.

## Purchase price impact

Price impact uses actual normalized purchase price history and the affected quantity. It is not inferred from supplier names or current display prices. A change can be translated into cost amount and, when a supported sales denominator exists, percentage-point impact.

## Menu profitability

For each menu item the worker stores quantity sold, net revenue, theoretical cost, contribution margin, food-cost basis points and popularity. `STAR`, `PLOWHORSE`, `PUZZLE` and `DOG` classifications are produced only when sufficient comparable data exists; otherwise quality is `INSUFFICIENT_DATA`.

## Quality states

- `HIGH`: complete sale/recipe/cost evidence with a sufficient sample.
- `MEDIUM`: usable evidence with limited gaps/sample.
- `LOW`: material gaps or legacy compatibility fallback.
- `INSUFFICIENT_DATA`: a defensible calculation cannot be made.

Examples of quality deductions include no recipe, no component cost, invalid conversion, no stock count and insufficient forecast history. The UI displays quality alongside the result.

## No AI claim

Food-cost analysis and demand forecasts are deterministic arithmetic/statistics. They are not described as AI or machine learning.
