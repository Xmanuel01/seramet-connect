# Read-only staging connectivity diagnostic

Issue #117: this manual diagnostic is independent of migration authorization and
backup certification. It cannot call the migration runner or lockdown scripts.
It shares the staging concurrency lock and is restricted to owner dispatch on main.
Single-owner control is not independent review; administrators can alter code or
secrets. Keep the repository private and staging credentials environment-scoped.

## Required administrator setup

An authorized database administrator must provision or verify the dedicated login
`seramet_staging_diagnostic` in project `vnymbavsbxorwxpebkot`. Use a unique password,
no superuser/BYPASSRLS/CREATEDB/CREATEROLE/replication privileges, no membership in
write-enabled roles, and only database CONNECT access. This probe needs no table
SELECT grants: it reads session identity and PostgreSQL catalog/session metadata.
Set the role's default transactions read-only as defense in depth. No role or grant
is created by this implementation. Administrators must verify inherited PUBLIC
privileges as well; client read-only settings alone are not a privilege boundary.

Store its exact connection URI in GitHub Settings > Environments > staging >
Environment secrets > `SERAMET_STAGING_READONLY_POSTGRES_URL`. Never copy the
migration/owner credential into this secret. Use the verified staging direct host
with the dedicated username, or session-pooler host on port 5432 with username
`seramet_staging_diagnostic.vnymbavsbxorwxpebkot`. Database is `postgres`; encode
password special characters. Omit query parameters or use `sslmode=verify-full`.
Weak SSL modes and connection-option overrides are rejected. Missing credentials
produce a sanitized failure without opening a network connection.

After review, merge and separate authorization, the owner may dispatch **Staging
read-only connectivity diagnostic** from main. This PR does not authorize execution.
No backup or one-use migration authorization is consumed.

## Evidence and limits

Stages are configuration, DNS, TCP, PostgreSQL certificate-verified TLS,
authentication and a fixed read-only query. TLS uses system trust and hostname
checking. No custom CA, insecure fallback or certificate contents are logged.
An untrusted chain must be investigated separately. The probe checks the actual
client TLS socket and separately reports `pg_stat_ssl` for the database backend.
Pooler backend TLS can differ from client TLS; a backend failure remains a failed
diagnostic and does not authorize remediation.

Only coarse status, stage, allowlisted category and code are printed. No SQL
results, endpoints, raw exceptions, driver messages or credentials are printed.
Unknown errors remain UNKNOWN. Each connection stage is bounded; workflow timeout
also caps the job. TLS probes send only the PostgreSQL SSLRequest, never credentials.
Authentication uses startup read-only defaults; the SQL probe uses BEGIN READ ONLY
and always attempts ROLLBACK. It never changes persistent data or privileges.

A dedicated role may fail authentication even when an owner credential works;
this diagnostic proves that credential's connectivity, not the migration role's
permissions. Session-pooler support for startup options and provider certificate
trust are runtime prerequisites. No live connectivity or SQL evidence is claimed
by synthetic tests. Local tests require no live staging secrets or database.
