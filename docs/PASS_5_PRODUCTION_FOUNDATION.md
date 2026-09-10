# Pass 5 - Production Data, Identity, Durable Workers and Reliability

Pass 5 hardens the existing Pass 1-4 architecture. It does not introduce a second order, payment, inventory or integration engine.

## Production execution path

```text
React route
  -> typed HTTP command + idempotency key
  -> bearer session and permission enforcement
  -> tenant/branch scope from server identity
  -> D1AuthoritativeTransactionRepository
  -> atomic record diff + revision + audit + mutation commit
  -> durable outbox/worker
  -> replaceable IndexedDB read cache
```

Production and staging fail readiness when the authoritative database, durable queue, JWT settings, HTTPS callback base, or server secret store is absent. Development memory and header authentication are available only with an explicit development environment, an explicit opt-in flag, and a localhost request.

## Authoritative persistence

- Six forward-only migrations create normalized operational tables, authoritative record storage, runtime metadata, indexes, immutable-record triggers and concurrency guards.
- The current transaction engine is persisted as individual authoritative records. The JSON read model is derived after each atomic commit and is not accepted from a production browser.
- Configuration is loaded from normalized server tables. Production browser persistence is disabled after authenticated bootstrap.
- Mutation commits include tenant, actor, device, action, request hash, idempotency key, correlation ID and base revision.
- Provider references, marketplace order IDs, settlement IDs, stock references and receipt identities have database uniqueness constraints.

## Identity and authorization

- HS256 bearer JWT validation checks signature, issuer, audience, expiry, tenant, user and session.
- Session lookup binds the token to the authoritative tenant/user and rejects revoked, expired or credential-version-invalidated sessions.
- Registered device binding rejects revoked devices.
- Role permissions and branch assignments are read from the database. Browser tenant, branch, role and permission claims are not trusted.
- Sensitive endpoints enforce permission codes server-side.

## Reliability

- Durable jobs and outbox rows use database leases, attempt counts, retry times, dead-letter states and correlation IDs.
- Scheduled order release, outbox recovery and EOD aggregation run from the server scheduler.
- Offline cash-capable commands use device sequence plus idempotency. Digital confirmation is rejected offline.
- Document sequences use an atomic upsert/returning statement scoped by tenant, branch, document type and period.
- Posted journals, confirmed payments, allocations, audit events, posted settlements and inventory movements are immutable at the database layer.

## Operations

`/api/seramet/health/live` is process liveness. `/api/seramet/health/ready` validates production dependencies and schema version. The authorized System Health screen reports database schema, queue availability, worker status, dead letters, build identity and recorded backup status without exposing secrets.

## Validation

The test suite includes real SQLite execution of the production migrations, tenant/FK isolation, uniqueness, JWT/session/device checks, production dev-header rejection, payment/invoice/refund races, settlement/cash-close races, inventory/receiving idempotency, offline replay, document numbering, immutability, worker dead-letter behavior, secure file boundaries and snapshot migration reconciliation.

## P0 closure

- **Production development-header authentication: CLOSED.** Production/staging always require bearer authentication, and startup rejects `SERAMET_ENABLE_DEV_AUTH=true`.
- **Production browser/snapshot authority: CLOSED.** Production/staging require D1, the snapshot PUT endpoint returns 405 in authoritative mode, and the UI uses typed server commands. Browser data is cache/queue/preference data only.
