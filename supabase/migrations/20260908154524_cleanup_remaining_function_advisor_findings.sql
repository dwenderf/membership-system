-- =============================================================================
-- Clean up the remaining findings from #291 (follow-up to #289 / #290)
-- =============================================================================
--
-- Supabase's advisor still lists four SECURITY DEFINER functions as callable
-- by anon/authenticated after 20260907000002_revoke_public_function_access.sql.
-- #291 investigated all four plus two additional anon-executable functions the
-- advisor doesn't surface (0028/0029 only report SECURITY DEFINER functions),
-- and confirmed none is currently exploitable. Two real items came out of that
-- investigation, handled here:
--
--   1. notify_payment_completion() is dead code: SECURITY DEFINER, anon/
--      authenticated executable, and attached to zero triggers (confirmed
--      against pg_trigger on both projects). Drop it.
--
--   2. set_registration_published_at() and
--      update_user_discount_allowances_updated_at() have a mutable
--      search_path (lint 0011), unlike every other function in `public`. Set
--      it explicitly.
--
-- Separately, this migration also revokes anon/authenticated EXECUTE on
-- update_updated_at_column() and set_member_id_on_insert() -- the two
-- remaining SECURITY DEFINER trigger functions besides is_admin_user(). The
-- prior migration left these alone out of caution that PostgreSQL might
-- re-check EXECUTE when a trigger fires. Verified on membership-system-dev
-- that this concern doesn't hold: PostgreSQL only checks EXECUTE on a trigger
-- function at CREATE TRIGGER time, not when the trigger fires, so revoking it
-- here does not affect any of the 8 existing triggers using these two
-- functions (tested with a real UPDATE as the `authenticated` role inside a
-- rolled-back transaction, with the grant already revoked -- the trigger
-- still fired and updated_at still changed).
--
-- is_admin_user() is deliberately left untouched. It is referenced by the
-- "Admins can view all users" RLS policy on public.users (`TO public`), and
-- RLS policy expressions are evaluated as the querying role -- revoking
-- EXECUTE there would turn every anon/authenticated read of public.users
-- into "permission denied for function is_admin_user".
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Drop the dead-code trigger function
-- -----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.notify_payment_completion();


-- -----------------------------------------------------------------------------
-- 2. Set a fixed search_path on the two functions missing one
-- -----------------------------------------------------------------------------

ALTER FUNCTION public.set_registration_published_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_user_discount_allowances_updated_at() SET search_path = public, pg_temp;


-- -----------------------------------------------------------------------------
-- 3. Revoke anon/authenticated EXECUTE on the remaining trigger functions
-- -----------------------------------------------------------------------------
-- set_member_id_on_insert() and update_updated_at_column() cannot be invoked
-- directly anyway ("trigger functions can only be called as triggers"), but
-- removing the grant clears the advisor lint for both and matches the intent
-- of the original revoke migration.

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_member_id_on_insert() FROM PUBLIC, anon, authenticated;
