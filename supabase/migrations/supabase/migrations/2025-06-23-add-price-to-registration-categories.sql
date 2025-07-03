-- Add price field to registration_categories table
-- Migration: Add price field without default value

-- First add as nullable to handle existing records
ALTER TABLE public.registration_categories 
ADD COLUMN IF NOT EXISTS price INTEGER;

-- Update any existing records to have a price (admins will need to review and update these)
UPDATE public.registration_categories 
SET price = 2500 -- $25.00 as a reasonable starting point for existing records
WHERE price IS NULL;

-- Now make it NOT NULL (no default, forcing explicit price entry for new records)
ALTER TABLE public.registration_categories 
ALTER COLUMN price SET NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.registration_categories.price IS 'Price in cents (no default - must be set explicitly)';