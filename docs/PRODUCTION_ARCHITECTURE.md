# Seramet Production Architecture

## Runtime topology

```text
Browser / branch device
        |
        | HTTPS + HttpOnly Supabase session cookie
        v
Cloudflare Worker (TanStack Start / Nitro)
        |-- Hyperdrive --> Supabase PostgreSQL (authority)
        |-- Queue ------> Seramet durable workers --> dead-letter queue
        |-- R2 ---------> public assets and private tenant documents
        |-- Service ----> malware scanner
        |-- HTTPS ------> configured payment, delivery, notification and AI providers
        `-- HTTPS ------> Supabase Auth

Branch device agent <---- authorized local print jobs ---- Worker
```

PostgreSQL is authoritative for tenants, configuration, identities, sessions, devices, orders,
payments, inventory, journals, audit, jobs and object metadata. Browser storage is limited to theme,
selected authorized scope, expiring guest convenience state, offline read cache and pending device
commands. Server acknowledgement remains authoritative.

## Trust boundaries

- Supabase Auth proves an external identity. Seramet database memberships, branch assignments,
  entitlements, permissions, session revocation and device trust determine authorization.
- The Worker derives tenant and branch scope from the verified session. Request payload scope never
  grants authority.
- Hyperdrive connection details, provider secrets and R2 bindings exist only in Worker bindings or
  managed secret storage.
- Payment and delivery callbacks pass through the integration runtime, signature verification,
  event store and idempotency controls.
- The print bridge is a branch device agent. Pairing, device revocation and allowed-origin policy are
  authoritative server concerns; localhost is not an ERP data authority.

## Delivery and recovery

Schema changes are applied by `npm run migrate:postgres` before Worker deployment. The Worker fails
readiness when the schema is behind version 16 or required production bindings are absent. Queue and
scheduled handlers share the persisted job/outbox state, so retries survive process restarts. R2
objects use random tenant-scoped keys and separate public/private access paths.

See `PRODUCTION_DEPLOYMENT_GUIDE.md`, `WORKER_AND_QUEUE_ARCHITECTURE.md`, and
`PRODUCTION_BACKUP_RESTORE_RUNBOOK.md` for operating procedures.
