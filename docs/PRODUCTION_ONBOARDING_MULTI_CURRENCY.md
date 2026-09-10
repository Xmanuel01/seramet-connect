# Production Onboarding And Multi-Currency

## Authoritative model

The tenant has exactly one base accounting currency. Invoices, allocations and journals remain in
that currency. A secondary currency represents accepted tender, not a second accounting ledger.

`country_reference` and `currency_reference` supply named reference data. Tenant choices are
stored in `tenant_business_locations` and `tenant_accepted_currencies`. Scope, tender eligibility,
rate policy, freshness, rounding and change policy are data, not payment-display-name checks.

The base currency is mutable only before financial activity. Database triggers enforce that rule
for both the tenant and legal entity when invoices, payments, journals, inventory openings or other
authoritative financial records exist.

## Exchange rates

Rates are append-only rows in `fx_rates` and belong to an `fx_rate_sources` record. The source
boundary supports manual, provider, headquarters and legal-entity policies. This implementation
provides an authorized manual-rate workflow; it does not claim a live external FX provider.

Rates are stored as positive integer numerator/denominator pairs. Conversion uses integer `BigInt`
arithmetic and currency-specific minor digits. Binary floating point is not used for payment
conversion. Manual decimal entry is converted into an exact rational pair before it reaches the
server.

## Payment flow

1. POS prepares an authoritative invoice in the tenant base currency.
2. Cashier selects an eligible secondary cash currency.
3. The server validates tenant, branch, invoice, payment method, accepted-currency scope and a
   currently effective rate.
4. The server creates a five-minute `fx_payment_quotes` row containing base amount, tender amount,
   exact rate, source and timestamps.
5. Payment confirmation ignores client rate calculations and reconstructs currency evidence from
   the server quote.
6. One database transaction creates the payment/allocation/journal state, inserts the immutable
   `payment_currency_snapshots` row and consumes the quote.
7. The receipt carries the base allocation, original tender, rate reference and rate ratio.

A quote is single-use. Expired, consumed, cross-tenant, cross-branch, wrong-invoice, wrong-method or
amount-mismatched quotes are rejected. A quote cannot be silently replaced after payment.

## Cash and change

Cash drawers retain one independent balance per currency. Values from different currencies are
never added together. For `TENDER_CURRENCY` change, the drawer movement is the net tender retained.
For `BASE_CURRENCY` change, the tender receipt and base-currency paid-out movement remain separate.
`NO_CHANGE` requires exact tender.

Drawer close accepts a physical count for each currency and calculates each variance independently.
The Payment Control Centre displays those independent expected, counted and variance values.

Refunds preserve the original payment rate evidence and prorate the tender amount using exact
integer arithmetic. The current implemented foreign-tender path is cash. A non-cash secondary
currency is rejected until its configured provider adapter has a documented, implemented currency
capability; no simulated digital settlement is created.

## Reporting and audit

Payment transactions and receipt breakdowns retain both base and tender facts. Financial journals
remain balanced in base currency. Physical cash reporting is currency-separated. Manual rates,
quotes, onboarding decisions and base-currency changes are audited without storing credentials or
provider secrets.

## Validation coverage

The database-backed suite covers country-specific suggestions, server-saved wizard progress, base
currency locking, exact KES/USD conversion, immutable quote consumption, stale-rate rejection,
tampered amount rejection, cross-tenant rejection, split base/foreign settlement, cash change,
refunds at the original rate, per-currency drawer variance, balanced journals and PostgreSQL
migration compatibility.
