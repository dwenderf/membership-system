-- Add is_goalie field to membership_analytics_data view for membership reports

-- Drop and recreate the view with is_goalie field
DROP VIEW IF EXISTS membership_analytics_data CASCADE;

CREATE OR REPLACE VIEW membership_analytics_data AS
WITH latest_memberships AS (
  -- Get the latest valid membership for each user per membership type
  SELECT DISTINCT ON (um.user_id, um.membership_id)
    um.user_id,
    um.membership_id,
    um.valid_until,
    um.valid_from,
    u.member_id,
    u.first_name,
    u.last_name,
    u.email,
    u.onboarding_completed_at,
    u.is_lgbtq,
    u.is_goalie,
    m.name as membership_name,
    m.description as membership_description
  FROM user_memberships um
  JOIN users u ON um.user_id = u.id
  JOIN memberships m ON um.membership_id = m.id
  WHERE um.payment_status = 'paid'
    AND um.valid_until >= CURRENT_DATE
    AND u.deleted_at IS NULL
  ORDER BY um.user_id, um.membership_id, um.valid_until DESC
),
membership_stats AS (
  -- Calculate statistics per membership type
  SELECT 
    membership_id,
    membership_name,
    membership_description,
    COUNT(*) as total_members,
    COUNT(*) FILTER (WHERE is_lgbtq = true) as lgbtq_count,
    COUNT(*) FILTER (WHERE is_lgbtq IS NULL) as prefer_not_to_say_count,
    COUNT(*) FILTER (WHERE is_goalie = true) as goalie_count,
    CASE 
      WHEN COUNT(*) - COUNT(*) FILTER (WHERE is_lgbtq IS NULL) > 0 
      THEN ROUND(
        (COUNT(*) FILTER (WHERE is_lgbtq = true)::DECIMAL / 
         (COUNT(*) - COUNT(*) FILTER (WHERE is_lgbtq IS NULL))) * 100, 1
      )
      ELSE 0 
    END as lgbtq_percent,
    CASE 
      WHEN COUNT(*) > 0 
      THEN ROUND(
        (COUNT(*) FILTER (WHERE is_goalie = true)::DECIMAL / COUNT(*)) * 100, 1
      )
      ELSE 0 
    END as goalie_percent
  FROM latest_memberships
  GROUP BY membership_id, membership_name, membership_description
)
SELECT 
  lm.*,
  ms.total_members,
  ms.lgbtq_count,
  ms.prefer_not_to_say_count,
  ms.lgbtq_percent,
  ms.goalie_count,
  ms.goalie_percent,
  (lm.valid_until - CURRENT_DATE) as days_to_expiration,
  CASE 
    WHEN (lm.valid_until - CURRENT_DATE) < 0 THEN 'Expired'
    WHEN (lm.valid_until - CURRENT_DATE) <= 30 THEN 'Expiring Soon'
    WHEN (lm.valid_until - CURRENT_DATE) <= 90 THEN 'Expiring'
    ELSE 'Active'
  END as expiration_status,
  CASE 
    WHEN lm.is_lgbtq = true THEN 'LGBTQ+'
    WHEN lm.is_lgbtq = false THEN 'Ally'
    ELSE 'No Response'
  END as lgbtq_status
FROM latest_memberships lm
JOIN membership_stats ms ON lm.membership_id = ms.membership_id
ORDER BY lm.membership_id, lm.last_name, lm.first_name;

-- Set security invoker to true (enables RLS)
ALTER VIEW membership_analytics_data SET (security_invoker = true);

-- Grant access only to authenticated users (RLS will handle admin filtering)
GRANT SELECT ON membership_analytics_data TO authenticated;

-- Add comments for documentation
COMMENT ON VIEW membership_analytics_data IS 'Comprehensive view for membership analytics with calculated statistics and member details. ADMIN ACCESS ONLY - This view contains sensitive member data and should only be accessed by admin users.';
COMMENT ON COLUMN membership_analytics_data.days_to_expiration IS 'Days until membership expires (negative if expired)';
COMMENT ON COLUMN membership_analytics_data.expiration_status IS 'Human-readable expiration status';
COMMENT ON COLUMN membership_analytics_data.lgbtq_status IS 'Human-readable LGBTQ+ status';
COMMENT ON COLUMN membership_analytics_data.lgbtq_percent IS 'Percentage of LGBTQ+ members (excluding "prefer not to say")';
COMMENT ON COLUMN membership_analytics_data.goalie_count IS 'Number of goalie members';
COMMENT ON COLUMN membership_analytics_data.goalie_percent IS 'Percentage of goalie members';