-- Migration: Rename survey_id to action_key in registrations table
-- Created: 2026-01-27
-- Purpose: Improve clarity by renaming survey_id to action_key to reflect Formbricks action-based triggers

-- Rename the column
ALTER TABLE registrations 
RENAME COLUMN survey_id TO action_key;

-- Drop existing index (it will have the old column name)
DROP INDEX IF EXISTS idx_registrations_survey;

-- Create new index with updated name
CREATE INDEX idx_registrations_action_key
ON registrations(action_key)
WHERE action_key IS NOT NULL;

-- Update the comment for clarity
COMMENT ON COLUMN registrations.action_key IS 'Formbricks action key for triggering surveys (e.g., "cc26_tournament_survey", "team_registration_survey")';

-- Example usage:
--
-- Setting up a registration with survey action:
-- UPDATE registrations
-- SET action_key = 'cc26_tournament_survey',
--     require_survey = true
-- WHERE name = 'Chelsea Challenge 2026';
--
-- The action_key corresponds to action triggers configured in Formbricks dashboard
-- Survey responses are still stored in user_registrations.survey_responses as JSONB