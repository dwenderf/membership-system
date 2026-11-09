-- =============================================================================
-- Server-side writes for users and the payment / registration tables
-- =============================================================================
--
-- Moves member-row writes on these tables behind the server. The signed-in
-- browser client keeps SELECT (RLS decides which rows) and, on public.users, an
-- UPDATE limited to the profile fields the account page edits. Every other
-- write goes through server routes that check the session first and then use
-- the service-role client (createAdminClient), which this file leaves alone.
--
-- public.users
--   * anon and authenticated lose table-wide INSERT and UPDATE.
--   * authenticated gets UPDATE on (first_name, last_name, is_goalie, is_lgbtq,
--     updated_at) only: what src/app/(user)/user/account/edit/page.tsx writes.
--     Onboarding, preferences, email sync and the admin toggle now write with
--     the service role from server code.
--   * The own-row INSERT policy is dropped (onboarding inserts server-side). The
--     own-row UPDATE policy is recreated for authenticated with a WITH CHECK.
--   * A BEFORE INSERT OR UPDATE trigger rejects changes to account, billing and
--     role columns when the statement runs as anon or authenticated. service_role
--     and postgres (migrations, SQL editor) are not affected.
--
-- public.user_memberships, public.user_registrations, public.payments
--   * The own-row INSERT / UPDATE policies are dropped. Payment state is written
--     only by server code: the Stripe webhook, the confirm-*-payment routes
--     (after they retrieve a succeeded PaymentIntent from Stripe), the zero-cost
--     flows and admin tools.
--   * authenticated also loses table-level INSERT and UPDATE (SELECT stays).
--     Admin UI that still wrote through the signed-in client must use
--     createAdminClient() after its admin check.
--   * Own-row SELECT policies and the admin policies are unchanged (admin
--     policies alone are not enough without the table grant).
--
-- public.waitlists, public.user_alternate_registrations
--   * The own-row INSERT / UPDATE policies are dropped; /api/join-waitlist and
--     /api/user-alternate-registrations insert and update with the service role
--     after validating the request. Own-row SELECT, own-row DELETE on
--     user_alternate_registrations, and the admin / captain policies stay.
--   * authenticated also loses table-level INSERT and UPDATE on both; DELETE
--     on user_alternate_registrations is kept for the own-row delete path.
--
-- anon
--   * Loses INSERT, UPDATE and DELETE on all six tables. No anon code path
--     writes them, and no policy let it.
--
-- Nothing here drops a table, column or row. Re-runnable: REVOKE of a privilege
-- that is not held is a no-op, policies use DROP ... IF EXISTS, the function is
-- CREATE OR REPLACE and the trigger is dropped before it is created.
--
-- Rollback (restores the previous access; only if a write path was missed):
--   GRANT INSERT, UPDATE ON public.users TO anon, authenticated;
--   GRANT INSERT, UPDATE ON public.user_memberships, public.user_registrations,
--     public.payments, public.waitlists, public.user_alternate_registrations
--     TO authenticated;
--   GRANT INSERT, UPDATE, DELETE ON public.users, public.user_memberships,
--     public.user_registrations, public.payments, public.waitlists,
--     public.user_alternate_registrations TO anon;
--   DROP TRIGGER IF EXISTS guard_users_protected_columns ON public.users;
--   and recreate the dropped policies from 20260907000000_baseline_schema.sql.

-- users -----------------------------------------------------------------------

REVOKE INSERT, UPDATE ON public.users FROM anon, authenticated;
GRANT UPDATE (first_name, last_name, is_goalie, is_lgbtq, updated_at) ON public.users TO authenticated;

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;

DROP POLICY IF EXISTS "Users can update their own profile" ON public.users;
CREATE POLICY "Users can update their own profile" ON public.users FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.guard_users_protected_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    -- Only the API roles are restricted. Server code (service_role) and
    -- migrations (postgres) may set any column.
    IF current_user NOT IN ('anon', 'authenticated') THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF coalesce(NEW.is_admin, false)
           OR coalesce(NEW.payment_plan_enabled, false)
           OR NEW.member_id IS NOT NULL
           OR NEW.deleted_at IS NOT NULL
           OR NEW.stripe_customer_id IS NOT NULL
           OR NEW.stripe_payment_method_id IS NOT NULL
           OR NEW.stripe_setup_intent_id IS NOT NULL
           OR NEW.setup_intent_status IS NOT NULL
           OR NEW.payment_method_updated_at IS NOT NULL
           OR coalesce(cardinality(NEW.tags), 0) > 0 THEN
            RAISE EXCEPTION 'protected users columns can only be set by the server'
                USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
       OR NEW.payment_plan_enabled IS DISTINCT FROM OLD.payment_plan_enabled
       OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id
       OR NEW.stripe_payment_method_id IS DISTINCT FROM OLD.stripe_payment_method_id
       OR NEW.stripe_setup_intent_id IS DISTINCT FROM OLD.stripe_setup_intent_id
       OR NEW.setup_intent_status IS DISTINCT FROM OLD.setup_intent_status
       OR NEW.payment_method_updated_at IS DISTINCT FROM OLD.payment_method_updated_at
       OR NEW.tags IS DISTINCT FROM OLD.tags
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'protected users columns can only be changed by the server'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

-- Trigger functions are not callable over RPC, and EXECUTE is only checked when
-- the trigger is created, so no API role needs it.
REVOKE EXECUTE ON FUNCTION public.guard_users_protected_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_users_protected_columns() TO service_role;

-- Named to sort before set_member_id_trigger, so it sees the member_id the
-- caller supplied rather than the one that trigger assigns.
DROP TRIGGER IF EXISTS guard_users_protected_columns ON public.users;
CREATE TRIGGER guard_users_protected_columns
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_users_protected_columns();

-- user_memberships / user_registrations / payments --------------------------------

DROP POLICY IF EXISTS "Users can insert their own memberships" ON public.user_memberships;
DROP POLICY IF EXISTS "Users can update their own memberships" ON public.user_memberships;

DROP POLICY IF EXISTS "Users can insert their own registrations" ON public.user_registrations;

DROP POLICY IF EXISTS "Users can insert their own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can update their own payments" ON public.payments;

-- waitlists / user_alternate_registrations ----------------------------------------

DROP POLICY IF EXISTS "Users can join waitlists" ON public.waitlists;
DROP POLICY IF EXISTS "Users can update their own waitlist entries" ON public.waitlists;

DROP POLICY IF EXISTS "Users can insert their own alternate registrations" ON public.user_alternate_registrations;
DROP POLICY IF EXISTS "Users can update their own alternate registrations" ON public.user_alternate_registrations;

-- anon --------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE ON
    public.users,
    public.user_memberships,
    public.user_registrations,
    public.payments,
    public.waitlists,
    public.user_alternate_registrations
FROM anon;

-- authenticated: table-level INSERT/UPDATE gone on payment/registration
-- tables. SELECT stays (RLS decides rows). DELETE stays on
-- user_alternate_registrations for the own-row delete path. Writes go through
-- createAdminClient() after a session check.
REVOKE INSERT, UPDATE ON
    public.user_memberships,
    public.user_registrations,
    public.payments,
    public.waitlists,
    public.user_alternate_registrations
FROM authenticated;
