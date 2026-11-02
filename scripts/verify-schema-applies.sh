#!/usr/bin/env bash
#
# Applies supabase/schema.sql to a throwaway database and checks the result.
#
# Parsing the SQL is not enough: "COMMENT ON TABLE <a view>" parses fine and
# fails at execution. This actually runs the file, twice, so re-runnability is
# covered too.
#
# Needs a reachable PostgreSQL server via the standard PG* environment
# variables (PGHOST, PGPORT, PGUSER, PGPASSWORD). In CI that is the postgres
# service container; locally, any scratch server will do.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="schema_verify_$$"

cleanup() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Creating $DB"
psql -q -d postgres -c "CREATE DATABASE $DB;"
psql -q -d postgres -c "ALTER DATABASE $DB SET search_path = \"\$user\", public, extensions;"

echo "==> Applying Supabase stand-ins"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/ci/supabase-stub.sql"

echo "==> Applying supabase/schema.sql"
psql -q -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$REPO_ROOT/supabase/schema.sql"

echo "==> Applying it a second time (must be re-runnable)"
psql -q -d "$DB" -v ON_ERROR_STOP=1 --single-transaction -f "$REPO_ROOT/supabase/schema.sql"

echo "==> Checking the result"
psql -d "$DB" -v ON_ERROR_STOP=1 -tA <<'SQL'
DO $$
DECLARE
    n_tables int;
    n_rls int;
    n_views int;
    n_bad_views int;
BEGIN
    SELECT count(*) INTO n_tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r';
    SELECT count(*) INTO n_rls FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
    SELECT count(*) INTO n_views FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v';
    SELECT count(*) INTO n_bad_views FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'v'
        AND NOT coalesce(array_to_string(c.reloptions, ',') LIKE '%security_invoker=true%', false);

    IF n_tables = 0 THEN
        RAISE EXCEPTION 'schema.sql created no tables';
    END IF;
    -- Every table must have RLS on: it is the only thing standing between the
    -- public anon key and the data.
    IF n_rls <> n_tables THEN
        RAISE EXCEPTION '% of % tables are missing RLS', n_tables - n_rls, n_tables;
    END IF;
    IF n_bad_views > 0 THEN
        RAISE EXCEPTION '% view(s) created without security_invoker=true', n_bad_views;
    END IF;

    RAISE NOTICE 'OK: % tables (all with RLS), % views (all security_invoker)', n_tables, n_views;
END $$;
SQL

echo "==> Checking explicit grants (Supabase no longer grants new public objects automatically)"
# The stand-in roles have no default privileges, so anything schema.sql does not
# GRANT itself is unreachable here -- the situation a rebuild is in since
# Supabase's 2026-10-30 change.
psql -d "$DB" -v ON_ERROR_STOP=1 -tA <<'SQL'
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       AND NOT has_table_privilege('service_role', c.oid, 'SELECT');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'service_role cannot SELECT from: %', missing;
    END IF;

    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       AND c.relname <> 'payment_plan_summary'
       AND NOT (has_table_privilege('anon', c.oid, 'SELECT') AND has_table_privilege('authenticated', c.oid, 'SELECT'));
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon/authenticated cannot SELECT from (expected, matching production): %', missing;
    END IF;

    -- payment_plan_summary is service_role-only in production.
    IF has_table_privilege('anon', 'public.payment_plan_summary', 'SELECT')
       OR has_table_privilege('authenticated', 'public.payment_plan_summary', 'SELECT') THEN
        RAISE EXCEPTION 'payment_plan_summary must be service_role-only';
    END IF;

    IF NOT has_sequence_privilege('authenticated', 'public.member_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'authenticated cannot use public.member_id_seq';
    END IF;

    -- Functions the app calls through .rpc() with the service-role client. A
    -- rebuild no longer gets EXECUTE for service_role by default, and PUBLIC's
    -- EXECUTE was revoked by 20260907000002, so each needs an explicit grant.
    -- anon / authenticated must not be able to call them.
    SELECT string_agg(f.proc::text, ', ' ORDER BY f.proc::text) INTO missing
      FROM unnest(ARRAY[
             'public.get_auth_audit_logs(uuid,integer,integer,timestamp with time zone,timestamp with time zone)',
             'public.get_oauth_email_mismatches()',
             'public.get_pending_xero_invoices_with_lock(integer)',
             'public.get_pending_xero_payments_with_lock(integer)'
           ]::regprocedure[]) AS f(proc)
     WHERE NOT has_function_privilege('service_role', f.proc, 'EXECUTE');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'service_role cannot EXECUTE (called over .rpc() by the app): %', missing;
    END IF;

    SELECT string_agg(f.proc::text, ', ' ORDER BY f.proc::text) INTO missing
      FROM unnest(ARRAY[
             'public.get_auth_audit_logs(uuid,integer,integer,timestamp with time zone,timestamp with time zone)',
             'public.get_oauth_email_mismatches()',
             'public.get_pending_xero_invoices_with_lock(integer)',
             'public.get_pending_xero_payments_with_lock(integer)'
           ]::regprocedure[]) AS f(proc)
     WHERE has_function_privilege('anon', f.proc, 'EXECUTE')
        OR has_function_privilege('authenticated', f.proc, 'EXECUTE');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon/authenticated can EXECUTE service-only functions: %', missing;
    END IF;

    RAISE NOTICE 'OK: every public table and view is granted to service_role; payment_plan_summary is service_role-only; the four service-role RPC functions are executable by service_role only';
END $$;
SQL

echo "==> Payment plan payoff DB checks (#452)"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/tests/payment-plan-payoff-db-test.sql"

echo "==> schema.sql applies cleanly"
