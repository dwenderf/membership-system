-- Create consolidated view of user memberships
-- Groups by user and membership type, showing latest expiration date and status

CREATE OR REPLACE VIEW user_memberships_consolidated AS
SELECT 
  um.user_id,
  um.membership_id,
  m.name as membership_name,
  m.description as membership_description,
  MAX(um.valid_until) as latest_expiration,
  MIN(um.valid_from) as member_since,
  MAX(um.valid_until) >= CURRENT_DATE as is_active
FROM user_memberships um
INNER JOIN memberships m ON m.id = um.membership_id
WHERE um.payment_status = 'paid'  -- Only include paid memberships
GROUP BY 
  um.user_id, 
  um.membership_id, 
  m.name, 
  m.description
ORDER BY latest_expiration DESC;

-- Add comment explaining the view
COMMENT ON VIEW user_memberships_consolidated IS 
'Consolidated view of user memberships grouped by membership type. Shows latest expiration date and active status for each membership type per user.';