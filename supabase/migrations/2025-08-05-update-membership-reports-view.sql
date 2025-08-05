-- Update membership_reports_data view to use the new reports_financial_data view
DROP VIEW IF EXISTS membership_reports_data;

CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rfd.customer_name,
    rfd.invoice_created_at,
    rfd.invoice_updated_at,
    rfd.payment_amount,
    rfd.line_amount,
    rfd.line_item_id,
    rfd.invoice_id,
    rfd.invoice_number,
    rfd.payment_id,
    rfd.user_id,
    rfd.first_name,
    rfd.last_name,
    rfd.email,
    -- Line amount (no need for absolute value since we only get membership line items)
    rfd.line_amount as absolute_amount
FROM reports_financial_data rfd
LEFT JOIN user_memberships um ON rfd.payment_id = um.payment_id 
RIGHT JOIN memberships m ON um.membership_id = m.id  
WHERE rfd.line_item_type = 'membership'
  AND rfd.payment_id IS NOT NULL; -- Ensure we only get actual membership purchases

-- Add RLS policy for the view (admin only)
ALTER VIEW membership_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON membership_reports_data TO authenticated; 