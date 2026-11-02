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
#
# Which relations / functions are service_role-only comes from
# scripts/ci/schema-verify-expectations.txt, not from this script.
EXPECTATIONS="$REPO_ROOT/scripts/ci/schema-verify-expectations.txt"
SERVICE_ONLY_RELATIONS=""
SERVICE_ONLY_FUNCTIONS=""
while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    kind="${line%%[[:space:]]*}"
    name="$(printf '%s' "${line#"$kind"}" | sed -e 's/^[[:space:]]*//')"
    case "$kind" in
        service_role_only_relation) SERVICE_ONLY_RELATIONS+="${name}"$'\n' ;;
        service_role_only_function) SERVICE_ONLY_FUNCTIONS+="${name}"$'\n' ;;
        *) echo "Unknown entry '$kind' in $EXPECTATIONS" >&2; exit 1 ;;
    esac
done < "$EXPECTATIONS"

psql -d "$DB" -v ON_ERROR_STOP=1 -tA \
    -v "service_only_relations=$SERVICE_ONLY_RELATIONS" \
    -v "service_only_functions=$SERVICE_ONLY_FUNCTIONS" <<'SQL'
-- psql does not substitute :variables inside a DO body, so hand the lists over
-- as settings (newline-separated).
SELECT set_config('verify.service_only_relations', :'service_only_relations', false) AS _a,
       set_config('verify.service_only_functions', :'service_only_functions', false) AS _b \gset

DO $$
DECLARE
    missing text;
    priv_list text;
    service_only_rels text[] := array_remove(string_to_array(current_setting('verify.service_only_relations'), E'\n'), '');
    service_only_fns  text[] := array_remove(string_to_array(current_setting('verify.service_only_functions'), E'\n'), '');
BEGIN
    -- A listed relation that does not exist is a stale entry.
    SELECT string_agg(r, ', ' ORDER BY r) INTO missing
      FROM unnest(service_only_rels) AS r
     WHERE NOT EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v') AND c.relname = r);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'schema-verify-expectations.txt lists relation(s) that do not exist in public: %', missing;
    END IF;

    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       AND NOT has_table_privilege('service_role', c.oid, 'SELECT');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'service_role cannot SELECT from: %', missing;
    END IF;

    -- Everything not on the service-role-only list is read by the browser client.
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       AND NOT (c.relname = ANY (service_only_rels))
       AND NOT (has_table_privilege('anon', c.oid, 'SELECT') AND has_table_privilege('authenticated', c.oid, 'SELECT'));
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon/authenticated cannot SELECT from (expected, matching production; if it is meant to be service_role-only, add it to scripts/ci/schema-verify-expectations.txt): %', missing;
    END IF;

    -- The listed relations must be service_role-only.
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
       AND c.relname = ANY (service_only_rels)
       AND (has_table_privilege('anon', c.oid, 'SELECT') OR has_table_privilege('authenticated', c.oid, 'SELECT'));
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'listed as service_role-only but anon/authenticated can SELECT: %', missing;
    END IF;

    IF NOT has_sequence_privilege('authenticated', 'public.member_id_seq', 'USAGE') THEN
        RAISE EXCEPTION 'authenticated cannot use public.member_id_seq';
    END IF;

    -- 20261102180000 revoked TRUNCATE, REFERENCES and TRIGGER (and, on
    -- PostgreSQL 17+, MAINTAIN) from anon and authenticated. RLS does not gate
    -- them and PostgREST never uses them, so no relation in public may hand them
    -- to either role again. Deliberately the only privilege-preservation check:
    -- how much DML a table grants (and to whom) is up to each table's
    -- least-privilege GRANT, so none is required here. MAINTAIN is an unknown
    -- privilege type before PostgreSQL 17 (has_table_privilege would error), so
    -- it is only asked about there; CI's server is 16.
    priv_list := 'TRUNCATE, REFERENCES, TRIGGER';
    IF current_setting('server_version_num')::int >= 170000 THEN
        priv_list := priv_list || ', MAINTAIN';
    END IF;

    SELECT string_agg(c.relname || ' (' || r.role_name || ')', ', ' ORDER BY c.relname, r.role_name) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege(r.role_name, c.oid, priv_list);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon/authenticated hold one of % on: % (grant only the DML verbs the access path needs)', priv_list, missing;
    END IF;

    -- The postgres role's default ACL for tables in public must not hand those
    -- privileges to anon/authenticated either, or every table created later would
    -- get them back. Empty on a bare scratch server (nothing to check); the
    -- "old defaults" rebuild below seeds Supabase's former default ACL to prove
    -- the migration removes it.
    SELECT string_agg(g.role_name || ':' || x.privilege_type, ', ' ORDER BY g.role_name, x.privilege_type) INTO missing
      FROM pg_default_acl d
      JOIN pg_namespace n ON n.oid = d.defaclnamespace
      JOIN pg_roles o ON o.oid = d.defaclrole
     CROSS JOIN LATERAL aclexplode(d.defaclacl) AS x
      JOIN (VALUES ('anon'), ('authenticated')) AS g(role_name) ON g.role_name = (SELECT rolname FROM pg_roles WHERE oid = x.grantee)
     WHERE n.nspname = 'public' AND o.rolname = 'postgres' AND d.defaclobjtype = 'r'
       AND x.privilege_type = ANY (string_to_array(replace(priv_list, ' ', ''), ','));
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'default privileges for postgres in public still grant (grantee:privilege): %', missing;
    END IF;

    -- Functions the app calls through .rpc() with the service-role client. A
    -- rebuild no longer gets EXECUTE for service_role by default, and PUBLIC's
    -- EXECUTE was revoked by 20260907000002, so each needs an explicit grant.
    -- anon / authenticated must not be able to call them. (regprocedure casts
    -- fail if a listed signature does not exist.)
    SELECT string_agg(f.proc::text, ', ' ORDER BY f.proc::text) INTO missing
      FROM unnest(service_only_fns::regprocedure[]) AS f(proc)
     WHERE NOT has_function_privilege('service_role', f.proc, 'EXECUTE');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'service_role cannot EXECUTE (called over .rpc() by the app): %', missing;
    END IF;

    SELECT string_agg(f.proc::text, ', ' ORDER BY f.proc::text) INTO missing
      FROM unnest(service_only_fns::regprocedure[]) AS f(proc)
     WHERE has_function_privilege('anon', f.proc, 'EXECUTE')
        OR has_function_privilege('authenticated', f.proc, 'EXECUTE');
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'anon/authenticated can EXECUTE service-only functions: %', missing;
    END IF;

    RAISE NOTICE 'OK: every public table and view is granted to service_role; anon/authenticated hold no TRUNCATE/REFERENCES/TRIGGER%; postgres default ACLs grant none of them; % relation(s) and % function(s) are service_role-only as listed in schema-verify-expectations.txt',
        CASE WHEN priv_list LIKE '%MAINTAIN%' THEN '/MAINTAIN' ELSE '' END,
        cardinality(service_only_rels), cardinality(service_only_fns);
