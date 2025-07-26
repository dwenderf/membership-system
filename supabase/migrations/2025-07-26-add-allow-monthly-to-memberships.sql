-- Add allow_monthly column to memberships table
-- This allows disabling monthly pricing for certain membership types

ALTER TABLE memberships 
ADD COLUMN allow_monthly BOOLEAN DEFAULT TRUE;

-- Add comment explaining the new column
COMMENT ON COLUMN memberships.allow_monthly IS 'Whether monthly pricing is available for this membership type. When false, only annual pricing is offered.';

-- Update the constraint to allow annual-only memberships
-- Remove the existing constraint that requires annual <= monthly * 12
ALTER TABLE memberships 
DROP CONSTRAINT IF EXISTS chk_annual_pricing;

-- Add new constraint that only applies when monthly is allowed
ALTER TABLE memberships 
ADD CONSTRAINT chk_annual_pricing 
CHECK (
  (allow_monthly = false) OR 
  (allow_monthly = true AND price_annual <= price_monthly * 12)
);

-- Add constraint to ensure monthly price is 0 when monthly is not allowed
ALTER TABLE memberships 
ADD CONSTRAINT chk_monthly_price_when_disabled 
CHECK (
  (allow_monthly = true) OR 
  (allow_monthly = false AND price_monthly = 0)
); 