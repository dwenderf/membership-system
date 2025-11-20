-- Add INSERT policy for email_change_logs table
-- This was missing from the original migration, preventing API routes from logging events

-- Users can insert their own email change logs
CREATE POLICY "Users can insert own email change logs"
  ON email_change_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Service role can insert any logs (for server-side API operations)
-- Note: This policy only applies when using authenticated role, not service_role
-- Service role bypasses RLS by default, but this policy helps document intent

COMMENT ON POLICY "Users can insert own email change logs" ON email_change_logs IS
  'Allows authenticated users to log their own email change events via API routes';
