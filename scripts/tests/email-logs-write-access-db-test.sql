-- DB-level checks for email_logs write access, run by
-- scripts/verify-schema-applies.sh against the throwaway database. Everything
-- runs in one transaction that is rolled back.
--
--   * anon and authenticated cannot insert email_logs rows (so cannot add rows
--     for the email cron to pick up), nor update or delete them;
--   * a member can still read their own rows;
--   * an admin session can read all rows but cannot insert, update or delete;
--   * service_role writes are unaffected.
BEGIN;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

INSERT INTO public.users (id, email, first_name, last_name)
VALUES ('00000000-0000-4000-8000-000000000011', 'member@example.test', 'Pat', 'Member');
INSERT INTO public.users (id, email, first_name, last_name, is_admin)
VALUES ('00000000-0000-4000-8000-000000000012', 'admin@example.test', 'Ada', 'Admin', true);
INSERT INTO public.email_logs (id, user_id, email_address, event_type, subject, status)
VALUES ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-000000000011', 'member@example.test', 'test', 'Existing', 'sent');
INSERT INTO public.email_logs (id, user_id, email_address, event_type, subject, status)
VALUES ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000012', 'admin@example.test', 'test', 'AdminOwn', 'sent');

CREATE FUNCTION pg_temp.expect_denied(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'expected permission denied: %', label;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_denied(text, text) TO anon, authenticated, service_role;

-- anon -------------------------------------------------------------------------
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM pg_temp.expect_denied('anon insert', $s$INSERT INTO public.email_logs (user_id, email_address, event_type, subject, status) VALUES ('00000000-0000-4000-8000-000000000011', 'x@example.test', 'test', 'Hi', 'pending')$s$);
  PERFORM pg_temp.expect_denied('anon update', $s$UPDATE public.email_logs SET status = 'pending'$s$);
  PERFORM pg_temp.expect_denied('anon delete', $s$DELETE FROM public.email_logs$s$);
END $$;
RESET ROLE;

-- authenticated (signed-in member) ---------------------------------------------------
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true); END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  PERFORM pg_temp.expect_denied('authenticated insert', $s$INSERT INTO public.email_logs (user_id, email_address, event_type, subject, status) VALUES (auth.uid(), 'x@example.test', 'test', 'Hi', 'pending')$s$);
  PERFORM pg_temp.expect_denied('authenticated update', $s$UPDATE public.email_logs SET status = 'pending' WHERE user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('authenticated delete', $s$DELETE FROM public.email_logs WHERE user_id = auth.uid()$s$);
  SELECT count(*) INTO n FROM public.email_logs WHERE user_id = auth.uid();
  IF n <> 1 THEN
    RAISE EXCEPTION 'member cannot read their own email_logs row (saw %)', n;
  END IF;
END $$;
RESET ROLE;

-- authenticated (signed-in admin): SELECT ok, writes denied --------------------------
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true); END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.email_logs;
  IF n < 2 THEN
    RAISE EXCEPTION 'admin cannot read email_logs rows (saw %)', n;
  END IF;
  PERFORM pg_temp.expect_denied('admin insert', $s$INSERT INTO public.email_logs (user_id, email_address, event_type, subject, status) VALUES (auth.uid(), 'a@example.test', 'test', 'Nope', 'pending')$s$);
  PERFORM pg_temp.expect_denied('admin update', $s$UPDATE public.email_logs SET status = 'pending' WHERE user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('admin delete', $s$DELETE FROM public.email_logs WHERE user_id = auth.uid()$s$);
END $$;
RESET ROLE;

-- No permissive write policy may remain on email_logs.
-- The admin policy must be SELECT-only (not FOR ALL / INSERT / UPDATE / DELETE).
DO $$
DECLARE bad text;
DECLARE admin_cmd text;
BEGIN
  SELECT string_agg(policyname, '; ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'email_logs'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND (coalesce(qual, '') = 'true' OR coalesce(with_check, '') = 'true'
          OR policyname = 'Admins can view all email logs');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'permissive or non-SELECT email_logs write policies remain: %', bad;
  END IF;

  SELECT cmd INTO admin_cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'email_logs'
     AND policyname = 'Admins can view all email logs';
  IF admin_cmd IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'Admins can view all email logs must be SELECT (saw %)', admin_cmd;
  END IF;
END $$;

-- service_role: unaffected. On Supabase service_role has BYPASSRLS; the CI
-- stub role does not, so give it that for this (rolled-back) transaction.
ALTER ROLE service_role BYPASSRLS;
SET LOCAL ROLE service_role;
INSERT INTO public.email_logs (user_id, email_address, event_type, subject, status)
VALUES ('00000000-0000-4000-8000-000000000011', 'member@example.test', 'test', 'Server', 'pending');
UPDATE public.email_logs SET status = 'sent' WHERE subject = 'Server';
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'OK: email_logs writes are server-only'; END $$;
ROLLBACK;
