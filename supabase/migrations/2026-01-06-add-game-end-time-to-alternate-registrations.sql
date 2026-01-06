-- Add game_end_time column to alternate_registrations table
-- This allows storing the end time for alternate games

ALTER TABLE alternate_registrations
ADD COLUMN game_end_time TIMESTAMP WITH TIME ZONE;

-- Create index for querying by game_end_time
CREATE INDEX idx_alternate_registrations_game_end_time
ON alternate_registrations(game_end_time);

-- Add a check constraint to ensure game_end_time is after game_date
ALTER TABLE alternate_registrations
ADD CONSTRAINT check_game_time_order CHECK (
    (game_date IS NULL AND game_end_time IS NULL) OR
    (game_date IS NOT NULL AND game_end_time IS NOT NULL AND game_end_time >= game_date)
);

-- Set default game_end_time for existing records as game_date + 90 minutes
UPDATE alternate_registrations
SET game_end_time = game_date + INTERVAL '90 minutes'
WHERE game_date IS NOT NULL AND game_end_time IS NULL;
