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

echo "==> schema.sql applies cleanly"
