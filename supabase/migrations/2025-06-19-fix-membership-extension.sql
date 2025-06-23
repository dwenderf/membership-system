-- Fix membership extension by removing unique constraint that prevents renewals
-- This allows users to purchase multiple memberships of the same type (extensions/renewals)

-- Drop the unique constraint that's preventing membership extensions
ALTER TABLE user_memberships 
DROP CONSTRAINT IF EXISTS user_memberships_user_id_membership_id_key;

-- We want to allow multiple membership purchases of the same type for extensions
-- The business logic handles preventing overlaps through date calculations

-- Add a comment to clarify the design
COMMENT ON TABLE user_memberships IS 'Stores individual membership purchases. Users can have multiple records for the same membership type to support extensions and renewals.';