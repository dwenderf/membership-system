-- Migration: Add survey support to registrations
-- Created: 2026-01-21
-- Purpose: Enable integration with external survey tools (Formbricks, Tally, etc.) for registration questionnaires

-- Add survey fields to registrations table
ALTER TABLE registrations
ADD COLUMN survey_id TEXT,
ADD COLUMN require_survey BOOLEAN DEFAULT FALSE;

-- Add survey responses to user_registrations table
ALTER TABLE user_registrations
ADD COLUMN survey_responses JSONB;

-- Indexes for performance
CREATE INDEX idx_registrations_survey
ON registrations(survey_id)
WHERE survey_id IS NOT NULL;

CREATE INDEX idx_user_registrations_survey_responses
ON user_registrations USING GIN (survey_responses)
WHERE survey_responses IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN registrations.survey_id IS 'External survey ID (Formbricks survey ID, Tally form ID, etc.)';
COMMENT ON COLUMN registrations.require_survey IS 'If true, users must complete survey before proceeding to payment';
COMMENT ON COLUMN user_registrations.survey_responses IS 'JSONB storage for survey responses from external survey tool';

-- Example usage:
--
-- Setting up a registration with survey:
-- UPDATE registrations
-- SET survey_id = 'cmkvdmu2804u4ad01o4ve1lj1',
--     require_survey = true
-- WHERE name = 'Chelsea Challenge 2026';
--
-- Survey responses will be stored as:
-- {
--   "location": "Brooklyn, NY",
--   "country": "USA",
--   "pronouns": "they/them",
--   "jersey_size": "L",
--   "positions": ["LW", "C"],
--   "backward_skating": 4,
--   "goal_scoring": 5,
--   "hockey_experience": "10 years competitive...",
--   "previous_teams": "NYC Warriors, Brooklyn Blades"
-- }
