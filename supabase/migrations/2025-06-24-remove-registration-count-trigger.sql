-- Remove obsolete registration count trigger and function
-- These were trying to update a current_count column that no longer exists
-- Registration counts are now calculated dynamically

DROP TRIGGER IF EXISTS update_registration_count_trigger ON user_registrations;
DROP FUNCTION IF EXISTS update_registration_count();