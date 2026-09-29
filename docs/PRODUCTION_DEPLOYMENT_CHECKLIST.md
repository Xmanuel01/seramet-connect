# Production Deployment Checklist

## Environment

- [ ] `SERAMET_ENVIRONMENT=production` (or `staging` for staging).
- [ ] Authoritative `SERAMET_DB` binding exists and schema version is 6.
- [ ] Durable `SERAMET_WORK_QUEUE` binding and scheduler are active.
- [ ] `SERAMET_ENABLE_DEV_AUTH` and `SERAMET_ALLOW_TEST_PROVIDERS` are absent/false.
- [ ] Strong JWT secret, issuer and audience are configured server-side.
- [ ] HTTPS callback base URL is trusted and not browser supplied.
- [ ] Environment or managed `SecretStore` is configured.
- [ ] Application version and immutable build ID are set.

## Identity and tenant safety

- [ ] Production identity provider issues the required claims.
- [ ] Session revoke, expiry and credential invalidation are tested.
- [ ] POS/KDS/printer devices are registered and activated.
- [ ] Role permissions and branch assignments are reviewed.
- [ ] Cross-tenant repository/API tests pass.

## Data and money

- [ ] Forward migrations completed and checksum/version recorded.
- [ ] Database backup and restore drill completed.
- [ ] Journal, allocation, refund, settlement, drawer and inventory invariants pass.
- [ ] Document sequence scope/format is configured.
- [ ] Branch timezone and business-day cutoff are verified.
- [ ] Legacy snapshot migration preview reconciles before apply.

## Providers and callbacks

- [ ] Only certified production provider connections are enabled.
- [ ] Daraja/Pesapal credentials, scopes, callback/IPN and transaction queries pass certification.
- [ ] TendePay remains `SPEC_REQUIRED` without official merchant API documentation.
- [ ] Webhook signature, raw-body, idempotency, replay and burst tests pass.
- [ ] Secrets and card-sensitive data are absent from logs/exports.

## Reliability

- [ ] Readiness/liveness are monitored separately.
- [ ] Queue retry, lease expiry, worker crash and dead-letter recovery are tested.
- [ ] Scheduled orders release with no browser open.
- [ ] EOD aggregates run from the scheduler.
- [ ] Offline cash, reconnect, duplicate replay, conflict and digital-payment block tests pass.
- [ ] Printer bridge/KOT/receipt reprint audit survives browser reset.

## Operations and rollback

- [ ] Structured logs and correlation IDs reach the operations platform.
- [ ] Rate-limit and file-size policies match expected traffic.
- [ ] Malware scan adapter is connected for production imports.
- [ ] Audit and financial retention policy is configured.
- [ ] Support diagnostics export is reviewed for redaction.
- [ ] Rollback procedure and on-call contacts are documented.
- [ ] First-pilot monitoring covers auth failures, duplicate references, payment mismatches, cash variance, dead letters and backup status.
