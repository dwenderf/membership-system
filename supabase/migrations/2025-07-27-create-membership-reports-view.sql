-- Create a membership-specific reports view that starts from memberships table
-- This ensures consistent membership names regardless of Xero line item descriptions

-- Drop the old view in case it was previously implemented
DROP VIEW IF EXISTS reports_data_with_membership_ids;

DROP VIEW IF EXISTS membership_reports_data;

CREATE VIEW membership_reports_data AS
SELECT
    m.id as membership_id,
    m.name as membership_name,
    m.description as membership_description,
    rd.customer_name,
    rd.invoice_created_at,
    rd.invoice_updated_at,
    rd.payment_amount,
    rd.line_amount,
    rd.line_item_id,
    rd.invoice_id,
    rd.invoice_number,
    rd.payment_id,
    rd.user_id,
    rd.first_name,
    rd.last_name,
    rd.email,
    -- Line amount (no need for absolute value since we only get membership line items)
    rd.line_amount as absolute_amount
FROM reports_data rd
LEFT JOIN user_memberships um ON rd.payment_id = um.payment_id 
RIGHT JOIN memberships m ON um.membership_id = m.id  
WHERE rd.line_item_type = 'membership'
  AND rd.payment_id IS NOT NULL; -- Ensure we only get actual membership purchases

-- Add RLS policy for the view (admin only)
ALTER VIEW membership_reports_data SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON membership_reports_data TO authenticated; 