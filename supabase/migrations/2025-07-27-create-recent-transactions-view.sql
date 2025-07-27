-- Drop the existing view first to allow column type changes
DROP VIEW IF EXISTS recent_transactions;

-- Create a view for recent transactions that joins all necessary tables
-- This provides a clean interface for the reports API to get transaction data
CREATE VIEW recent_transactions AS
SELECT 
    xi.id as transaction_id,
    xi.invoice_number,
    xi.net_amount as amount,
    xi.invoice_status as status,
    xi.created_at as transaction_date,
    xi.staging_metadata,
    p.id as payment_id,
    p.final_amount as payment_amount,
    p.created_at as payment_date,
    u.id as user_id,
    u.first_name,
    u.last_name,
    u.email,
    -- Use item_type from xero_invoice_line_items to determine transaction type
    COALESCE(
        (SELECT xili.line_item_type 
         FROM xero_invoice_line_items xili 
         WHERE xili.xero_invoice_id = xi.id 
         LIMIT 1),
        'unknown'::text
    ) as transaction_type,
    -- Get the actual item ID from line items
    (SELECT xili.item_id 
     FROM xero_invoice_line_items xili 
     WHERE xili.xero_invoice_id = xi.id 
     LIMIT 1) as item_id
FROM xero_invoices xi
LEFT JOIN payments p ON xi.payment_id = p.id
LEFT JOIN users u ON p.user_id = u.id
WHERE xi.payment_id IS NOT NULL
  AND p.status = 'completed'
ORDER BY xi.created_at DESC;

-- Add RLS policy for the view (admin only)
ALTER VIEW recent_transactions SET (security_invoker = true);

-- Grant access to the view
GRANT SELECT ON recent_transactions TO authenticated; 