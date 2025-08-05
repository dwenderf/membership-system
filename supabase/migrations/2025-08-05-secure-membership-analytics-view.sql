-- Secure the membership_analytics_data view to admin-only access
-- This view contains sensitive member data and should be restricted

-- Set security invoker to true (enables RLS)
ALTER VIEW membership_analytics_data SET (security_invoker = true);

-- Grant access only to authenticated users (RLS will handle admin filtering)
GRANT SELECT ON membership_analytics_data TO authenticated;

-- Add comment about security
COMMENT ON VIEW membership_analytics_data IS 'Comprehensive view for membership analytics with calculated statistics and member details. ADMIN ACCESS ONLY - This view contains sensitive member data and should only be accessed by admin users.'; 