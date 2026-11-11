-- Database hardening from the November 2026 Supabase review.
--
-- 1. configuration_revisions (0034) was created without row level security. It is the only
--    public table without it. Only the server reads it; with RLS on and no policies, Supabase's
--    Data API cannot read it as anon or authenticated, the same as every other table.
-- POSTGRES_ONLY: ALTER TABLE configuration_revisions ENABLE ROW LEVEL SECURITY;

-- 2. idx_setup_import_status_created (0018) repeats idx_setup_import_status (0009) column for
--    column: (tenant_id, status, created_at DESC). Every setup import write maintained both.
DROP INDEX IF EXISTS idx_setup_import_status_created;

-- 3. Pin the search_path of every trigger function, so a function never resolves a table or
--    function through a caller's search_path. Trigger functions compiled from now on carry the
--    same setting (see postgres-migration-compiler.ts). The SQL helpers json_extract/json_each
--    are left alone: they call only built-ins, and a SET clause would stop PostgreSQL from
--    inlining them into the queries that use them.
-- POSTGRES_ONLY: DO $$ DECLARE fn regprocedure; BEGIN FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype AND p.proname LIKE 'seramet\_trigger\_%' AND pg_get_userbyid(p.proowner) = current_user AND p.proconfig IS NULL LOOP EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn); END LOOP; END $$;

INSERT INTO schema_migrations(version,name,checksum,applied_at)
VALUES(36,'supabase_hardening','supabase-hardening-0036-v1',CURRENT_TIMESTAMP);
