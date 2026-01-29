-- Migration: Add tournament registration type
-- Created: 2026-01-26
-- Purpose: Add 'tournament' as a valid registration type alongside team, scrimmage, and event

-- Add check constraint to enforce valid registration types
-- This replaces any existing implicit type validation
ALTER TABLE registrations
DROP CONSTRAINT IF EXISTS registrations_type_check;

ALTER TABLE registrations
ADD CONSTRAINT registrations_type_check
CHECK (type IN ('team', 'scrimmage', 'event', 'tournament'));

-- Add comment documenting the types
COMMENT ON COLUMN registrations.type IS 'Type of registration: team (season-long teams), scrimmage (single game), event (one-time event), tournament (multi-day competition with all-day scheduling)';

-- Example usage:
--
-- Creating a tournament registration:
-- INSERT INTO registrations (season_id, name, type, start_date, end_date)
-- VALUES (
--   'season-id',
--   'Chelsea Challenge 2026',
--   'tournament',
--   '2026-03-01 00:00:00+00',  -- Start of first day (midnight UTC)
--   '2026-03-03 23:59:59+00'   -- End of last day (end of day UTC)
-- );
--
-- Tournaments are treated as all-day events:
-- - Duration measured in days rather than minutes
-- - Calendar exports mark them as all-day events
-- - No specific start/end times, just dates
