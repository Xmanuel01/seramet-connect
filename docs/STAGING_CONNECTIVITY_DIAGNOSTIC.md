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
authentication and a fixed read-only query. TLS uses system trust plus a pinned
provider root CA and hostname checking. No insecure fallback or certificate
contents are logged. The probe checks the actual
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

## Provider root trust setup

Run 38608806151 passed configuration, DNS and TCP, then failed TLS with
`SELF_SIGNED_CERT_IN_CHAIN`, before authentication or SQL. This confirms a chain
trust failure, not a bad password. It does not establish backend TLS compatibility.

An authorized administrator must download the root certificate through the
correct Supabase staging project's Database Settings > SSL Configuration.
Use the official download, never a certificate extracted from a failed peer
handshake or an unverified third-party bundle. See
[Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement).

In GitHub Settings > Environments > staging, store the PEM certificate as secret
`SERAMET_STAGING_POSTGRES_CA_PEM`. Independently verify its DER SHA-256 fingerprint
against the official download and store the 64 hex digits (no colons) as environment
variable `SERAMET_STAGING_POSTGRES_CA_SHA256`. For example, locally run
`openssl x509 -in prod-ca-2021.crt -noout -fingerprint -sha256`.
The root certificate is public trust material, not a private key. Never upload a
private key. Owner control of these two configuration entries is a trust boundary,
not independent two-person approval.

The preparation script rejects missing configuration, multiple certificates,
non-root/non-CA certificates, wrong fingerprints and expired certificates. It
writes a runner-temporary certificate and sets `NODE_EXTRA_CA_CERTS` and
`PGSSLROOTCERT` for subsequent processes only. Node and libpq retain their existing
certificate and hostname verification; URI TLS overrides remain prohibited.
The shared step also prepares future authorized migration and recovery workflows
without altering their approval, backup freshness or identity checks. Failure
stops execution before database connection. Runner teardown removes the public
temporary root; database recovery-file cleanup remains unchanged.

Review and merge this correction before separately authorizing one new read-only
diagnostic. No migration, recovery verification or deployment is authorized by
configuring the CA. Certificate rotation requires a verified replacement and pin.

The initial trust configuration was provisioned from the official dashboard's
production-platform CA download over verified HTTPS (the Supabase platform's
`prod` certificate is also used by customer staging projects). The download
template was verified in `apps/studio/hooks/custom-content/custom-content.json`
at Supabase source revision `4c7014745c223904b817f46bc17b8d480031c1a2`.
No staging diagnostic was rerun during this correction. Runtime provider-chain,
authentication and backend TLS acceptance remain unverified until an authorized
diagnostic runs the reviewed change from main.
