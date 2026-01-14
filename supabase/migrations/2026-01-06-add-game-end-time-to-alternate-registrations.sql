-- Add game_end_time column to alternate_registrations table
-- This allows storing the end time for alternate games

ALTER TABLE alternate_registrations
ADD COLUMN game_end_time TIMESTAMP WITH TIME ZONE;

-- Backfill existing records with game_end_time = game_date + 90 minutes
-- This must happen BEFORE adding constraints
UPDATE alternate_registrations
SET game_end_time = game_date + INTERVAL '90 minutes'
WHERE game_end_time IS NULL;

-- Add NOT NULL constraint to game_end_time since game_date is always NOT NULL
ALTER TABLE alternate_registrations
ALTER COLUMN game_end_time SET NOT NULL;

-- Add a check constraint to ensure game_end_time is after or equal to game_date
ALTER TABLE alternate_registrations
ADD CONSTRAINT check_game_time_order CHECK (game_end_time >= game_date);

-- Create index for querying by game_end_time
CREATE INDEX idx_alternate_registrations_game_end_time
ON alternate_registrations(game_end_time);
