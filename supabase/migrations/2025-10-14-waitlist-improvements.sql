-- Waitlist Improvements Migration
-- Remove bypass code functionality (never implemented)
-- Add discount code support for waitlist entries

-- Remove bypass code columns (no longer needed)
ALTER TABLE waitlists DROP COLUMN IF EXISTS bypass_code_generated;
ALTER TABLE waitlists DROP COLUMN IF EXISTS bypass_code_id;

-- Add discount code support
ALTER TABLE waitlists ADD COLUMN IF NOT EXISTS discount_code_id UUID REFERENCES discount_codes(id);

-- Create index for discount code lookups
CREATE INDEX IF NOT EXISTS idx_waitlists_discount_code_id ON waitlists(discount_code_id);

-- Add comment explaining the discount code usage
COMMENT ON COLUMN waitlists.discount_code_id IS 'Optional discount code to be applied when user is selected from waitlist';
