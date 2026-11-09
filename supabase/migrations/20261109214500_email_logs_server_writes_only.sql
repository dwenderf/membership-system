-- =============================================================================
-- email_logs: writes from the server only
-- =============================================================================
--
-- email_logs rows are created and updated only by server code using the
-- service-role client (src/lib/email/service.ts, staging.ts, processor.ts,
-- batch-sync-email.ts, the admin sync route and the daily housekeeping cron).
-- The API roles keep SELECT so the existing own-row and admin read policies
-- still work; they lose INSERT, UPDATE and DELETE.
--
--   * Drops the "System can insert email logs" and "System can update email
--     logs" policies. service_role bypasses RLS and does not need them.
--   * Revokes INSERT, UPDATE, DELETE on public.email_logs from anon and
--     authenticated. SELECT is unchanged.
--   * "Users can view their own email logs" and "Admins can view all email
--     logs" are unchanged.
--
-- Nothing is dropped except the two policies. Re-runnable: DROP POLICY IF
-- EXISTS, and REVOKE of a privilege that is not held is a no-op.
--
-- Rollback (restores the previous access):
--   GRANT INSERT, UPDATE, DELETE ON public.email_logs TO anon, authenticated;
--   CREATE POLICY "System can insert email logs" ON public.email_logs
--     FOR INSERT TO public WITH CHECK (true);
--   CREATE POLICY "System can update email logs" ON public.email_logs
--     FOR UPDATE TO public USING (true);

DROP POLICY IF EXISTS "System can insert email logs" ON public.email_logs;
DROP POLICY IF EXISTS "System can update email logs" ON public.email_logs;

REVOKE INSERT, UPDATE, DELETE ON public.email_logs FROM anon, authenticated;
