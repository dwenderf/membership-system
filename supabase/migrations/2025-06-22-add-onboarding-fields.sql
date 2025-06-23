-- Migration: Add onboarding fields to users table
-- Created: 2025-06-22
-- Purpose: Add user onboarding tracking fields for terms acceptance and onboarding completion

-- Add new columns to users table
ALTER TABLE users 
ADD COLUMN onboarding_completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN terms_accepted_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN terms_version TEXT;

-- Mark all existing users as onboarded (they bypass the new onboarding flow)
-- Use current timestamp for existing users
UPDATE users 
SET 
    onboarding_completed_at = NOW(),
    terms_accepted_at = NOW(),
    terms_version = 'v1.0'
WHERE onboarding_completed_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.onboarding_completed_at IS 'Timestamp when user completed the onboarding process. NULL means not onboarded.';
COMMENT ON COLUMN users.terms_accepted_at IS 'Timestamp when user accepted terms and conditions.';
COMMENT ON COLUMN users.terms_version IS 'Version of terms and conditions accepted by user (e.g., v1.0, v2.1).';