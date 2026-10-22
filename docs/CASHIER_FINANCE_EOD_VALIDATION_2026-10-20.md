# Cashier, Finance and EOD validation

Date: 20 October 2026, Africa/Nairobi.

## Decision

**NOT READY for complete cashier-to-accounting certification.**

Cash collection and closing controls passed focused local tests, but a real disposable
POS invoice demonstrates a missing sales-to-general-ledger posting. Passing isolated
closing tests does not establish complete accounting integration.

The inspected checkout is `codex/pilot-staff-integration`, including the uncommitted
invoice/receipt preview and recipient-dialog changes. No staging or production database
was accessed, no credentials changed, and nothing was merged or deployed.

## Confirmed blocker

The paid invoice produced by the local printer acceptance workflow has:

| Evidence                              | Actual result                              |
| ------------------------------------- | ------------------------------------------ |
| Invoice total                         | KES 614.05 / 61,405 minor units            |
| Confirmed paid amount                 | KES 614.05 / 61,405 minor units            |
| Canonical journal sources             | One `PAYMENT_COLLECTION`                   |
| Required invoice-linked sales journal | Missing                                    |
| Finance quality                       | `INCOMPLETE`                               |
| Finance issue                         | `SETTLED_SALES_NOT_IN_GL`                  |
| Income reported for this branch/date  | 0 minor units                              |
| Trial balance                         | Equal debits/credits of 61,405 minor units |

The payment orchestrator posts the collection journal. Finance independently requires
a posted `POS_INVOICE` journal linked to each settled invoice. Repository-wide source
inspection finds the `POS_INVOICE` contract in the Finance completeness check, but no
corresponding producer. Collection-to-receivable posting is not revenue recognition.
Changing the reporting check to accept a collection journal would conceal the gap.

Relevant implementation:

- `src/payments/payment-orchestrator.ts`: collection journal creation.
- `src/server/database/authoritative-transaction-repository.ts`: immutable canonical journal persistence.
- `src/finance/financial-ledger-service.ts`: invoice-linked posting completeness checks.

The probe used only `.seramet/development.sqlite`, constrained to a generated
`e2e-<uuid>` tenant with the disposable trading name. SQLite `query_only` was enabled
before inspection. No financial records were created or repaired by the probe.

## Separate configuration finding

The same disposable fixture reports `CASH_ACCOUNT_CLASSIFICATION_MISSING`. Its cash
account is not explicitly classified for cash-flow reporting. This demonstrates a
configuration prerequisite, not proof that the live restaurant has the same omission.
Live chart-of-accounts, bank/cash classification and payment mappings remain unverified.

## Targeted results

| Area                                                         | Result     | Scope                                                    |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------- |
| Payment, settlement, cash count and invoice components       | PASS       | Disposable unit/service tests                            |
| Refunds, payouts, drops, bank and marketplace reconciliation | PASS       | Simulated providers and records                          |
| Single-cashier supervisor closing                            | PASS       | Unit/repository and browser checks                       |
| Multi-cashier consolidation without recounting               | PASS       | Unit tests                                               |
| Variance explanations and approval permissions               | PASS       | Unit tests                                               |
| Idempotency, concurrent close and rollback                   | PASS       | Disposable SQLite repository tests                       |
| Business dates, cutoff and overnight sessions                | PASS       | Unit tests                                               |
| Immutable PDF figures and report authorization               | PASS       | Unit/API tests; browser PDF download                     |
| Missing accounting setup and invalid-filter recovery         | PASS       | Desktop/mobile browser checks                            |
| Complete paid invoice to canonical sales accounting          | FAIL       | Actual disposable paid invoice + Finance service         |
| Live M-Pesa, bank and marketplace integration                | UNVERIFIED | No external requests made                                |
| Live closing email delivery                                  | UNVERIFIED | Durable/provider fixture tests only                      |
| PostgreSQL 16 runtime certification                          | NOT RUN    | This focused local check is not PostgreSQL certification |

Totals: **104 tests passed across 11 files, zero skipped; 2 browser scenarios passed.**
The browser EOD scenario closes a drawer with opening float and no sales. It verifies
confirmation, cancellation, drawer finalization, snapshot download and responsive layout;
it does not certify a populated multi-method shift. The earlier printer scenario supplied
the actual paid invoice inspected here.

Evidence retained locally (ignored disposable artifacts):

- `.seramet/cashier-finance-validation.log`
- `.seramet/cashier-finance-browser.log`
- `.seramet/cashier-finance-probe.ts`
- `.seramet/cashier-finance-probe.json`
- `.seramet/accounting-photo-fixes/`
- `.seramet/daily-closing/`

## Minimum next correction

1. Establish the existing authoritative invoice-recognition event and explicit account
   mappings for receivable, revenue, tax, discounts and service charges. Do not guess
   account IDs or invent historical invoice components.
2. Persist the invoice-linked sales journal atomically and idempotently with the
   authoritative invoice lifecycle. Cash collection must remain a separate collection
   event; partial payments must not duplicate revenue recognition.
3. Preserve invoice reversal/void behavior, branch business dates, tenant isolation and
   closed-period restrictions. Historical backfill requires a separately reviewed process,
   not automatic replay or edits to immutable journals.
4. Add one connected regression: create invoice, collect cash and verified digital
   payments, verify Finance/GL and sales agree, then close the populated business day.
   Also prove replay, partial payment, refund, variance and rejected close do not duplicate
   sales postings or cash movements.

Until that correction and populated-shift acceptance pass, do not present the financial
workflow as fully reconciled or production-certified. Cashiers should retain only their
authorized collection/drawer operations; supervisor/finance approval permissions must not
be broadened to make EOD pass.
