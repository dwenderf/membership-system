-- DB-level checks for member write access on users and the payment /
-- registration tables, run by scripts/verify-schema-applies.sh against the
-- throwaway database. Everything runs in one transaction that is rolled back.
--
--   * a signed-in member can update their own profile fields;
--   * a signed-in member cannot change role, billing or account columns on
--     their own users row (column grants, and the guard trigger behind them);
--   * a signed-in member cannot insert their own users row, or write their own
--     payments, memberships, registrations, waitlist or alternate rows
--     (table grants revoked: INSERT/UPDATE raise 42501);
--   * a signed-in member UPDATE that sets payment/registration status to
--     paid/completed on their own existing rows raises 42501;
--   * an admin signed in as authenticated also cannot INSERT/UPDATE those
--     tables without the table grant (use createAdminClient / service_role);
--   * service_role writes are unaffected.
BEGIN;

-- The CI stub's auth.uid() always returns NULL. For this transaction only, read
-- the caller from a setting, the way Supabase reads it from the JWT.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

INSERT INTO public.users (id, email, first_name, last_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'member@example.test', 'Pat', 'Member'),
       ('00000000-0000-4000-8000-000000000002', 'admin@example.test', 'Sam', 'Admin');
UPDATE public.users SET is_admin = true WHERE id = '00000000-0000-4000-8000-000000000002';

-- Parent rows so UPDATE checks can target real membership/registration FKs.
INSERT INTO public.memberships (id, name, price_monthly, price_annual)
VALUES ('00000000-0000-4000-8000-000000000011', 'Test Membership', 1000, 10000);
INSERT INTO public.seasons (id, name, type, start_date, end_date)
VALUES ('00000000-0000-4000-8000-000000000012', 'Test Season', 'fall_winter', current_date, current_date + 180);
INSERT INTO public.registrations (id, season_id, name, type)
VALUES ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000012', 'Test Registration', 'scrimmage');

-- Existing unpaid rows the member will try to mark paid/completed.
INSERT INTO public.payments (id, user_id, total_amount, final_amount, status)
VALUES ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000001', 1000, 1000, 'pending');
INSERT INTO public.user_memberships (id, user_id, membership_id, valid_from, valid_until, payment_status)
VALUES ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', current_date, current_date + 30, 'pending');
INSERT INTO public.user_registrations (id, user_id, registration_id, payment_status)
VALUES ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', 'awaiting_payment');
INSERT INTO public.waitlists (id, user_id, registration_id, position)
VALUES ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013', 1);
INSERT INTO public.user_alternate_registrations (id, user_id, registration_id)
VALUES ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000013');

