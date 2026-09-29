# Previous POS Sales Migration

## Purpose

This optional onboarding step transfers historical sales totals from a restaurant's previous POS into Seramet once. It is an archival data migration, not a replay of restaurant operations.

## Workflow

1. Download the canonical template from Menu Import.
2. Export or reshape the old POS data as CSV or Excel `.xlsx`.
3. Enter the previous POS name.
4. Upload and review the server-generated preview.
5. Correct every error and review all warnings.
6. Explicitly commit the migration once, or select `Skip for now`.

## Safety Rules

- File type, signature, size, workbook structure, row count, and cell size are bounded server-side.
- Branch codes resolve to authoritative branch IDs and remain permission scoped.
- Currency must match the tenant base currency.
- Net sales must equal gross sales less discounts and refunds.
- A branch/date already containing Seramet orders or invoices is rejected to prevent double counting.
- External references are unique per tenant, branch, and source system.
- One committed migration is allowed per tenant and enforced by a database unique index.
- Historical records are append-only and tenant scoped.
- Browser values are never authoritative.

## Deliberate Non-Effects

Committing historical sales does not create current orders, invoices, receipts, payments, journal entries, KDS/KOT work, inventory consumption, loyalty events, or customer records. Those source facts cannot be reconstructed safely from a sales summary.

Historical rows contribute to daily sales aggregates on their original business dates. Analytics attach `HISTORICAL_SALES_WITHOUT_OPERATIONAL_DETAIL`, so missing COGS, item mix, payment, and kitchen evidence is not presented as known data.

## Template Columns

| Column                   | Required | Meaning                                                             |
| ------------------------ | -------- | ------------------------------------------------------------------- |
| `templateVersion`        | No       | Current version is `1`; omitted files are treated as version 1.     |
| `externalSaleReference`  | Yes      | Unique receipt, order, or daily-summary reference from the old POS. |
| `branchCode`             | Yes      | Existing Seramet branch code.                                       |
| `businessDate`           | Yes      | Restaurant business date in `YYYY-MM-DD`.                           |
| `occurredAt`             | No       | ISO timestamp with timezone.                                        |
| `currency`               | Yes      | Tenant base ISO currency.                                           |
| `grossAmount`            | Yes      | Gross sales in major currency units.                                |
| `discountAmount`         | No       | Discounts, default zero.                                            |
| `refundAmount`           | No       | Refunds, default zero.                                              |
| `taxAmount`              | No       | Reported tax component, default zero.                               |
| `serviceChargeAmount`    | No       | Reported service charge component, default zero.                    |
| `netAmount`              | No       | Gross less discounts and refunds; derived when omitted.             |
| `orderCount`             | No       | Number of orders represented, default one.                          |
| `channelCode`            | No       | Source channel label from the old system.                           |
| `paymentMethodReference` | No       | Source payment-method label for historical reference only.          |
| `notes`                  | No       | Bounded migration note.                                             |
