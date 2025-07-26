-- Add allow_monthly column to memberships table
-- This allows disabling monthly pricing for certain membership types

ALTER TABLE memberships 
ADD COLUMN allow_monthly BOOLEAN DEFAULT TRUE;

-- Add comment explaining the new column
COMMENT ON COLUMN memberships.allow_monthly IS 'Whether monthly pricing is available for this membership type. When false, only annual pricing is offered.';

-- Note: No constraints added - when monthly pricing is disabled, the monthly price value
-- doesn't matter since it's never shown to users. This allows flexibility for admins
-- to update annual pricing without worrying about monthly price constraints. 