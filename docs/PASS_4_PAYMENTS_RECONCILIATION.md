# Pass 4 Payment Orchestration, Settlements and Reconciliation

Completed on 30 August 2026. Pass 4 extends the existing transaction engine and Pass 2 integration runtime. It does not introduce a parallel order, invoice or accounting store.

## Architecture

The flow is:

`sale/invoice -> PaymentIntent -> provider or cash action -> immutable PaymentTransaction -> PaymentAllocation -> PaymentCollection -> receipt -> reconciliation -> bank/cash state`

Sales, payment requests, confirmed collections, receivables, settlements, bank receipts, fees, refunds, cash movements and journals are separate records. An invoice is paid from the total of confirmed allocations, not from an invoice-level payment identifier. Every record is tenant scoped and branch scoped where applicable.

Money is represented in integer minor units. Currency decimal rules and parsing are centralized in `src/payments/money.ts`. Cross-currency allocation is rejected because foreign exchange is outside this pass.

## Payment lifecycle

`PaymentOrchestrator` owns intent creation, provider initiation state, verified confirmation, allocation, receipt eligibility, cash collection, external-terminal records, manual references, refunds, reversals, gift cards and customer accounts. Routes call this orchestrator or the integration runtime; they do not call provider adapters directly.

Payment transaction records are frozen and append-only. Refund and reversal transactions point to the original transaction. Overpayments retain `unallocatedAmountMinor`; underpayments leave the invoice `PARTIAL`.

Payment-method records provide category, connection and account mappings. Business logic uses identifiers and capabilities rather than provider display names.

## Cash

A cashier opens a branch drawer with a float. Cash tendered and change are stored, but the drawer sale movement equals the invoice amount. Explicit movements cover sale, refund, paid-in, paid-out, cash drop, petty cash, correction and closing. Expected cash is derived from movements and cannot be directly edited. Closing records counted cash and variance; non-zero variance requires review and may be manager approved with a reason.

Cash remains local-provider independent. Digital API methods never simulate confirmation while offline.

## Digital providers

All provider callbacks enter the Pass 2 raw-body webhook gateway. The connection resolves tenant, provider and server credentials. Adapter verification, durable idempotency, event storage and correlation happen before a normalized payment event reaches `PaymentOrchestrator`. A paid receipt is generated only after a verified confirmed transaction.

### Daraja

The adapter implements the current official OAuth client-credential operation, M-Pesa Express request, M-Pesa Express status query, dynamic QR request, STK callback normalization and C2B collection callback normalization. Credentials, shortcode, passkey and callback secret resolve server side. Refund, reversal, balance, B2C and B2B are not declared because this implementation does not have a configured and certified official contract for those operations.

Manual Till/Paybill references start `UNVERIFIED`. The connection and external reference pair is unique across branches. A cashier-entered reference alone cannot create a paid receipt.

### Pesapal

The adapter uses API 3.0 only: authentication, IPN registration, order submission, transaction-status resolution and refund request. Browser redirects and IPN parameters are not treated as payment proof; the runtime calls `GetTransactionStatus` before confirmation. A successful refund request remains processing until authoritative confirmation.

### TendePay

TendePay has configuration metadata, secret references, health boundaries, normalized DTO boundaries and settlement/webhook interfaces. No official public merchant API contract was available in the repository or implementation environment. Every live network operation returns `SPEC_REQUIRED` and creates no transaction.

### Test provider

The generic test provider is explicitly non-production. It simulates success, failure, delayed confirmation, duplicate callbacks, refund processing, settlement, fees, rate limits and timeouts for automated tests.

## Bank, matching and reconciliation

Bank statements enter through a `BankStatementAdapter`; the generic adapter supports CSV and XLSX preview and normalized import. Imports are idempotent by tenant, account and external transaction ID. Provider-specific parsing remains outside the reconciliation core.

`ReconciliationEngine` ranks exact external references, merchant references, amount, date/account and timing. Only one unambiguous EXACT or HIGH candidate is automatically approved. Ambiguous candidates remain suggested; no candidate creates an exception. Manual matches require an actor, reason and audit/fraud flag.

A fully matched digital collection posts `Dr configured Bank / Cr configured clearing account` and moves to `IN_BANK`. This is separate from customer payment confirmation. Thus a successful provider collection does not imply that bank settlement has occurred.

## Marketplace settlements

Pass 3 marketplace sales remain gross revenue with a marketplace receivable. Normalized settlement batches retain one line per order, commission, service fee, promotion, refund, tax adjustment or other adjustment. Gross lines link to the external order and Seramet receivable.

A matched settlement posts configured accounts, for example:

- Dr Bank: net receipt
- Dr Commission, promotion and adjustment expenses: deductions
- Cr Marketplace Receivable: gross orders

A short or over settlement creates a variance exception and cannot be posted as matched. Posted batches are locked; correction requires a reversal journal and a new event.

## Credit and stored value

House-account invoices create a customer receivable and customer-account ledger entry without creating a payment. Credit limits and payment terms are enforced, and dated statements calculate opening balance, invoices, payments, credits/adjustments and closing balance.

Gift-card or voucher issue posts the collection account against a liability, not food revenue. Redemption releases that liability against the invoice receivable. Loyalty remains a separate stored-value category and uses configured accounting mappings.

## Refunds and disputes

Refunds move through REQUESTED, APPROVED, PROCESSING and CONFIRMED/FAILED/REJECTED. Provider request acceptance is not final customer receipt. Cash refunds require an open drawer and create a refund movement. Reversals append a linked transaction and reversal journal; originals are never deleted. The domain includes a tenant-scoped dispute foundation for chargebacks.

## EOD

The Payment Control Centre provides payments, unmatched records, settlements, drawers, bank imports, refunds, reconciliation and EOD in one operations page. Day close uses the configured business-date cutoff, includes unresolved critical exceptions and pending refunds, and requires explicit override permission plus a reason when issues remain.

Reports distinguish order channel sales from payment-method collections. Marketplace names are order channels; cash and configured wallet/card methods are payment methods.

## Security

- Provider credentials resolve from server secret references and are redacted from logs.
- Raw webhook bytes are verified before parsing and pass through durable idempotency.
- Full PAN, CVV, PIN and track data are rejected; only a masked PAN ending in four digits may be stored.
- Tenant checks protect collect, match, refund, reconciliation and close operations.
- Production must require bearer authentication and replace local snapshot repositories before certification. See `PASS_4_SECURITY_FINDINGS.md`.

## Tests and limitations

Automated coverage includes cash, split/partial/over payment, immutable reversals, duplicate references, gifts, customer credit, balanced journals, bank imports, matching, settlement variances, EOD controls, tenant isolation, card-data rejection and official provider fixture shapes.

No live credentials, merchant approvals, Safaricom production shortcode certification, Pesapal production merchant approval or TendePay merchant API specification are bundled. Local state adapters remain development fallbacks; production requires an authoritative transactional database and durable workers.
