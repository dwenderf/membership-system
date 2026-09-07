-- =============================================================================
-- Remove ad-hoc data-export functions and close the anon RPC hole
-- =============================================================================
--
-- Supabase exposes every function in `public` as a REST endpoint at
-- /rest/v1/rpc/<name>, and Supabase's default privileges grant EXECUTE on new
-- functions to `anon` and `authenticated` automatically. A SECURITY DEFINER
-- function runs as its owner and therefore ignores RLS, so any such function
-- created in `public` is readable by anyone holding the (public) anon key.
--
-- Three hand-written export helpers had accumulated in production this way --
-- get_users_data(), get_full_data() and get_current_data(), each still carrying
-- a "-- paste your SQL query here" line. Between them they returned every
-- member's first name, last name, email, member_id and membership expiry to
-- unauthenticated callers. They are referenced nowhere in the application.
--
-- This migration:
--   1. drops those three functions
--   2. revokes anon/authenticated EXECUTE on the functions that only the
--      service role should ever call
--   3. stops new functions from being granted to anon/authenticated by default
--
-- After applying, Supabase's Security Advisor should no longer report
-- 0028_anon_security_definer_function_executable for anything except the
-- functions listed under "deliberately left executable" below.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the ad-hoc export functions
-- -----------------------------------------------------------------------------
-- If someone still needs these numbers, the reporting views (which are
-- security_invoker and therefore respect RLS) already cover them, and an admin
-- API route is the supported way to export.

DROP FUNCTION IF EXISTS public.get_users_data();
DROP FUNCTION IF EXISTS public.get_full_data();
DROP FUNCTION IF EXISTS public.get_current_data();


-- -----------------------------------------------------------------------------
-- 2. Revoke EXECUTE where only the service role should be calling
-- -----------------------------------------------------------------------------
-- Every .rpc() call in the application uses createAdminClient (service_role),
-- so nothing in the app loses access here. service_role keeps EXECUTE; it also
-- bypasses RLS by design and is only ever used server-side.

REVOKE EXECUTE ON FUNCTION public.get_auth_audit_logs(uuid, integer, integer, timestamp with time zone, timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_oauth_email_mismatches() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_xero_invoices_with_lock(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pending_xero_payments_with_lock(integer) FROM PUBLIC, anon, authenticated;

-- Not called from the application at all; it exists for set_member_id_on_insert,
-- which is SECURITY DEFINER and so calls it as the owner. Leaving it exposed
-- lets an anonymous caller burn member_id sequence values.
REVOKE EXECUTE ON FUNCTION public.generate_member_id() FROM PUBLIC, anon, authenticated;

-- Deliberately left executable by anon/authenticated:
--
--   is_admin_user()   -- referenced by the "Admins can view all users" policy on
--                        public.users. RLS policy expressions are evaluated as
--                        the querying role, so that role needs EXECUTE or every
--                        read of public.users fails.
--
--   update_updated_at_column(), set_member_id_on_insert(),
--   set_registration_published_at(), notify_payment_completion(),
--   update_user_discount_allowances_updated_at()
--                     -- trigger functions. Calling one over RPC raises
--                        "trigger functions can only be called as triggers",
--                        so the exposure is inert, and revoking EXECUTE risks
--                        breaking ordinary INSERT/UPDATE traffic if PostgreSQL
--                        re-checks the privilege when the trigger fires. Not
--                        worth the risk for no gain. Supabase's advisor will
--                        keep listing these; that is expected.


-- -----------------------------------------------------------------------------
-- 3. Stop granting EXECUTE on new functions automatically
-- -----------------------------------------------------------------------------
-- This is the control that would have prevented the original mistake: a
-- function created in `public` from the SQL editor is no longer reachable over
-- the REST API unless someone explicitly grants it.
--
-- Existing functions are unaffected (default privileges apply only to objects
-- created afterwards), so nothing changes for the running application.
--
-- A future function that genuinely needs to be callable from the browser must
-- now say so out loud, in its own migration:
--
--   GRANT EXECUTE ON FUNCTION public.my_function(...) TO authenticated;
--
-- Scope limit: default privileges are per-grantor. This covers objects created
-- by `postgres`, which is the role the Supabase SQL editor and the CLI use. It
-- does not cover `supabase_admin`, whose default privileges we cannot alter.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
