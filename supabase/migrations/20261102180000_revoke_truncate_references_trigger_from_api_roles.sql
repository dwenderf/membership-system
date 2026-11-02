-- Narrow anon and authenticated: revoke TRUNCATE, REFERENCES, TRIGGER (and, on
-- PostgreSQL 17+, MAINTAIN) on every table and view in `public`, and stop
-- postgres-created tables from getting them back by default.
--
-- WHY: 20261102170500_explicit_public_grants.sql wrote down the privileges
-- Supabase's old default privileges had handed out: SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER, to anon, authenticated and
-- service_role. Row level security gates the first four. It does NOT gate the
-- last three, nor MAINTAIN (PostgreSQL 17+):
--   * TRUNCATE   empties a table with no row filter at all, RLS never runs.
--   * REFERENCES lets the holder create a foreign key pointing at the table.
--   * TRIGGER    lets the holder create a trigger on the table.
--   * MAINTAIN   lets the holder VACUUM, ANALYZE, REINDEX, CLUSTER and LOCK the
--                table. Both projects run PostgreSQL 17, but only production
--                holds it for anon and authenticated (through the same default
--                ACL; read from pg_class.relacl on 2026-11-02).
-- None of the three is reachable through PostgREST (it only issues
-- SELECT / INSERT / UPDATE / DELETE), but they are held by the two roles that
-- the public anon key and every signed-in browser session map to, for no
-- benefit. This file takes them away.
--
-- AUDIT (2026-11-02, summarised in the PR): nothing in the app or the
-- migrations needs these privileges for anon or authenticated.
--   * no TRUNCATE statement exists in the application code or any migration;
--   * every migration runs as postgres (`supabase db push`), the owner of every
--     table, which needs no grant to add a foreign key or a trigger;
--   * an existing trigger fires whatever privileges the invoking role holds
--     (the TRIGGER privilege is only checked by CREATE TRIGGER);
--   * the app never opens a SQL connection as anon or authenticated: browser
--     and server code speak PostgREST (supabase-js), which cannot TRUNCATE.
--
-- SCOPE:
--   * anon, authenticated only. service_role is left as it is.
--   * MAINTAIN does not exist before PostgreSQL 17 (the keyword is a syntax
--     error there), so it is revoked, and removed from the default privileges,
--     inside DO blocks that build the statement dynamically and only run it when
--     server_version_num >= 170000. CI's scratch server is PostgreSQL 16.
--   * DEFAULT PRIVILEGES: Supabase's default ACL for objects created by the
--     postgres role in public (which is every table a migration creates) still
--     hands anon, authenticated and service_role all table privileges. A table
--     created from now on would therefore regain TRUNCATE, REFERENCES, TRIGGER
--     (and MAINTAIN) for anon and authenticated whatever its GRANTs say. The
--     ALTER DEFAULT PRIVILEGES below removes exactly those from that default ACL
--     for anon and authenticated. It adds nothing: SELECT / INSERT / UPDATE /
--     DELETE stay in the default ACL, service_role's default is untouched, and
--     so are the defaults of other grantor roles (supabase_admin, which the app
--     never creates objects as) and for functions and sequences. New tables
--     still get their explicit least-privilege GRANT (AGENTS.md); an explicit
--     GRANT of any of the four to anon/authenticated keeps working but is
--     flagged by the lint. Where the postgres role does not exist (a bare
--     scratch server) the default-privileges step is skipped with a NOTICE;
--     there is nothing to revoke there.
--   * SELECT, INSERT, UPDATE, DELETE are left as they are (RLS decides them).
--   * ON ALL TABLES IN SCHEMA public covers every table and view that exists
--     when this runs. The privileges are removed from 39 tables and 8 views on
--     production and development; the ninth view, payment_plan_summary, never
--     gave anon or authenticated anything, so it is a no-op. It does not touch
--     objects created later: those get their own least-privilege GRANT in the
--     migration that creates them (AGENTS.md).
--   * Sequences: TRUNCATE, REFERENCES and TRIGGER are not valid privileges on a
--     sequence (only USAGE, SELECT and UPDATE are), so member_id_seq has
--     nothing to revoke and is not touched.
--   * PUBLIC holds none of the three on any relation in either project (read
--     from pg_class.relacl on 2026-11-02), so nothing is revoked from PUBLIC.
--
-- Against production and development this removes TRUNCATE, REFERENCES and
-- TRIGGER (plus MAINTAIN, which only production holds; both projects are
-- PostgreSQL 17) from anon and authenticated on each of 39 tables and 8 views, and the same privileges from
-- the postgres default ACL for them. It is re-runnable: revoking a privilege
-- that is not held is a no-op. Rollback, if ever wanted (it should not be):
--   GRANT TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
--     TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon, authenticated;
-- (add MAINTAIN on PostgreSQL 17), followed by
--   REVOKE ALL ON public.payment_plan_summary FROM anon, authenticated;

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON ALL TABLES IN SCHEMA public
FROM anon, authenticated;

DO $$
BEGIN
    -- MAINTAIN exists from PostgreSQL 17; building the statement as a string
    -- keeps this file parseable on 16.
    IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    END IF;
END $$;

-- Future tables: stop the postgres default ACL from granting these back.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
        RAISE NOTICE 'role postgres does not exist; skipping ALTER DEFAULT PRIVILEGES';
        RETURN;
    END IF;

    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

    IF current_setting('server_version_num')::int >= 170000 THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public '
             || 'REVOKE MAINTAIN ON TABLES FROM anon, authenticated';
    END IF;
END $$;
