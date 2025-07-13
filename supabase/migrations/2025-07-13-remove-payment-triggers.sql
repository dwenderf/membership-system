-- Remove payment completion triggers
-- Moving to synchronous staging approach instead of async triggers

-- Drop payment completion triggers
DROP TRIGGER IF EXISTS payment_completed_trigger ON payments;
DROP TRIGGER IF EXISTS payment_inserted_completed_trigger ON payments;

-- Drop membership and registration triggers as well
DROP TRIGGER IF EXISTS membership_completed_trigger ON user_memberships;
DROP TRIGGER IF EXISTS registration_completed_trigger ON user_registrations;

-- Keep the notification functions for now (might be useful later)
-- but they won't be triggered automatically

COMMENT ON FUNCTION notify_payment_completion() IS 'Function kept for manual triggering if needed - no longer auto-triggered';