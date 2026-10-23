# Production sign-in runtime

The native Cloudflare Git build previously generated only an asset binding. That
discarded the runtime configuration, leaving public authentication and device
startup correctly rejected by `PUBLIC_DEVELOPMENT_RUNTIME`.

`vite.config.ts` now supplies Nitro's generated Wrangler configuration through
`cloudflareBuildConfig`. Only a Cloudflare main-branch build with a full commit
identifier receives production bindings. Other builds explicitly remain in
development mode with no production database, queue or object-store bindings.
Production version-preview URLs are disabled. Secrets remain in Cloudflare,
never in source or browser build variables.

## Dedicated Resources

- Worker: `seramet-connect`.
- Public origin: `https://pos.seramet.co.ke`.
- Supabase project: `qnhqylslyhxjcksuhgyq` (`seramet-production`).
- Hyperdrive: `seramet-production-live-db`, with TLS `verify-full`, a pinned
  Supabase root CA, five origin connections, and query caching disabled.
- Work/dead-letter queues: `seramet-production-live-work` and
  `seramet-production-live-dlq`. Old queues are not imported or purged.
- Private objects: existing `seramet-production-objects` bucket.

These are deployment identifiers, not restaurant identifiers. All restaurant,
branch, employee and device authorization remains server-checked and tenant scoped.
The staging resources and the older production database connection are unchanged.

## Database Authority

The Worker uses the dedicated `seramet_runtime` login, not the database owner or
read-only backup account. It has public-schema DML and sequence access, but no
superuser, role-creation, database-creation, schema-creation, Auth-schema access,
table ownership or migration-writing privileges. Migration history is read-only.

The existing server-authoritative repository design checks tenant authorization
before SQL execution; it does not set per-request PostgreSQL tenant claims. The
private runtime login therefore has `BYPASSRLS`, scoped by its SQL grants. This
must never be exposed through Supabase's public Data API or any browser code.
Public/anon/authenticated table access stays revoked and table RLS stays enabled.
Moving tenant enforcement into database policies requires a separate design and
must not be approximated with permissive public policies.

## Acceptance

Verify readiness, public Auth configuration and device startup on the POS origin
after deployment. A new browser with no activated device must report an
unregistered device, not a connection error, and must not receive staff access.
An empty production database still needs an owner-created restaurant, staff and
an activated device before real PIN sign-in can succeed. Do not auto-register an
unknown browser or seed live employee credentials to hide that requirement.

Queue bindings alone do not prove consumption. File scanning, email delivery,
payments, physical printing and the full sales workflow require their separate
acceptance checks; this configuration does not certify them.

## Rollback

Retain the previous Worker version and the protected pre-change binding metadata.
If a deployment fails, roll back the Worker version/settings without restoring
over customer data, switching to staging, purging queues, dropping the runtime
role, or changing database/schema history. Keep the public-development safeguard
and staff/device authorization enabled throughout.
