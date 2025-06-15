-- Move membership requirements from registrations to registration_categories
-- This allows category-specific membership requirements (e.g., Players need membership, Guests don't)

-- Step 1: Add required_membership_id to registration_categories
ALTER TABLE registration_categories 
ADD COLUMN required_membership_id UUID REFERENCES memberships(id);

-- Step 2: Migrate existing data from registrations to registration_categories
-- Copy the required_membership_id from registrations to all their categories
UPDATE registration_categories 
SET required_membership_id = r.required_membership_id
FROM registrations r 
WHERE registration_categories.registration_id = r.id 
AND r.required_membership_id IS NOT NULL;

-- Step 3: Remove required_membership_id from registrations
ALTER TABLE registrations DROP COLUMN required_membership_id;

-- Step 4: Add index for performance
CREATE INDEX idx_registration_categories_membership ON registration_categories(required_membership_id);

-- Verification queries
SELECT 'Migration completed successfully!' as status;

-- Show registrations and their category membership requirements
SELECT 
    r.name as registration_name,
    r.type as registration_type,
    COALESCE(rc.custom_name, c.name) as category_name,
    m.name as required_membership,
    m.price as membership_price
FROM registrations r
LEFT JOIN registration_categories rc ON r.id = rc.registration_id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN memberships m ON rc.required_membership_id = m.id
ORDER BY r.name, rc.sort_order;