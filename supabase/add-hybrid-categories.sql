-- Add hybrid categories system for flexible category management

-- Step 1: Create master categories table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    category_type TEXT NOT NULL CHECK (category_type IN ('system', 'user')),
    created_by UUID REFERENCES users(id), -- NULL for system categories
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicate names within the same type
    UNIQUE(name, category_type)
);

-- Step 2: Add indexes
CREATE INDEX idx_categories_type ON categories(category_type);
CREATE INDEX idx_categories_created_by ON categories(created_by);

-- Step 3: Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Step 4: Add RLS policies
CREATE POLICY "Anyone can view categories" ON categories 
FOR SELECT USING (TRUE);

CREATE POLICY "Only admins can create user categories" ON categories 
FOR INSERT WITH CHECK (
    category_type = 'user' AND 
    EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

CREATE POLICY "Only admins can modify their user categories" ON categories 
FOR UPDATE USING (
    category_type = 'user' AND 
    created_by = auth.uid() AND
    EXISTS (
        SELECT 1 FROM users 
        WHERE id = auth.uid() AND is_admin = TRUE
    )
);

-- Step 5: Update registration_categories table
ALTER TABLE registration_categories 
ADD COLUMN category_id UUID REFERENCES categories(id),
ADD COLUMN custom_name TEXT;

-- Add constraint: must have either category_id OR custom_name, not both
ALTER TABLE registration_categories 
ADD CONSTRAINT check_category_or_custom CHECK (
    (category_id IS NOT NULL AND custom_name IS NULL) OR 
    (category_id IS NULL AND custom_name IS NOT NULL)
);

-- Step 6: Add index for category lookups
CREATE INDEX idx_registration_categories_category ON registration_categories(category_id);

-- Step 7: Insert system categories
INSERT INTO categories (name, description, category_type, created_by) VALUES
('Player', 'Regular team player', 'system', NULL),
('Goalie', 'Goaltender/goalkeeper', 'system', NULL),
('Alternate', 'Substitute/backup player', 'system', NULL),
('Guest', 'Guest participant for tournaments/events', 'system', NULL),
('Coach', 'Team coach or assistant coach', 'system', NULL),
('Manager', 'Team manager or administrator', 'system', NULL),
('Referee', 'Game official/referee', 'system', NULL),
('Volunteer', 'General volunteer role', 'system', NULL);

-- Step 8: Migrate existing registration_categories to use custom_name
-- (This preserves any existing data as custom categories)
UPDATE registration_categories 
SET custom_name = name 
WHERE category_id IS NULL;

-- Step 9: Remove the old name column (it's now redundant)
ALTER TABLE registration_categories 
DROP COLUMN name;

-- Step 10: Add helpful comments
COMMENT ON TABLE categories IS 'Master categories table with system defaults and user-created categories';
COMMENT ON COLUMN categories.category_type IS 'system = built-in categories, user = organization-specific categories';
COMMENT ON COLUMN registration_categories.category_id IS 'Reference to master categories table (for reusable categories)';
COMMENT ON COLUMN registration_categories.custom_name IS 'One-off custom category name (for unique situations)';

-- Verification
SELECT 'Hybrid categories system created successfully!' as status;
SELECT COUNT(*) as system_categories_count FROM categories WHERE category_type = 'system';