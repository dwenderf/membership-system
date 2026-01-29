-- Migration: Remove survey_responses field from user_registrations
-- Created: 2026-01-28
-- Purpose: Remove survey_responses JSONB column from user_registrations table since we're using normalized user_survey_responses table

-- Drop the index first
DROP INDEX IF EXISTS idx_user_registrations_survey_responses;

-- Drop the survey_responses column
ALTER TABLE user_registrations
DROP COLUMN IF EXISTS survey_responses;

-- Migration complete: user_registrations table no longer stores survey responses directly
-- Survey responses are now stored in the normalized user_survey_responses table