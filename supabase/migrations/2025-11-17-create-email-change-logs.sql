-- Audit log for all email change activity
CREATE TABLE email_change_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_email TEXT NOT NULL,
  new_email TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'request_created',
    'request_failed',
    'verification_sent',
    'email_updated',
    'email_update_failed',
    'xero_sync_succeeded',
    'xero_sync_failed',
    'rate_limit_hit'
  )),
  metadata JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for user audit history
CREATE INDEX idx_email_change_logs_user_created
  ON email_change_logs(user_id, created_at DESC);

-- Index for monitoring failed attempts
CREATE INDEX idx_email_change_logs_failures
  ON email_change_logs(event_type, created_at DESC)
  WHERE event_type LIKE '%failed%';

-- RLS Policies
ALTER TABLE email_change_logs ENABLE ROW LEVEL SECURITY;

-- Users can view their own logs
CREATE POLICY "Users can view own email change logs"
  ON email_change_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admins can view all logs
CREATE POLICY "Admins can view all email change logs"
  ON email_change_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

COMMENT ON TABLE email_change_logs IS
  'Audit trail for all email change activity. Append-only via API.';
