# Production Provider Certification

An adapter interface, fixture or `SPEC_REQUIRED` operation is not a certified live integration.

For each enabled payment, delivery, notification or AI provider record:

1. Capture official API version, approved scopes, environment, merchant/outlet mapping and support
   contact.
2. Store credentials in managed server secrets and test rotation without changing business code.
3. Verify signatures/raw-body handling, callback URL, event idempotency, status query, timeout,
   retry, rate limit and dead-letter recovery.
4. For payments, verify amount/currency, duplicate reference, delayed callback, refund/reversal,
   settlement and reconciliation. A redirect or cashier click never confirms money.
5. For delivery, verify menu/availability/order capabilities only where official scopes support them.
6. For notifications, verify consent category, template variables, delivery status and suppression.
7. Record sandbox evidence, provider approval, production penny test and rollback/disable procedure.

Daraja, Pesapal and marketplace production credentials/whitelisting remain environment-specific.
TendePay undocumented operations remain `SPEC_REQUIRED` until official merchant specifications are
provided. Test providers are rejected by production readiness.
