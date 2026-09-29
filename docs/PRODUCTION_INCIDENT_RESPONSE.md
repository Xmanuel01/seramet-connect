# Production Incident Response

## Severity

- **P0:** confirmed cross-tenant disclosure, financial duplication/corruption, credential compromise,
  or widespread inability to trade.
- **P1:** material tenant/branch outage, payment callback failure, queue backlog threatening data, or
  unrecoverable device operations.
- **P2:** degraded provider, reporting delay or bounded workflow failure with a workaround.

## Response

1. Acknowledge, assign commander and create an incident correlation reference.
2. Preserve logs, provider events, job/dead-letter records, audit records and build/schema versions.
3. Contain with feature flags, provider disablement, token/session revocation or rollout rollback.
4. Never delete immutable financial, payment, inventory or audit history to hide an incident.
5. Reconcile orders, allocations, journals, inventory movements, queue effects and external provider
   references before restoring service.
6. Notify affected tenants and authorities according to approved legal/privacy policy.
7. Complete root cause, corrective work, regression test and post-incident review.

Do not ask staff to resubmit payments blindly. Use idempotency keys and provider transaction status to
determine whether an external effect already occurred.
