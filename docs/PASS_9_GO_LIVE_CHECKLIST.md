# Pass 9 Go-Live Checklist

## Provider and secrets

- [ ] Deploy and bind an approved `SERAMET_AI_GATEWAY` implementation.
- [ ] Select a provider/model with contractual structured-output support.
- [ ] Store provider credentials in the managed server secret store.
- [ ] Configure only a managed secret reference in Seramet.
- [ ] Confirm `DETERMINISTIC_TEST` is absent from production configuration.
- [ ] Verify timeout, rate-limit, invalid-credential, malformed-output, and outage behavior in staging.
- [ ] Confirm provider health is evidence-based and reports degraded/unavailable honestly.

## Authorization and commercial controls

- [ ] Assign intelligence permissions by job function, not role-name checks.
- [ ] Verify finance and staff source permissions independently.
- [ ] Verify owner users can see only assigned branches.
- [ ] Activate the correct tenant subscription entitlements.
- [ ] Configure per-minute, daily, monthly, and per-user limits.
- [ ] Confirm disabled feature flags fail closed.

## Privacy and retention

- [ ] Approve the provider data-processing agreement and data residency.
- [ ] Select `EPHEMERAL`, `SHORT`, or `STANDARD` retention.
- [ ] Review employee/staff privacy with HR or legal counsel.
- [ ] Verify PII, payment reference, secret-key, and injection redaction fixtures.
- [ ] Verify application, provider, support, and diagnostics logs contain no provider secret.
- [ ] Exercise retention expiry and backup/restore behavior.

## Evidence and finance

- [ ] Recalculate Pass 6/7 read models before pilot.
- [ ] Resolve material data-quality and missing-recipe issues.
- [ ] Confirm Flash P&L is presented as managerial, not statutory.
- [ ] Finance signs off evidence definitions and food-cost reconciliation.
- [ ] Confirm unexplained variance remains unexplained.
- [ ] Verify business timezone and cutoff for every pilot branch.

## Prompts and releases

- [ ] Approve and record prompt/model version.
- [ ] Run hallucinated number, percentage, cause, entity, and action tests.
- [ ] Run menu, order-note, and supplier prompt-injection tests.
- [ ] Run cross-tenant, cross-branch, permission-change, and cache-isolation tests.
- [ ] Rehearse provider outage while POS, KDS, payments, inventory, and close continue.
- [ ] Verify high-risk actions cannot be proposed or executed.

## Briefs and workers

- [ ] Configure Morning, EOD, and Owner brief feature markers.
- [ ] Verify branch-local schedule times and business-date behavior.
- [ ] Verify queue availability, idempotency, retry, and dead-letter alerts.
- [ ] Confirm failed briefs remain visibly failed and can be retried.
- [ ] Confirm brief recipients have current branch and source-domain permissions.

## Browser and operations

- [ ] Test 1440x900, 1024x768, and 390x844.
- [ ] Test Ask, Morning, EOD, History, Usage, provider unavailable, and evidence drawer.
- [ ] Confirm no console errors, failed network calls, or page-level overflow.
- [ ] Export safe support diagnostics and confirm provider secrets are absent.
- [ ] Record tested app, schema, model, prompt, and build versions.
