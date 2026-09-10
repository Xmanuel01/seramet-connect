# Worker and Queue Architecture

## Durable execution

Critical integration work uses the platform durable queue and `worker_jobs`/`integration_outbox` database rows. Production readiness fails when the queue binding is absent. In-memory queue behavior remains test/development-only.

Queue messages contain a record ID, tenant and correlation ID; the database row remains the durable source of job state. Workers hydrate authoritative configuration before processing.

## Claiming and retries

- Claims are conditional updates with lease owner and lease expiry.
- Multiple workers cannot hold the same live lease.
- Provider idempotency remains required because a worker can fail after an external success.
- Attempts, start/finish, duration, error and next retry are persisted.
- Exhausted jobs enter `DEAD_LETTER`; successful or terminal rows acknowledge the queue message.
- Expired leases permit recovery after process termination.

## Implemented job types

- integration outbox delivery and recovery;
- scheduled marketplace/POS order release;
- EOD aggregate generation.

Pass 4 integration runtime jobs continue to normalize provider events, payment verification, menu/availability and settlement work through the outbox. New job types must be explicitly registered; unknown jobs fail and dead-letter rather than silently succeeding.

## Crash trace

```text
Provider accepts idempotent request
  -> worker crashes before success mark
  -> lease expires / queue redelivers
  -> row is reclaimed
  -> same provider idempotency key is used
  -> provider returns original result or webhook is deduplicated
  -> one authoritative mutation/receipt/journal effect
  -> outbox marked succeeded
```

## Operations

The authorized System Health page exposes job status counts, queue availability and open dead letters. Structured logs include environment, tenant/branch when known, job/correlation, duration and result; payload credentials are excluded.
