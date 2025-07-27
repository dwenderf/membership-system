-- Create an enhanced reports view that includes membership IDs for proper grouping
-- This view joins xero_invoice_line_items with user_memberships to get membership IDs
DROP VIEW IF EXISTS reports_data_with_membership_ids;

CREATE VIEW reports_data_with_membership_ids AS
SELECT
    xil.id as line_item_id,
    xil.line_amount,
    xil.quantity,
    xil.line_item_type,
    xil.description,
    xil.created_at as line_item_created_at,
    xi.id as invoice_id,
    xi.invoice_number,
    xi.invoice_status,
    xi.sync_status,
    xi.created_at as invoice_created_at,
    xi.updated_at as invoice_updated_at,
    p.id as payment_id,
    p.status as payment_status,
    p.final_amount as payment_amount,
    p.created_at as payment_created_at,
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    -- Membership-specific fields (NULL for non-membership line items)
    um.membership_id,
    m.name as membership_name,
    m.description as membership_description,
    -- Computed fields for easier reporting
    CASE 
        WHEN xil.line_item_type = 'discount' THEN ABS(xil.line_amount)
        ELSE xil.line_amount
    END as absolute_amount,
    -- Full customer name
    CONCAT(u.first_name, ' ', u.last_name) as customer_name
FROM xero_invoice_line_items xil
INNER JOIN xero_invoices xi ON xil.xero_invoice_id = xi.id
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
-- Join to get membership information for membership line items
LEFT JOIN user_memberships um ON p.id = um.payment_id
LEFT JOIN memberships m ON um.membership_id = m.id
WHERE xi.sync_status = 'synced'
  AND xi.invoice_status != 'DRAFT'
  AND p.status = 'completed';

-- Add RLS policy for the view (admin only)
ALTER VIEW reports_data_with_membership_ids SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON reports_data_with_membership_ids TO authenticated; 