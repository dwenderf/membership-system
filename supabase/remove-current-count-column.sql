-- Remove current_count column from registration_categories
-- This should be calculated dynamically to prevent data inconsistency

-- Remove the current_count column since it should be calculated
ALTER TABLE registration_categories 
DROP COLUMN IF EXISTS current_count;

-- Add comment explaining the approach
COMMENT ON TABLE registration_categories IS 'Categories within registrations (Player, Goalie, etc) with individual capacity limits - current count calculated from user_registrations';

-- Example query for calculating current count:
-- SELECT 
--   rc.*,
--   COALESCE(ur.current_count, 0) as current_count
-- FROM registration_categories rc
-- LEFT JOIN (
--   SELECT 
--     registration_category_id,
--     COUNT(*) as current_count
--   FROM user_registrations 
--   WHERE payment_status = 'paid'  -- or confirmed status
--   GROUP BY registration_category_id
-- ) ur ON rc.id = ur.registration_category_id;

SELECT 'current_count column removed from registration_categories' as status;
SELECT 'Current count should now be calculated dynamically' as message;