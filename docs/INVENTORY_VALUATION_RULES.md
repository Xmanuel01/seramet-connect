# Inventory Valuation Rules

## Numeric representation

- Quantity: integer micro-units, where one base unit equals `1,000,000`.
- Money: integer currency minor units.
- Conversion: rational `factorNumerator / factorDenominator`.
- Intermediate multiplication and division: `BigInt`, followed by one centralized half-up integer rounding step.

Binary floating-point values are not stored in the inventory ledger or used for valuation.

## Source of truth

`inventory_movements` is the quantity and cost ledger. `inventory_balances` is a transactionally maintained read model. A route cannot edit balance history. Corrections append a new movement with an actor, reason, source and idempotency key.

## Weighted average

`WEIGHTED_AVERAGE` is implemented.

For an inbound quantity:

```text
new value = current value + receipt value
new quantity = current quantity + receipt quantity
new average unit cost = new value / new quantity
```

Example in minor units:

```text
10 kg at KSh 550 = KSh 5,500
10 kg at KSh 600 = KSh 6,000
20 kg value       = KSh 11,500
average           = KSh 575/kg
```

Outbound movements use the current weighted-average unit cost. They reduce quantity and value by the same calculated amount. Intermediate values are not rounded repeatedly.

## Purchase-unit conversion

A receipt first converts the accepted purchase quantity into the item's base unit using the conversion effective at receipt time. The normalized base-unit quantity and normalized price are written to receipt lines and supplier price history.

Examples such as boxes-to-bottles or jerricans-to-litres require item-specific conversions. Global dimensional conversion is allowed only within the same dimension, such as kilograms to grams.

## Lots and expiry

Items configured for expiry tracking may create lot rows at receiving. Lot quantity is reduced with linked movements. Expiry data supports FEFO recommendations and alerts, but weighted-average financial valuation remains independent of physical picking order.

## Negative stock

- `BLOCK`: the database rejects an outbound movement that exceeds available stock.
- `ALLOW_WITH_ALERT`: the movement is accepted and the quality/action system records the condition.
- `MANAGER_OVERRIDE`: requires the configured permission/policy and an audited override reason.

## FIFO boundary

`FIFO` exists in `InventoryValuationMethod` so a real cost-layer implementation can be added without changing feature screens. Selecting it currently throws a clear not-implemented error. Seramet does not label FIFO as implemented.

## Subledger reconciliation

For perpetual accounting, the inventory GL reconciliation compares:

```text
sum(inventory_balances.total_value_minor)
vs
posted journal balance for the configured inventory account
```

A difference is reported as a variance. It is not silently forced to zero.
