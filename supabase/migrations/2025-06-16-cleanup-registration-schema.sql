-- Remove redundant fields from registrations table
-- These are now managed at the category level

-- Remove max_capacity, current_count, and accounting_code from registrations
ALTER TABLE registrations 
DROP COLUMN IF EXISTS max_capacity,
DROP COLUMN IF EXISTS current_count,
DROP COLUMN IF EXISTS accounting_code;

-- Add accounting_code to registration_categories if not exists
ALTER TABLE registration_categories 
ADD COLUMN IF NOT EXISTS accounting_code TEXT;

-- Add helpful comments
COMMENT ON TABLE registrations IS 'Main registration records (teams, events, etc) - capacity and accounting managed per category';
COMMENT ON TABLE registration_categories IS 'Categories within registrations (Player, Goalie, etc) with individual capacity limits and accounting codes';
COMMENT ON COLUMN registration_categories.accounting_code IS 'Optional accounting code for this category (e.g., TEAM-PLAYER, TOURNAMENT-GOALIE)';

-- Update any existing data if needed (this is a no-op since we don't have data yet)
-- In a real migration, you might want to:
-- 1. Copy existing registration accounting codes to a default category
-- 2. Copy existing capacity limits to categories
-- But since this is early development, we can just clean up the schema