END $$;
SQL

echo "==> Rebuild under Supabase's old default privileges (must still end up without TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for anon/authenticated)"
# Supabase's default ACL for objects created by postgres in public used to hand
# anon, authenticated and service_role every table privilege. Production and
# development still have it. Seed it, apply schema.sql (twice), and check that
# the revoke migration leaves neither the tables nor the default ACL holding the
# privileges, and that a table created afterwards does not get them back.
# Needs the connecting role to be `postgres` (CI's service container is): the
# default ACL is per creating role, and the migration targets postgres.
OLD_DB="${DB}_olddefaults"
if [ "$(psql -d postgres -tAc 'SELECT current_user')" = "postgres" ]; then
    cleanup_old() { psql -q -d postgres -c "DROP DATABASE IF EXISTS $OLD_DB;" >/dev/null 2>&1 || true; cleanup; }
    trap cleanup_old EXIT
    psql -q -d postgres -c "CREATE DATABASE $OLD_DB;"
    psql -q -d postgres -c "ALTER DATABASE $OLD_DB SET search_path = \"\$user\", public, extensions;"
    psql -q -d "$OLD_DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/ci/supabase-stub.sql"
    psql -q -d "$OLD_DB" -v ON_ERROR_STOP=1 <<'SQL'
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL
    psql -q -d "$OLD_DB" -v ON_ERROR_STOP=1 --single-transaction -f "$REPO_ROOT/supabase/schema.sql"
    psql -q -d "$OLD_DB" -v ON_ERROR_STOP=1 --single-transaction -f "$REPO_ROOT/supabase/schema.sql"
    psql -d "$OLD_DB" -v ON_ERROR_STOP=1 -tA <<'SQL'
DO $$
DECLARE
    priv_list text := 'TRUNCATE, REFERENCES, TRIGGER';
    missing text;
BEGIN
    IF current_setting('server_version_num')::int >= 170000 THEN
        priv_list := priv_list || ', MAINTAIN';
    END IF;

    -- The seed must have been in effect, or this proves nothing: service_role
    -- keeps the privileges the default ACL gave it.
    IF NOT EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclobjtype = 'r' AND d.defaclnamespace = 'public'::regnamespace) THEN
        RAISE EXCEPTION 'old-defaults seed is missing';
    END IF;

    SELECT string_agg(g.role_name || ':' || x.privilege_type, ', ' ORDER BY g.role_name, x.privilege_type) INTO missing
      FROM pg_default_acl d
      JOIN pg_roles o ON o.oid = d.defaclrole
     CROSS JOIN LATERAL aclexplode(d.defaclacl) AS x
      JOIN (VALUES ('anon'), ('authenticated')) AS g(role_name) ON g.role_name = (SELECT rolname FROM pg_roles WHERE oid = x.grantee)
     WHERE d.defaclnamespace = 'public'::regnamespace AND o.rolname = 'postgres' AND d.defaclobjtype = 'r'
       AND x.privilege_type = ANY (string_to_array(replace(priv_list, ' ', ''), ','));
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'old defaults: default ACL still grants %', missing;
    END IF;

    SELECT string_agg(c.relname || ' (' || r.role_name || ')', ', ' ORDER BY c.relname, r.role_name) INTO missing
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege(r.role_name, c.oid, priv_list);
    IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'old defaults: anon/authenticated hold one of % on: %', priv_list, missing;
    END IF;

    -- DML stays in the default ACL: only the four privileges were taken out.
    CREATE TABLE public.verify_new_table (id int);
    IF has_table_privilege('anon', 'public.verify_new_table', priv_list)
       OR has_table_privilege('authenticated', 'public.verify_new_table', priv_list) THEN
        RAISE EXCEPTION 'old defaults: a table created afterwards still gets one of % for anon/authenticated', priv_list;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.verify_new_table', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
        RAISE EXCEPTION 'old defaults: service_role lost its default table privileges';
    END IF;
    DROP TABLE public.verify_new_table;

    RAISE NOTICE 'OK: under the old default privileges anon/authenticated end up with none of %, on existing and on future tables', priv_list;
END $$;
SQL
else
    echo "    skipped: connected as $(psql -d postgres -tAc 'SELECT current_user'), not postgres (CI connects as postgres)"
fi

echo "==> Payment plan payoff DB checks (#452)"
psql -q -d "$DB" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/scripts/tests/payment-plan-payoff-db-test.sql"

echo "==> schema.sql applies cleanly"
