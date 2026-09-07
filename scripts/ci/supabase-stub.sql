-- Minimal stand-in for the Supabase-managed objects that supabase/schema.sql
-- assumes already exist. Used only to verify that the schema applies cleanly
-- against a plain PostgreSQL server (see scripts/verify-schema-applies.sh).
--
-- This is NOT a model of Supabase's auth system -- just enough for the RLS
-- policies and functions in schema.sql to be creatable.

-- Roles are cluster-wide, so they may already exist from an earlier run.
DO $$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
    END LOOP;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY,
    email text,
    raw_user_meta_data jsonb,
    raw_app_meta_data jsonb,
    last_sign_in_at timestamptz,
    deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
    id uuid PRIMARY KEY,
    created_at timestamptz,
    ip_address text,
    payload json
);
