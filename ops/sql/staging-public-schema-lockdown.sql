-- INCIDENT RUNBOOK SQL, NEVER AN AUTOMATIC APP MIGRATION.
-- Applies only after restore-tested backup, dependency inventory and successful
-- app-runtime + Supabase Data API compatibility tests on an isolated restore.
-- Only run as the verified staging migration/table-owner role.
BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '3min';
DO $guard$
BEGIN
  IF current_setting('seramet.staging_schema_lockdown_approved', true)
       IS DISTINCT FROM 'APPROVED_AFTER_ISOLATED_RESTORE' THEN
    RAISE EXCEPTION 'Lockdown refused: independently verified staging restore and tested application role are required';
  END IF;
  -- A separate runner MUST verify the staging project-ref in the DSN;
  -- Supabase staging itself commonly has database name 'postgres'.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') OR
     NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    RAISE EXCEPTION 'Supabase role inventory differs; stop';
  END IF;
END $guard$;

-- Deny existing PostgREST data access for the two client roles.
-- This does not affect backend database owners, but MUST be compatibility
-- tested with the actual production-like Hyperdrive database role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Fail closed for future tables created by THIS migration role. Repeat the
-- default-privilege review for every distinct table-creating role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE USAGE, SELECT ON SEQUENCES FROM PUBLIC, anon, authenticated;

-- Independently enforce RLS on existing base tables and partitioned parents.
-- No permissive blanket policies. Needed external API use must later move to
-- a dedicated allowlisted schema with explicitly tenant-scoped policies.
DO $enable_rls$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',r.nspname,r.relname);
  END LOOP;
END $enable_rls$;

-- Check under the same transaction before making any change durable.
DO $verify$
DECLARE unprotected integer;
DECLARE anon_reads integer;
DECLARE auth_reads integer;
BEGIN
  SELECT count(*) INTO unprotected FROM pg_tables
    WHERE schemaname='public' AND NOT rowsecurity;
  SELECT count(*) INTO anon_reads FROM pg_tables
    WHERE schemaname='public' AND has_table_privilege('anon',
      format('%I.%I',schemaname,tablename),'SELECT');
  SELECT count(*) INTO auth_reads FROM pg_tables
    WHERE schemaname='public' AND has_table_privilege('authenticated',
      format('%I.%I',schemaname,tablename),'SELECT');
  IF unprotected<>0 OR anon_reads<>0 OR auth_reads<>0 THEN
    RAISE EXCEPTION 'Lockdown verification failed (no RLS: %, anon readable: %, authenticated readable: %)',
      unprotected, anon_reads, auth_reads;
  END IF;
END $verify$;
COMMIT;
