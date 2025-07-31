-- Add 'failed' status to email_logs table check constraint
-- This allows emails to be marked as 'failed' when sending errors occur (not bounces)

-- Drop the existing check constraint
ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;

-- Add the new check constraint that includes 'failed'
ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check 
  CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'spam', 'failed'));