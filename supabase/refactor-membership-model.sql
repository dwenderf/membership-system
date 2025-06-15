-- Refactor membership model to duration-based types with monthly/annual pricing
-- This migration transforms the current season-based memberships into flexible membership types

BEGIN;

-- Step 1: Add new columns to memberships table
ALTER TABLE memberships 
  ADD COLUMN description TEXT,
  ADD COLUMN price_monthly INTEGER, -- in cents
  ADD COLUMN price_annual INTEGER; -- in cents

-- Step 2: Update existing memberships with default pricing
-- Set reasonable defaults based on current price (assume current price is monthly)
UPDATE memberships 
SET 
  price_monthly = price,
  price_annual = price * 10, -- 10x monthly = 2 months free annually
  description = 'Converted from season-based membership';

-- Step 3: Make new columns required
ALTER TABLE memberships 
  ALTER COLUMN price_monthly SET NOT NULL,
  ALTER COLUMN price_annual SET NOT NULL;

-- Step 4: Remove season_id dependency from memberships
ALTER TABLE memberships DROP COLUMN season_id;

-- Step 5: Update user_memberships table to track duration-based purchases
ALTER TABLE user_memberships 
  ADD COLUMN valid_from DATE,
  ADD COLUMN valid_until DATE,
  ADD COLUMN months_purchased INTEGER;

-- Step 6: Set default values for existing user_memberships
-- Assume existing memberships are valid for the current fiscal year
UPDATE user_memberships 
SET 
  valid_from = CURRENT_DATE,
  valid_until = CURRENT_DATE + INTERVAL '12 months',
  months_purchased = 12
WHERE valid_from IS NULL;

-- Step 7: Make new columns required
ALTER TABLE user_memberships 
  ALTER COLUMN valid_from SET NOT NULL,
  ALTER COLUMN valid_until SET NOT NULL;

-- Step 8: Drop the old price column from memberships (now have monthly/annual)
ALTER TABLE memberships DROP COLUMN price;

-- Step 9: Update registration_categories to reference membership types
-- The required_membership_id already exists, so we just need to ensure it can be null
-- (it already can be null from our previous migration)

-- Step 10: Create indexes for performance
CREATE INDEX idx_user_memberships_validity ON user_memberships(user_id, valid_from, valid_until);
CREATE INDEX idx_user_memberships_membership_type ON user_memberships(membership_id);

-- Step 11: Add a check constraint to ensure valid_until > valid_from
ALTER TABLE user_memberships 
  ADD CONSTRAINT chk_membership_validity 
  CHECK (valid_until > valid_from);

-- Step 12: Add a check constraint to ensure price_annual offers some discount
ALTER TABLE memberships 
  ADD CONSTRAINT chk_annual_pricing 
  CHECK (price_annual <= price_monthly * 12);

COMMIT;

-- Verification queries to check the migration
-- 1. Check memberships structure
SELECT 
  name,
  description,
  price_monthly,
  price_annual,
  (price_monthly * 12 - price_annual) AS annual_savings_cents,
  accounting_code
FROM memberships
ORDER BY name;

-- 2. Check user_memberships structure  
SELECT 
  um.id,
  u.email,
  m.name as membership_name,
  um.valid_from,
  um.valid_until,
  um.months_purchased,
  um.payment_status
FROM user_memberships um
JOIN users u ON um.user_id = u.id
JOIN memberships m ON um.membership_id = m.id
ORDER BY um.valid_until DESC;

-- 3. Check registration_categories with membership requirements
SELECT 
  rc.id,
  r.name as registration_name,
  COALESCE(rc.custom_name, c.name) as category_name,
  m.name as required_membership,
  CASE 
    WHEN rc.required_membership_id IS NULL THEN 'No membership required'
    ELSE 'Membership required'
  END as membership_requirement
FROM registration_categories rc
JOIN registrations r ON rc.registration_id = r.id
LEFT JOIN categories c ON rc.category_id = c.id
LEFT JOIN memberships m ON rc.required_membership_id = m.id
ORDER BY r.name, rc.sort_order;