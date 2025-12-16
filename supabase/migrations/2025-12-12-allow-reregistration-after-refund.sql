-- Allow users to re-register after refund by making the unique constraint conditional
-- This changes the UNIQUE constraint to only apply to non-refunded registrations

-- Drop the existing unique constraint on user_registrations
ALTER TABLE user_registrations DROP CONSTRAINT IF EXISTS user_registrations_user_id_registration_id_key;

-- Create a partial unique index that only applies to paid registrations
-- This allows users to have multiple refunded/failed registrations but only one paid registration per registration
CREATE UNIQUE INDEX user_registrations_active_unique
ON user_registrations(user_id, registration_id)
WHERE payment_status = 'paid';

-- Add comment explaining the change
COMMENT ON INDEX user_registrations_active_unique IS
'Ensures a user can only have one active (paid) registration per registration. Allows re-registration after refund since refunded registrations are excluded from this constraint.';
