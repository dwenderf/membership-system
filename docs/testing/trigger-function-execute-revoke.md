# Verification: EXECUTE revoked on two trigger functions

Covers `supabase/migrations/20261029223700_revoke_execute_on_remaining_trigger_functions.sql`
(from InfoSec hardening).

| Function (signature) | Trigger | Table | Security | Needs a caller grant? |
| --- | --- | --- | --- | --- |
| `public.set_registration_published_at()` | `set_registrations_published_at` (BEFORE INSERT OR UPDATE OF is_active) | `public.registrations` | INVOKER, `search_path = public, pg_temp` | No |
| `public.update_user_discount_allowances_updated_at()` | `trg_user_discount_allowances_updated_at` (BEFORE UPDATE) | `public.user_discount_allowances` | INVOKER, `search_path = public, pg_temp` | No |

PostgreSQL checks EXECUTE on a trigger function when `CREATE TRIGGER` runs, not
when the trigger fires, so writers (anon, authenticated, service_role) keep
working without the grant. No application code references either function and
there is no `.rpc()` call for them.

`service_role` keeps its explicit EXECUTE grant; only PUBLIC, anon and
authenticated lose it.

## Verification SQL (read-only; run after applying the migration)

```sql
SELECT p.oid::regprocedure::text AS fn,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       (SELECT count(*)
          FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         WHERE a.grantee = 0) AS public_grants          -- grantee 0 = PUBLIC
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('set_registration_published_at',
                    'update_user_discount_allowances_updated_at')
ORDER BY 1;
```

Expected after the migration:

| fn | anon | authenticated | service_role | public_grants |
| --- | --- | --- | --- | --- |
| `set_registration_published_at()` | false | false | true | 0 |
| `update_user_discount_allowances_updated_at()` | false | false | true | 0 |

State InfoSec found on dev and prod before the migration: anon = true,
authenticated = true, service_role = true, PUBLIC granted.

Triggers must still be enabled (expect two rows, `tgenabled = 'O'`):

```sql
SELECT tgname, tgrelid::regclass AS tbl, tgfoid::regprocedure AS fn, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('set_registrations_published_at', 'trg_user_discount_allowances_updated_at');
```

Direct calls must now fail (expect `permission denied for function ...`; before
the migration they failed with "trigger functions can only be called as
triggers"):

```sql
SET ROLE anon;          SELECT public.set_registration_published_at();
RESET ROLE;
SET ROLE authenticated; SELECT public.update_user_discount_allowances_updated_at();
RESET ROLE;
```

## Run against a scratch database before this PR was opened

The migration was **not** applied to dev, prod or any Supabase project. It was
run against an in-memory scratch PostgreSQL 17 (PGlite) holding the two tables,
the two functions (verbatim from the baseline, plus the `search_path` setting)
and the two triggers, with EXECUTE granted to anon/authenticated/service_role
first to mirror the state InfoSec reported:

- Before: anon/authenticated/service_role all `true`, one PUBLIC grant each.
- After: anon `false`, authenticated `false`, service_role `true`, 0 PUBLIC grants.
- Second run of the migration: no error (re-runnable).
- After the revoke, INSERT on `registrations` and INSERT/UPDATE on
  `user_discount_allowances` as `anon`, `authenticated` and `service_role` all
  fired the triggers (`published_at` set, `updated_at` advanced).
- Direct `SELECT` of either function as anon / authenticated:
  `permission denied for function ...`.

Re-run the verification SQL on dev after the "Apply database migrations"
workflow has applied it there; that confirms the real Supabase ACLs.
