# P0 security review: Supabase public schema / Data API exposure

**Evidence date:** 27 September 2026 UTC. **Project:** `seramet-staging`.
**Scope:** Read-only project metadata, security advisors and PostgreSQL system
catalogue. Do not interpret a PostgreSQL grant as proof that an external REST
endpoint is currently enabled. Do not read private table contents to test.

## Independently observed

- Staging has **303** tables in the PostgreSQL `public` schema.
- **302** public tables have PostgreSQL RLS disabled; **302** are selectable by
  the `anon` and `authenticated` roles according to effective PostgreSQL
  grants. Both roles have `USAGE` on `public`; only **1** policy exists.
- Supabase's Security Advisor agrees: `rls_disabled_in_public` ERROR, 302
  findings. It separately warns about **148** functions with mutable
  `search_path` and leaked-password protection not being enabled.
- Current Seramet source connects to its business database through PostgreSQL
  via Cloudflare Hyperdrive; Supabase is the configured **identity provider**.
  Searches of `main` found no direct `supabase.from(`, `/rest/v1/` or
  `createClient(` application data calls. Inspect other clients and the
  Supabase Data API Dashboard before concluding it is unused.
- Whether the **Data API is enabled and exposes `public`** could not be
  independently confirmed with the available connector. These findings
  establish a high-risk **conditional exposure**, not evidence that data
  has been retrieved by an unauthorized third party.

## Immediate authorized containment: before real customer data

1. In the **staging** Supabase project, open **Integrations → Data API →
   Settings**, check whether the Data API is enabled and which schemas are
   exposed. Record evidence in a restricted security ticket; do not print API
   keys or data rows.
2. If Seramet and all other clients use only Supabase Auth and direct
   PostgreSQL through Hyperdrive, **disable the Supabase Data API**.
   Supabase documents this as the safe route when the Data API is unused.
   Verify owner login, signup, email verification, PIN login, and authorized
   server APIs after this change before applying it in any production project.
   Project console: https://supabase.com/dashboard/project/vnymbavsbxorwxpebkot/integrations/data_api/settings
3. If any client legitimately needs Data API access, use **separate
   explicitly allowlisted API schemas**, revoke `anon/authenticated`
   privileges on internal public tables, enable RLS on every genuinely
   exposed table and create least-privilege tenant/branch policies. Verify
   allow/deny for all methods as `anon`/`authenticated` on disposable data.
   Never rely solely on a `TO authenticated` policy without tenant scope.
4. Before a broad permissions or RLS migration, capture a **verified backup
   and isolated restore rehearsal**, list all app/third-party database access
   dependencies, test against an isolated copy and define rollback. Blanket
   `ALTER TABLE ... ENABLE RLS` and `REVOKE` across 302 live tables are
   NOT approved or automatically run by this PR. Preserve server access,
   service integrations, authenticated tenant permissions and incident logs.
5. Fix `SECURITY DEFINER` execution grants/search paths based on an
   individual function inventory and actual call graphs. Do not mass-edit
   148 trigger/functions or assume all need public EXECUTE.
6. Enable Supabase Auth leaked-password protection when compatible with
   the product/account tier; test registration/password recovery separately.

## Completion proof

- Document and verify that public schema is not Data API-exposed, OR that
  every exposed table has secure grants and RLS with tenant/branch-negative
  integration tests.
- Re-run Supabase Security Advisor, verify no unintended API exposure, and
  inspect sanitized auth/API-access logs according to retention.
- Verify PostgreSQL/Hyperdrive server workflows, onboarding, POS, financial
  writes, migrations and background jobs are unaffected.
- Do not mark this issue closed merely by suppressing linter warnings.

Current Supabase documentation:
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