-- Helper: run a statement and require it to fail with SQLSTATE 42501.
CREATE FUNCTION pg_temp.expect_denied(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN;
  END;
  RAISE EXCEPTION 'expected permission denied: %', label;
END $$;

-- Helper: run an UPDATE/DELETE and return how many rows it touched.
CREATE FUNCTION pg_temp.rows_affected(stmt text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_denied(text, text), pg_temp.rows_affected(text) TO anon, authenticated, service_role;

-- Signed-in member ---------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true); END $$;
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  IF pg_temp.rows_affected($s$UPDATE public.users SET first_name = 'Pat2', last_name = 'M', is_goalie = true, is_lgbtq = null, updated_at = now() WHERE id = auth.uid()$s$) <> 1 THEN
    RAISE EXCEPTION 'member could not update their own profile fields';
  END IF;

  PERFORM pg_temp.expect_denied('users.is_admin',             $s$UPDATE public.users SET is_admin = true WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.payment_plan_enabled', $s$UPDATE public.users SET payment_plan_enabled = true WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.stripe_customer_id',   $s$UPDATE public.users SET stripe_customer_id = 'x' WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.member_id',            $s$UPDATE public.users SET member_id = 1 WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.email',                $s$UPDATE public.users SET email = 'other@example.test' WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.deleted_at',           $s$UPDATE public.users SET deleted_at = now() WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users.preferences',          $s$UPDATE public.users SET preferences = '{}' WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('users insert',               $s$INSERT INTO public.users (id, email, first_name, last_name) VALUES (gen_random_uuid(), 'n@example.test', 'N', 'N')$s$);

  PERFORM pg_temp.expect_denied('payments insert', $s$INSERT INTO public.payments (user_id, total_amount, final_amount, status) VALUES (auth.uid(), 0, 0, 'completed')$s$);
  PERFORM pg_temp.expect_denied('user_memberships insert', $s$INSERT INTO public.user_memberships (user_id, membership_id, valid_from, valid_until, payment_status) VALUES (auth.uid(), '00000000-0000-4000-8000-000000000011', current_date, current_date + 30, 'paid')$s$);
  PERFORM pg_temp.expect_denied('user_registrations insert', $s$INSERT INTO public.user_registrations (user_id, registration_id, payment_status) VALUES (auth.uid(), '00000000-0000-4000-8000-000000000013', 'paid')$s$);
  PERFORM pg_temp.expect_denied('waitlists insert', $s$INSERT INTO public.waitlists (user_id, registration_id, position) VALUES (auth.uid(), '00000000-0000-4000-8000-000000000013', 2)$s$);
  PERFORM pg_temp.expect_denied('user_alternate_registrations insert', $s$INSERT INTO public.user_alternate_registrations (user_id, registration_id) VALUES (auth.uid(), gen_random_uuid())$s$);

  -- Existing-row paid/completed updates: table grant revoke makes these 42501
  -- (not 0 rows). Assert that outcome explicitly.
  PERFORM pg_temp.expect_denied('payments update to completed', $s$UPDATE public.payments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000000021' AND user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('user_memberships update to paid', $s$UPDATE public.user_memberships SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-000000000022' AND user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('user_registrations update to paid', $s$UPDATE public.user_registrations SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-000000000023' AND user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('waitlists update', $s$UPDATE public.waitlists SET position = 99 WHERE id = '00000000-0000-4000-8000-000000000024' AND user_id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('user_alternate_registrations update', $s$UPDATE public.user_alternate_registrations SET updated_at = now() WHERE id = '00000000-0000-4000-8000-000000000025' AND user_id = auth.uid()$s$);
END $$;

RESET ROLE;

-- No own-row INSERT/UPDATE policy may remain on these tables: every remaining
-- INSERT/UPDATE/ALL policy must be an admin (or service-role) policy.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(tablename || ': ' || policyname, '; ') INTO bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('users', 'user_memberships', 'user_registrations', 'payments', 'waitlists', 'user_alternate_registrations')
     AND cmd IN ('INSERT', 'UPDATE', 'ALL')
     AND NOT (coalesce(qual, '') || coalesce(with_check, '') ~* '(is_admin|service_role)')
     AND NOT (tablename = 'users' AND policyname = 'Users can update their own profile');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'member write policies remain: %', bad;
  END IF;
END $$;

-- authenticated must not hold table-level INSERT/UPDATE on these five tables.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(table_name || '.' || privilege_type, ', ' ORDER BY table_name, privilege_type) INTO bad
    FROM information_schema.role_table_grants
   WHERE grantee = 'authenticated'
     AND table_schema = 'public'
     AND table_name IN ('payments', 'user_memberships', 'user_registrations', 'waitlists', 'user_alternate_registrations')
     AND privilege_type IN ('INSERT', 'UPDATE');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'authenticated still has INSERT/UPDATE: %', bad;
  END IF;
END $$;

-- The guard trigger on its own: even with a column grant, the API roles cannot
-- change a protected column (this grant is rolled back with the transaction).
GRANT UPDATE (is_admin, stripe_customer_id) ON public.users TO authenticated;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM pg_temp.expect_denied('guard trigger is_admin', $s$UPDATE public.users SET is_admin = true WHERE id = auth.uid()$s$);
  PERFORM pg_temp.expect_denied('guard trigger stripe_customer_id', $s$UPDATE public.users SET stripe_customer_id = 'x' WHERE id = auth.uid()$s$);
END $$;
RESET ROLE;

-- Admin through the signed-in role: table grants are gone, so INSERT/UPDATE on
-- the payment/registration tables raise 42501 even with admin policies.
DO $$ BEGIN PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true); END $$;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM pg_temp.expect_denied('admin authenticated payments insert', $s$INSERT INTO public.payments (user_id, total_amount, final_amount, status) VALUES ('00000000-0000-4000-8000-000000000001', 0, 0, 'pending')$s$);
  PERFORM pg_temp.expect_denied('admin authenticated payments update', $s$UPDATE public.payments SET status = 'cancelled' WHERE id = '00000000-0000-4000-8000-000000000021'$s$);
  PERFORM pg_temp.expect_denied('admin authenticated user_memberships insert', $s$INSERT INTO public.user_memberships (user_id, membership_id, valid_from, valid_until, payment_status) VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', current_date, current_date + 30, 'paid')$s$);
END $$;
RESET ROLE;

-- service_role: unaffected --------------------------------------------------------
SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF pg_temp.rows_affected($s$UPDATE public.users SET is_admin = false, payment_plan_enabled = true, stripe_customer_id = 'cus_test' WHERE id = '00000000-0000-4000-8000-000000000001'$s$) <> 1 THEN
    RAISE EXCEPTION 'service_role could not update protected users columns';
  END IF;
  INSERT INTO public.users (id, email, first_name, last_name)
  VALUES ('00000000-0000-4000-8000-000000000003', 'new@example.test', 'New', 'Member');
  INSERT INTO public.payments (user_id, total_amount, final_amount, status)
  VALUES ('00000000-0000-4000-8000-000000000003', 0, 0, 'completed');
  IF pg_temp.rows_affected($s$UPDATE public.payments SET status = 'completed' WHERE id = '00000000-0000-4000-8000-000000000021'$s$) <> 1 THEN
    RAISE EXCEPTION 'service_role could not update payment status';
  END IF;
  IF pg_temp.rows_affected($s$UPDATE public.user_memberships SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-000000000022'$s$) <> 1 THEN
    RAISE EXCEPTION 'service_role could not update membership payment_status';
  END IF;
  IF pg_temp.rows_affected($s$UPDATE public.user_registrations SET payment_status = 'paid' WHERE id = '00000000-0000-4000-8000-000000000023'$s$) <> 1 THEN
    RAISE EXCEPTION 'service_role could not update registration payment_status';
  END IF;
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE 'OK: member write access on users and payment/registration tables'; END $$;
ROLLBACK;
