-- Mark reports_data view as deprecated
-- This view is deprecated as of August 5, 2025
-- Use reports_financial_data view instead for financial reporting
-- This view is kept for backward compatibility with reports_active_memberships

-- Add deprecation comment to the view
COMMENT ON VIEW reports_data IS 'DEPRECATED: This view is deprecated as of August 5, 2025. Use reports_financial_data view instead for financial reporting. This view is kept for backward compatibility with reports_active_memberships.'; 