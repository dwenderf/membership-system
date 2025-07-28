-- Remove annual pricing constraint - handle validation in UI instead
-- Database constraints for business logic create poor UX with cryptic error messages
-- Better to validate in the UI with clear, user-friendly messages

BEGIN;

-- Drop the existing constraint
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS chk_annual_pricing;

COMMIT; 