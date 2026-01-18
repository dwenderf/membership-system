-- Migration: Add email notifications to registration_captains
-- Description: Adds email_notifications column to allow captains to opt in/out of registration notifications
-- Date: 2026-01-18

-- Add email_notifications column (default TRUE for opt-out model)
ALTER TABLE registration_captains
ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN DEFAULT TRUE;

-- Add index for efficient notification queries
-- Only index rows where notifications are enabled
CREATE INDEX IF NOT EXISTS idx_registration_captains_notifications
ON registration_captains(registration_id, email_notifications)
WHERE email_notifications = TRUE;

-- Add comment to document the column
COMMENT ON COLUMN registration_captains.email_notifications IS
'Whether captain wants email notifications when members register for this team. Default TRUE (opt-out model). Captains can unsubscribe via Loops email link.';
