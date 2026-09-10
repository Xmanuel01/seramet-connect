# Pass 4 Security Findings

Reviewed 30 August 2026 for the TypeScript/React payment, integration and repository changes.

## Findings

### P0: development-header authentication must be disabled in production

`src/lib/seramet-auth.ts:60-79` permits a development header identity unless `SERAMET_REQUIRE_BEARER=true`. A production deployment without that environment setting could allow caller-supplied tenant, user and branch headers. Make bearer verification mandatory at deployment and reject all development authentication at the external gateway. This blocks live payment certification.

### P0: local snapshot persistence is not an authoritative financial ledger

`src/lib/transaction-engine.ts:1373-1392` and `src/platform/repositories/configuration-repository.ts:379-441` retain browser/local development fallbacks. Local storage is user controlled, lacks transactional row locking and cannot provide production-grade concurrency, durability or tamper resistance. Deploy the existing repository contracts on an ACID database with tenant predicates, unique provider-reference constraints and transactional journal/allocation updates. This blocks live payment certification.

### P1: Daraja callback origin controls require merchant gateway configuration

`src/integrations/payments/daraja/adapter.ts:354-359` requires the configured Seramet callback secret because the callback payload alone is not treated as sufficient proof. Production must use an unguessable callback URL/secret, TLS, edge rate limits and Safaricom network controls where available, and must retain authoritative status-query/idempotency checks. Do not expose a callback without those controls.

### P1: production provider certification and scopes are external blockers

The Daraja and Pesapal adapters are live-spec code, but no production credentials, merchant scopes, shortcodes, passkeys, IPN registrations or provider certification are bundled. Connections must remain unconfigured until health checks and end-to-end sandbox/production certification pass. TendePay must remain `SPEC_REQUIRED` until official merchant API documentation is supplied.

## Positive controls verified

- Provider secrets use server-side `secretReference` resolution and structured-log redaction.
- Webhooks use exact raw body bytes, adapter-owned verification, durable idempotency and tenant/connection validation.
- External transaction references are unique within a provider connection across branches.
- Full PAN, CVV, PIN, track data and unmasked PAN values are rejected.
- Money uses integer minor units and cross-currency allocation is rejected.
- Financial journals enforce balanced debit and credit totals.
- Refunds, reversals, manual matches and cash variances retain actor/audit records rather than deleting history.

## Residual risk

File imports should be malware scanned and size limited by the production edge even though malformed lines are previewed and rejected before posting. Production observability should alert on authentication failure, webhook signature failure, repeated references, manual reconciliation, large drawer variance, refund approval and settlement variance without recording provider secrets or card data.
