# Forecast and PAR Methods

## Supported deterministic methods

The domain supports:

- `MOVING_AVERAGE`
- `WEIGHTED_MOVING_AVERAGE`
- `SAME_WEEKDAY_AVERAGE`

These are transparent deterministic statistics. The durable worker currently uses a 28-day weighted moving average of daily `SALE_CONSUMPTION` and `PRODUCTION_INPUT` quantities. Recent observations receive larger integer weights.

## Formula

```text
weighted forecast = sum(sample quantity x sample weight) / sum(sample weight)
```

All samples are integer micro-units. Multiplication and division use `BigInt` and centralized integer rounding. The same stored input always produces the same output.

## Quality

- 28 or more samples: `HIGH`
- 14-27 samples: `MEDIUM`
- 4-13 samples: `LOW`
- fewer than 4 samples: `INSUFFICIENT_DATA`

The forecast stores method, lookback, result, quality, sample count and serialized inputs.

## PAR configuration

PAR policy is configured per tenant, branch, warehouse and item. It may contain minimum, reorder point, target quantity, maximum, safety stock, negative-stock policy and recommendation mode. A day-of-week override may supplement the default policy.

Recommendation modes are:

- `MANUAL`
- `RECOMMEND`
- `AUTO_REQUISITION`

Pass 6 defaults to recommendation. It does not autonomously place an order or pay a supplier.

## Purchase recommendation

```text
recommended base quantity
  = forecast consumption over supplier lead time
  + safety stock
  + target closing stock
  - quantity on hand
  - confirmed incoming PO quantity
```

Negative results become zero. The base quantity is converted to the configured purchase unit using the effective item-specific rational conversion, then rounded up to a complete purchase unit.

The recommended order date is the requirement date minus configured supplier lead time. The stored explanation contains every input so a manager can reproduce the result.

## Production prep recommendation

```text
recommended prep
  = forecast required
  + configured safety buffer
  - prepared quantity available
```

Prep remains a recommendation until an authorized user starts/completes a production batch.

## Exclusions

- No random output.
- No opaque model score.
- No autonomous supplier order.
- No reservation/event quantity is included unless that module provides confirmed, configured demand.
