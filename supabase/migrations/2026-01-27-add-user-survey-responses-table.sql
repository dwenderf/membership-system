-- Migration: Add user survey responses table
-- Created: 2026-01-27
-- Purpose: Store reusable survey responses per user to enable pre-fill functionality across registrations

-- Create user survey responses table
CREATE TABLE user_survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  survey_id TEXT NOT NULL, -- Tally form ID (e.g., "VLzWBv")
  response_data JSONB NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent duplicate responses per user/survey combination
  UNIQUE(user_id, survey_id)
);

-- Indexes for performance
CREATE INDEX idx_user_survey_responses_user_id 
ON user_survey_responses(user_id);

CREATE INDEX idx_user_survey_responses_survey_id 
ON user_survey_responses(survey_id);

CREATE INDEX idx_user_survey_responses_data 
ON user_survey_responses USING GIN (response_data);

-- Enable RLS
ALTER TABLE user_survey_responses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own survey responses" ON user_survey_responses
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own survey responses" ON user_survey_responses
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own survey responses" ON user_survey_responses
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own survey responses" ON user_survey_responses
FOR DELETE USING (auth.uid() = user_id);

-- Comments for documentation
COMMENT ON TABLE user_survey_responses IS 'Reusable survey responses per user, enables pre-fill functionality';
COMMENT ON COLUMN user_survey_responses.user_id IS 'Reference to users table';
COMMENT ON COLUMN user_survey_responses.survey_id IS 'Tally form ID (e.g., VLzWBv)';
COMMENT ON COLUMN user_survey_responses.response_data IS 'JSONB storage for survey responses from Tally webhook';
COMMENT ON COLUMN user_survey_responses.completed_at IS 'When the user completed the survey';

-- Example usage:
--
-- Store a survey response:
-- INSERT INTO user_survey_responses (user_id, survey_id, response_data)
-- VALUES (
--   '123e4567-e89b-12d3-a456-426614174000',
--   'VLzWBv',
--   '{
--     "location": "Brooklyn, NY",
--     "country": "USA", 
--     "pronouns": "they/them",
--     "jersey_size": "L",
--     "positions": ["LW", "C"],
--     "backward_skating": 4,
--     "goal_scoring": 5,
--     "hockey_experience": "10 years competitive...",
--     "previous_teams": "NYC Warriors, Brooklyn Blades"
--   }'
-- );
--
-- Check if user has completed a survey:
-- SELECT response_data 
-- FROM user_survey_responses 
-- WHERE user_id = $1 AND survey_id = $2;