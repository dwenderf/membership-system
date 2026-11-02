-- Explicit table, view, sequence and function grants for the `public` schema.
--
-- WHY: from 2026-10-30 Supabase no longer grants anon / authenticated /
-- service_role anything on new objects in `public` (default privileges are not
-- applied any more; https://github.com/orgs/supabase/discussions/45329). A
-- table without an explicit GRANT answers 42501 "permission denied" before RLS
-- is even consulted. Every object below predates that change, so the baseline
-- (20260907000000) and the later table/view migrations carry no GRANTs: they
-- relied on the default privileges, which a rebuild from migrations -- a
-- scratch database, a new dev project, `supabase db reset` -- no longer gets.
--
-- WHAT: this file writes down the privileges production and development have
-- TODAY. Both were read read-only on 2026-11-02 (pg_class.relacl via
-- aclexplode) and were identical apart from MAINTAIN, see below:
--   * 39 tables   -> anon, authenticated, service_role:
--                    SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   * 8 views     -> the same privileges for the same three roles
--   * 1 view      -> payment_plan_summary: service_role only (anon and
--                    authenticated hold nothing on it, in either project)
--   * 1 sequence  -> member_id_seq: USAGE, SELECT, UPDATE for the three roles
--   * 4 functions -> service_role: EXECUTE on the four SECURITY DEFINER
--                    functions the app calls through .rpc() with
--                    createAdminClient (see FUNCTIONS below)
--
-- FUNCTIONS: the same change drops the default grants on functions. Since
-- 20260907000002 revoked EXECUTE from PUBLIC, service_role only holds EXECUTE on
-- these four through the old default grant (service_role=X on both live
-- projects), which a rebuild no longer gets: the Xero batch sync
-- (src/lib/xero/batch-sync-xero.ts) and the two admin security routes
-- (auth-logs, oauth-mismatches) would answer 42501. Only service_role is
-- granted; anon and authenticated stay without EXECUTE. The other functions in
-- public (generate_member_id, set_member_id_on_insert, update_updated_at_column,
-- set_registration_published_at, update_user_discount_allowances_updated_at)
-- are trigger/internal functions the app never calls over RPC, so they are
-- left alone; is_admin_user() keeps its existing PUBLIC EXECUTE.
--
-- Against production and development this migration changes nothing: every
-- statement re-states a privilege that is already held, and the one REVOKE
-- removes a privilege that is not held.
--
-- NOT LEAST PRIVILEGE. These are Supabase's old defaults, i.e. wider than the
-- app needs: RLS gates SELECT / INSERT / UPDATE / DELETE, but TRUNCATE,
-- REFERENCES and TRIGGER are not subject to it. Narrowing them is a separate,
-- deliberate change (it needs an audit of which tables the browser client
-- touches as `authenticated`, and nothing here pre-empts it). New objects must
-- NOT copy this list; they get the minimum their access path needs (AGENTS.md,
-- "Grants on new tables, views and sequences").
--
-- MAINTAIN (Postgres 17) is deliberately left out: production holds it through
-- its default ACL, development does not, nothing in the app uses it, and
-- leaving it out lets this file say the same thing on both.
--
-- The REVOKE on payment_plan_summary is the only revoke in the file. It is a
-- no-op on the live projects; it exists so a rebuild on a server that still
-- applies the old default privileges ends up service_role-only like live,
-- instead of handing anon and authenticated an aggregate over xero_payments.
-- (The view is security_invoker, so RLS on xero_payments would also hold, but
-- the grant is the first line.)
--
-- Re-runnable: GRANT and REVOKE are idempotent. Rollback: not needed; revoking
-- these would break the app.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE
    public.access_code_usage,
    public.access_codes,
    public.alternate_registrations,
    public.alternate_selections,
    public.categories,
    public.discount_categories,
    public.discount_codes,
    public.discount_usage,
    public.email_change_logs,
    public.email_logs,
    public.login_attempts,
    public.magic_link_tokens,
    public.memberships,
    public.payment_configurations,
    public.payments,
    public.policy_acceptance_logs,
    public.refunds,
    public.registration_captains,
    public.registration_categories,
    public.registration_pricing_tiers,
    public.registrations,
    public.seasons,
    public.system_accounting_codes,
    public.system_events,
    public.user_alternate_registrations,
    public.user_discount_allowances,
    public.user_memberships,
    public.user_registrations,
    public.user_survey_responses,
    public.users,
    public.waitlists,
    public.xero_accounts,
    public.xero_contacts,
    public.xero_invoice_line_items,
    public.xero_invoices,
    public.xero_oauth_tokens,
    public.xero_payments,
    public.xero_sync_logs,
    public.xero_webhooks
TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE
    public.discount_usage_computed,
    public.membership_analytics_data,
    public.membership_reports_data,
    public.recent_transactions,
    public.registration_reports_data,
    public.reports_active_memberships,
    public.reports_financial_data,
    public.user_memberships_consolidated
TO anon, authenticated, service_role;

-- Service-role only, as in production and development.
REVOKE ALL ON TABLE public.payment_plan_summary FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.payment_plan_summary
TO service_role;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.member_id_seq
TO anon, authenticated, service_role;

-- FUNCTIONS (exact signatures, as in pg_proc on production and development).
GRANT EXECUTE ON FUNCTION public.get_auth_audit_logs(uuid, integer, integer, timestamp with time zone, timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_oauth_email_mismatches() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_xero_invoices_with_lock(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_pending_xero_payments_with_lock(integer) TO service_role;
