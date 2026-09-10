-- =============================================================================
-- Least-privilege read-only role for CI drift/posture checks (#290 Part 1)
-- =============================================================================
--
-- db-drift-check.yml currently runs with the same admin SUPABASE_DB_URL as
-- db-migrate.yml, sourced from the `supabase-production` Environment, which
-- now carries a required reviewer. A read-only status check has no decision
-- for a reviewer to make, so it inherits an approval gate that just makes it
-- silently pend forever instead of reporting -- the exact condition it exists
-- to catch (production behind on migrations) now produces the same silence as
-- everything being fine.
--
-- The fix is a dedicated role, not a copy of the admin connection string into
-- an ungated environment: that would forfeit the real benefit of the gate,
-- which is that an unapproved change to a gated workflow can't exfiltrate the
-- production credential. This role can read migration history and nothing
-- else, so a leaked credential for it exposes a list of version numbers.
--
-- This migration only creates the role and grants; the password is set
-- out-of-band (never here -- it would land in git and in schema.sql) and the
-- new `supabase-production-readonly` GitHub Environment/secret is manual
-- setup. See README "Database Migrations" for both steps.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ci_readonly') THEN
    CREATE ROLE ci_readonly LOGIN;
  END IF;
END $$;

-- No membership in anon/authenticated, and never BYPASSRLS: this role is a
-- CI credential, not an application identity.
GRANT USAGE ON SCHEMA supabase_migrations TO ci_readonly;
GRANT SELECT ON supabase_migrations.schema_migrations TO ci_readonly;
