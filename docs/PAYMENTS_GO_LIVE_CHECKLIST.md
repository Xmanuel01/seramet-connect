# Payments Go-Live Checklist

## Platform controls

- [ ] Replace development snapshot/local-storage repositories with an authoritative ACID database implementation.
- [ ] Run durable integration, outbox and settlement workers with monitoring and dead-letter alerts.
- [ ] Set `SERAMET_REQUIRE_BEARER=true`; disable development header authentication at the edge.
- [ ] Configure production identity/JWT validation, tenant claims, branch claims and permission claims.
- [ ] Configure TLS, WAF/rate limits, request-size limits and provider network controls where supported.
- [ ] Store all provider credentials in a managed secret store and rotate them before production.
- [ ] Configure immutable audit retention, database backup, restore drills and period-close retention.
- [ ] Verify business-date cutoffs, currency minor units and every tenant account mapping.

## Daraja

- [ ] Obtain approved production app, consumer key/secret, shortcode and passkey.
- [ ] Confirm Till/Paybill ownership and branch/payment-account mappings.
- [ ] Register public TLS callbacks and enforce gateway callback authentication controls.
- [ ] Complete sandbox and production STK request/query/callback certification.
- [ ] Validate C2B callback registration and reference uniqueness with Safaricom.
- [ ] Confirm dynamic QR approval if enabled.
- [ ] Leave reversal, refund, balance, B2C and B2B disabled unless separately contracted and certified.

## Pesapal

- [ ] Obtain API 3.0 production consumer credentials and merchant approval.
- [ ] Register and verify production IPN URL and callback URL.
- [ ] Prove IPN-to-GetTransactionStatus confirmation and duplicate delivery behavior.
- [ ] Certify refund request and final refund-state polling/callback handling.
- [ ] Confirm settlement statement/feed access and account mappings before enabling automatic bank posting.

## TendePay

- [ ] Obtain official versioned merchant API documentation and credentials directly from TendePay.
- [ ] Implement and contract-test only documented operations in the existing adapter boundary.
- [ ] Keep every live operation `SPEC_REQUIRED` until those tests and provider certification pass.

## Cash, terminal and bank

- [ ] Assign drawer devices/employees and approval thresholds per branch.
- [ ] Train opening, paid-in/out, petty-cash, safe-drop, refund and close procedures.
- [ ] Configure card terminal/acquirer clearing accounts and batch references.
- [ ] Confirm PCI scope with the acquirer; do not enter or upload PAN, CVV, PIN or track data.
- [ ] Validate every bank CSV/XLSX adapter with representative statements before posting.
- [ ] Set manual-match, refund, variance and EOD override permissions using permission records, not roles.

## Reconciliation and accounting

- [ ] Validate cash, digital clearing, marketplace, refund, customer credit and gift-card journals with the accountant.
- [ ] Import a complete marketplace settlement and prove every gross order and deduction line is traceable.
- [ ] Verify short/over settlements remain exceptions and posted batches require reversal for correction.
- [ ] Complete clean, variance, outage, unmatched-payment and pending-refund EOD drills.
- [ ] Prove tenant and branch isolation with production authorization integration tests.

## Release evidence

- [ ] Full automated suite, TypeScript, lint and production build pass on the release commit.
- [ ] Desktop, tablet and mobile QA covers POS payment, split payment, drawers, refunds, settlement, reconciliation and EOD.
- [ ] No console errors, sensitive logs, page overflow or test-provider production connections exist.
- [ ] Operations team has provider outage, duplicate callback, settlement shortfall and rollback runbooks.
