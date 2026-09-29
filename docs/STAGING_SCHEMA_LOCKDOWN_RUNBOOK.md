# Staging emergency public-schema lockdown: **manual approved operation**

**Status: implementation and disposable-Postgres test only; NOT RUN on staging.**
The actual staging Supabase SQL connection here is supabase_read_only_user.
Never describe the documented plan as live protection or claim 302
RLS findings cleared before an independent live check.

## Why this cannot be deployed blindly
On 28 September 2026 the Supabase edge logs showed 28 successful REST
Data API GETs in the past 24 hours, including users, roles, permission and
branch endpoints. The requests carried API keys, but the recorded JWT role was
unavailable. They might be legitimate diagnostics, another client, or
unauthorized calls: the logs alone cannot distinguish. Staging has 303
public tables; 302 lack RLS and have effective anon/authenticated SELECT
grants. **Do not infer the API is unused and turn it off blindly.**

The source POS business backend uses direct PostgreSQL/Hyperdrive. The SQL
in ops/sql/staging-public-schema-lockdown.sql revokes existing public client
table/schema grants, opts the *executing migration role* out of future
implicit grants and turns on RLS for all currently unprotected public base
tables; it creates no permissive policies. The other 148 mutable search-path
findings and possibly callable SECURITY DEFINER functions remain separate
work and must be audited individually.

## Authorized deployment

1. Freeze staging operations and retain a restricted incident access-log
   snapshot. Inventory all clients (including dashboard, cookbook, external
   apps) using the REST endpoints and their required explicit grants. Confirm
   the real Cloudflare runtime database role and whether RLS affects it.
2. Generate a staging PostgreSQL backup, **restore it into a completely
   isolated database**, and actually run Seramet owner login, branch
   creation, existing POS reads/writes, invoice/stock/GL, migrations and
   background-job fixtures there as the same restricted application role.
   Record restricted restore evidence and a separate rollback operator.
3. Run the SQL on that isolated restored copy (not just the clean disposable
   CI schema). It is gated by a transaction-scoped PostgreSQL setting
   named seramet.staging_schema_lockdown_approved set to the exact value
   APPROVED_AFTER_ISOLATED_RESTORE. Ensure the runner independently
   verifies the *staging project ref* vnymbavsbxorwxpebkot from its
   connection URL; the database's own name may simply be postgres.
   Never log database credentials or any table rows.
4. Explicitly test previously legitimate REST clients. Any client that
   truly needs data should use a dedicated explicitly exposed API schema
   with least-privilege grants and tenant/branch-correct RLS. The blanket
   internal public table grants must remain revoked. If no application
   needs REST/GraphQL data, disable the Data API in the Supabase dashboard
   after confirming Auth, login and direct-Postgres functionality. Do not
   switch it off merely because source searches missed an external client.
5. After the clone passes, and only with owner approval, use an authorized
   **staging-only** migration account to run the vetted script inside its
   existing transaction. The tool available in this chat is READ-ONLY:
   it cannot apply the migration or produce a verified backup. Do not
   use the production project's SQL editor or an unidentified DSN.
6. Independently re-run the system catalog grants/RLS check. Require
   0 public base tables with RLS disabled and 0 internal public tables
   SELECT-able by anon or authenticated. Review Supabase Security Advisor,
   Auth/POS/Hyperdrive regression, negative REST security probes, and
   sanitized API access logs. Verify function EXECUTE grants separately.
7. Only after these independent checks may the existing staging release
   attestation SERAMET_DATA_API_EXPOSURE_CLEARED be considered for approval.

The SQL uses an atomic transaction and aborts on failed postconditions.
After COMMIT, rollback requires a separately reviewed privilege/policy
restoration based on the verified isolated backup; **do not blindly restore
the original insecure public grants**.
