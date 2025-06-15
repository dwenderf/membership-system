-- Apply registration categories migration to Supabase database
-- Run this in your Supabase SQL Editor

-- Step 1: Create registration_categories table
CREATE TABLE IF NOT EXISTS registration_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- "Player", "Goalie", "Alternate", "Guest"
    max_capacity INTEGER,
    current_count INTEGER DEFAULT 0,
    accounting_code TEXT, -- accounting code for this category
    sort_order INTEGER DEFAULT 0, -- for display ordering
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicate category names within a registration
    UNIQUE(registration_id, name)
);

-- Step 2: Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_registration_categories_registration ON registration_categories(registration_id);

-- Step 3: Enable RLS for new table
ALTER TABLE registration_categories ENABLE ROW LEVEL SECURITY;

-- Step 4: Add RLS policies
CREATE POLICY "Anyone can view registration categories" ON registration_categories 
FOR SELECT USING (TRUE);

CREATE POLICY "Only admins can modify registration categories" ON registration_categories
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

-- Step 5: Update user_registrations to reference categories
ALTER TABLE user_registrations 
ADD COLUMN IF NOT EXISTS registration_category_id UUID REFERENCES registration_categories(id);

-- Step 6: Update registration_pricing_tiers to support category-specific pricing
ALTER TABLE registration_pricing_tiers 
ADD COLUMN IF NOT EXISTS registration_category_id UUID REFERENCES registration_categories(id);

-- Step 7: Add index for pricing tier queries
CREATE INDEX IF NOT EXISTS idx_registration_pricing_tiers_category ON registration_pricing_tiers(registration_category_id);

-- Step 8: Remove redundant fields from registrations table
ALTER TABLE registrations 
DROP COLUMN IF EXISTS max_capacity,
DROP COLUMN IF EXISTS current_count,
DROP COLUMN IF EXISTS accounting_code;

-- Step 9: Add helpful comments
COMMENT ON TABLE registrations IS 'Main registration records (teams, events, etc) - capacity and accounting managed per category';
COMMENT ON TABLE registration_categories IS 'Categories within registrations (Player, Goalie, etc) with individual capacity limits and accounting codes';
COMMENT ON COLUMN registration_categories.accounting_code IS 'Optional accounting code for this category (e.g., TEAM-PLAYER, TOURNAMENT-GOALIE)';
COMMENT ON COLUMN registration_pricing_tiers.registration_category_id IS 'If NULL, pricing applies to all categories in the registration';
COMMENT ON COLUMN user_registrations.registration_category_id IS 'Specific category user registered for (Player, Goalie, etc)';

-- Verify the changes
SELECT 'registration_categories table created' as status;
SELECT 'Columns removed from registrations table' as status;
SELECT 'Migration complete!' as status;