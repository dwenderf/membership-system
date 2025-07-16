-- Add 'pending' status to email_logs table check constraint
-- This allows emails to be staged with 'pending' status before being sent

-- Drop the existing check constraint
ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_status_check;

-- Add the new check constraint that includes 'pending'
ALTER TABLE email_logs ADD CONSTRAINT email_logs_status_check 
  CHECK (status IN ('pending', 'sent', 'delivered', 'bounced', 'spam'));

-- Update the default status to 'pending' for new staged emails
ALTER TABLE email_logs ALTER COLUMN status SET DEFAULT 'pending'; 