-- Central append-only log of policy-bundle acceptance events (Terms & Conditions,
-- Privacy Policy, Code of Conduct, Concussion Policy). One row per acceptance,
-- from every path that requires it (onboarding, membership purchase,
-- registration, alternate-registration, waitlist join, ...) so no future path
-- is silently missed the way per-table columns would be.
CREATE TABLE IF NOT EXISTS public.policy_acceptance_logs (
    id uuid DEFAULT uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    CONSTRAINT policy_acceptance_logs_pkey PRIMARY KEY (id),
    CONSTRAINT policy_acceptance_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_policy_acceptance_logs_user_id ON public.policy_acceptance_logs(user_id);
-- Matches the indexed-sort-column pattern used by every other log table
-- (idx_system_events_completed_at, idx_xero_sync_logs_created_at, ...):
-- /api/admin/logs sorts this table by accepted_at DESC with a limit.
CREATE INDEX IF NOT EXISTS idx_policy_acceptance_logs_accepted_at ON public.policy_acceptance_logs(accepted_at);

ALTER TABLE public.policy_acceptance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read policy acceptance logs" ON public.policy_acceptance_logs;
CREATE POLICY "Admins can read policy acceptance logs" ON public.policy_acceptance_logs FOR SELECT TO public
  USING ((EXISTS ( SELECT 1 FROM users WHERE users.id = auth.uid() AND users.is_admin = true)));

DROP POLICY IF EXISTS "Service role can manage policy acceptance logs" ON public.policy_acceptance_logs;
CREATE POLICY "Service role can manage policy acceptance logs" ON public.policy_acceptance_logs FOR ALL TO public
  USING (auth.role() = 'service_role'::text);

-- Backfill: preserve the one historical acceptance signal we already had
-- (onboarding's terms_accepted_at) as a log row, before dropping the column
-- it lived on. Guarded twice: NOT EXISTS so a re-run doesn't double-insert,
-- and an information_schema check so the INSERT (which references a column
-- this same migration drops below) is never even planned once that column
-- is gone on a later re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'terms_accepted_at'
  ) THEN
    INSERT INTO public.policy_acceptance_logs (user_id, accepted_at, source)
    SELECT u.id, u.terms_accepted_at, 'onboarding'
    FROM public.users u
    WHERE u.terms_accepted_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.policy_acceptance_logs pal
        WHERE pal.user_id = u.id AND pal.source = 'onboarding'
      );
  END IF;
END $$;

COMMENT ON COLUMN public.users.onboarding_completed_at IS 'Also marks the user''s initial acceptance of the policy bundle (Terms, Privacy Policy, Code of Conduct, Concussion Policy) in effect at signup. See policy_acceptance_logs for the full history, including onboarding and every later purchase/registration/alternate/waitlist acceptance.';

-- terms_accepted_at was identical to onboarding_completed_at for all but a
-- handful of users (off by ~1ms), and terms_version has been the literal
-- string 'v1.0' for every user since the column existed. Both are superseded
-- by policy_acceptance_logs above.
ALTER TABLE public.users
    DROP COLUMN IF EXISTS terms_accepted_at,
    DROP COLUMN IF EXISTS terms_version;
