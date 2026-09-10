# Seramet Production Readiness Audit

Date: 2026-09-10

## Decision

**Current status: NOT READY for commercial production.**

The repository production path is implemented for PostgreSQL/Hyperdrive, Supabase Auth,
registration, R2, durable Queue/Cron workers, scoped realtime events, security headers and fail-closed
configuration. Local validation is clean. Commercial status remains blocked because the supplied
Supabase publishable key is intentionally insufficient to migrate the real database or create the
Cloudflare resources, and no staging deployment, backup restore, provider certification or physical
hardware acceptance has been executed.

This audit does not treat an interface, fixture, local emulator or checklist as deployed evidence.

## Implemented production controls

- `PostgresD1Database` runs existing repository statements over `pg` and Hyperdrive; connection pool
  size and timeouts are bounded.
- The complete 16-migration history compiles and migrates from zero in PGlite, including PostgreSQL
  trigger equivalents and append-only protections.
- Production requires PostgreSQL plus Hyperdrive and rejects SQLite, in-memory authority, dev auth,
  test providers, unsafe HTTP origins, missing Queue, missing R2 and missing malware scanning.
- Supabase JWT verification resolves the current Auth user, then Seramet resolves tenant membership,
  branch assignment, permissions, revocable session and device state from PostgreSQL.
- `/register` and the public registration API provision tenant, legal entity, brand, first branch,
  hierarchy, administrator and audit atomically and idempotently with zero operational data.
- R2 storage uses random tenant-scoped keys, server metadata, bounded MIME/size validation,
  public/private separation and a production-required scanner.
- Durable Queue/Cron entry points, persisted claiming, retries and dead letters remain the only
  production worker path.
- Tenant/branch-authorized SSE events trigger authoritative client refresh after reconnect.
- The production build audit rejects secrets, original pilot identifiers and development database or
  demo fixture artifacts.
- Setup readiness makes unsafe runtime/schema and missing verified backup non-overridable in staging
  and production.

## Remaining launch blockers

| Severity | Blocker | Evidence needed to close |
| --- | --- | --- |
| P0 deployment | Production PostgreSQL is not connected or migrated | Supabase migration URL, applied version 16, verified counts/invariants |
| P0 deployment | Cloudflare production resources are not bound | Hyperdrive ID, Queue/DLQ, R2, scanner service, Worker/domain and readiness result |
| P0 recovery | Backup is not configured and restore is not rehearsed | Approved retention/RPO/RTO, verified backup record and isolated restore report |
| P1 staging | No production-like staging deployment exists | Staging URL, deployment record, clean-registration E2E and browser/security results |
| P1 providers | Live providers are not certified | Enabled provider credentials, official scopes, callback/reconciliation acceptance |
| P1 hardware | Physical KDS/printing/device agent is not accepted | Registered device, trust/revoke, print/KDS/failure-recovery sign-off |
| P1 operations | External telemetry/WAF/alerts are not configured | Cloudflare rules, log/error sink, alert destinations and escalation drill |

## Storage authority

| Data | Authority | Browser allowance |
| --- | --- | --- |
| Orders, payments, journals, stock, audit, jobs, objects | PostgreSQL/R2 | Read cache only |
| Offline POS commands | PostgreSQL after acknowledgement | Bounded pending command queue |
| Guest cart/tracking convenience | Server on submit | Expiring minimized UX state |
| Theme and selected branch | Server revalidates access | Preference only |
| Development SQLite/snapshot | Development only | Never production |

## Validation snapshot

- Full suite: 455/455 tests, 26/26 files.
- PostgreSQL migration and commercial tests: 10/10.
- Database: 19/19; concurrency: 19/19; offline: 2/2.
- TypeScript: pass. Lint: pass with 18 existing Fast Refresh warnings and zero errors.
- Client, SSR and Cloudflare Nitro build: pass.
- Production bundle secret/demo/development-artifact audit: pass.
- Browser QA: login/register, POS and Setup Centre at desktop/tablet/mobile; no console errors or
  page-level overflow in tested views.

## Gate

Seramet remains **NOT READY** until all blockers above have deployed evidence. A publishable Supabase
key can configure Auth calls but cannot authorize database administration, Cloudflare provisioning,
backup verification or provider/hardware certification.
