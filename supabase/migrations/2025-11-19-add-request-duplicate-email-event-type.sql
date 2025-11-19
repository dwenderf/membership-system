-- Add missing 'request_duplicate_email' event type to email_change_logs constraint
-- This event type is used when a user tries to change to an email that already exists

-- Drop the old constraint
ALTER TABLE email_change_logs
  DROP CONSTRAINT IF EXISTS email_change_logs_event_type_check;

-- Add the new constraint with the missing event type
ALTER TABLE email_change_logs
  ADD CONSTRAINT email_change_logs_event_type_check
  CHECK (event_type IN (
    'request_created',
    'request_failed',
    'request_duplicate_email',
    'verification_sent',
    'email_updated',
    'email_update_failed',
    'xero_sync_succeeded',
    'xero_sync_failed',
    'rate_limit_hit'
  ));

COMMENT ON CONSTRAINT email_change_logs_event_type_check ON email_change_logs IS
  'Validates event_type values including request_duplicate_email for duplicate email attempts';
