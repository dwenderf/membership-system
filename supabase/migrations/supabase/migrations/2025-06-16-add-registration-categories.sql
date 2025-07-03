-- Add registration categories table
CREATE TABLE registration_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- "Player", "Goalie", "Alternate", "Guest"
    max_capacity INTEGER,
    current_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0, -- for display ordering
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicate category names within a registration
    UNIQUE(registration_id, name)
);

-- Add index for efficient queries
CREATE INDEX idx_registration_categories_registration ON registration_categories(registration_id);

-- Update user_registrations table to reference categories
ALTER TABLE user_registrations 
ADD COLUMN registration_category_id UUID REFERENCES registration_categories(id);

-- Update registration_pricing_tiers to support category-specific pricing
ALTER TABLE registration_pricing_tiers 
ADD COLUMN registration_category_id UUID REFERENCES registration_categories(id);

-- Add index for pricing tier queries
CREATE INDEX idx_registration_pricing_tiers_category ON registration_pricing_tiers(registration_category_id);

-- Enable RLS for new table
ALTER TABLE registration_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies for registration_categories
CREATE POLICY "Anyone can view registration categories" ON registration_categories 
FOR SELECT USING (TRUE);

CREATE POLICY "Authenticated users can manage registration categories" ON registration_categories 
FOR ALL USING (auth.role() = 'authenticated');

-- Update existing policies comments
COMMENT ON TABLE registration_categories IS 'Categories within registrations (Player, Goalie, etc) with individual capacity limits';
COMMENT ON COLUMN registration_categories.sort_order IS 'Order for displaying categories (0 = first)';
COMMENT ON COLUMN registration_pricing_tiers.registration_category_id IS 'If NULL, pricing applies to all categories in the registration';
COMMENT ON COLUMN user_registrations.registration_category_id IS 'Specific category user registered for (Player, Goalie, etc)';