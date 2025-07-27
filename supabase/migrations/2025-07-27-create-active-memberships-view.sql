-- Create a view for active memberships data (grouped by membership type)
-- This view joins user_memberships with users and memberships and groups by membership type
DROP VIEW IF EXISTS reports_active_memberships;

CREATE VIEW reports_active_memberships AS
SELECT
    um.membership_id,
    m.name as membership_name,
    COUNT(DISTINCT um.user_id) as active_member_count
FROM user_memberships um
INNER JOIN users u ON um.user_id = u.id
INNER JOIN memberships m ON um.membership_id = m.id
WHERE um.payment_status = 'paid'
  AND um.valid_until > NOW()
GROUP BY um.membership_id, m.name
ORDER BY active_member_count DESC;

-- Add RLS policy for the view (admin only)
ALTER VIEW reports_active_memberships SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_active_memberships TO authenticated;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_memberships_user_membership ON user_memberships(user_id, membership_id);
CREATE INDEX IF NOT EXISTS idx_user_memberships_payment_validity ON user_memberships(payment_status, valid_until); 