# Inventory Accounting Rules

All account IDs come from `inventory_account_mappings`, with an optional branch override and tenant default. No journal rule compares account or payment display names.

## Accounting mode

- `PERPETUAL`: eligible inventory movements post inventory/COGS/loss journals as they occur.
- `PERIODIC`: operational movements update the inventory subledger but do not post perpetual COGS journals. Period-close policy posts the periodic adjustment separately.

The two modes are mutually exclusive for a mapping.

## Perpetual movement postings

| Event                       | Debit                | Credit                 |
| --------------------------- | -------------------- | ---------------------- |
| Opening inventory           | Inventory            | Opening balance/equity |
| Sale consumption            | COGS                 | Inventory              |
| Wastage, breakage or expiry | Wastage/loss expense | Inventory              |
| Count/manual adjustment in  | Inventory            | Inventory variance     |
| Count/manual adjustment out | Inventory variance   | Inventory              |

Values use the movement's weighted-average cost. Production input/output and internal transfer pairs do not independently recognize COGS; they move value through the inventory subledger and avoid double counting.

## Supplier invoice

```text
Dr Inventory                         subtotal
Dr Configured recoverable tax       tax, when applicable
Cr Accounts payable                 total
```

Invoice approval does not create a bank/cash payment. Payment remains in the Pass 4 payment/payables workflow.

## Supplier return credit

```text
Dr Accounts payable                 returned inventory value
Cr Inventory                        returned inventory value
```

The physical return movement is recorded first. The financial credit waits until the credit note is confirmed. Both stages are idempotent and auditable.

## Wastage and variance

Wastage uses the configured wastage account. Count/manual adjustments use the configured variance account. Process loss expected by a recipe belongs in recipe/yield configuration; it is not automatically posted as unexpected wastage.

## Journal invariants

- Total debit equals total credit.
- Money is integer minor units.
- Journal source links to the authoritative movement, invoice or supplier return.
- Tenant and branch are retained.
- Posted journals are immutable under Pass 5 database triggers.
- Corrections use reversal or adjustment, never destructive edit.

## Inventory-to-GL reconciliation

For perpetual tenants, Seramet compares subledger value with the configured inventory-account balance. A mismatch is reported and routed for investigation. It is not forced to match.
