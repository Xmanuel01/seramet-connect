# Production Monitoring Runbook

Monitor Worker error rate/latency, PostgreSQL/Hyperdrive availability, queue age and depth, retries,
dead letters, cron last success, R2 failures, Auth failures, payment callback age, provider circuit
state, printer/KDS heartbeat, migration/schema drift and backup verification age.

Recommended alerts:

- readiness endpoint fails for two consecutive checks;
- queue oldest message exceeds the workflow SLA;
- any financial/payment dead letter;
- duplicate-reference or invariant alarm;
- payment confirmation backlog or webhook signature failures increase;
- database connection errors or exhausted pool;
- no scheduled-worker heartbeat;
- backup exceeds the approved age;
- unusual authentication, OTP, registration or voucher rate-limit activity.

Dashboards must show tenant/branch/correlation metadata only to authorized operators and redact PII,
credentials, cookies and tokens. Provider degradation does not make core readiness fail, but it must
be visible separately. Every alert must name an owner, escalation route and runbook link before pilot.
